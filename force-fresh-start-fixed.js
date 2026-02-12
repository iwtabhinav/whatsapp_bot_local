#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🔄 Forcing fresh start with enhanced session management...');

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

// Create fresh disconnected state with enhanced session management
const freshState = {
    connectionState: 'disconnected',
    isReady: false,
    isAuthenticated: false,
    connectedNumber: null,
    lastHeartbeat: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    connectionAttempts: 0,
    qrAttempts: 0,
    maxConnectionAttempts: 10,
    maxQRAttempts: 5, // Limit QR attempts to prevent session conflicts
    lastQRTime: null,
    sessionCleared: true,
    sessionClearedAt: new Date().toISOString()
};

try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(stateFile, JSON.stringify(freshState, null, 2));
    console.log('✅ Fresh disconnected state created with enhanced session management');
} catch (error) {
    console.log('⚠️ Error creating fresh state:', error.message);
}

console.log('🎉 Fresh start completed! Bot will now start with enhanced session management.');
console.log('🚀 Starting fixed bot...');

// Start the fixed bot
const botProcess = spawn('node', ['start-fixed-bot.js'], {
    stdio: 'inherit',
    shell: true
});

botProcess.on('error', (error) => {
    console.error('❌ Failed to start fixed bot:', error);
});

botProcess.on('close', (code) => {
    console.log(`Fixed bot process exited with code ${code}`);
});

console.log('📱 Fixed bot started. Check the console for QR code or use the web dashboard.');
console.log('💡 The bot now has enhanced session management to prevent QR code failures after multiple attempts.');
