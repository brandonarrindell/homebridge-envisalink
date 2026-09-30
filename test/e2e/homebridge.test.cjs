'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { DscSimulator, frame } = require('./dsc-simulator.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BRIDGE_PIN = '031-45-154'; // Synthetic test credentials only.
const TYPES = {
  information: '3E', switch: '49', security: '7E', name: '23', serial: '30', on: '25',
  contact: '6A', motion: '22', leak: '70', smoke: '76', current: '66', target: '67',
};

function isType(actual, expected) {
  return actual === expected || actual === `000000${expected}-0000-1000-8000-0026BB765291`;
}

async function until(description, predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(100);
  } while (Date.now() < end);
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

async function freePort(excluded = []) {
  // Keep the restart-stable HAP ports outside macOS/Linux client ephemeral
  // ranges. Otherwise a HAP client's new source port can occupy the bridge's
  // temporarily closed listening port between process restarts (EADDRINUSE).
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = 20000 + randomBytes(2).readUInt16BE(0) % 10000;
    if (excluded.includes(port)) continue;
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    } catch (error) {
      if (error.code === 'EADDRINUSE') continue;
      throw error;
    }
    await new Promise(resolve => server.close(resolve));
    return port;
  }
  throw new Error('Cannot find an available isolated HAP port');
}

