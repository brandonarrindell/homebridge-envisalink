# 2.0.1 — 2026-09-30

## Fixed

- Publish partitions with numbered fallback names when their configured names
  are missing, empty or whitespace (issue #45)
- Normalize accessory and service names using current HAP Unicode and
  punctuation rules, including trailing-space names such as `Smoke detector `
  (issue #74)
- Repair restored accessory, Accessory Information, service and existing
  ConfiguredName values while preserving UUIDs, HomeKit AIDs and panel commands
- Apply the platform-name fallback and expose its supported configuration field
- Persist repaired names on the Homebridge 1.6 compatibility floor as well as
  current Homebridge 1 and 2 releases

## Upgrading

Set a valid platform `name`, such as `"name": "Envisalink"`, or an explicit
`_bridge.name` when using a child bridge. Homebridge selects the child-bridge name
before constructing the plugin, so the plugin's runtime fallback cannot repair
the preselected scoped-package default. Keep the existing bridge username,
settings and accessory cache to preserve HomeKit identity.

Homebridge may emit invalid-name warnings while deserializing an old cache before
plugin callbacks run. The plugin repairs and saves those names; the next restart
uses the repaired cache. Apple Home's own cached labels and pairing UI are outside
the simulated tests.

The Node.js 22/24 requirement introduced in 2.0.0 is unchanged.

## Verification

Real Homebridge-process, simulated DSC TCP panel and HAP HTTP tests cover absent
and malformed names, legacy cache upgrades, main and child bridges, actual
restarts, stable identities and restored controls across every accessory type.
They include the production 60-second reconnect delay and the Homebridge 1.6 /
Node 22.0.0 compatibility floor. Test-port selection uses Node's uniform
`crypto.randomInt` API. See [testing documentation](docs/testing.md) for scope.

# 2.0.0 — 2026-09-30

## Breaking change: Node.js 22 or 24 required

This is a **major-version update**, not a patch release. Upgrade older Node.js
installations before installing version 2. Node.js 14–21 are no longer supported;
odd-numbered and other untested runtime lines are outside the supported range.
Homebridge's API compatibility range remains `^1.6.0 || ^2.0.0-beta.0`.

Use [Homebridge's official Node update instructions](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js).
Back up Homebridge configuration and cached accessories first, upgrade Node, then
install the plugin update and verify your alarm's normal operation. Do not delete
the accessory cache as an upgrade step. Installations that cannot upgrade Node
must stay on the older plugin release until their runtime is upgraded.

This follows Homebridge's currently supported LTS Node lines. It also makes the
engine declaration honest about the refreshed production dependency tree:
NodeAlarmProxy's Winston/diagnostics dependencies now include code that fails to
load on Node 14. We do not freeze the entire published dependency tree or rely on
root-only overrides that would not protect consumers.

## Fixed

- Remove orphaned custom-command switches when commands are edited or removed,
  including when the command list is empty or omitted (issue #77)
- Recognize previously unmarked cached commands using their persisted serial
  number and exact command-derived UUID, while preserving unrelated accessories
- Preserve existing UUIDs and HomeKit identities for unchanged commands; renaming
  changes both visible names without replacing the accessory
- Ignore duplicate command strings deterministically instead of rebinding twice

Editing a command string still creates a new accessory, as it did before. The old
one is now removed correctly. Reassign its HomeKit room and update automations
that referenced the replaced command if necessary. A name-only edit preserves
those existing references.

## Maintenance and verification

- Refresh production/transitive dependencies and compatible development tooling
- Remove the unnecessary npm `net` package; networking still uses Node's built-in
  module
- Migrate ESLint to flat configuration and remove forced Jest exit; tests clean up
  their timers instead
- Add real Homebridge-process, simulated DSC TCP panel and HAP HTTP tests, with
  persisted cache restarts and the production reconnect delay
- Run reproducible installs, lint, unit tests, simulation and production audit in
  CI on Node 22/24 with Homebridge 1/2, plus the Homebridge 1.6 API floor

See [testing documentation](docs/testing.md) for protocol sources and limitations.
The transport implements DSC TPI, not Honeywell TPI; the former README claim of
Honeywell support was incorrect. Simulated tests do not certify real alarm
hardware, Apple Home pairing, dispatch, or every firmware/protocol edge case.
