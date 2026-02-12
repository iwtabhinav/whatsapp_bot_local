#!/usr/bin/env node

/**
 * Kill All Bot Processes Script
 * 
 * This script kills all running bot processes for a clean restart
 */

const { spawn } = require('child_process');

console.log('🛑 Killing all bot processes...');

function killAllBotProcesses() {
    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const killPatterns = [
            'ai-bot',
            'start-ai-bot',
            'UltraRobustWhatsAppBot',
            'web-server',
            'node.*start-ai-bot',
            'node.*UltraRobustWhatsAppBot',
            'node.*web-server'
        ];

        let killedCount = 0;
        const totalPatterns = killPatterns.length;

        if (totalPatterns === 0) {
            resolve();
            return;
        }

        killPatterns.forEach(pattern => {
            let killProcess;

            if (isWindows) {
                // Windows: Use taskkill
                killProcess = spawn('taskkill', ['/f', '/im', `${pattern}.exe`], { stdio: 'ignore' });
            } else {
                // Unix/Linux/macOS: Use pkill
                killProcess = spawn('pkill', ['-f', pattern], { stdio: 'ignore' });
            }

            killProcess.on('close', (code) => {
                killedCount++;
                if (code === 0) {
                    console.log(`✅ Killed ${pattern} processes`);
                } else {
                    console.log(`ℹ️ No ${pattern} processes found`);
                }

                if (killedCount === totalPatterns) {
                    setTimeout(() => {
                        console.log('✅ All bot processes cleaned up');
                        resolve();
                    }, 1000);
                }
            });

            killProcess.on('error', (error) => {
                console.log(`ℹ️ Could not check for ${pattern} processes: ${error.message}`);
                killedCount++;
                if (killedCount === totalPatterns) {
                    setTimeout(() => {
                        console.log('✅ All bot processes cleaned up');
                        resolve();
                    }, 1000);
                }
            });
        });
    });
}

// Run the cleanup
killAllBotProcesses().then(() => {
    console.log('🎉 Bot process cleanup completed!');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
});

