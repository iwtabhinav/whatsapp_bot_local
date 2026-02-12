#!/usr/bin/env node

/**
 * AI-Powered WhatsApp Taxi Booking Bot Startup Script
 * 
 * This script starts the complete integrated system with:
 * - Ultra-Robust WhatsApp Bot with AI integration
 * - MongoDB database connection
 * - OpenAI API integration
 * - Booking management system
 * - Media processing capabilities
 */

require('dotenv').config();
const { fork, spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting AI-Powered WhatsApp Taxi Booking System...');
console.log('==================================================');

// Function to kill existing bot processes
function killExistingProcesses() {
    console.log('🔄 Checking for existing bot processes...');

    return new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const killPatterns = [
            'ai-bot',
            'start-ai-bot',
            'UltraRobustWhatsAppBot',
            'web-server'
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
                    console.log(`✅ Killed existing ${pattern} processes`);
                } else {
                    console.log(`ℹ️ No existing ${pattern} processes found`);
                }

                if (killedCount === totalPatterns) {
                    // Wait a moment for processes to fully terminate
                    setTimeout(() => {
                        console.log('✅ Process cleanup completed');
                        resolve();
                    }, 2000);
                }
            });

            killProcess.on('error', (error) => {
                console.log(`ℹ️ Could not check for ${pattern} processes: ${error.message}`);
                killedCount++;
                if (killedCount === totalPatterns) {
                    setTimeout(() => {
                        console.log('✅ Process cleanup completed');
                        resolve();
                    }, 2000);
                }
            });
        });
    });
}

// Check required environment variables
const requiredEnvVars = ['OPENAI_API_KEY', 'MONGODB_URI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName] || process.env[varName] === `your-${varName.toLowerCase().replace('_', '-')}-here`);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
        console.error(`   • ${varName}`);
    });
    console.error('\n💡 Please update your .env file with the correct values.');
    process.exit(1);
}

console.log('✅ Environment variables validated');
console.log('🧠 OpenAI API: Ready');
console.log('📊 MongoDB: Ready');
console.log('🤖 WhatsApp Bot: Starting...');

let botProcess;
let webServerProcess;
let restartCount = 0;
const MAX_RESTARTS = 2; // Reduced from 5 to 2
let healthCheckInterval;
let isShuttingDown = false;

function startProcesses() {
    console.log('\n🔄 Starting integrated processes...');

    // Clean up any existing processes first
    if (botProcess && !botProcess.killed) {
        botProcess.kill('SIGTERM');
    }
    if (webServerProcess && !webServerProcess.killed) {
        webServerProcess.kill('SIGTERM');
    }

    // Start the AI-powered bot process
    botProcess = fork(path.join(__dirname, 'src', 'UltraRobustWhatsAppBot.js'), [], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });

    console.log(`🤖 AI Bot process started with PID: ${botProcess.pid}`);

    // Start the web server process (optional)
    try {
        webServerProcess = fork(path.join(__dirname, 'src', 'web-server.js'), [], {
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'production' }
        });
        console.log(`🌐 Web Server process started with PID: ${webServerProcess.pid}`);
        
        // Start health check for web server
        startHealthCheck();
    } catch (error) {
        console.log('⚠️ Web server not available, running bot only');
    }

    // Handle process exits
    botProcess.on('exit', (code) => {
        console.error(`❌ AI Bot process exited with code ${code}`);
        if (isShuttingDown) {
            console.log('🛑 System is shutting down, not restarting');
            return;
        }
        
        if (code !== 0 && code !== null && restartCount < MAX_RESTARTS) {
            restartCount++;
            console.log(`🔄 Restarting bot in 5 seconds... (${restartCount}/${MAX_RESTARTS})`);
            // Kill web server process before restarting
            if (webServerProcess && !webServerProcess.killed) {
                webServerProcess.kill('SIGTERM');
                console.log('🌐 Web Server process killed before restart');
            }
            setTimeout(() => {
                if (!isShuttingDown) {
                    startProcesses();
                }
            }, 5000);
        } else if (code === null) {
            console.log('🛑 Bot process terminated by user, not restarting');
        } else {
            console.error(`❌ Maximum restart attempts (${MAX_RESTARTS}) reached or invalid exit code. Stopping.`);
            process.exit(1);
        }
    });

    if (webServerProcess) {
        webServerProcess.on('exit', (code) => {
            console.error(`❌ Web Server process exited with code ${code}`);
            // Only restart web server if it's not a user termination
            if (code !== null) {
                console.log('🔄 Web server crashed, will restart with next bot restart');
                // Don't restart immediately, let the bot restart handle it
            } else {
                console.log('🛑 Web server terminated by user, not restarting');
            }
        });
    }
}

