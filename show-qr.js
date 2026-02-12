#!/usr/bin/env node

/**
 * QR Code Display Script
 * This script will show the QR code when it's generated
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Looking for QR code...');
console.log('================================');

// Check if QR code file exists
const qrFile = path.join(__dirname, 'qr-code.json');

function checkQRCode() {
    if (fs.existsSync(qrFile)) {
        try {
            const qrData = JSON.parse(fs.readFileSync(qrFile, 'utf8'));
            console.log('📱 QR Code found!');
            console.log('================================');
            console.log('Scan this QR code with WhatsApp:');
            console.log('================================');
            console.log(qrData.qr);
            console.log('================================');
            console.log('📱 Open WhatsApp > Settings > Linked Devices > Link a Device');
            console.log('📱 Scan the QR code above to connect the bot');
            console.log('================================');
            return true;
        } catch (error) {
            console.log('❌ Error reading QR code:', error.message);
        }
    }
    return false;
}

// Check immediately
if (checkQRCode()) {
    process.exit(0);
}

// If not found, wait and check again
console.log('⏳ Waiting for QR code to be generated...');
console.log('💡 Make sure the bot is running: npm run ai-bot');

let attempts = 0;
const maxAttempts = 30; // 30 seconds

const interval = setInterval(() => {
    attempts++;

    if (checkQRCode()) {
        clearInterval(interval);
        process.exit(0);
    }

    if (attempts >= maxAttempts) {
        console.log('❌ QR code not found after 30 seconds');
        console.log('💡 Make sure the bot is running and try again');
        clearInterval(interval);
        process.exit(1);
    }

    process.stdout.write('.');
}, 1000);
