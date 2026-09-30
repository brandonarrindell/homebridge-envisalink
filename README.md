# @brandonarrindell/homebridge-envisalink

[![npm version](https://img.shields.io/npm/v/@brandonarrindell/homebridge-envisalink.svg)](https://www.npmjs.com/package/@brandonarrindell/homebridge-envisalink)
[![npm downloads](https://img.shields.io/npm/dm/@brandonarrindell/homebridge-envisalink.svg)](https://www.npmjs.com/package/@brandonarrindell/homebridge-envisalink)

> A maintained fork of [homebridge-envisalink](https://github.com/dustindclark/homebridge-envisalink) (v1.2.10) with enhanced features and Homebridge 2.0 support.

This Homebridge plugin integrates your Envisalink security system with HomeKit, allowing you to:
- Control your alarm panel (arm/disarm) using Siri or any HomeKit app
- Monitor sensors for automations (e.g., turn on lights when doors open)
- Trigger panic buttons (police, fire, ambulance) from HomeKit
- Auto-discover Envisalink devices on your network

## Version History

This fork continues from version 1.2.10 of the original plugin:

- v2.0.0 (2026-09-30) - Node.js 22/24 support, custom-command cache cleanup,
  dependency refresh, and simulated end-to-end tests. **Breaking runtime change:**
  see [migration and release notes](RELEASE_NOTES.md).
- v1.3.0 - First release of the fork
  - Added Homebridge 2.0 support
  - Added auto-discovery feature
  - Improved stability and error handling
  - TypeScript rewrite

For earlier version history, see the [original repository](https://github.com/dustindclark/homebridge-envisalink).

## Features

✨ **What's New in This Fork**
- Full Homebridge 2.0 compatibility
- Automatic discovery of Envisalink devices
- Improved stability and error handling
- Regular updates and maintenance
- TypeScript rewrite for better reliability

🔒 **Core Features**
- Support for both Envisalink 3 and 4
- DSC panel support (the current transport does not implement Honeywell TPI)
- Zone monitoring (doors, windows, motion, smoke, leak sensors)
- Multiple partition support
- Custom command support
- Chime control
- Panic buttons

## Installation

```bash
npm install -g @brandonarrindell/homebridge-envisalink
```

## Configuration

Add to your Homebridge config.json:

```json
{
  "platforms": [
    {
      "platform": "Envisalink",
      "enableAutoDiscovery": true,
      "host": "192.168.0.XXX",  // Optional if enableAutoDiscovery is true
      "deviceType": "DSC",
      "password": "YOUR_PASSWORD",  // Default is "user"
      "pin": "YOUR_PANEL_PIN",
      "suppressZoneAccessories": false,
      "suppressClockReset": false,
      "ambulancePanic": {
          "enabled": true,
          "name": "Ambulance Panic"
      },
      "firePanic": {
          "enabled": true,
          "name": "Fire Panic"
      },
      "policePanic": {
          "enabled": true,
          "name": "Police Panic"
      },
      "partitions": [
        {
          "name": "Main Alarm",
          "enableChimeSwitch": true,
          "pin": "1243"
        }
      ],
      "zones": [
        {
          "name": "Front Door",
          "type": "door",
          "partition": 1
        },
        {
          "name": "Master Bedroom Door",
          "type": "door",
          "partition": 1
        }
      ]
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| enableAutoDiscovery | boolean | true | Automatically discover Envisalink devices |
| host | string | - | IP address of Envisalink (optional with auto-discovery) |
| deviceType | string | "DSC" | Panel type ("DSC" or "Honeywell") |
| password | string | "user" | Envisalink web interface password |
| pin | string | - | Alarm panel PIN for disarming |
| suppressZoneAccessories | boolean | false | Hide zone accessories in HomeKit |
| suppressClockReset | boolean | false | Disable hourly panel clock sync |

See [config.schema.json](./config.schema.json) for full configuration options.

## Auto-Discovery

The auto-discovery feature scans your network for Envisalink devices:

1. Enable with `enableAutoDiscovery: true`
2. Omit `host` to use auto-discovery exclusively
3. First discovered device will be used
4. Manual `host` configuration takes precedence

## Advanced Features

### Home vs. Night Arm Modes

- **Home**: Arms in stay mode with entry delay
- **Night**: Arms in stay mode with no entry delay (instant alarm)

### Non-Sequential Zones

For systems with gaps in zone numbering:

```json
{
  "zones": [
    {
      "name": "Front Door",
      "type": "door",
      "partition": 1,
      "zoneNumber": 1
    },
    {
      "name": "Garage Door",
      "type": "door",
      "partition": 1,
      "zoneNumber": 5
    }
  ]
}
```

### Custom Commands

Add custom panel commands:

```json
{
  "customCommands": [
    {
      "name": "System Test",
      "command": "071*600004"
    }
  ]
}
```

## Troubleshooting

### Common Issues

1. **Connection Problems**
   - Only one socket connection allowed at a time
   - Use wired connections when possible
   - Set static IP for Envisalink
   - Verify password is correct

2. **Debug Mode**
   ```json
   {
     "platforms": [
       {
         "platform": "Envisalink",
         "enableVerboseLogging": true
       }
     ]
   }
   ```

## Custom command changes

Custom command identities remain based on their command string for compatibility
with existing HomeKit installations. Renaming a command preserves its accessory.
Editing its command string replaces that accessory and removes the old tile;
HomeKit room assignments and automations referencing the old command may need to
be updated. Removing commands (including clearing or omitting `customCommands`)
removes their cached accessories on the next successful platform startup.
Previously orphaned command switches are recognized from their persisted serial
number and matching UUID, without deleting unrelated accessories.

## Development and testing

Use Node.js 22.13+ or 24 for development tooling, then run:

```sh
npm ci
npm run check
```

`npm test` runs both unit tests and real Homebridge-process tests against a local
simulated DSC EnvisaLink TCP panel. No alarm hardware, Home app pairing, or real
alarm credentials are needed. The simulator binds only to loopback and uses
temporary Homebridge storage. See [the testing guide](docs/testing.md) for protocol
sources, coverage, runtime overrides, and important simulation limits.

Version 2 requires Node.js 22 or 24. CI runs the simulator against Homebridge 1
and 2 on both Node versions, and checks the Homebridge 1.6 API floor on Node 22.0.0.
Upgrade older Node installations before installing version 2; see the
[migration notes](RELEASE_NOTES.md). The Homebridge engine range is unchanged.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Credits

- Original plugin by [Dustin D. Clark](https://github.com/dustindclark)
- Built on [Node Alarm Proxy](https://www.npmjs.com/package/nodealarmproxy)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
