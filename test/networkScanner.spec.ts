import { EnvisalinkNetworkScanner } from '../src/networkScanner';
import { EnvisalinkHomebridgePlatform } from '../src/platform';
import * as net from 'net';
import * as os from 'os';

// Mock the Logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

// Mock the net.Socket
jest.mock('net', () => {
  const mockSocket = {
    setTimeout: jest.fn(),
    on: jest.fn(),
    connect: jest.fn(),
    destroy: jest.fn(),
    removeAllListeners: jest.fn()
  };
  
  return {
    Socket: jest.fn(() => mockSocket)
  };
});

// Mock os.networkInterfaces
jest.mock('os', () => {
  return {
    networkInterfaces: jest.fn()
  };
});

// Mock the EnvisalinkNetworkScanner
jest.mock('../src/networkScanner');

// Mock the nodealarmproxy module
jest.mock('nodealarmproxy', () => {
  return {
    initConfig: jest.fn().mockReturnValue({
      on: jest.fn()
    }),
    manualCommand: jest.fn()
  };
});

describe('EnvisalinkNetworkScanner', () => {
  let mockSocket: any;
  let sockets: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    sockets = [];
    mockSocket = {
      setTimeout: jest.fn(),
      on: jest.fn(),
      connect: jest.fn(),
      destroy: jest.fn(),
      removeAllListeners: jest.fn()
    };
    ((net.Socket as unknown) as jest.Mock).mockImplementation(() => {
      sockets.push(mockSocket);
      return mockSocket;
    });
  });

  afterEach(() => {
    // Clean up all sockets
    sockets.forEach(socket => {
      socket.destroy();
      socket.removeAllListeners();
    });
    sockets = [];
    jest.restoreAllMocks();
  });
  
  it('should return empty array when no network interfaces are found', async () => {
    // Setup the mock implementation for this test
    const mockDiscoverDevices = jest.fn().mockResolvedValue([]);
    (EnvisalinkNetworkScanner as jest.Mock).mockImplementation(() => ({
      discoverDevices: mockDiscoverDevices
    }));
    
    const scanner = new EnvisalinkNetworkScanner(mockLogger as any);
    const result = await scanner.discoverDevices();
    
    expect(result).toEqual([]);
    expect(mockDiscoverDevices).toHaveBeenCalled();
  });
  
  it('should scan network and find devices', async () => {
    // Setup the mock implementation for this test
    const mockDiscoverDevices = jest.fn().mockResolvedValue(['192.168.1.10']);
    (EnvisalinkNetworkScanner as jest.Mock).mockImplementation(() => ({
      discoverDevices: mockDiscoverDevices
    }));
    
    const scanner = new EnvisalinkNetworkScanner(mockLogger as any);
    const result = await scanner.discoverDevices();
    
    expect(result).toEqual(['192.168.1.10']);
    expect(mockDiscoverDevices).toHaveBeenCalled();
  });
});

