#!/usr/bin/env node

/**
 * Fixed WhatsApp Bot - Enhanced QR Code Handling and Connection Management
 * 
 * This version fixes common QR scanning issues and provides better connection stability.
 */

require('dotenv').config();
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('./lib');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

class FixedWhatsAppBot {
    constructor() {
        this.config = {
            authDir: process.env.WHATSAPP_SESSION_PATH || './data/whatsapp-session',
            printQRInTerminal: true,
            generateHighQualityLinkPreview: false,
            browser: ['FixedBot', 'Chrome', '4.0.0'],
        };

        this.sock = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 5;
        this.reconnectTimeout = null;
        this.lastReconnectTime = 0;
        this.qrCodeGenerated = false;
        this.lastQRCode = null;
        this.qrGenerationTime = 0;
        this.qrMinAge = 15000; // 15 seconds minimum between QR generations

        // Enhanced connection settings for better stability
        this.connectionSettings = {
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 3,
            markOnlineOnConnect: false,
            qrTimeout: 120000, // 2 minutes
            restartOnAuthFail: false,
            syncFullHistory: false,
            fireInitQueries: false,
            shouldIgnoreJid: (jid) => false,
            shouldSyncHistoryMessage: () => false,
            generateHighQualityLinkPreview: false,
            msgRetryCounterCache: new (require('node-cache'))({
                stdTTL: 3600, // 1 hour
                useClones: false
            }),
            linkPreviewImageThumbnailWidth: 192,
            linkPreviewImageThumbnailHeight: 192,
        };

        console.log('🚀 Fixed WhatsApp Bot initialized');
        console.log('📁 Auth directory:', this.config.authDir);
    }

    async initialize() {
        if (this.isConnecting) {
            console.log('⚠️ Connection already in progress, skipping...');
            return;
        }

        this.isConnecting = true;
        this.connectionAttempts++;
        this.lastReconnectTime = Date.now();

        try {
            console.log(`🔄 Connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

            // Clear any existing connection
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (error) {
                    console.log('⚠️ Error during logout:', error.message);
                }
                this.sock = null;
            }

            // Wait before reconnecting
            const waitTime = this.connectionAttempts === 1 ? 1000 : 5000;
            console.log(`⏳ Waiting ${waitTime / 1000} seconds before connecting...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));

            // Get latest WhatsApp version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

            // Setup auth state
            const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);

