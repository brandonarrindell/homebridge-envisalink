# Testing the Envisalink integration

## Automated checks

Use a current development Node.js release (22.13+ or 24), then run:

```sh
npm ci
npm run lint
npm run build
npm test
npm run test:e2e
```

The unit suite covers accessory reconciliation with small controlled fixtures. The
end-to-end suite runs a **real Homebridge process**, the built plugin and its
actual pinned NodeAlarmProxy dependency, a TCP DSC panel simulator, and HomeKit
Accessory Protocol (HAP) HTTP requests. It does not need an alarm panel, an Apple
device, or existing Homebridge configuration. Allow about three minutes, including
the production 60-second reconnect delay.

`test/e2e/homebridge.test.cjs` uses Node's built-in test runner, independently of
Jest. `test/e2e/dsc-simulator.cjs` is the simulated hardware peer. The simulator
does not import or mock the plugin or NodeAlarmProxy. It listens on an ephemeral
loopback port, authenticates the client, validates outgoing checksums, and emits
DSC TPI frames. All PINs and passwords in these tests are synthetic.

Homebridge receives an isolated temporary `-U` storage directory, a unique bridge
identity, explicit loopback binding, and `--strict-plugin-resolution`. It loads
only this checkout using `-P`. Insecure HAP access (`-I`) is restricted to this
test bridge; never enable it on a production bridge just to run these tests.
The test never contacts a real panel or fires a real panic alarm. HAP listener
ports are probed in 20000–29999, outside the usual macOS/Linux client ephemeral
ranges, so HTTP client connections do not claim a bridge's port between restarts.

## What is asserted

- DSC login (`5053` → `005user` → `5051`) and the initial `001` status request
- Coalesced, complete status frames across two partitions and sparse zones
- Door/window contact, motion, smoke, and leak characteristics through real
  `609`/`610` events and HAP reads
- HAP writes for stay, away, night, and disarm, with exact on-wire commands and
  partition-specific PINs; reported panel alarm and ready states
- Custom-command writes, command ACKs, momentary switch reset, false-write no-op,
  `502024` failure logging/reset, and a successful command after that failure
- Actual process restarts with the same Homebridge `persist` and `accessories`
  directories, rather than simulated lifecycle callbacks
- `PLUGIN_NAME` equals the package name used by Homebridge; all fresh accessory
  cache entries have the scoped plugin/platform association and registration
  emits no "no loaded plugin" warning
- Synthetic legacy unscoped associations across every accessory type migrate
  through Homebridge's own platform resolution on main and child bridges,
  preserve UUIDs and HAP AIDs/IIDs, and persist the scoped association; restored
  sensors, partition controls, panic switches and custom commands still work
- Adding/removing commands after that migration survives process restarts without
  duplicate accessories, stale cache entries or repeated association migration
- Legacy custom-command cache entries with empty context; name-only changes
  preserve command-derived UUID and HomeKit AID and update both visible names
- Command edits remove the old accessory; deleting entries removes their stale
  accessories from both HAP and the persisted cache
- Empty and omitted `customCommands` remove all custom-command accessories
- Zone, partition, panic and unrelated cached accessories survive reconciliation
  without duplicate accessories
- Omitted, empty and whitespace partition/platform names on main and child bridges,
  numbered fallbacks, actual restarts, stable UUIDs and HomeKit AIDs
- Fresh malformed names and legacy cache upgrades across door, window, motion,
  smoke and leak zones, partitions, chime, bypass, all panic switches and custom
  commands; Unicode/punctuation retention, full display/information/service name
  repair and restored HAP controls with exact DSC commands
- Supported explicit platform/child bridge display names; invalid legacy-cache
  warnings are permitted only during Homebridge's deserialization before plugin
  callbacks, and the next process restart must have no naming warnings
- A real TCP disconnect, the unchanged 60-second retry delay, reauthentication,
  status replay, and subsequent live sensor updates

HAP reads use `GET /accessories` and `GET /characteristics?id=aid.iid`. Writes use
`PUT /characteristics` with an `Authorization` header containing the synthetic
bridge PIN. This exercises the real HAP characteristic handlers. A successful
write normally returns HTTP 204. The existing plugin catches command failures,
so the error scenario checks the logged `502` error and switch reset rather than
claiming that HomeKit receives a failure status.

## Useful variants

```sh
# Focused naming regressions only (still real Homebridge processes and restarts).
npm run build
node --test --test-name-pattern='names:' test/e2e/homebridge.test.cjs

# Focused registration and legacy plugin-association migration regressions.
node --test --test-name-pattern='registration:' test/e2e/homebridge.test.cjs

# Fast restart/cache iteration. Reports reconnect as skipped.
E2E_SKIP_RECONNECT=1 npm run test:e2e

# Retain config, cache, individual Homebridge logs and the DSC command transcript.
E2E_KEEP_STORAGE=1 npm run test:e2e

# Test an independently installed Homebridge and/or a different child runtime.
# The test runner itself stays on current Node; only Homebridge uses this Node.
HOMEBRIDGE_BIN=/absolute/path/to/homebridge/bin/homebridge.js \
HOMEBRIDGE_NODE=/absolute/path/to/node \
npm run test:e2e

# Isolate the orphan-removal regression from the separate rename assertions.
# With the original compiled plugin, this must fail at stale-command removal.
E2E_REMOVAL_REGRESSION=1 E2E_SKIP_RECONNECT=1 npm run test:e2e
```

