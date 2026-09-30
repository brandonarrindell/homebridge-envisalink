import {Characteristic, PlatformAccessory, Service} from 'homebridge';

// Match the Unicode letters/numbers and interior punctuation accepted by current
// HAP-NodeJS. Never apply this to plugin identifiers, UUID seeds or panel commands.
export function normalizeName(value: unknown, fallback: string): string {
    const name = (typeof value === 'string' ? value : '').normalize('NFC')
        .replace(/[^\p{L}\p{N}\p{Zs}\u2019'&!._:;()/,-]+/gu, ' ')
        .replace(/\p{Zs}+/gu, ' ')
        .slice(0, 64)
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    // HAP's current validator also requires at least two letters/numbers at the
    // edges (a single-character name does not match its expression).
    return /^[\p{L}\p{N}][\p{L}\p{N}\p{Zs}\u2019'&!._:;()/,-]*[\p{L}\p{N}]$/u.test(name) ? name : fallback;
}

export function updateServiceName(service: Service, name: string, characteristic: typeof Characteristic): void {
    service.displayName = name;
    service.setCharacteristic(characteristic.Name, name);
    if (service.testCharacteristic(characteristic.ConfiguredName)) {
        service.setCharacteristic(characteristic.ConfiguredName, name);
    }
}

export function updateAccessoryName(accessory: PlatformAccessory, name: string, characteristic: typeof Characteristic): void {
    // updateDisplayName was added after the supported Homebridge 1.6 API floor.
    if (typeof accessory.updateDisplayName === 'function') {
        accessory.updateDisplayName(name);
    } else {
        accessory.displayName = name;
    }
    const information = accessory.services.find(service => service.UUID === '0000003E-0000-1000-8000-0026BB765291');
    if (information) {
        updateServiceName(information, name, characteristic);
    }
}