describe('EnvisalinkHomebridgePlatform Auto-Discovery', () => {
  let platform: EnvisalinkHomebridgePlatform | null;
  let mockApi: any;
  let mockSocket: any;
  let sockets: any[] = [];
  
  beforeEach(() => {
    jest.clearAllMocks();
    sockets = [];
    
    mockSocket = {
      setTimeout: jest.fn(),
      on: jest.fn(),
      connect: jest.fn(),
      destroy: jest.fn(),
      removeAllListeners: jest.fn()
    };
    ((net.Socket as unknown) as jest.Mock).mockImplementation(() => {
      sockets.push(mockSocket);
      return mockSocket;
    });
    
    // Create mock API
    mockApi = {
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
  });

  afterEach(async () => {
    // Clean up all sockets
    sockets.forEach(socket => {
      socket.destroy();
      socket.removeAllListeners();
    });
    sockets = [];
    jest.restoreAllMocks();
    
    if (platform) {
      // Clean up any platform resources
      platform = null;
    }
  });
  
  it('should use auto-discovery when host is not provided', async () => {
    // Mock the config
    const mockConfig = {
      name: 'Test Platform',
      enableAutoDiscovery: true,
      password: 'password',
      pin: '1234',
      port: 4025,
      partitions: [{ name: 'Partition 1' }],
      zones: [{ name: 'Zone 1', type: 'door', partition: 1 }]
    };
    
    // Mock the network scanner to return a discovered device
    const mockDiscoverDevices = jest.fn().mockResolvedValue(['192.168.1.10']);
    (EnvisalinkNetworkScanner as jest.Mock).mockImplementation(() => {
      return {
        discoverDevices: mockDiscoverDevices
      };
    });
    
    // Create the platform
    platform = new EnvisalinkHomebridgePlatform(
      mockLogger as any,
      mockConfig as any,
      mockApi
    );
    
    // Trigger the didFinishLaunching event
    const didFinishLaunchingCallback = mockApi.on.mock.calls.find(
      call => call[0] === 'didFinishLaunching'
    )[1];
    
    await didFinishLaunchingCallback();
    
    // Verify that auto-discovery was attempted
    expect(mockDiscoverDevices).toHaveBeenCalledWith(4025);
    
    // Verify that the discovered host was used
    expect(mockLogger.info).toHaveBeenCalledWith('Auto-discovered Envisalink device at 192.168.1.10');
  });
  
  it('should handle auto-discovery failure', async () => {
    // Mock the config
    const mockConfig = {
      name: 'Test Platform',
      enableAutoDiscovery: true,
      password: 'password',
      pin: '1234',
      port: 4025,
      partitions: [{ name: 'Partition 1' }],
      zones: [{ name: 'Zone 1', type: 'door', partition: 1 }]
    };
    
    // Mock the network scanner to return no devices
    const mockDiscoverDevices = jest.fn().mockResolvedValue([]);
    (EnvisalinkNetworkScanner as jest.Mock).mockImplementation(() => {
      return {
        discoverDevices: mockDiscoverDevices
      };
    });
    
    // Create the platform
    platform = new EnvisalinkHomebridgePlatform(
      mockLogger as any,
      mockConfig as any,
      mockApi
    );
    
    // Trigger the didFinishLaunching event
    const didFinishLaunchingCallback = mockApi.on.mock.calls.find(
      call => call[0] === 'didFinishLaunching'
    )[1];
    
    await didFinishLaunchingCallback();
    
    // Verify that auto-discovery was attempted
    expect(mockDiscoverDevices).toHaveBeenCalledWith(4025);
    
    // Verify that an error was logged
    expect(mockLogger.error).toHaveBeenCalledWith('No Envisalink devices found on the network. Please specify the host manually.');
  });
  
  it('should use provided host when auto-discovery is disabled', async () => {
    // Mock the config
    const mockConfig = {
      name: 'Test Platform',
      host: '192.168.1.20',
      enableAutoDiscovery: false,
      password: 'password',
      pin: '1234',
      port: 4025,
      partitions: [{ name: 'Partition 1' }],
      zones: [{ name: 'Zone 1', type: 'door', partition: 1 }]
    };
    
    // Mock the network scanner
    const mockDiscoverDevices = jest.fn();
    (EnvisalinkNetworkScanner as jest.Mock).mockImplementation(() => {
      return {
        discoverDevices: mockDiscoverDevices
      };
    });
    
    // Create the platform
    platform = new EnvisalinkHomebridgePlatform(
      mockLogger as any,
      mockConfig as any,
      mockApi
    );
    
    // Trigger the didFinishLaunching event
    const didFinishLaunchingCallback = mockApi.on.mock.calls.find(
      call => call[0] === 'didFinishLaunching'
    )[1];
    
    await didFinishLaunchingCallback();
    
    // Verify that auto-discovery was not attempted
    expect(mockDiscoverDevices).not.toHaveBeenCalled();
    
    // Verify that the provided host was used
    expect(mockLogger.info).toHaveBeenCalledWith('Configuring Envisalink platform, Host: 192.168.1.20 Port: 4025');
  });
}); 