import * as net from 'net';
import * as os from 'os';
import { Logger } from 'homebridge';

export class EnvisalinkNetworkScanner {
    private readonly defaultPort = 4025;
    private readonly connectionTimeout = 1000; // 1 second timeout
    private readonly log: Logger;

    constructor(log: Logger) {
        this.log = log;
    }

    /**
     * Discover Envisalink devices on the network
     * @param port Optional port to scan (default: 4025)
     * @returns Promise that resolves to an array of discovered device IPs
     */
    async discoverDevices(port: number = this.defaultPort): Promise<string[]> {
        this.log.info(`Starting Envisalink device discovery on port ${port}...`);

        // Get all network interfaces
        const networkInterfaces = this.getNetworkInterfaces();
        if (networkInterfaces.length === 0) {
            this.log.warn('No suitable network interfaces found for scanning');
            return [];
        }

        // Scan each network for devices
        const discoveryPromises = networkInterfaces.map(networkInfo =>
            this.scanNetwork(networkInfo.subnet, networkInfo.netmask, port),
        );

        // Wait for all scans to complete
        const results = await Promise.all(discoveryPromises);

        // Flatten the results and remove duplicates
        const discoveredDevices = [...new Set(results.flat())];

        this.log.info(`Discovered ${discoveredDevices.length} Envisalink device(s): ${discoveredDevices.join(', ') || 'none'}`);
        return discoveredDevices;
    }

    /**
     * Get all suitable network interfaces for scanning
     */
    private getNetworkInterfaces(): Array<{subnet: string; netmask: string}> {
        const interfaces = os.networkInterfaces();
        const results: Array<{subnet: string; netmask: string}> = [];

        // Process each network interface
        Object.keys(interfaces).forEach(interfaceName => {
            const networkInterface = interfaces[interfaceName];
            if (!networkInterface) {
                return;
            }

            // Look for IPv4 interfaces that are not internal
            networkInterface.forEach(info => {
                if (info.family === 'IPv4' && !info.internal) {
                    results.push({
                        subnet: info.address,
                        netmask: info.netmask,
                    });
                }
            });
        });

        return results;
    }

    /**
     * Scan a network for devices with the specified port open
     */
    private async scanNetwork(subnet: string, netmask: string, port: number): Promise<string[]> {
        // Calculate the network address and broadcast address
        const ipParts = subnet.split('.').map(part => parseInt(part, 10));
        const maskParts = netmask.split('.').map(part => parseInt(part, 10));

        // Calculate network address
        const networkAddress = ipParts.map((part, i) => part & maskParts[i]);

        // Calculate broadcast address
        const invertedMask = maskParts.map(part => 255 - part);
        const broadcastAddress = ipParts.map((part, i) => part | invertedMask[i]);

        // Calculate the number of hosts in the network
        const numHosts = invertedMask.reduce((acc, part) => acc * (part + 1), 1) - 2;

        // If the network is too large, limit the scan to avoid performance issues
        const maxHosts = 256; // Limit to a /24 network
        if (numHosts > maxHosts) {
            this.log.warn(`Network is too large (${numHosts} hosts), limiting scan to ${maxHosts} hosts`);

            // Modify the broadcast address to limit the scan
            const limitedBroadcast = [...networkAddress];
            limitedBroadcast[3] = Math.min(networkAddress[3] + maxHosts - 1, 255);

            return this.scanIPRange(
                this.ipToString(networkAddress),
                this.ipToString(limitedBroadcast),
                port,
            );
        }

        return this.scanIPRange(
            this.ipToString(networkAddress),
            this.ipToString(broadcastAddress),
            port,
        );
    }

    /**
     * Scan a range of IP addresses for devices with the specified port open
     */
    private async scanIPRange(startIP: string, endIP: string, port: number): Promise<string[]> {
        const startIPNum = this.ipToNumber(startIP);
        const endIPNum = this.ipToNumber(endIP);
        const discoveredDevices: string[] = [];

        // Create an array of promises for each IP address
        const scanPromises: Promise<void>[] = [];

        for (let ipNum = startIPNum + 1; ipNum < endIPNum; ipNum++) {
            const ip = this.numberToIP(ipNum);
            scanPromises.push(
                this.checkPort(ip, port).then(isOpen => {
                    if (isOpen) {
                        this.log.debug(`Found device at ${ip}:${port}`);
                        discoveredDevices.push(ip);
                    }
                }),
            );
        }

        // Wait for all scans to complete
        await Promise.all(scanPromises);

        return discoveredDevices;
    }

    /**
     * Check if a port is open on a specific IP address
     */
    private checkPort(ip: string, port: number): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const socket = new net.Socket();
            let resolved = false;

            // Set a timeout to avoid hanging
            socket.setTimeout(this.connectionTimeout);

            // Handle successful connection
            socket.on('connect', () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(true);
                }
            });

            // Handle timeout
            socket.on('timeout', () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(false);
                }
            });

            // Handle errors
            socket.on('error', () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(false);
                }
            });

            // Attempt to connect
            socket.connect(port, ip);
        });
    }

    /**
     * Convert an IP address to a number
     */
    private ipToNumber(ip: string): number {
        return ip.split('.')
            .map(part => parseInt(part, 10))
            .reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
    }

    /**
     * Convert a number to an IP address
     */
    private numberToIP(num: number): string {
        return [
            (num >>> 24) & 255,
            (num >>> 16) & 255,
            (num >>> 8) & 255,
            num & 255,
        ].join('.');
    }

    /**
     * Convert an IP address array to a string
     */
    private ipToString(ip: number[]): string {
        return ip.join('.');
    }
}