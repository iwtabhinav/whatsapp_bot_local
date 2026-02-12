#!/usr/bin/env node

/**
 * Restart service script - can be called from web server
 * This is the exact same logic as debug-restart.js but designed to be called from web server
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function restartWhatsAppService() {
  try {
    console.log('🔄 Restarting WhatsApp bot service...');
    const processName = 'whatsapp_api';
    let stopResult = null;
    let startResult = null;
    let deleteResult = null;
    
    // Get the correct working directory (same as when running directly)
    const path = require('path');
    const projectRoot = path.resolve(__dirname);
    console.log('🔧 Working directory:', projectRoot);
    console.log('🔧 Current working directory:', process.cwd());
    console.log('🔧 __dirname:', __dirname);
    
    // Check if start-fixed-bot.js exists
    const startScriptPath = path.join(projectRoot, 'start-fixed-bot.js');
    const fs = require('fs');
    if (fs.existsSync(startScriptPath)) {
      console.log('✅ start-fixed-bot.js exists at:', startScriptPath);
    } else {
      console.log('❌ start-fixed-bot.js NOT found at:', startScriptPath);
      throw new Error(`start-fixed-bot.js not found at ${startScriptPath}`);
    }
    
    // Check PM2 environment
    try {
      const pm2Version = await execAsync('pm2 --version', { cwd: projectRoot });
      console.log('✅ PM2 version:', pm2Version.stdout.trim());
    } catch (pm2Error) {
      console.log('❌ PM2 not available:', pm2Error.message);
      throw new Error('PM2 is not available');
    }
    
    // Check current PM2 processes before starting
    try {
      const currentProcesses = await execAsync('pm2 jlist', { cwd: projectRoot });
      const processes = JSON.parse(currentProcesses.stdout);
      console.log('📊 Current PM2 processes before start:', processes.map(p => `${p.name}: ${p.pm2_env.status}`));
    } catch (processError) {
      console.log('⚠️ Could not get current PM2 processes:', processError.message);
    }
    
    // Step 1: Stop the process (always try, even if it doesn't exist)
    console.log(`⏹️ Stopping ${processName} service...`);
    try {
      stopResult = await execAsync(`pm2 stop ${processName}`, { cwd: projectRoot });
      console.log('✅ Stop result:', stopResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (stopError) {
      console.log('⚠️ Stop error (may not exist):', stopError.message);
    }
    
    // Step 2: Delete the process completely to ensure clean start
    console.log(`🗑️ Deleting ${processName} process...`);
    try {
      deleteResult = await execAsync(`pm2 delete ${processName}`, { cwd: projectRoot });
      console.log('✅ Delete result:', deleteResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (deleteError) {
      console.log('⚠️ Delete error (may not exist):', deleteError.message);
    }
    
    // Step 3: Start the service using the exact same command as debug script
    console.log(`▶️ Starting ${processName} service...`);
    try {
      // Use absolute path to ensure we're in the right directory
      console.log('🔧 Starting script path:', startScriptPath);
      console.log('🔧 Command to execute:', `pm2 start ${startScriptPath} --name ${processName}`);
      console.log('🔧 Working directory for command:', projectRoot);
      
      // Try multiple start strategies
      let startSuccess = false;
      
      // Strategy 1: Try with absolute path
      try {
        startResult = await execAsync(`pm2 start ${startScriptPath} --name ${processName}`, { cwd: projectRoot });
        console.log('✅ Start result (absolute path):', startResult.stdout);
        console.log('Start stderr (absolute path):', startResult.stderr);
        startSuccess = true;
      } catch (absoluteError) {
        console.log('⚠️ Absolute path start failed:', absoluteError.message);
        console.log('Absolute path error stdout:', absoluteError.stdout);
        console.log('Absolute path error stderr:', absoluteError.stderr);
      }
      
      // Strategy 2: Try with relative path (like debug script)
      if (!startSuccess) {
        try {
          console.log('🔄 Trying relative path approach...');
          startResult = await execAsync(`pm2 start start-fixed-bot.js --name ${processName}`, { cwd: projectRoot });
          console.log('✅ Start result (relative path):', startResult.stdout);
          console.log('Start stderr (relative path):', startResult.stderr);
          startSuccess = true;
        } catch (relativeError) {
          console.log('⚠️ Relative path start failed:', relativeError.message);
          console.log('Relative path error stdout:', relativeError.stdout);
          console.log('Relative path error stderr:', relativeError.stderr);
        }
      }
      
      // Strategy 3: Try with ecosystem file
      if (!startSuccess) {
        try {
          console.log('🔄 Trying ecosystem file approach...');
          startResult = await execAsync(`pm2 start ecosystem-whatsapp.config.js`, { cwd: projectRoot });
          console.log('✅ Start result (ecosystem):', startResult.stdout);
          console.log('Start stderr (ecosystem):', startResult.stderr);
          startSuccess = true;
        } catch (ecosystemError) {
          console.log('⚠️ Ecosystem start failed:', ecosystemError.message);
          console.log('Ecosystem error stdout:', ecosystemError.stdout);
          console.log('Ecosystem error stderr:', ecosystemError.stderr);
        }
      }
      
      if (!startSuccess) {
        throw new Error('All start strategies failed');
      }
      
    } catch (startError) {
      console.log('❌ Start error:', startError.message);
      console.log('Error stdout:', startError.stdout);
      console.log('Error stderr:', startError.stderr);
      throw new Error(`Failed to start service: ${startError.message}`);
    }
    
    // Step 4: Wait and verify (exact same as debug script)
    console.log('⏳ Waiting for service to start...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Check PM2 processes after start attempt
    try {
      const afterStartProcesses = await execAsync('pm2 jlist', { cwd: projectRoot });
      const afterProcesses = JSON.parse(afterStartProcesses.stdout);
      console.log('📊 PM2 processes after start attempt:', afterProcesses.map(p => `${p.name}: ${p.pm2_env.status}`));
    } catch (afterError) {
      console.log('⚠️ Could not get PM2 processes after start:', afterError.message);
    }
    
    // Step 5: Final verification (exact same as debug script)
    console.log('🔍 Final verification...');
    let runningProcess = null;
    
    try {
      const verifyResult = await execAsync('pm2 jlist', { cwd: projectRoot });
      const verifyList = JSON.parse(verifyResult.stdout);
      runningProcess = verifyList.find(proc => proc.name === processName);
      
      if (runningProcess) {
        console.log(`Final status: ${runningProcess.pm2_env.status}`);
        console.log(`Final uptime: ${runningProcess.pm2_env.uptime}s`);
        console.log(`Final PID: ${runningProcess.pid}`);
        console.log(`Final memory: ${runningProcess.monit.memory} bytes`);
      }
    } catch (verifyError) {
      console.log('❌ Verification error:', verifyError.message);
    }
    
    if (!runningProcess || runningProcess.pm2_env.status !== 'online') {
      throw new Error(`Service is not online. Final status: ${runningProcess?.pm2_env?.status || 'not found'}`);
    }
    
    console.log('✅ Service is online!');
    
    return {
      success: true,
      message: `WhatsApp bot service (${runningProcess.name}) restarted successfully`,
      processName: runningProcess.name,
      stopOutput: stopResult?.stdout || 'No stop needed',
      startOutput: startResult?.stdout || 'No start attempted',
      verification: {
        status: runningProcess.pm2_env.status,
        uptime: runningProcess.pm2_env.uptime,
        pid: runningProcess.pid
      }
    };
    
  } catch (error) {
    console.error('❌ Error restarting service:', error.message);
    throw error;
  }
}

// Export for use in web server
module.exports = { restartWhatsAppService };

// If called directly, run the restart
if (require.main === module) {
  restartWhatsAppService()
    .then(result => {
      console.log('\n🎉 RESTART SUCCESSFUL!');
      console.log('✅ Service was stopped and restarted successfully');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.log('\n❌ RESTART FAILED!');
      console.log('❌ Error:', error.message);
      process.exit(1);
    });
}
