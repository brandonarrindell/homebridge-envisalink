import { HomebridgeAPI } from 'homebridge/lib/api';
const { hap, platformAccessory: PlatformAccessory } = new HomebridgeAPI();
import { EnvisalinkHomebridgePlatform } from '../src/platform';
import { PLATFORM_NAME, PLUGIN_NAME } from '../src/settings';

jest.mock('nodealarmproxy', () => ({ initConfig: jest.fn(), manualCommand: jest.fn() }));

const commandUUID = (command: string) => hap.uuid.generate(`envisalink.customCommand.${command}`);

function fixture(customCommands?: Array<{ name: string; command: string }>) {
    const api = {
        hap, platformAccessory: PlatformAccessory, on: jest.fn(),
        registerPlatformAccessories: jest.fn(), updatePlatformAccessories: jest.fn(),
        unregisterPlatformAccessories: jest.fn(),
    };
    const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const config = { platform: PLATFORM_NAME, name: 'Test', customCommands };
    const platform = new EnvisalinkHomebridgePlatform(log as any, config, api as any);
    return { platform, api, config };
}

function legacyCommand(command: string, name = 'Legacy') {
    const accessory = new PlatformAccessory(name, commandUUID(command));
    accessory.getService(hap.Service.AccessoryInformation)!
        .setCharacteristic(hap.Characteristic.SerialNumber, command);
    accessory.addService(hap.Service.Switch, name);
    return accessory;
}

describe('custom command cache reconciliation', () => {
    it('preserves legacy UUID and accessory identity when only the name changes', () => {
        const { platform, api } = fixture([{ name: 'Renamed', command: '0711*4' }]);
        const cached = legacyCommand('0711*4');
        platform.configureAccessory(cached);
        platform.discoverCustomCommandAccessories();
        expect(platform.accessories.get(cached.UUID)).toBe(cached);
        expect(cached.context.type).toBe('customCommand');
        expect(cached.displayName).toBe('Renamed');
        expect(cached.getService(hap.Service.Switch)!.getCharacteristic(hap.Characteristic.Name).value).toBe('Renamed');
        expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
        expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
        expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cached]);
    });

    it('removes legacy orphan when the command changes and registers the new command once', () => {
        const { platform, api } = fixture([{ name: 'Command', command: '0711*4' }]);
        const cached = legacyCommand('071*4');
        platform.configureAccessory(cached);
        platform.discoverCustomCommandAccessories();
        platform.discoverCustomCommandAccessories();
        expect(platform.accessories.has(cached.UUID)).toBe(false);
        expect(platform.accessories.has(commandUUID('0711*4'))).toBe(true);
        expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
        expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, [cached]);
        expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, []])('removes marked and legacy commands with absent/empty config (%p)', commands => {
        const { platform, api } = fixture(commands);
        const legacy = legacyCommand('0711*4');
        const marked = legacyCommand('0711*6');
        marked.context.type = 'customCommand';
        platform.configureAccessory(legacy);
        platform.configureAccessory(marked);
        platform.discoverCustomCommandAccessories();
        expect(platform.accessories.size).toBe(0);
        expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(2);
    });

    it('does not remove panic, zones, partitions or unidentified cached switches', () => {
        const { platform, api } = fixture([]);
        const accessories = ['envisalink.panic', 'envisalink.1.1', 'envisalink.1', 'unidentified'].map(key => {
            const accessory = new PlatformAccessory('Keep', hap.uuid.generate(key));
            accessory.getService(hap.Service.AccessoryInformation)!
                .setCharacteristic(hap.Characteristic.SerialNumber, '0711*4');
            accessory.addService(hap.Service.Switch, 'Keep');
            platform.configureAccessory(accessory);
            return accessory;
        });
        platform.discoverCustomCommandAccessories();
        expect([...platform.accessories.values()]).toEqual(accessories);
        expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    });

    it('requires a switch as well as a matching legacy serial-derived UUID', () => {
        const { platform, api } = fixture([]);
        const accessory = new PlatformAccessory('Keep', commandUUID('0711*4'));
        accessory.getService(hap.Service.AccessoryInformation)!
            .setCharacteristic(hap.Characteristic.SerialNumber, '0711*4');
        platform.configureAccessory(accessory);
        platform.discoverCustomCommandAccessories();
        expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    });

    it('ignores duplicate command entries instead of registering or rebinding twice', () => {
        const { platform, api } = fixture([
            { name: 'First', command: '0711*4' }, { name: 'Duplicate', command: '0711*4' },
        ]);
        platform.discoverCustomCommandAccessories();
        expect(platform.accessories.size).toBe(1);
        expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
        expect(platform.accessories.get(commandUUID('0711*4'))!.displayName).toBe('First');
    });
});
