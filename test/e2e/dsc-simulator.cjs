'use strict';

// A TCP peer, not a NodeAlarmProxy mock. All packets use the DSC TPI checksum
// and CRLF framing from docs/EnvisaLinkTPI-1-08.pdf sections 2 and 3.
const net = require('node:net');

function frame(body) {
  const checksum = [...body].reduce((sum, character) => sum + character.charCodeAt(0), 0) & 0xff;
  return `${body}${checksum.toString(16).padStart(2, '0').toUpperCase()}\r\n`;
}

class DscSimulator {
  constructor({ password = 'user', zones = [1, 2, 3, 4, 7], partitions = [1, 2] } = {}) {
    this.password = password;
    this.zones = new Map(zones.map(zone => [zone, false]));
    this.partitions = new Map(partitions.map(partition => [partition, `650${partition}`]));
    this.commands = [];
    this.protocolErrors = [];
    this.connections = 0;
    this.logins = 0;
    this.sockets = new Set();
    this.failNext = new Map();
    this.chimes = new Map();
    this.server = net.createServer(socket => this.accept(socket));
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this;
  }

  accept(socket) {
    this.connections++;
    this.sockets.add(socket);
    socket.setNoDelay(true);
    socket.authenticated = false;
    let buffer = '';
    socket.on('error', () => {});
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('data', chunk => {
      buffer += chunk.toString('ascii');
      let boundary;
      while ((boundary = buffer.indexOf('\r\n')) !== -1) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (packet.length < 5 || frame(packet.slice(0, -2)).trimEnd() !== packet) {
          this.protocolErrors.push(packet);
          socket.write(frame('501'));
          continue;
        }
        this.handle(socket, packet.slice(0, -2));
      }
    });
    socket.write(frame('5053'));
  }

  handle(socket, body) {
    const code = body.slice(0, 3);
    this.commands.push({ body, packet: frame(body), at: Date.now(), connection: this.connections });
    if (code === '005') {
      socket.authenticated = body.slice(3) === this.password;
      socket.write(frame(socket.authenticated ? '5051' : '5050'));
      if (socket.authenticated) this.logins++;
      else socket.end();
      return;
    }
    if (!socket.authenticated) {
      this.protocolErrors.push(`Unauthenticated command: ${body}`);
      return;
    }
    if (this.failNext.has(body)) {
      const error = this.failNext.get(body);
      this.failNext.delete(body);
      socket.write(frame(`502${error}`));
      return;
    }
    socket.write(frame(`500${code}`));
    if (code === '001') {
      // Deliberately batch whole frames: TCP may deliver multiple reports at once.
      const reports = [...this.partitions.values(), ...[...this.zones].map(([zone, open]) =>
        `${open ? '609' : '610'}${String(zone).padStart(3, '0')}`)];
      socket.write(reports.map(frame).join(''));
    } else if (['030', '031', '032'].includes(code)) {
      const partition = Number(body[3]);
      const mode = { '030': 0, '031': 1, '032': 3 }[code];
      this.setPartition(partition, `656${partition}`);
      this.setPartition(partition, `652${partition}${mode}`);
    } else if (code === '040') {
      const partition = Number(body[3]);
      this.setPartition(partition, `655${partition}`);
    } else if (code === '071' && /\*1\d{2}#$/.test(body)) {
      this.setPartition(Number(body[3]), `650${body[3]}`);
    } else if (code === '071' && body.endsWith('*4')) {
      const partition = Number(body[3]);
      const enabled = !this.chimes.get(partition);
      this.chimes.set(partition, enabled);
      this.broadcast(`${enabled ? '663' : '664'}${partition}`);
    }
  }

  broadcast(body) {
    for (const socket of this.sockets) {
      if (socket.authenticated && !socket.destroyed) socket.write(frame(body));
    }
  }

  setZone(zone, open) {
    this.zones.set(zone, open);
    this.broadcast(`${open ? '609' : '610'}${String(zone).padStart(3, '0')}`);
  }

  setPartition(partition, body) {
    this.partitions.set(partition, body);
    this.broadcast(body);
  }

  disconnect() {
    for (const socket of this.sockets) socket.end();
  }

  async close() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise(resolve => this.server.close(resolve));
  }
}

module.exports = { DscSimulator, frame };