function homebridgeBinary() {
  if (process.env.HOMEBRIDGE_BIN) return path.resolve(process.env.HOMEBRIDGE_BIN);
  // Homebridge 2 exports its entrypoint but intentionally not package.json.
  let directory = path.dirname(require.resolve('homebridge'));
  while (!fsSync.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot locate Homebridge package metadata');
    directory = parent;
  }
  const manifest = JSON.parse(fsSync.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const binary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.homebridge;
  return path.resolve(directory, binary);
}

class HomebridgeHarness {
  constructor(storage, port, panel, options = {}) {
    this.storage = storage;
    this.mainPort = port;
    this.port = options.childPort || port;
    this.options = options;
    this.panel = panel;
    this.run = 0;
    this.output = '';
    this.allOutput = '';
    this.username = ['0E', ...randomBytes(5).toString('hex').match(/../g)].join(':').toUpperCase();
  }

  config(customCommands) {
    return {
      bridge: {
        name: 'Envisalink Isolated E2E', username: this.username, pin: BRIDGE_PIN,
        port: this.mainPort, bind: ['127.0.0.1'], advertiser: 'ciao',
      },
      accessories: [],
      platforms: [{
        platform: 'Envisalink', name: 'E2E DSC', host: '127.0.0.1', port: this.panel.port,
        password: 'user', pin: '1234', enableAutoDiscovery: false, suppressClockReset: true,
        partitions: [{ name: 'Main Alarm' }, { name: 'Second Alarm', pin: '5678' }],
        zones: [
          { name: 'Front Door', type: 'door', partition: 1, zoneNumber: 1 },
          { name: 'Hall Motion', type: 'motion', partition: 1, zoneNumber: 2 },
          { name: 'Smoke Sensor', type: 'smoke', partition: 2, zoneNumber: 3 },
          { name: 'Leak Sensor', type: 'leak', partition: 2, zoneNumber: 4 },
          { name: 'Window Sensor', type: 'window', partition: 2, zoneNumber: 7 },
        ],
        firePanic: { enabled: true, name: 'Test Fire Panic' },
        ambulancePanic: { enabled: true, name: 'Test Ambulance Panic' },
        policePanic: { enabled: true, name: 'Test Police Panic' },
        ...(customCommands === undefined ? {} : { customCommands }),
        ...this.options.platform,
        ...(this.options.childPort ? { _bridge: { username: this.username.replace(/^0E/, '0C'),
          port: this.port, ...(this.options.bridgeName ? { name: this.options.bridgeName } : {}) } } : {}),
      }],
    };
  }

  async start(commands) {
    this.run++;
    this.output = '';
    await fs.writeFile(path.join(this.storage, 'config.json'), JSON.stringify(this.config(commands), null, 2));
    const binary = homebridgeBinary();
    const preload = process.env.E2E_LOOPBACK_ONLY === '1' ? ['--require', path.join(__dirname, 'loopback-only.cjs')] : [];
    this.child = spawn(process.env.HOMEBRIDGE_NODE || process.execPath, [...preload, binary, '-D', '-I', '-Q', '-T',
      '-U', this.storage, '-P', ROOT, '--strict-plugin-resolution'], {
      cwd: ROOT, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.closed = new Promise(resolve => this.child.once('close', (code, signal) => resolve({ code, signal })));
    this.child.once('error', error => { this.output += `Spawn error: ${error.stack}\n`; });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream.on('data', chunk => {
        this.output += chunk.toString();
        this.allOutput += chunk.toString();
      });
    }
    const loginBaseline = this.panel.logins;
    await until('Homebridge loaded plugin and received DSC status', async () => {
      if (this.child.exitCode !== null) throw new Error(this.output.slice(-4000));
      if (this.panel.logins <= loginBaseline) return false;
      const accessories = await this.accessories();
      return accessories.find(accessory => this.serial(accessory) === 'Partition 1 Zone 1');
    });
  }

  request(method, endpoint, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request({
        host: '127.0.0.1', port: this.port, path: endpoint, method,
        headers: { Authorization: BRIDGE_PIN, 'Content-Type': 'application/hap+json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode, data: text ? JSON.parse(text) : undefined }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.setTimeout(10000, () => request.destroy(new Error('HAP HTTP request timed out')));
      request.end(data);
    });
  }

  async accessories() {
    const response = await this.request('GET', '/accessories');
    assert.equal(response.status, 200);
    return response.data.accessories;
  }

  characteristic(accessory, type, serviceType) {
    for (const service of accessory.services) {
      if (serviceType && !isType(service.type, serviceType)) continue;
      const characteristic = service.characteristics.find(item => isType(item.type, type));
      if (characteristic) return { aid: accessory.aid, iid: characteristic.iid, value: characteristic.value };
    }
    throw new Error(`Missing characteristic ${type} on AID ${accessory.aid}`);
  }

  serial(accessory) { return this.characteristic(accessory, TYPES.serial, TYPES.information).value; }

  async bySerial(serial) {
    const matches = (await this.accessories()).filter(accessory => this.serial(accessory) === serial);
    assert.equal(matches.length, 1, `Exactly one accessory for serial ${serial}`);
    return matches[0];
  }

  async read(id) {
    const response = await this.request('GET', `/characteristics?id=${id.aid}.${id.iid}`);
    assert.equal(response.status, 200);
    return response.data.characteristics[0].value;
  }

  async write(id, value) {
    const response = await this.request('PUT', '/characteristics', {
      characteristics: [{ aid: id.aid, iid: id.iid, value }],
    });
    assert.equal(response.status, 204, JSON.stringify(response));
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 8000);
    await this.closed;
    clearTimeout(killTimer);
    await fs.writeFile(path.join(this.storage, `homebridge-${this.run}.log`), this.output);
    this.child = undefined;
  }

  cacheName() {
    return this.options.childPort ? `cachedAccessories.${this.username.replace(/^0E/, '0C').replace(/:/g, '')}` : 'cachedAccessories';
  }

  async cache() {
    return JSON.parse(await fs.readFile(path.join(this.storage, 'accessories', this.cacheName()), 'utf8'));
  }

  async writeCache(cache) {
    await fs.writeFile(path.join(this.storage, 'accessories', this.cacheName()), JSON.stringify(cache));
  }
}

test('real Homebridge + DSC TCP + HAP: controls, persisted cache reconciliation, reconnect', { timeout: 240000 }, async t => {
  // These examples anchor the simulator checksum implementation independently.
  assert.equal(frame('5053'), '5053CD\r\n');
  assert.equal(frame('005user'), '005user54\r\n');
  assert.equal(frame('6543'), '6543D2\r\n');
  await fs.access(path.join(ROOT, 'dist/index.js')); // Run npm run build first.
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'envisalink-e2e-'));
  const panel = await new DscSimulator().start();
  const bridge = new HomebridgeHarness(storage, await freePort(), panel);
  const initialCommands = [{ name: 'Output One', command: '02011' }, { name: 'Output Two', command: '02012' }];
  let passed = false;

  async function expectCommand(command, action) {
    const start = panel.commands.length;
    await action();
    await until(`DSC command ${command}`, () => panel.commands.slice(start).some(item => item.body === command));
    assert.equal(panel.commands.slice(start).filter(item => item.body === command).length, 1);
  }

  async function expectPreserved() {
    const serials = (await bridge.accessories()).map(accessory => bridge.serial(accessory));
    for (const serial of ['Partition 1', 'Partition 2', 'Partition 1 Zone 1', 'Partition 1 Zone 2',
      'Partition 2 Zone 3', 'Partition 2 Zone 4', 'Partition 2 Zone 7', 'Panic', 'Unknown E2E']) {
      assert.equal(serials.filter(value => value === serial).length, 1, `Preserve ${serial} without duplication`);
    }
  }

  try {
    await bridge.start(initialCommands);
    assert.ok(panel.commands.some(item => item.body === '005user'));
    assert.ok(panel.commands.some(item => item.body === '001'));
    t.diagnostic('PASS: real Homebridge plugin startup, DSC authentication, initial batched status report');

    for (const [zone, partition, type] of [[1, 1, 'contact'], [2, 1, 'motion'], [3, 2, 'smoke'], [4, 2, 'leak'], [7, 2, 'contact']]) {
      const id = bridge.characteristic(await bridge.bySerial(`Partition ${partition} Zone ${zone}`), TYPES[type]);
      assert.equal(Number(await bridge.read(id)), 0);
      panel.setZone(zone, true);
      await until(`zone ${zone} open via HAP`, async () => Number(await bridge.read(id)) === 1);
      panel.setZone(zone, false);
      await until(`zone ${zone} restored via HAP`, async () => Number(await bridge.read(id)) === 0);
    }
    t.diagnostic('PASS: door, window, motion, smoke and leak 609/610 events, including sparse zone 7');

    const partition = await bridge.bySerial('Partition 1');
    const current = bridge.characteristic(partition, TYPES.current);
    const target = bridge.characteristic(partition, TYPES.target);
    for (const [value, command] of [[0, '0311'], [1, '0301'], [2, '0321'], [3, '04011234']]) {
      await expectCommand(command, () => bridge.write(target, value));
      await until(`partition state ${value}`, async () => await bridge.read(current) === value);
    }
    const second = await bridge.bySerial('Partition 2');
    await expectCommand('04025678', () => bridge.write(bridge.characteristic(second, TYPES.target), 3));
    panel.setPartition(1, '6541');
    await until('alarm event reaches HomeKit', async () => await bridge.read(current) === 4);
    panel.setPartition(1, '6501');
    await until('ready event reaches HomeKit', async () => await bridge.read(current) === 3);
    t.diagnostic('PASS: HomeKit stay/away/night/disarm writes, partition-specific PIN, panel alarm/ready events');

    const output = await bridge.bySerial('02011');
    const outputId = bridge.characteristic(output, TYPES.on, TYPES.switch);
    await expectCommand('02011', () => bridge.write(outputId, true));
    await until('momentary custom command reset', async () => !await bridge.read(outputId), 4000);
    const count = panel.commands.length;
    await bridge.write(outputId, false);
    await delay(150);
    assert.equal(panel.commands.length, count, 'Turning custom command off sends no panel command');
    panel.failNext.set('02011', '024');
    await expectCommand('02011', () => bridge.write(outputId, true));
    await until('command error logged', () => bridge.output.includes('Failed invoking custom command') && bridge.output.includes('024'));
    await until('switch resets after panel error', async () => !await bridge.read(outputId), 4000);
    await expectCommand('02011', () => bridge.write(outputId, true));
    await until('command succeeds after earlier error', async () => !await bridge.read(outputId), 4000);
    t.diagnostic('PASS: custom command framing/ACK, momentary reset, false-write no-op, 502 error recovery');

    const originalAid = output.aid;
    await bridge.stop();
    const cache = await bridge.cache();
    const commandCache = cache.filter(item => ['Output One', 'Output Two'].includes(item.displayName));
    assert.equal(commandCache.length, 2);
    const originalUUID = commandCache.find(item => item.displayName === 'Output One').UUID;
    for (const accessory of commandCache) accessory.context = {}; // Actual pre-fix cache format.

    // Preserve an unrelated cached switch with its own serial number and UUID,
    // outside the custom-command namespace.
    const unknown = JSON.parse(JSON.stringify(commandCache[0]));
    unknown.UUID = '480bc1a2-03d1-431e-8e75-102d30e2e001';
    unknown.displayName = 'Unknown Cached Accessory';
    unknown.context = { unrelated: true };
    for (const service of unknown.services) {
      for (const characteristic of service.characteristics) {
        if (isType(characteristic.UUID, TYPES.serial)) characteristic.value = 'Unknown E2E';
        if (isType(characteristic.UUID, TYPES.name)) characteristic.value = 'Unknown Cached Accessory';
      }
    }
    cache.push(unknown);
    await bridge.writeCache(cache);

    const renamedName = process.env.E2E_REMOVAL_REGRESSION === '1' ? 'Output One' : 'Renamed Output';
    await bridge.start([{ name: renamedName, command: '02011' }, initialCommands[1]]);
    const renamed = await bridge.bySerial('02011');
    assert.equal(renamed.aid, originalAid, 'Name-only changes retain HomeKit AID');
    assert.equal(bridge.characteristic(renamed, TYPES.name, TYPES.switch).value, renamedName);
    assert.equal(bridge.characteristic(renamed, TYPES.name, TYPES.information).value, renamedName);
    assert.equal((await bridge.cache()).find(item => item.UUID === originalUUID).UUID, originalUUID);
    await expectPreserved();
    await expectCommand('02011', () => bridge.write(bridge.characteristic(renamed, TYPES.on, TYPES.switch), true));
    await until('restored command reset', async () => !await bridge.read(bridge.characteristic(renamed, TYPES.on, TYPES.switch)), 4000);
    t.diagnostic('PASS: legacy unmarked cache restored, rename retains UUID/AID and updates service name, restored action works');

    await bridge.stop();
    // Recreate unmarked legacy entries immediately before removing them. This
    // proves cleanup supports upgrades without relying on a prior marked restart.
    const legacy = await bridge.cache();
    for (const accessory of legacy) {
      if ([originalUUID, commandCache[1].UUID].includes(accessory.UUID)) accessory.context = {};
    }
    await bridge.writeCache(legacy);
    await bridge.start([{ name: 'Replacement Output', command: '02013' }]);
    const serials = (await bridge.accessories()).map(accessory => bridge.serial(accessory));
    assert.ok(!serials.includes('02011') && !serials.includes('02012'));
    await bridge.bySerial('02013');
    const changedCache = await bridge.cache();
    assert.ok(!changedCache.some(item => [originalUUID, commandCache[1].UUID].includes(item.UUID)));
    await expectPreserved();
    t.diagnostic('PASS: command edit and removal delete both legacy orphan accessories from HAP and disk');

    await bridge.stop();
    await bridge.start([]);
    assert.ok(!(await bridge.accessories()).some(accessory => bridge.serial(accessory) === '02013'));
    await expectPreserved();
    await bridge.stop();
    await bridge.start([{ name: 'Temporary Output', command: '02014' }]);
    await bridge.bySerial('02014');
    await bridge.stop();
    await bridge.start(undefined);
    assert.ok(!(await bridge.accessories()).some(accessory => bridge.serial(accessory) === '02014'));
    await expectPreserved();
    t.diagnostic('PASS: empty and omitted customCommands remove all commands; zones, partitions, panic and unknown cache survive');

    if (process.env.E2E_SKIP_RECONNECT !== '1') {
      const loginCount = panel.logins;
      const disconnectedAt = Date.now();
      panel.disconnect();
      await until('real 60-second reconnect and reauthentication', () => panel.logins > loginCount, 75000);
      assert.ok(Date.now() - disconnectedAt >= 59000, 'Production reconnect timer was not mocked');
      const door = bridge.characteristic(await bridge.bySerial('Partition 1 Zone 1'), TYPES.contact);
      panel.setZone(1, true);
      await until('zone event after reconnect', async () => Number(await bridge.read(door)) === 1);
      await expectPreserved();
      t.diagnostic('PASS: real disconnect, production 60-second retry, login/status replay, live HAP updates without duplication');
    } else {
      t.diagnostic('SKIPPED: 60-second reconnect (E2E_SKIP_RECONNECT=1)');
    }
    assert.deepEqual(panel.protocolErrors, [], 'All outgoing DSC frames have valid checksums and authentication');
    assert.ok(!/uncaughtException|UnhandledPromiseRejection|Error: Cannot add a Service/.test(bridge.allOutput), 'No process or duplicate-service errors');
    passed = true;
  } catch (error) {
    t.diagnostic(`Failure artifacts: ${storage}`);
    t.diagnostic(bridge.output.slice(-8000));
    throw error;
  } finally {
    await bridge.stop();
    await panel.close();
    await fs.writeFile(path.join(storage, 'dsc-commands.json'), JSON.stringify(panel.commands, null, 2));
    if (passed && process.env.E2E_KEEP_STORAGE !== '1') await fs.rm(storage, { recursive: true, force: true });
    else t.diagnostic(`Artifacts retained: ${storage}`);
  }
});

