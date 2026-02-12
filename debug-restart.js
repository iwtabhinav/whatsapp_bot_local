#!/usr/bin/env node

/**
 * Debug script to test PM2 restart functionality
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function debugRestart() {
  try {
    console.log('🔍 Debug: Testing PM2 restart functionality...');
    console.log('===============================================');
    
    // Step 1: Check current PM2 status
    console.log('\n📊 Step 1: Current PM2 status');
    try {
      const jlistResult = await execAsync('pm2 jlist');
      const pm2List = JSON.parse(jlistResult.stdout);
      console.log('PM2 processes:', pm2List.map(p => `${p.name}: ${p.pm2_env.status}`));
      
      const whatsappProcess = pm2List.find(proc => proc.name === 'whatsapp_api');
      if (whatsappProcess) {
        console.log(`whatsapp_api found: ${whatsappProcess.pm2_env.status}`);
      } else {
        console.log('whatsapp_api not found');
      }
    } catch (error) {
      console.log('❌ Error getting PM2 list:', error.message);
    }
    
    // Step 2: Stop the process
    console.log('\n⏹️ Step 2: Stopping whatsapp_api');
    try {
      const stopResult = await execAsync('pm2 stop whatsapp_api');
      console.log('Stop result:', stopResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.log('⚠️ Stop error (may not exist):', error.message);
    }
    
    // Step 3: Delete the process
    console.log('\n🗑️ Step 3: Deleting whatsapp_api process');
    try {
      const deleteResult = await execAsync('pm2 delete whatsapp_api');
      console.log('Delete result:', deleteResult.stdout);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('⚠️ Delete error (may not exist):', error.message);
    }
    
    // Step 4: Start the process
    console.log('\n▶️ Step 4: Starting whatsapp_api');
    try {
      const startResult = await execAsync('pm2 start start-fixed-bot.js --name whatsapp_api');
      console.log('Start result:', startResult.stdout);
      console.log('Start stderr:', startResult.stderr);
    } catch (error) {
      console.log('❌ Start error:', error.message);
      console.log('Error stdout:', error.stdout);
      console.log('Error stderr:', error.stderr);
      return;
    }
    
    // Step 5: Wait and verify
    console.log('\n⏳ Step 5: Waiting for service to start...');
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Step 6: Check final status
    console.log('\n🔍 Step 6: Final verification');
    try {
      const finalResult = await execAsync('pm2 jlist');
      const finalList = JSON.parse(finalResult.stdout);
      const finalProcess = finalList.find(proc => proc.name === 'whatsapp_api');
      
      if (finalProcess) {
        console.log(`Final status: ${finalProcess.pm2_env.status}`);
        console.log(`Final uptime: ${finalProcess.pm2_env.uptime}s`);
        console.log(`Final PID: ${finalProcess.pid}`);
        console.log(`Final memory: ${finalProcess.monit.memory} bytes`);
        
        if (finalProcess.pm2_env.status === 'online') {
          console.log('✅ Service is online!');
        } else {
          console.log('❌ Service is not online');
        }
      } else {
        console.log('❌ Service not found in final check');
      }
    } catch (error) {
      console.log('❌ Error in final verification:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  }
}

// Run the debug
debugRestart();
