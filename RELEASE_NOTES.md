# 2.0.0 (unreleased)

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

This change prepares a draft PR only. No npm release is published automatically.