const VALID_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{Zs}\u2019'&!._:;()/,-]*[\p{L}\p{N}]$/u;
const NAME_WARNING = /HAP-NodeJS WARNING:.*invalid '(?:Name|ConfiguredName)'/;

function assertNames(accessories) {
  for (const accessory of accessories) {
    for (const service of accessory.services) {
      for (const characteristic of service.characteristics) {
        if (isType(characteristic.type, TYPES.name) || isType(characteristic.type, 'E3')) {
          assert.match(characteristic.value, VALID_NAME, `AID ${accessory.aid} service ${service.type}`);
          assert.ok(characteristic.value.length <= 64);
        }
      }
    }
  }
}

async function namingFixture(t, child, action) {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'envisalink-names-'));
  const panel = await new DscSimulator().start();
  const port = await freePort();
  const bridge = new HomebridgeHarness(storage, port, panel,
    child ? { childPort: await freePort([port]) } : {});
  let passed = false;
  try {
    await action(bridge, panel);
    assert.deepEqual(panel.protocolErrors, []);
    assert.ok(!/uncaughtException|UnhandledPromiseRejection|Error: Cannot add a Service/.test(bridge.allOutput));
    passed = true;
  } catch (error) {
    t.diagnostic(bridge.output.slice(-8000));
    throw error;
  } finally {
    await bridge.stop();
    await panel.close();
    await fs.writeFile(path.join(storage, 'dsc-commands.json'), JSON.stringify(panel.commands, null, 2));
    if (passed && process.env.E2E_KEEP_STORAGE !== '1') await fs.rm(storage, { recursive: true, force: true });
    else t.diagnostic(`Naming artifacts retained: ${storage}`);
  }
}

