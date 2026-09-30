import {normalizeName} from '../src/names';
import {transformPartitionStatus, transformZoneStatus} from '../src/util';
import {ZoneType} from '../src/types';
import {HomebridgeAPI} from 'homebridge/lib/api';
import {EnvisalinkHomebridgePlatform} from '../src/platform';

jest.mock('nodealarmproxy', () => ({initConfig: jest.fn(), manualCommand: jest.fn()}));

describe('HomeKit display names', () => {
    it.each([undefined, null, 12, '', ' \t\r\n ', '🚨💧', '@/', "'''", 'A'])
    ('uses a nonempty fallback for unusable input %p', value => {
        expect(normalizeName(value, 'Partition 2')).toBe('Partition 2');
    });

    it.each([
        [' Smoke detector ', 'Smoke detector'],
        ['Front 🚪 Door', 'Front Door'],
        ['Hall\nMotion', 'Hall Motion'],
        ['  Étage (2) & O’Brien  ', 'Étage (2) & O’Brien'],
        ['玄関 ２', '玄関 ２'],
        ['Cafe\u0301 - 2', 'Café - 2'],
        ["O'Brien’s / Alarm: 1 & 2; A.B_C,D!", "O'Brien’s / Alarm: 1 & 2; A.B_C,D"],
    ])('normalizes %p while preserving HAP-supported Unicode/punctuation', (input, expected) => {
        expect(normalizeName(input, 'Zone 1')).toBe(expected);
    });

    it('truncates before stripping invalid edges and retains a valid name within the HAP length limit', () => {
        expect(normalizeName('AB'.repeat(31) + ' - extra', 'Zone 1')).toBe('AB'.repeat(31));
        expect(normalizeName('A'.repeat(100), 'Zone 1')).toHaveLength(64);
    });

    it.each([undefined, '', ' \t\n '])('supplies numbered partition and sparse zone defaults for %p', name => {
        expect(transformPartitionStatus([{name}, {name}], 2, {partition: 2, code: '6502'}).name).toBe('Partition 2');
        expect(transformZoneStatus(new Map([['7', {name, partition: 2, zoneNumber: 7, type: ZoneType.Window}]]),
            7, {zone: 7, code: '610007'})!.name).toBe('Zone 7');
    });

    it('repairs cached names before DSC status, including disabled controls, without changing identity or handlers', () => {
        const homebridge = new HomebridgeAPI();
        const update = jest.fn();
        const api = {hap: homebridge.hap, platformAccessory: homebridge.platformAccessory,
            on: jest.fn(), updatePlatformAccessories: update};
        const log = {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()};
        const platform = new EnvisalinkHomebridgePlatform(log as any, {platform: 'Envisalink'}, api as any);
        const accessory = new homebridge.platformAccessory(' Legacy 🚨 Alarm ', homebridge.hap.uuid.generate('envisalink.1'));
        const chime = accessory.addService(homebridge.hap.Service.Switch, ' Legacy 🚨 Chime ', 'Chime');
        chime.getCharacteristic(homebridge.hap.Characteristic.ConfiguredName).setValue(' Legacy 🚨 Chime ');
        const handler = jest.fn();
        chime.getCharacteristic(homebridge.hap.Characteristic.On).onSet(handler);
        const uuid = accessory.UUID;
        platform.configureAccessory(accessory);
        expect(accessory.UUID).toBe(uuid);
        expect(accessory.displayName).toBe('Legacy Alarm');
        expect(accessory.getService(homebridge.hap.Service.AccessoryInformation)!
            .getCharacteristic(homebridge.hap.Characteristic.Name).value).toBe('Legacy Alarm');
        expect(chime.subtype).toBe('Chime');
        expect(chime.displayName).toBe('Legacy Chime');
        expect(chime.getCharacteristic(homebridge.hap.Characteristic.ConfiguredName).value).toBe('Legacy Chime');
        expect(handler).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith([accessory]);
    });

    it.each([undefined, '', ' \t\n '])('actually assigns the platform default for %p', name => {
        const api = new HomebridgeAPI();
        const config = {platform: 'Envisalink', name};
        const log = {debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()};
        new EnvisalinkHomebridgePlatform(log as any, config, api);
        expect(config.name).toBe('Envisalink');
    });
});
