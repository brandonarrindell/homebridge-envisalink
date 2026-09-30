import { PLUGIN_NAME } from '../src/settings';

describe('Homebridge plugin identity', () => {
    it('matches the installed package name used by Homebridge plugin resolution', () => {
        expect(PLUGIN_NAME).toBe(require('../package.json').name);
    });
});
