#!/usr/bin/env node

/**
 * Setup PM2 Monitor as a cron job
 * This script sets up the PM2 monitor to run automatically
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const path = require('path');
const fs = require('fs');

async function setupCronJob() {
  try {
    console.log('🔧 Setting up PM2 Monitor as cron job...');
    
    const projectRoot = path.resolve(__dirname);
    const monitorScript = path.join(projectRoot, 'pm2-monitor.js');
    const cronScript = path.join(projectRoot, 'monitor-cron.sh');
    
    // Create a shell script for the cron job
    const cronContent = `#!/bin/bash
cd ${projectRoot}
node ${monitorScript} >> logs/pm2-monitor-cron.log 2>&1
`;
    
    fs.writeFileSync(cronScript, cronContent);
    
    // Make it executable
    await execAsync(`chmod +x ${cronScript}`);
    
    console.log('✅ Cron script created:', cronScript);
    console.log('📝 To add to crontab, run:');
    console.log(`   crontab -e`);
    console.log(`   Add this line: */1 * * * * ${cronScript}`);
    console.log('   (This will run every minute)');
    
    // Alternative: Run as PM2 process
    console.log('\n🔄 Alternative: Running as PM2 process...');
    try {
      await execAsync(`pm2 start ${monitorScript} --name pm2-monitor --cron "*/1 * * * *"`, { cwd: projectRoot });
      console.log('✅ PM2 Monitor started as PM2 process');
    } catch (pm2Error) {
      console.log('⚠️ PM2 process start failed:', pm2Error.message);
      console.log('📝 You can manually start the monitor with:');
      console.log(`   node ${monitorScript}`);
    }
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  setupCronJob();
}

module.exports = { setupCronJob };
