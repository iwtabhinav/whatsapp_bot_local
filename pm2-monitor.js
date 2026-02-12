#!/usr/bin/env node

/**
 * PM2 Service Monitor - Background monitoring script
 * This script runs independently and monitors the whatsapp_api service
 * If the service is stopped, it automatically restarts it
 * Designed to run as a background process or cron job
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const path = require('path');
const fs = require('fs');

class PM2Monitor {
  constructor() {
    this.projectRoot = path.resolve(__dirname);
    this.processName = 'whatsapp_api';
    this.checkInterval = 30000; // Check every 30 seconds
    this.isRunning = false;
    this.logFile = path.join(this.projectRoot, 'logs', 'pm2-monitor.log');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    // Also write to log file
    try {
      fs.appendFileSync(this.logFile, logMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  async checkPM2Status() {
    try {
      const result = await execAsync('pm2 jlist', { cwd: this.projectRoot });
      const processes = JSON.parse(result.stdout);
      const targetProcess = processes.find(p => p.name === this.processName);
      
      if (targetProcess) {
        return {
          exists: true,
          status: targetProcess.pm2_env.status,
          pid: targetProcess.pid,
          uptime: targetProcess.pm2_env.uptime
        };
      } else {
        return { exists: false };
      }
    } catch (error) {
      this.log(`❌ Error checking PM2 status: ${error.message}`);
      return null;
    }
  }

  async startService() {
    try {
      this.log(`🔄 Starting ${this.processName} service...`);
      
      // Try ecosystem file first
      try {
        const result = await execAsync(`pm2 start ecosystem-whatsapp.config.js`, { cwd: this.projectRoot });
        this.log(`✅ Ecosystem start result: ${result.stdout}`);
        return true;
      } catch (ecosystemError) {
        this.log(`⚠️ Ecosystem start failed: ${ecosystemError.message}`);
        
        // Try direct script as fallback
        try {
          const result = await execAsync(`pm2 start start-fixed-bot.js --name ${this.processName}`, { cwd: this.projectRoot });
          this.log(`✅ Direct start result: ${result.stdout}`);
          return true;
        } catch (directError) {
          this.log(`❌ Direct start also failed: ${directError.message}`);
          return false;
        }
      }
    } catch (error) {
      this.log(`❌ Start service error: ${error.message}`);
      return false;
    }
  }

  async stopService() {
    try {
      this.log(`⏹️ Stopping ${this.processName} service...`);
      await execAsync(`pm2 stop ${this.processName}`, { cwd: this.projectRoot });
      this.log(`✅ Service stopped`);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Delete the process
      try {
        await execAsync(`pm2 delete ${this.processName}`, { cwd: this.projectRoot });
        this.log(`✅ Service deleted`);
      } catch (deleteError) {
        this.log(`⚠️ Delete error (may not exist): ${deleteError.message}`);
      }
      
      return true;
    } catch (error) {
      this.log(`❌ Stop service error: ${error.message}`);
      return false;
    }
  }

  async restartService() {
    try {
      this.log(`🔄 Restarting ${this.processName} service...`);
      
      // Stop the service first
      await this.stopService();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Start the service
      const startSuccess = await this.startService();
      
      if (startSuccess) {
        this.log(`✅ Service restart completed`);
        return true;
      } else {
        this.log(`❌ Service restart failed`);
        return false;
      }
    } catch (error) {
      this.log(`❌ Restart service error: ${error.message}`);
      return false;
    }
  }

  async monitor() {
    try {
      const status = await this.checkPM2Status();
      
      if (!status) {
        this.log(`⚠️ Could not check PM2 status`);
        return;
      }
      
      if (!status.exists) {
        this.log(`⚠️ Service ${this.processName} not found, starting...`);
        await this.startService();
      } else if (status.status === 'stopped') {
        this.log(`⚠️ Service ${this.processName} is stopped, restarting...`);
        await this.restartService();
      } else if (status.status === 'errored') {
        this.log(`⚠️ Service ${this.processName} is errored, restarting...`);
        await this.restartService();
      } else if (status.status === 'online') {
        this.log(`✅ Service ${this.processName} is online (PID: ${status.pid}, Uptime: ${status.uptime}s)`);
      } else {
        this.log(`⚠️ Service ${this.processName} has unknown status: ${status.status}`);
      }
    } catch (error) {
      this.log(`❌ Monitor error: ${error.message}`);
    }
  }

  async start() {
    this.log(`🚀 PM2 Monitor started for ${this.processName}`);
    this.log(`📁 Project root: ${this.projectRoot}`);
    this.log(`⏰ Check interval: ${this.checkInterval}ms`);
    this.log(`📝 Log file: ${this.logFile}`);
    
    this.isRunning = true;
    
    // Initial check
    await this.monitor();
    
    // Set up interval
    const interval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      
      await this.monitor();
    }, this.checkInterval);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.log(`🛑 PM2 Monitor shutting down...`);
      this.isRunning = false;
      clearInterval(interval);
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      this.log(`🛑 PM2 Monitor shutting down...`);
      this.isRunning = false;
      clearInterval(interval);
      process.exit(0);
    });
  }
}

// Run the monitor
if (require.main === module) {
  const monitor = new PM2Monitor();
  monitor.start().catch(error => {
    console.error('❌ PM2 Monitor failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = PM2Monitor;