By default, the runner finds the installed Homebridge executable through its
package metadata, accommodating both Homebridge 1.x and 2.x entrypoint names.
`HOMEBRIDGE_BIN` must be an absolute path. Failure artifacts are retained and their
temporary directory is printed. Successful runs remove their own temporary
storage unless `E2E_KEEP_STORAGE=1` is set. No production cache is touched.
CI runs the complete suite against Homebridge 1.11.4 and 2.4.0 on Node 22 and 24,
plus the supported Homebridge 1.6.0 / Node 22.0.0 runtime floor.

### Restricted containers

Some containers forbid network-interface enumeration (`os.networkInterfaces()` /
`uv_interface_addresses`) or multicast. A real Homebridge advertiser fails before
HAP starts in such an environment. Use the explicit test-only mode:

```sh
E2E_LOOPBACK_ONLY=1 npm run test:e2e
```

This preloads `test/e2e/loopback-only.cjs` into the Homebridge child. It supplies a
synthetic loopback interface inventory and disables only mDNS advertisement.
Homebridge, plugin lifecycle, TCP panel traffic, HAP HTTP server, characteristic
handlers, timers and disk persistence remain real. This mode does **not** verify
real-interface enumeration or mDNS. It is opt-in, logs a warning, and is not
automatically enabled after a test fails.

## Protocol fixtures and scope

DSC frames are the three-digit command plus data, two uppercase hexadecimal
checksum characters, and CRLF. The checksum is the low byte of the sum of ASCII
character codes in the command and data. Some concrete fixtures are:

| Meaning | Complete wire packet (escaped line ending) |
| --- | --- |
| Request login | `5053CD\r\n` |
| Login with test password | `005user54\r\n` |
| Login accepted | `5051CB\r\n` |
| Request status | `00191\r\n` |
| Status request ACK | `50000126\r\n` |
| Partition 1 ready | `6501CC\r\n` |
| Zone 1 open / restored | `60900130\r\n` / `61000128\r\n` |
| Arm partition 1 away / stay / zero-entry | `0301C4\r\n` / `0311C5\r\n` / `0321C6\r\n` |
| Partition 1 armed away / stay / zero-entry stay | `65210FE\r\n` / `65211FF\r\n` / `6521301\r\n` |
| Disarm partition 1 with test PIN | `040112348F\r\n` |
| Partition 1 alarm | `6541D0\r\n` |
| Test output command / ACK | `02011F4\r\n` / `50002027\r\n` |
| Not-ready-to-arm system error | `5020242D\r\n` |

The simulator validates every outgoing packet and deliberately batches complete
incoming frames. It does **not** validate arbitrary incoming TCP fragmentation,
checksum rejection by NodeAlarmProxy, every DSC event, or every panel firmware.
The pinned dependency splits each received TCP chunk without a persistent framing
buffer and does not validate incoming checksums. Its zero-length-message handling
also bypasses `501` error callbacks, and `601`–`604` contain a partition byte that
its generic zone parser does not account for. These are separate existing
dependency limitations, not passing scenarios or fixes supplied by this suite.
The `502` scenario intentionally uses the dependency's supported error path.

**Honeywell is not covered or implemented by the pinned transport.** Although the
README previously advertised both panel families, the code uses the DSC protocol
and does not select a Honeywell transport. Honeywell uses a different login and
wire format. Passing these tests is not evidence of Honeywell compatibility.

Other exclusions: Apple Home pairing/encryption and UI, physical sirens or sensor
hardware, alarm monitoring/dispatch, LAN auto-discovery, proxy-client behavior,
and prolonged real-world network loss. The smoke/leak checks verify the plugin's
configured `609`/`610` mapping, not physical detector behavior or all alarm events.

## Primary references

- [Bundled EnvisaLink TPI 1.08 protocol](EnvisaLinkTPI-1-08.pdf), sections 2–3
- [EyezOn's official DSC and Honeywell TPI documents](https://forum.eyezon.com/viewtopic.php?t=301)
- [Exact pinned NodeAlarmProxy implementation](https://github.com/dustindclark/NodeAlarmProxy/blob/0abdfe688451cc57b0bbd64cf54e38e54a2d2a67/nodealarmproxy.js)
- [Pinned NodeAlarmProxy command definitions](https://github.com/dustindclark/NodeAlarmProxy/blob/0abdfe688451cc57b0bbd64cf54e38e54a2d2a67/envisalink.js)
- [HAP-NodeJS HTTP request handlers](https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/HAPServer.ts)
- [Homebridge CLI options](https://github.com/homebridge/homebridge/blob/master/src/cli.ts)
