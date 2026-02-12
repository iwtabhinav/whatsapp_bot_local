#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🔄 Forcing fresh start - clearing all session data...');

// Clear session directory
const sessionDir = path.join(__dirname, 'data', 'whatsapp-session');
if (fs.existsSync(sessionDir)) {
    try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('✅ Session directory cleared');
    } catch (error) {
        console.log('⚠️ Error clearing session directory:', error.message);
    }
} else {
    console.log('ℹ️ Session directory does not exist');
}

// Clear QR file
const qrFile = path.join(__dirname, 'data', 'whatsapp-qr.json');
if (fs.existsSync(qrFile)) {
    try {
        fs.unlinkSync(qrFile);
        console.log('✅ QR file cleared');
    } catch (error) {
        console.log('⚠️ Error clearing QR file:', error.message);
    }
} else {
    console.log('ℹ️ QR file does not exist');
}

// Clear connection state file
const stateFile = path.join(__dirname, 'data', 'whatsapp-connection-state.json');
if (fs.existsSync(stateFile)) {
    try {
        fs.unlinkSync(stateFile);
        console.log('✅ Connection state file cleared');
    } catch (error) {
        console.log('⚠️ Error clearing connection state file:', error.message);
    }
} else {
    console.log('ℹ️ Connection state file does not exist');
}

// Create fresh disconnected state
const freshState = {
    connectionState: 'disconnected',
    isReady: false,
    isAuthenticated: false,
    connectedNumber: null,
    lastHeartbeat: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    connectionAttempts: 0,
    maxConnectionAttempts: 10
};

try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(stateFile, JSON.stringify(freshState, null, 2));
    console.log('✅ Fresh disconnected state created');
} catch (error) {
    console.log('⚠️ Error creating fresh state:', error.message);
}

console.log('🎉 Fresh start completed! Bot will now start in disconnected state and generate QR codes.');
console.log('🚀 Starting bot...');

// Start the bot
const botProcess = spawn('node', ['src/index.js'], {
    stdio: 'inherit',
    shell: true
});

botProcess.on('error', (error) => {
    console.error('❌ Failed to start bot:', error);
});

botProcess.on('close', (code) => {
    console.log(`Bot process exited with code ${code}`);
});