for (const child of [false, true]) {
  test(`names: missing, empty and whitespace partition/platform names, restart identity (${child ? 'child' : 'main'} bridge)`,
    { timeout: 90000 }, async t => namingFixture(t, child, async (bridge, panel) => {
      // _bridge.name is selected by Homebridge BEFORE constructing the plugin.
      // Explicitly set it when testing a child with an omitted platform name.
      if (child) bridge.options.bridgeName = 'Envisalink';
      let identities;
      for (const name of [undefined, '', ' \t\n ']) {
        bridge.options.platform = { name, partitions: [{ name, enableChimeSwitch: true }, { name, pin: '5678' }] };
        await bridge.start([]);
        for (const number of [1, 2]) {
          const partition = await bridge.bySerial(`Partition ${number}`);
          assert.equal(bridge.characteristic(partition, TYPES.name, TYPES.information).value, `Partition ${number}`);
          assert.equal(bridge.characteristic(partition, TYPES.name, TYPES.security).value, `Partition ${number}`);
          const switchNames = partition.services.filter(s => isType(s.type, TYPES.switch))
            .map(s => s.characteristics.find(c => isType(c.type, TYPES.name)).value);
          assert.ok(switchNames.includes(`Partition ${number} Bypass`));
          if (number === 1) assert.ok(switchNames.includes('Partition 1 Chime'));
          const start = panel.commands.length;
          await bridge.write(bridge.characteristic(partition, TYPES.target), 3);
          await until('fallback-named partition disarm', () => panel.commands.slice(start)
            .some(c => c.body === (number === 1 ? '04011234' : '04025678')));
        }
        assertNames(await bridge.accessories());
        assert.doesNotMatch(bridge.output, NAME_WARNING);
        const aids = Object.fromEntries((await bridge.accessories()).map(a => [bridge.serial(a), a.aid]));
        await bridge.stop();
        const cache = await bridge.cache();
        const current = Object.fromEntries(cache.map(a => [a.UUID, a.displayName]));
        if (identities) {
          assert.deepEqual(current, identities.cache, 'UUIDs/display names survive actual restart');
          assert.deepEqual(aids, identities.aids, 'AIDs survive actual restart');
        }
        identities = { cache: current, aids };
      }
      t.diagnostic('PASS: all absent/blank variants publish usable partitions with numbered names; repeated process restarts preserve UUIDs/AIDs');
    }));

  test(`names: malformed fresh names and legacy cache upgrade across every accessory (${child ? 'child' : 'main'} bridge)`,
    { timeout: 120000 }, async t => namingFixture(t, child, async (bridge, panel) => {
      bridge.options.platform = {
        name: 'Envisalink',
        partitions: [{ name: ' Main 🚨 Alarm ', enableChimeSwitch: true }, { name: "  Étage (2) & O’Brien  ", pin: '5678' }],
        zones: [
          { name: ' Front 🚪 Door ', type: 'door', partition: 1, zoneNumber: 1 },
          { name: 'Hall\nMotion', type: 'motion', partition: 1, zoneNumber: 2 },
          { name: 'Smoke detector ', type: 'smoke', partition: 2, zoneNumber: 3 },
          { name: '💧', type: 'leak', partition: 2, zoneNumber: 4 },
          { name: ' Fenêtre / Est ', type: 'window', partition: 2, zoneNumber: 7 },
        ],
        firePanic: { enabled: true, name: ' Fire 🚒 Panic ' },
        ambulancePanic: { enabled: true, name: ' \t ' },
        policePanic: { enabled: true, name: ' Police @ Panic ' },
      };
      await bridge.start([{ name: ' Output ⚡ One ', command: '02011' }]);
      const initial = await bridge.accessories();
      assertNames(initial);
      assert.doesNotMatch(bridge.output, NAME_WARNING);
      assert.equal(bridge.characteristic(await bridge.bySerial('Partition 2'), TYPES.name, TYPES.information).value, 'Étage (2) & O’Brien');
      assert.equal(bridge.characteristic(await bridge.bySerial('Partition 2 Zone 4'), TYPES.name, TYPES.information).value, 'Zone 4');
      const aids = Object.fromEntries(initial.map(a => [bridge.serial(a), a.aid]));
      await bridge.stop();
      const cache = await bridge.cache();
      const uuids = cache.map(a => a.UUID).sort();
      // Recreate the actual legacy cache shape, including stale information and
      // service names; do not alter UUID, subtype, serial, AID persistence or command.
      for (const accessory of cache) {
        accessory.displayName = ' Legacy 🚨 Name ';
        for (const service of accessory.services) {
          service.displayName = ' Legacy 🚨 Service ';
          const name = service.characteristics.find(c => isType(c.UUID, TYPES.name));
          if (name) service.characteristics.push({ ...structuredClone(name),
            UUID: '000000E3-0000-1000-8000-0026BB765291', constructorName: 'ConfiguredName', displayName: 'Configured Name' });
          for (const characteristic of service.characteristics) {
            if (isType(characteristic.UUID, TYPES.name) || isType(characteristic.UUID, 'E3')) {
              characteristic.value = ' Legacy 🚨 Name ';
            }
          }
        }
      }
      await bridge.writeCache(cache);
      bridge.options.platform.partitions[0].name = ' Renamed 🚨 Alarm ';
      bridge.options.platform.zones[2].name = ' Renamed Smoke ';
      bridge.options.platform.firePanic.name = ' Renamed Fire ';
      await bridge.start([{ name: ' Renamed Output ', command: '02011' }]);
      const restored = await bridge.accessories();
      assertNames(restored);
      assert.deepEqual(Object.fromEntries(restored.map(a => [bridge.serial(a), a.aid])), aids, 'All AIDs survive upgrade');
      assert.equal(bridge.characteristic(await bridge.bySerial('Partition 1'), TYPES.name, TYPES.information).value, 'Renamed Alarm');
      assert.equal(bridge.characteristic(await bridge.bySerial('Partition 2 Zone 3'), TYPES.name, TYPES.information).value, 'Renamed Smoke');
      const partition = await bridge.bySerial('Partition 1');
      const switches = partition.services.filter(s => isType(s.type, TYPES.switch));
      assert.deepEqual(switches.map(s => s.characteristics.find(c => isType(c.type, TYPES.name)).value).sort(),
        ['Renamed Alarm Bypass', 'Renamed Alarm Chime']);
      const panic = await bridge.bySerial('Panic');
      assert.ok(panic.services.some(s => s.characteristics.some(c => isType(c.type, TYPES.name) && c.value === 'Renamed Fire')),
        'Cached panic service name is updated');
      // Homebridge 2 necessarily warns while deserializing an invalid old cache
      // before plugin callbacks. Assert that all those warnings precede configure.
      for (const warning of bridge.output.matchAll(/HAP-NodeJS WARNING:.*invalid '(?:Name|ConfiguredName)'[^\n]*/g)) {
        assert.ok(warning.index < bridge.output.indexOf('Loading accessory from cache:'), warning[0]);
      }
      // Exercise the restored handlers through real HAP and DSC TCP.
      async function command(body, action) {
        const start = panel.commands.length;
        await action();
        await until(`restored DSC ${body}`, () => panel.commands.slice(start).some(c => c.body === body));
        assert.equal(panel.commands.slice(start).filter(c => c.body === body).length, 1);
      }
      const output = await bridge.bySerial('02011');
      await command('02011', () => bridge.write(bridge.characteristic(output, TYPES.on, TYPES.switch), true));
      for (const [zone, type] of [[1, TYPES.contact], [2, TYPES.motion], [3, TYPES.smoke], [4, TYPES.leak], [7, TYPES.contact]]) {
        const serial = `Partition ${zone < 3 ? 1 : 2} Zone ${zone}`;
        panel.setZone(zone, true);
        await until(`restored zone ${zone}`, async () => Number(await bridge.read(bridge.characteristic(await bridge.bySerial(serial), type))) === 1);
      }
      // Allow the production 10-second chime initialization to finish first.
      await until('initial chime toggles', () => panel.commands.filter(c => c.body === '0711*4').length >= 2, 15000);
      const chime = switches.find(s => s.characteristics.some(c => c.value === 'Renamed Alarm Chime'));
      const on = chime.characteristics.find(c => isType(c.type, TYPES.on));
      await command('0711*4', () => bridge.write({ aid: partition.aid, iid: on.iid }, true));
      await until('restored chime HAP status', async () => Boolean(await bridge.read({ aid: partition.aid, iid: on.iid })));
      for (const [name, body] of [['Renamed Fire', '0601'], ['Ambulance Panic', '0602'], ['Police Panic', '0603']]) {
        const service = panic.services.find(s => s.characteristics.some(c => isType(c.type, TYPES.name) && c.value === name));
        const id = { aid: panic.aid, iid: service.characteristics.find(c => isType(c.type, TYPES.on)).iid };
        await command(body, () => bridge.write(id, true));
        if (body === '0601') await command('04011234', () => bridge.write(id, false));
        else {
          const start = panel.commands.length;
          await bridge.write(id, false);
          await delay(100);
          assert.equal(panel.commands.length, start, 'Police/ambulance false writes remain no-ops');
        }
      }
      const bypass = switches.find(s => s.characteristics.some(c => c.value === 'Renamed Alarm Bypass'));
      await bridge.write({ aid: partition.aid, iid: bypass.characteristics.find(c => isType(c.type, TYPES.on)).iid }, true);
      await command('0711*101#', () => bridge.write(bridge.characteristic(partition, TYPES.target), 0));
      await until('restored arm after bypass', () => panel.commands.some(c => c.body === '0311'));
      await until('restored armed HAP state', async () => await bridge.read(bridge.characteristic(partition, TYPES.current)) === 0);
      await command('04011234', () => bridge.write(bridge.characteristic(partition, TYPES.target), 3));
      await bridge.stop();
      const repaired = await bridge.cache();
      assert.deepEqual(repaired.map(a => a.UUID).sort(), uuids);
      for (const accessory of repaired) {
        assert.match(accessory.displayName, VALID_NAME);
        for (const service of accessory.services) {
          if (service.displayName) assert.match(service.displayName, VALID_NAME);
        }
      }
      await bridge.start([{ name: 'Renamed Output', command: '02011' }]);
      assertNames(await bridge.accessories());
      assert.doesNotMatch(bridge.output, NAME_WARNING, 'Restart after migration has no naming warnings');
      assert.deepEqual(Object.fromEntries((await bridge.accessories()).map(a => [bridge.serial(a), a.aid])), aids);
      t.diagnostic('PASS: fresh valid HAP names, legacy cache repaired across all types, UUID/AID retained, restored commands/sensors work, next restart has no warnings');
    }));
}

