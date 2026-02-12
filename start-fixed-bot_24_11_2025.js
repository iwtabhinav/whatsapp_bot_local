#!/usr/bin/env node

const FixedWhatsAppBot = require('./src/UltraRobustWhatsAppBot');
const path = require('path');

console.log('🚀 Starting Fixed WhatsApp Bot...');

// Create bot instance
const bot = new FixedWhatsAppBot({
    authDir: path.join(__dirname, 'data', 'whatsapp-session'),
    dataDir: path.join(__dirname, 'data'),
    browser: ['WhatsApp Bot', 'Chrome', '1.0.0']
});

// Set global bot instance for web server integration
global.mainBot = bot;

// Enable auto QR generation
bot.autoGenerateQR = true;

// Handle bot events
bot.on('ready', () => {
    console.log('✅ Bot is ready!');
    
    // Emit initial connection status
    setTimeout(() => {
        bot.emitConnectionStatus('ready');
    }, 1000);
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
    bot.emitConnectionStatus('error');
});

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot...');
    bot.emitConnectionStatus('disconnected');
    await bot.disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down bot...');
    bot.emitConnectionStatus('disconnected');
    await bot.disconnect();
    process.exit(0);
});

// Start the bot
bot.initialize().catch(error => {
    console.error('❌ Failed to initialize bot:', error);
    bot.emitConnectionStatus('error');
    process.exit(1);
});

console.log('📱 Bot started. Check the console for QR code or use the web dashboard.');