// Health check function for web server (monitoring only, no auto-restart)
function startHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    
    healthCheckInterval = setInterval(async () => {
        if (webServerProcess && !webServerProcess.killed) {
            try {
                const http = require('http');
                const options = {
                    hostname: 'localhost',
                    port: process.env.WEB_PORT || 3002,
                    path: '/health',
                    method: 'GET',
                    timeout: 5000
                };
                
                const req = http.request(options, (res) => {
                    if (res.statusCode === 200) {
                        console.log('✅ Web server health check passed');
                    } else {
                        console.log(`⚠️ Web server health check failed with status: ${res.statusCode}`);
                    }
                });
                
                req.on('error', (error) => {
                    console.log('❌ Web server health check failed:', error.message);
                    // Just log, don't restart automatically
                });
                
                req.on('timeout', () => {
                    console.log('❌ Web server health check timed out');
                    // Just log, don't restart automatically
                });
                
                req.end();
            } catch (error) {
                console.log('❌ Health check error:', error.message);
            }
        }
    }, 60000); // Check every 60 seconds (less frequent)
}

function restartWebServer() {
    if (webServerProcess && !webServerProcess.killed) {
        webServerProcess.kill('SIGTERM');
    }
    
    setTimeout(() => {
        try {
            webServerProcess = fork(path.join(__dirname, 'src', 'web-server.js'), [], {
                stdio: 'inherit',
                env: { ...process.env, NODE_ENV: 'production' }
            });
            console.log(`🌐 Web Server process restarted with PID: ${webServerProcess.pid}`);
            startHealthCheck();
        } catch (error) {
            console.error('❌ Failed to restart web server:', error.message);
        }
    }, 2000);
}

function shutdownProcesses() {
    console.log('\n🛑 Shutting down AI-Powered WhatsApp Taxi Booking System...');
    isShuttingDown = true;

    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }

    if (botProcess && !botProcess.killed) {
        botProcess.kill('SIGINT');
        console.log('🤖 AI Bot process sent SIGINT');
    }

    if (webServerProcess && !webServerProcess.killed) {
        webServerProcess.kill('SIGINT');
        console.log('🌐 Web Server process sent SIGINT');
    }

    setTimeout(() => process.exit(0), 3000);
}

// Start the application with cleanup
async function startApplication() {
    try {
        await killExistingProcesses();
        startProcesses();
    } catch (error) {
        console.error('❌ Error during startup:', error);
        process.exit(1);
    }
}

startApplication();

// Graceful shutdown handlers
process.on('SIGINT', shutdownProcesses);
process.on('SIGTERM', shutdownProcesses);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception in main process:', error);
    // Don't shutdown on uncaught exceptions, just log them
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection in main process:', reason);
    // Don't shutdown on unhandled rejections, just log them
});

console.log('\n✅ AI-Powered WhatsApp Taxi Booking System is running!');
console.log('📱 Scan the QR code when it appears to connect WhatsApp');
console.log('💬 Send "book chauffeur" to any whitelisted number to start booking');
console.log('🌐 Web dashboard available at http://localhost:3002(if web server is running)');
console.log('\nPress Ctrl+C to stop the system');
