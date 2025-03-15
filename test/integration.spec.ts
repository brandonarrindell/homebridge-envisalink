import { EnvisalinkNetworkScanner } from '../src/networkScanner';
import { EnvisalinkHomebridgePlatform } from '../src/platform';
import * as net from 'net';
import * as os from 'os';

// This test simulates a real-world scenario where the auto-discovery feature is used
// to find an Envisalink device on the network and then connect to it.
// Note: This test is marked as 'skip' by default because it requires a real network
// and Envisalink device to work properly. It's meant to be run manually when needed.

describe.skip('Auto-Discovery Integration Test', () => {
  // Create a real logger for debugging
  const logger = {
    info: (message: string) => console.log(`[INFO] ${message}`),
    warn: (message: string) => console.log(`[WARN] ${message}`),
    error: (message: string) => console.log(`[ERROR] ${message}`),
    debug: (message: string) => console.log(`[DEBUG] ${message}`)
  };

  it('should discover and connect to a real Envisalink device', async () => {
    // Create a real network scanner
    const scanner = new EnvisalinkNetworkScanner(logger as any);
    
    // Discover devices on the network
    console.log('Starting device discovery...');
    const discoveredDevices = await scanner.discoverDevices();
    console.log(`Discovered devices: ${discoveredDevices.join(', ') || 'none'}`);
    
    // Verify that at least one device was found
    expect(discoveredDevices.length).toBeGreaterThan(0);
    
    // If a device was found, try to connect to it
    if (discoveredDevices.length > 0) {
      const deviceIP = discoveredDevices[0];
      console.log(`Attempting to connect to device at ${deviceIP}...`);
      
      // Create a socket to test the connection
      const socket = new net.Socket();
      
      // Set up a promise to wait for the connection
      const connectionPromise = new Promise<boolean>((resolve, reject) => {
        socket.on('connect', () => {
          console.log('Successfully connected to the device!');
          socket.destroy();
          resolve(true);
        });
        
        socket.on('error', (error) => {
          console.log(`Error connecting to the device: ${error.message}`);
          socket.destroy();
          resolve(false);
        });
        
        socket.on('timeout', () => {
          console.log('Connection timed out');
          socket.destroy();
          resolve(false);
        });
        
        // Set a timeout
        socket.setTimeout(5000);
        
        // Attempt to connect
        socket.connect(4025, deviceIP);
      });
      
      // Wait for the connection attempt to complete
      const connected = await connectionPromise;
      
      // Verify that the connection was successful
      expect(connected).toBe(true);
    }
  }, 30000); // Increase timeout to 30 seconds for network operations
  
  it('should integrate with the platform', async () => {
    // Create a mock API
    const mockApi = {
      on: jest.fn(),
      hap: {
        uuid: {
          generate: jest.fn().mockReturnValue('test-uuid')
        },
        Service: {},
        Characteristic: {}
      },
      registerPlatformAccessories: jest.fn(),
      updatePlatformAccessories: jest.fn()
    };
    
    // Create a config without a host to trigger auto-discovery
    const config = {
      name: 'Test Platform',
      enableAutoDiscovery: true,
      password: 'user', // Default Envisalink password
      pin: '1234',
      port: 4025,
      partitions: [{ name: 'Partition 1' }],
      zones: [{ name: 'Zone 1', type: 'door', partition: 1 }]
    };
    
    // Create the platform
    const platform = new EnvisalinkHomebridgePlatform(
      logger as any,
      config as any,
      mockApi as any
    );
    
    // Trigger the didFinishLaunching event
    const didFinishLaunchingCallback = mockApi.on.mock.calls.find(
      call => call[0] === 'didFinishLaunching'
    )[1];
    
    // This will trigger the auto-discovery process
    console.log('Triggering platform initialization...');
    await didFinishLaunchingCallback();
    
    // The test will pass if no exceptions are thrown during initialization
    // This indicates that auto-discovery worked and the platform was able to connect
    console.log('Platform initialization completed');
  }, 60000); // Increase timeout to 60 seconds for platform initialization
}); 