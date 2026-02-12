#!/usr/bin/env node

/**
 * Start PM2 Monitor in background
 * This script starts the PM2 monitor as a background process
 */

const { spawn } = require('child_process');
const path = require('path');

function startMonitor() {
  console.log('🚀 Starting PM2 Monitor in background...');
  
  const monitorScript = path.join(__dirname, 'pm2-monitor.js');
  console.log('📁 Monitor script:', monitorScript);
  
  // Start the monitor as a detached process
  const monitorProcess = spawn('node', [monitorScript], {
    cwd: path.resolve(__dirname),
    stdio: 'inherit',
    detached: true
  });
  
  monitorProcess.on('error', (error) => {
    console.error('❌ Monitor process error:', error);
  });
  
  monitorProcess.on('exit', (code) => {
    console.log(`📊 Monitor process exited with code: ${code}`);
  });
  
  // Unref to allow the parent process to exit
  monitorProcess.unref();
  
  console.log('✅ PM2 Monitor started in background');
  console.log('📝 Monitor PID:', monitorProcess.pid);
  console.log('📝 Logs will be written to: logs/pm2-monitor.log');
  
  return monitorProcess;
}

// Run if called directly
if (require.main === module) {
  startMonitor();
}

module.exports = { startMonitor };