            // Create socket with enhanced settings
            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }),
                printQRInTerminal: this.config.printQRInTerminal,
                auth: state,
                browser: this.config.browser,
                generateHighQualityLinkPreview: this.config.generateHighQualityLinkPreview,
                ...this.connectionSettings,
                getMessage: async (key) => {
                    return {
                        conversation: "Hello! I'm a fixed WhatsApp bot."
                    };
                }
            });

            this.setupSocketEventHandlers(saveCreds);

            console.log('✅ Fixed WhatsApp Bot initialized successfully!');
            console.log('📱 Scan the QR code with your WhatsApp app to start using the bot.');

        } catch (error) {
            console.error(`❌ Connection failed (attempt ${this.connectionAttempts}):`, error.message);
            this.isConnecting = false;

            if (this.connectionAttempts < this.maxConnectionAttempts) {
                const delay = Math.min(5000 + (this.connectionAttempts * 3000), 20000);
                console.log(`🔄 Retrying in ${delay / 1000} seconds... (attempt ${this.connectionAttempts + 1}/${this.maxConnectionAttempts})`);
                this.reconnectTimeout = setTimeout(() => {
                    this.initialize();
                }, delay);
            } else {
                console.error('❌ Max connection attempts reached. Please check your internet connection and try again.');
                this.connectionAttempts = 0;
                this.isConnecting = false;
            }
        }
    }

    setupSocketEventHandlers(saveCreds) {
        if (!this.sock) return;

        // Handle connection updates
        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection) {
                this.handleConnectionUpdate(connection, lastDisconnect);
            }

            if (qr) {
                this.handleQRCode(qr);
            }
        });

        // Handle credentials update
        this.sock.ev.on('creds.update', saveCreds);

        // Handle messages
        this.sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            const phoneNumber = msg.key.remoteJid.replace('@c.us', '');
            const messageText = msg.message.conversation || 
                              msg.message.extendedTextMessage?.text || 
                              msg.message.imageMessage?.caption || '';

            if (messageText) {
                console.log(`📨 Message from ${phoneNumber}: ${messageText}`);
                
                // Simple echo response
                if (messageText.toLowerCase().includes('hello') || messageText.toLowerCase().includes('hi')) {
                    await this.sendMessage(msg.key.remoteJid, 'Hello! I am a fixed WhatsApp bot. How can I help you?');
                }
            }
        });
    }

    handleConnectionUpdate(connection, lastDisconnect) {
        if (connection === 'open') {
            console.log('✅ WhatsApp Bot is ready and connected!');
            this.isConnected = true;
            this.isConnecting = false;
            this.connectionAttempts = 0;
            this.qrCodeGenerated = false;
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed due to:', lastDisconnect?.error?.message || 'Unknown error');
            console.log('🔄 Reconnecting:', shouldReconnect ? 'Yes' : 'No');

            if (shouldReconnect) {
                this.isConnected = false;
                this.isConnecting = false;
                this.qrCodeGenerated = false;

                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                }

                const delay = 5000;
                console.log(`🔄 Reconnecting in ${delay / 1000} seconds...`);
                this.reconnectTimeout = setTimeout(() => {
                    this.initialize();
                }, delay);
            } else {
                console.log('❌ Logged out. Will attempt to reconnect...');
                this.isConnected = false;
                this.isConnecting = false;
                this.qrCodeGenerated = false;

                setTimeout(() => {
                    console.log('🔄 Attempting to reconnect after logout...');
                    this.initialize();
                }, 10000);
            }
        } else if (connection === 'connecting') {
            console.log('🔄 Connecting to WhatsApp...');
            this.isConnecting = true;
            this.isConnected = false;
        }
    }

    handleQRCode(qr) {
        const now = Date.now();
        const timeSinceLastQR = now - this.qrGenerationTime;

        // Only process QR if it's different and enough time has passed
        if (this.lastQRCode !== qr && timeSinceLastQR >= this.qrMinAge) {
            console.log('📱 QR Code received, scan it with your WhatsApp app');
            console.log('📱 Open WhatsApp > Settings > Linked Devices > Link a Device');
            console.log('📱 Make sure to scan the QR code within 2 minutes');
            
            // Generate QR code in terminal
            qrcode.generate(qr, { small: true });
            
            // Save QR code to file
            this.saveQRCode(qr);
            
            this.lastQRCode = qr;
            this.qrGenerationTime = now;
            this.qrCodeGenerated = true;
            this.isConnected = false;
            this.isConnecting = false;
        } else if (this.lastQRCode === qr) {
            console.log('📱 Same QR code received, skipping duplicate');
        } else {
            console.log(`⏰ QR code too recent (${Math.round(timeSinceLastQR / 1000)}s), waiting ${Math.round((this.qrMinAge - timeSinceLastQR) / 1000)}s more...`);
        }
    }

    async saveQRCode(qr) {
        try {
            const qrData = {
                qr: qr,
                timestamp: new Date().toISOString(),
                attempt: this.connectionAttempts
            };
            
            fs.writeFileSync('./data/whatsapp-qr.json', JSON.stringify(qrData, null, 2));
            console.log('💾 QR code saved to file');
        } catch (error) {
            console.log('⚠️ Could not save QR code:', error.message);
        }
    }

    async sendMessage(jid, text) {
        if (!this.sock || !this.isConnected) {
            console.log('⚠️ Bot not connected, cannot send message');
            return;
        }

        try {
            await this.sock.sendMessage(jid, { text });
            console.log(`📤 Message sent to ${jid}`);
        } catch (error) {
            console.log('❌ Error sending message:', error.message);
        }
    }

    async start() {
        console.log('🚀 Starting Fixed WhatsApp Bot...');
        console.log('=====================================');
        
        // Ensure auth directory exists
        if (!fs.existsSync(this.config.authDir)) {
            fs.mkdirSync(this.config.authDir, { recursive: true });
            console.log('📁 Created auth directory');
        }

        // Start the bot
        await this.initialize();
    }

    async stop() {
        console.log('🛑 Stopping Fixed WhatsApp Bot...');
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (error) {
                console.log('⚠️ Error during logout:', error.message);
            }
        }

        this.isConnected = false;
        this.isConnecting = false;
        console.log('✅ Bot stopped');
    }
}

// Create and start the bot
const bot = new FixedWhatsAppBot();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
});

// Start the bot
bot.start().catch(error => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
});

console.log('\n✅ Fixed WhatsApp Bot is running!');
console.log('📱 Scan the QR code when it appears to connect WhatsApp');
console.log('💬 Send "hello" to test the bot');
console.log('\nPress Ctrl+C to stop the bot');