test('names: supported child bridge display-name upgrade keeps scoped plugin identifier and bridge identity',
  { timeout: 45000 }, async t => namingFixture(t, true, async bridge => {
    bridge.options.platform = { name: undefined };
    await bridge.start([]);
    const initial = await bridge.accessories();
    const childName = bridge.characteristic(initial.find(a => a.aid === 1), TYPES.name, TYPES.information).value;
    assert.match(childName, /^@brandonarrindell\/homebridge-envisalink/,
      'Homebridge selects the scoped default before the platform constructor');
    if (/Homebridge v2\.\d+\.\d+ \(HAP/.test(bridge.output)) assert.match(bridge.output, NAME_WARNING);
    const aids = Object.fromEntries(initial.map(a => [bridge.serial(a), a.aid]));
    await bridge.stop();
    // Supported user config, keeping the exact same child username/persist/cache.
    bridge.options.platform.name = 'Envisalink';
    await bridge.start([]);
    assertNames(await bridge.accessories());
    assert.doesNotMatch(bridge.output, NAME_WARNING);
    assert.deepEqual(Object.fromEntries((await bridge.accessories()).map(a => [bridge.serial(a), a.aid])), aids);
    await bridge.stop();
    // An explicit child name overrides even an invalid platform display name.
    bridge.options.platform.name = '@brandonarrindell/homebridge-envisalink';
    bridge.options.bridgeName = 'Envisalink';
    await bridge.start([]);
    assertNames(await bridge.accessories());
    assert.doesNotMatch(bridge.output, NAME_WARNING);
    assert.deepEqual(Object.fromEntries((await bridge.accessories()).map(a => [bridge.serial(a), a.aid])), aids);
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@brandonarrindell/homebridge-envisalink', 'Scoped npm identifier remains unchanged');
    t.diagnostic('PASS: scoped child default reproduced; platform.name and _bridge.name prevent warnings with stable identity');
  }));
