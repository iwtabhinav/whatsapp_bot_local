#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔄 Resetting WhatsApp Bot Authentication...');
console.log('');

const authDir = './auth_info_baileys';

try {
    if (fs.existsSync(authDir)) {
        console.log('📁 Found authentication directory');

        // List files in auth directory
        const files = fs.readdirSync(authDir);
        console.log(`📄 Found ${files.length} authentication files:`);
        files.forEach(file => {
            console.log(`   - ${file}`);
        });

        // Remove the directory
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log('✅ Authentication data cleared successfully');
    } else {
        console.log('ℹ️  No authentication data found');
    }

    console.log('');
    console.log('🚀 You can now start the bot fresh:');
    console.log('   npm run fixed    # Fixed bot with improved connection handling');
    console.log('   npm run robust   # Robust bot with retry logic');
    console.log('   npm start        # Standard bot');
    console.log('');
    console.log('💡 The bot will ask you to scan a new QR code when you start it.');

} catch (error) {
    console.error('❌ Error clearing authentication data:', error.message);
    console.log('');
    console.log('🔧 Manual cleanup:');
    console.log('   rm -rf auth_info_baileys');
    console.log('   npm run fixed');
}
