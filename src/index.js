#!/usr/bin/env node

require('dotenv').config();
const UltraRobustWhatsAppBot = require('./UltraRobustWhatsAppBot');
const portUtils = require('./utils/portUtils');
const botStatus = require('./utils/botStatus');
const { connectDB } = require('./models');

// Bot port (different from web server)
const BOT_PORT = process.env.BOT_PORT || 3000;

async function startBot() {
  try {
    console.log('🚀 Starting Ultra-Robust AI WhatsApp Bot...');
    console.log('🧠 AI-powered taxi booking system');
    console.log('📊 Database integration enabled');

    // Ensure database connection is ready before starting
    await connectDB();
    console.log('✅ Database connected successfully');

    // Check if port is in use first
    const isPortInUse = await portUtils.isPortInUse(BOT_PORT);
    if (isPortInUse) {
      console.log(`⚠️ Port ${BOT_PORT} is in use, attempting to free it...`);
      await portUtils.killPortProcess(BOT_PORT);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }

    // Create Ultra-Robust AI WhatsApp Bot instance
    const bot = new UltraRobustWhatsAppBot({
      authDir: process.env.WHATSAPP_SESSION_PATH || './data/whatsapp-session',
      printQRInTerminal: true,
      generateHighQualityLinkPreview: true,
      browser: ['UltraRobustBot', 'Chrome', '4.0.0']
    });

    // Set up bot event handlers
    bot.on('qr', (data) => {
      console.log('📱 QR Code received - Scan with WhatsApp to connect');
      botStatus.updateStatus('qr_received', { qr: data.qr });
    });

    bot.on('ready', (data) => {
      console.log('✅ Ultra-Robust AI Bot is ready!');
      console.log('🚗 AI booking system activated');
      console.log('🎤 Voice transcription ready');
      console.log('👁️ Image analysis ready');
      botStatus.updateStatus('ready');
    });

    bot.on('connected', (data) => {
      console.log('🔐 WhatsApp client authenticated and connected');
      console.log('📱 Bot is ready to receive booking requests');
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
      const phoneNumber = message.key?.remoteJid?.replace('@c.us', '') || 'unknown';
      console.log(`📨 Message from ${phoneNumber}: ${message.message?.conversation?.substring(0, 50) || 'Media message'}`);
    });

    // Set global bot reference for web server access
    global.mainBot = bot;

    // Initialize the bot
    await bot.initialize();

    console.log('🤖 Ultra-Robust AI Bot is running and ready to receive messages');
    console.log('💬 Send "book chauffeur" to any whitelisted number to start booking');

  } catch (error) {
    console.error('❌ Error starting the bot:', error);
    // Don't exit the process, let the parent handle it
    throw error;
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Ultra-Robust AI Bot...');
  if (global.mainBot) {
    await global.mainBot.shutdown();
  }
  // Don't exit the process, let the parent handle it
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down Ultra-Robust AI Bot...');
  if (global.mainBot) {
    await global.mainBot.shutdown();
  }
  // Don't exit the process, let the parent handle it
});

startBot(); 