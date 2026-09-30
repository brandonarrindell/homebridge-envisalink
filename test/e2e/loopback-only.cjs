'use strict';

// Opt-in support for containers that prohibit getifaddrs()/multicast. This does
// not replace any Homebridge lifecycle, HAP HTTP, plugin, panel or cache code.
// Discovery and real-interface enumeration are explicitly outside this mode.
const { EventEmitter } = require('events');
const { createRequire } = require('module');
const path = require('path');
const os = require('os');

if (process.env.E2E_LOOPBACK_ONLY !== '1') throw new Error('Loopback bootstrap requires E2E_LOOPBACK_ONLY=1');
os.networkInterfaces = () => ({
  lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4',
    mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
});

const homebridgeRequire = createRequire(path.resolve(process.argv[1]));
let hapEntry;
try { hapEntry = homebridgeRequire.resolve('@homebridge/hap-nodejs'); }
catch { hapEntry = homebridgeRequire.resolve('hap-nodejs'); }
const advertiser = require(path.join(path.dirname(hapEntry), 'lib/Advertiser.js'));
class LoopbackAdvertiser extends EventEmitter {
  initPort() {}
  async startAdvertising() {}
  updateAdvertisement() {}
  async destroy() {}
}
Object.setPrototypeOf(LoopbackAdvertiser, advertiser.CiaoAdvertiser);
advertiser.CiaoAdvertiser = LoopbackAdvertiser;
console.warn('[E2E] Loopback-only mode: mDNS disabled and interface inventory is synthetic; TCP/HAP HTTP remain real.');
