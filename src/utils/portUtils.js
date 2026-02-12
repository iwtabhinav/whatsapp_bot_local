const { exec } = require('child_process');
const { promisify } = require('util');
const net = require('net');

const execAsync = promisify(exec);

/**
 * Utility functions for port management
 */
class PortUtils {
    /**
     * Check if a port is in use using Node.js net module (cross-platform)
     * @param {number} port - Port number to check
     * @returns {Promise<boolean>} - True if port is in use
     */
    static async isPortInUse(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.listen(port, () => {
                server.once('close', () => {
                    resolve(false); // Port is available
                });
                server.close();
            });
            
            server.on('error', () => {
                resolve(true); // Port is in use
            });
        });
    }

    /**
     * Kill process using a specific port (Windows compatible)
     * @param {number} port - Port number
     * @returns {Promise<boolean>} - True if process was killed
     */
    static async killPortProcess(port) {
        try {
            let pids = [];
            
            // Windows command to find process using port
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                const lines = stdout.trim().split('\n');
                
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5 && parts[4] !== '0') {
                        pids.push(parts[4]);
                    }
                }
            } else {
                // Unix/Linux command
                const { stdout } = await execAsync(`lsof -ti:${port}`);
                pids = stdout.trim().split('\n').filter(pid => pid.length > 0);
            }

            if (pids.length === 0) {
                console.log(`⚠️ No process found using port ${port}`);
                return false;
            }

            for (const pid of pids) {
                try {
                    if (process.platform === 'win32') {
                        await execAsync(`taskkill /PID ${pid} /F`);
                        console.log(`✅ Killed process ${pid} using port ${port}`);
                    } else {
                        await execAsync(`kill -9 ${pid}`);
                        console.log(`✅ Killed process ${pid} using port ${port}`);
                    }
                } catch (killError) {
                    console.log(`⚠️ Could not kill process ${pid}: ${killError.message}`);
                }
            }

            return true;
        } catch (error) {
            console.log(`⚠️ Could not find process using port ${port}: ${error.message}`);
            return false;
        }
    }

    /**
     * Find an available port starting from a given port
     * @param {number} startPort - Starting port number
     * @param {number} maxAttempts - Maximum number of ports to try
     * @returns {Promise<number>} - Available port number
     */
    static async findAvailablePort(startPort = 3000, maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            const port = startPort + i;
            const inUse = await this.isPortInUse(port);

            if (!inUse) {
                return port;
            }
        }

        throw new Error(`No available port found starting from ${startPort}`);
    }

    /**
     * Get process information for a port (Windows compatible)
     * @param {number} port - Port number
     * @returns {Promise<Object|null>} - Process information or null
     */
    static async getPortProcessInfo(port) {
        try {
            let processInfo = null;
            
            if (process.platform === 'win32') {
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                const lines = stdout.trim().split('\n');
                
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5 && parts[4] !== '0') {
                        const pid = parts[4];
                        try {
                            const { stdout: taskInfo } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV`);
                            const taskLines = taskInfo.trim().split('\n');
                            if (taskLines.length > 1) {
                                const taskParts = taskLines[1].split('","');
                                processInfo = {
                                    command: taskParts[0].replace(/"/g, ''),
                                    pid: pid,
                                    user: 'N/A',
                                    fd: 'N/A',
                                    type: 'TCP',
                                    device: 'N/A',
                                    size: 'N/A',
                                    node: `:${port}`,
                                    name: taskParts[0].replace(/"/g, '')
                                };
                                break;
                            }
                        } catch (taskError) {
                            // Continue to next process
                        }
                    }
                }
            } else {
                // Unix/Linux command
                const { stdout } = await execAsync(`lsof -i:${port} -P -n`);
                const lines = stdout.trim().split('\n');

                if (lines.length <= 1) {
                    return null;
                }

                const processLine = lines[1];
                const parts = processLine.split(/\s+/);

                processInfo = {
                    command: parts[0],
                    pid: parts[1],
                    user: parts[2],
                    fd: parts[3],
                    type: parts[4],
                    device: parts[5],
                    size: parts[6],
                    node: parts[7],
                    name: parts[8]
                };
            }
            
            return processInfo;
        } catch (error) {
            return null;
        }
    }
}

module.exports = PortUtils;
