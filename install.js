#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Installing Advanced WhatsApp Bot...');
console.log('');

// Check if package.json exists
if (!fs.existsSync('package.json')) {
    console.error('❌ package.json not found. Please run this script in the project directory.');
    process.exit(1);
}

try {
    console.log('📦 Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });

    console.log('📦 Installing peer dependencies...');
    execSync('npm install jimp link-preview-js qrcode-terminal sharp', { stdio: 'inherit' });

    console.log('✅ Installation completed successfully!');
    console.log('');
    console.log('🚀 To start the bot, run:');
    console.log('   npm start');
    console.log('');
    console.log('📱 Or run specific versions:');
    console.log('   npm run bot        # Basic bot');
    console.log('   npm run advanced   # Advanced bot class');
    console.log('   npm run example    # Full example');
    console.log('');
    console.log('💬 Send !help to any chat to see available commands.');

} catch (error) {
    console.error('❌ Installation failed:', error.message);
    process.exit(1);
}
