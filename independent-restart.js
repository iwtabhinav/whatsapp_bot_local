#!/usr/bin/env node

/**
 * Independent restart script that runs outside the web server
 * This prevents the "chicken and egg" problem where stopping the service
 * also stops the web server that's trying to restart it
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const path = require('path');
const fs = require('fs');

async function independentRestart() {
  try {
    console.log('🔄 Independent restart process started...');
    console.log('===============================================');
    
    const projectRoot = path.resolve(__dirname);
    const processName = 'whatsapp_api';
    
    console.log('🔧 Project root:', projectRoot);
    console.log('🔧 Target process:', processName);
    
    // Step 1: Stop the service
    console.log('\n⏹️ Step 1: Stopping whatsapp_api service...');
    try {
      const stopResult = await execAsync(`pm2 stop ${processName}`, { cwd: projectRoot });
      console.log('✅ Stop result:', stopResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (stopError) {
      console.log('⚠️ Stop error (may not exist):', stopError.message);
    }
    
    // Step 2: Delete the process
    console.log('\n🗑️ Step 2: Deleting whatsapp_api process...');
    try {
      const deleteResult = await execAsync(`pm2 delete ${processName}`, { cwd: projectRoot });
      console.log('✅ Delete result:', deleteResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (deleteError) {
      console.log('⚠️ Delete error (may not exist):', deleteError.message);
    }
    
    // Step 3: Start the service
    console.log('\n▶️ Step 3: Starting whatsapp_api service...');
    try {
      const startScriptPath = path.join(projectRoot, 'start-fixed-bot.js');
      console.log('🔧 Starting script:', startScriptPath);
      
      const startResult = await execAsync(`pm2 start ${startScriptPath} --name ${processName}`, { cwd: projectRoot });
      console.log('✅ Start result:', startResult.stdout);
      console.log('Start stderr:', startResult.stderr);
    } catch (startError) {
      console.log('❌ Start error:', startError.message);
      console.log('Error stdout:', startError.stdout);
      console.log('Error stderr:', startError.stderr);
      throw new Error(`Failed to start service: ${startError.message}`);
    }
    
    // Step 4: Wait and verify
    console.log('\n⏳ Step 4: Waiting for service to start...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Step 5: Final verification
    console.log('\n🔍 Step 5: Final verification...');
    try {
      const verifyResult = await execAsync('pm2 jlist', { cwd: projectRoot });
      const verifyList = JSON.parse(verifyResult.stdout);
      const runningProcess = verifyList.find(proc => proc.name === processName);
      
      if (runningProcess) {
        console.log(`Final status: ${runningProcess.pm2_env.status}`);
        console.log(`Final uptime: ${runningProcess.pm2_env.uptime}s`);
        console.log(`Final PID: ${runningProcess.pid}`);
        console.log(`Final memory: ${runningProcess.monit.memory} bytes`);
        
        if (runningProcess.pm2_env.status === 'online') {
          console.log('\n🎉 RESTART SUCCESSFUL!');
          console.log('✅ Service is online and running');
          return true;
        } else {
          console.log('\n❌ RESTART FAILED!');
          console.log('❌ Service is not online');
          return false;
        }
      } else {
        console.log('\n❌ RESTART FAILED!');
        console.log('❌ Service not found');
        return false;
      }
    } catch (verifyError) {
      console.log('❌ Verification error:', verifyError.message);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Independent restart failed:', error.message);
    return false;
  }
}

// Run the independent restart
if (require.main === module) {
  independentRestart()
    .then(success => {
      if (success) {
        console.log('\n🎉 INDEPENDENT RESTART COMPLETED SUCCESSFULLY!');
        process.exit(0);
      } else {
        console.log('\n❌ INDEPENDENT RESTART FAILED!');
        process.exit(1);
      }
    })
    .catch(error => {
      console.log('\n❌ INDEPENDENT RESTART ERROR!');
      console.log('❌ Error:', error.message);
      process.exit(1);
    });
}

module.exports = { independentRestart };
