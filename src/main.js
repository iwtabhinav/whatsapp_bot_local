#!/usr/bin/env node

require('dotenv').config();
const UltraRobustWhatsAppBot = require('./UltraRobustWhatsAppBot');
const portUtils = require('./utils/portUtils');
const botStatus = require('./utils/botStatus');
const { connectDB } = require('./models');

// Bot port (different from web server)
const BOT_PORT = process.env.BOT_PORT || 3000;

async function startUltraRobustBot() {
    try {
        console.log('🚀 Starting Ultra-Robust WhatsApp Bot...');

        // Ensure database connection is ready before starting
        console.log('🔄 Initializing database connection...');
        await connectDB();

        // Wait a moment for connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if port is in use first
        const isPortInUse = await portUtils.isPortInUse(BOT_PORT);
        if (isPortInUse) {
            console.log(`⚠️ Port ${BOT_PORT} is in use, attempting to free it...`);
            await portUtils.killPortProcess(BOT_PORT);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        }

        // Create Ultra-Robust WhatsApp Bot instance
        const bot = new UltraRobustWhatsAppBot({
            authDir: './data/whatsapp-session',
            printQRInTerminal: true,
            generateHighQualityLinkPreview: true,
            browser: ['UltraRobustBot', 'Chrome', '4.0.0']
        });

        // Set up bot event handlers
        bot.on('qr', (data) => {
            console.log('📱 QR Code received');
            botStatus.updateStatus('qr_received', { qr: data.qr });
        });

        bot.on('ready', (data) => {
            console.log('✅ Ultra-Robust Bot is ready!');
            botStatus.updateStatus('ready');
        });

        bot.on('connected', (data) => {
            console.log('🔐 WhatsApp client authenticated and connected');
            botStatus.updateStatus('authenticated');
        });

        bot.on('disconnected', (data) => {
            console.log('🔌 WhatsApp client disconnected:', data.reason);
            botStatus.updateStatus('disconnected', { reason: data.reason });
        });

        bot.on('error', (data) => {
            console.error('❌ Bot error:', data.error);
            botStatus.updateStatus('error', { error: data.error });
        });

        bot.on('message', (data) => {
            const message = data.message;
            console.log('📨 Message received:', message.body?.substring(0, 50));
            console.log('📨 From:', message.from);
        });

        // Set global bot reference for web server access
        global.mainBot = bot;

        // Initialize the bot
        await bot.initialize();

        console.log('🤖 Ultra-Robust Bot is running and ready to receive messages');

    } catch (error) {
        console.error('❌ Error starting the bot:', error);
        process.exit(1);
    }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Ultra-Robust Bot...');
    if (global.mainBot) {
        await global.mainBot.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down Ultra-Robust Bot...');
    if (global.mainBot) {
        await global.mainBot.shutdown();
    }
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    if (global.mainBot) {
        global.mainBot.emit('error', { error, bot: global.mainBot });
    }
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    if (global.mainBot) {
        global.mainBot.emit('error', { error: reason, bot: global.mainBot });
    }
    process.exit(1);
});

startUltraRobustBot();

