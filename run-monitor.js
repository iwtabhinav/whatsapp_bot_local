#!/usr/bin/env node

/**
 * Run PM2 Monitor manually
 * This script starts the PM2 monitor for immediate use
 */

const PM2Monitor = require('./pm2-monitor');

async function runMonitor() {
  try {
    console.log('🚀 Starting PM2 Monitor manually...');
    
    const monitor = new PM2Monitor();
    await monitor.start();
    
  } catch (error) {
    console.error('❌ Monitor failed to start:', error.message);
    process.exit(1);
  }
}

// Run the monitor
runMonitor();
