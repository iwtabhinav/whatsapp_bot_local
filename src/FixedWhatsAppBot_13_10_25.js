#!/usr/bin/env node

const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('../lib');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Import the enhanced session manager
const EnhancedSessionManager = require('./utils/EnhancedSessionManager');
const ProductionQRManager = require('./utils/ProductionQRManager');

class FixedWhatsAppBot extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            authDir: process.env.AUTH_DIR || path.join(__dirname, '../data/whatsapp-session'),
            dataDir: process.env.DATA_DIR || path.join(__dirname, '../data'),
            browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
            generateHighQualityLinkPreview: true,
            ...config
        };

        // Initialize enhanced session manager
        this.sessionManager = new EnhancedSessionManager(this.config.authDir, this.config.dataDir);
        
        // Initialize production QR manager
        this.qrManager = new ProductionQRManager(this.config.authDir, this.config.dataDir);
        
        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
        
        // Connection state
        this.sock = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.reconnectTimeout = null;
        this.lastReconnectTime = 0;
        this.minReconnectInterval = 15000;

        // QR code management
        this.lastQRCode = null;
        this.lastQRTime = 0;
        this.qrMinAge = 5000;
        this.isGeneratingQR = false;
        this.autoGenerateQR = false;

        // Connection settings for better stability
        this.connectionSettings = {
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 2,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            fireInitQueries: false,
            shouldSyncHistoryMessage: () => false,
            shouldIgnoreJid: (jid) => {
                return jid.endsWith('@broadcast') || jid.endsWith('@newsletter');
            },
        };

        this.startTime = Date.now();
        console.log('🤖 Fixed WhatsApp Bot initialized');
    }

    /**
     * Initialize the bot with proper session management
     */
    async initialize() {
        try {
            // Check if we're already connecting
            if (this.isConnecting) {
                console.log('⏳ Already connecting, skipping...');
                return;
            }

            // Get current session status
            const sessionStatus = this.sessionManager.getSessionStatus();
            //console.log('🔍 Session Status:', sessionStatus);

            // If session should be cleared, do it now
            if (sessionStatus.shouldClear || sessionStatus.shouldClearSession) {
                console.log('🧹 Clearing session due to validation failure or excessive attempts');
                await this.sessionManager.clearSession(true);
            }

            // Check if we should wait before reconnecting
            const now = Date.now();
            const timeSinceLastReconnect = now - this.lastReconnectTime;
            if (timeSinceLastReconnect < this.minReconnectInterval) {
                const waitTime = this.minReconnectInterval - timeSinceLastReconnect;
                console.log(`⏳ Waiting ${Math.ceil(waitTime / 1000)} seconds before reconnecting...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            this.isConnecting = true;
            this.lastReconnectTime = now;

            // Increment connection attempts
            const connectionAttempts = this.sessionManager.incrementConnectionAttempts();
            console.log(`🔄 Fixed Bot Connection attempt ${connectionAttempts}`);

            // CRITICAL: Ensure session directory exists before initialization
            const sessionDir = path.join(__dirname, '../data/whatsapp-session');
            if (!fs.existsSync(sessionDir)) {
                try {
                    fs.mkdirSync(sessionDir, { recursive: true });
                    console.log('✅ Created session directory before initialization');
                } catch (dirError) {
                    console.log('⚠️ Could not create session directory:', dirError.message);
                }
            }

            // Clear any existing connection
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (error) {
                    console.log('⚠️ Error during logout:', error.message);
                }
                this.sock = null;
            }

            // Get latest Baileys version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

            // Setup auth state with proper session management
            const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);

            // Create socket with enhanced settings
            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }),
                printQRInTerminal: this.autoGenerateQR,
                auth: state,
                browser: this.config.browser,
                generateHighQualityLinkPreview: this.config.generateHighQualityLinkPreview,
                ...this.connectionSettings,
            });

            // Setup event handlers
            this.setupSocketEventHandlers(saveCreds);

            console.log('✅ Fixed Bot initialized successfully!');
            console.log('📱 Scan the QR code with your WhatsApp app to start using the bot.');

            // Emit ready event
            this.emit('ready', { bot: this });

        } catch (error) {
            console.error(`❌ Fixed Bot Connection failed:`, error.message);
            this.isConnecting = false;

            // Check if this is a session-related error
            if (error.message.includes('session') || error.message.includes('auth') || error.message.includes('credentials')) {
                console.log('🔄 Session-related error detected, clearing session...');
                this.sessionManager.clearSession(true);
            }

            // Get current state to check attempts
            const state = this.sessionManager.getConnectionState();
            
            if (state.connectionAttempts < state.maxConnectionAttempts) {
                const delay = Math.min(10000 + (state.connectionAttempts * 5000), 30000);
                console.log(`🔄 Retrying in ${delay / 1000} seconds... (attempt ${state.connectionAttempts + 1}/${state.maxConnectionAttempts})`);
                this.reconnectTimeout = setTimeout(() => {
                    this.initialize();
                }, delay);
            } else {
                console.error('❌ Max connection attempts reached. Resetting counter and continuing...');
                
                // Reset connection attempts to start over
                this.sessionManager.clearSession(true);
                this.isConnecting = false;

                console.log('💡 Troubleshooting tips:');
                console.log('   1. Check your internet connection');
                console.log('   2. Close ALL WhatsApp Web sessions in browsers');
                console.log('   3. Wait 5-10 minutes before retrying');
                console.log('   4. Session cleared - fresh QR will be generated on next attempt');
                console.log('   5. Restart your router if DNS issues persist');
                console.log('   6. Use !qr command to force QR code generation');

                this.emit('error', { error, bot: this });
            }
        }
    }

    /**
     * Setup socket event handlers with enhanced QR management
     */
    setupSocketEventHandlers(saveCreds) {
        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            console.log('🔗 Connection update:', connection);
            if (lastDisconnect?.error) {
                console.log('🔍 Disconnect error:', lastDisconnect.error.message);
            }
            if (qr){
                await this.handleQRCode(qr);
            }
            if(connection === 'close'){
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log(`🔍 Should reconnect: ${shouldReconnect}`);
                console.log(`🔍 Disconnect reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
                
                if (shouldReconnect) {
                    console.log('🔄 Connection closed, reconnecting...');
                    this.isConnected = false;
                    this.isConnecting = false;
                    
                    // Clear QR generation flags on disconnection
                    this.isGeneratingQR = false;
                    this.lastQRCode = null;
                    this.lastQRTime = 0;
                    
                    // Update connection state
                    this.sessionManager.saveConnectionState({
                        connectionState: 'disconnected',
                        isReady: false,
                        isAuthenticated: false,
                        connectedNumber: null,
                        lastHeartbeat: new Date().toISOString()
                    });
                    
                    // Emit to web dashboard
                    this.emitConnectionStatus('disconnected');
                    
                    if (this.reconnectTimeout) {
                        clearTimeout(this.reconnectTimeout);
                    }

                    const state = this.sessionManager.getConnectionState();
            // Optimized reconnection for faster success
            let delay;
            if (state.connectionAttempts === 0) {
                delay = 3000; // First retry after 3 seconds
            } else if (state.connectionAttempts < 3) {
                delay = 5000; // Next few retries after 5 seconds
            } else {
                delay = Math.min(8000 + (state.connectionAttempts * 1000), 12000); // Gradual increase
            }
            
            console.log(`🔄 Reconnecting in ${delay / 1000} seconds... (attempt ${state.connectionAttempts + 1})`);
            this.reconnectTimeout = setTimeout(() => {
                this.initialize();
            }, delay);
                } else {
                    console.log('❌ Logged out. Will attempt to reconnect...');
                    this.isConnected = false;
                    this.isConnecting = false;
                    
                    // Update connection state
                    this.sessionManager.saveConnectionState({
                        connectionState: 'disconnected',
                        isReady: false,
                        isAuthenticated: false,
                        connectedNumber: null,
                        lastHeartbeat: new Date().toISOString()
                    });
                    
                    // Emit to web dashboard
                    this.emitConnectionStatus('disconnected');
                    
                    // Clear session on logout
                    this.sessionManager.clearSession(true);
                    
                    setTimeout(() => {
                        this.initialize();
                    }, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ Connected to WhatsApp!');
                this.isConnected = true;
                this.isConnecting = false;
                
                // Handle successful QR scan
                await this.qrManager.handleQRScanResult(true);
                
                // Reset all attempts on successful connection
                this.sessionManager.resetAttempts();
                
                // Clear any timeouts
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                }
                
                // Save connection state
                const connectedNumber = this.sock?.user?.id?.replace('@c.us', '') || null;
                this.sessionManager.saveConnectionState({
                    connectionState: 'connected',
                    isReady: true,
                    isAuthenticated: true,
                    connectedNumber: connectedNumber,
                    lastHeartbeat: new Date().toISOString()
                });
                
                // Emit to web dashboard
                this.emitConnectionStatus('connected');
                
                console.log(`📱 Connected as: ${connectedNumber}`);
                console.log('✅ QR scanning successful - session established');
            } else if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
                this.isConnecting = true;
                
                // Update connection state
                this.sessionManager.saveConnectionState({
                    connectionState: 'connecting',
                    isReady: false,
                    isAuthenticated: false,
                    connectedNumber: null,
                    lastHeartbeat: new Date().toISOString()
                });
                
                // Emit to web dashboard
                this.emitConnectionStatus('connecting');
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            try {
                await this.processMessage(msg);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        });
    }

    /**
     * Handle QR code with production-ready session management
     */
    async handleQRCode(qr) {
        const now = Date.now();
        const timeSinceLastQR = now - this.lastQRTime;

        console.log('📱 QR Code received');
        console.log(`🔍 QR length: ${qr.length} characters`);
        console.log(`🔍 isGeneratingQR: ${this.isGeneratingQR}`);
        console.log(`🔍 lastQRCode match: ${this.lastQRCode === qr}`);
        console.log(`🔍 timeSinceLastQR: ${Math.round(timeSinceLastQR / 1000)}s`);

        // Always process QR codes if they're different from the last one
        if (this.lastQRCode !== qr && !this.isGeneratingQR) {
            this.isGeneratingQR = true;
            
            console.log('📱 QR Code received, scan it with your WhatsApp app');
            console.log('📱 Open WhatsApp > Settings > Linked Devices > Link a Device');
            console.log('📱 Make sure to scan the QR code within 3 minutes');
            console.log('=====================================');
            qrcode.generate(qr, { small: true });
            console.log('=====================================');

            // Store the QR code and time to prevent duplicate processing
            this.lastQRCode = qr;
            this.lastQRTime = now;

            // Generate QR code as data URL for web dashboard
            try {
                const qrcode = require('qrcode');
                const qrDataURL = await qrcode.toDataURL(qr, {
                    width: 400,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });

                // Use production QR manager to handle QR generation
                const qrData = {
                    qrCode: qrDataURL,
                    qrData: qr
                };

                const qrResult = await this.qrManager.generateQRCode(qrData);
                
                if (!qrResult) {
                    console.log('⚠️ QR generation skipped due to rate limiting');
                    this.isGeneratingQR = false;
                    return;
                }

                // Emit to web dashboard if available
                try {
                    const io = require('./web-server').io;
                    if (io) {
                        io.emit('qrCodeGenerated', {
                            phoneNumber: 'main-instance',
                            qrCode: qrDataURL,
                            attempt: qrResult.attempt,
                            maxRetries: qrResult.maxRetries,
                            timestamp: qrResult.timestamp,
                            status: 'ready',
                            expiresAt: qrResult.expiresAt,
                            sessionId: qrResult.sessionId
                        });
                        console.log('📱 QR code emitted to web dashboard');
                    }
                } catch (ioError) {
                    console.log('⚠️ Web server not available for QR emission');
                }

                // Reset flag after successful generation
                this.isGeneratingQR = false;

                console.log(`✅ QR code generated successfully (attempt ${qrResult.attempt}/${qrResult.maxRetries})`);
                console.log(`⏰ QR expires at: ${qrResult.expiresAt}`);
                console.log(`🆔 Session ID: ${qrResult.sessionId}`);

            } catch (error) {
                console.error('❌ Error generating QR code image:', error);
                this.isGeneratingQR = false;
                
                // Handle QR generation error
                await this.qrManager.handleQRScanResult(false, error);
            }
        } else if (this.lastQRCode === qr) {
            console.log('📱 Same QR code received, skipping duplicate processing');
        } else if (this.isGeneratingQR) {
            console.log('📱 QR generation already in progress, skipping duplicate');
        } else {
            console.log(`⏰ QR code too recent (${Math.round(timeSinceLastQR / 1000)}s), waiting ${Math.round((this.qrMinAge - timeSinceLastQR) / 1000)}s more...`);
        }
    }

    /**
     * Save QR code to file
     */
    async saveQRCode(qr) {
        try {
            const qrData = {
                qrData: qr,
                timestamp: new Date().toISOString(),
                attempt: this.sessionManager.getConnectionState().qrAttempts,
                maxRetries: this.sessionManager.getConnectionState().maxQRAttempts
            };

            const qrFilePath = path.join(this.config.dataDir, 'whatsapp-qr.json');
            fs.writeFileSync(qrFilePath, JSON.stringify(qrData, null, 2));
            console.log('📱 QR code saved to file');
        } catch (error) {
            console.error('Error saving QR code:', error);
        }
    }

    /**
     * Process incoming messages
     */
    async processMessage(msg) {
        // Basic message processing - you can extend this
        console.log('📨 Message received:', msg.key.remoteJid);
    }

    /**
     * Force QR generation
     */
    async forceQRGeneration() {
        console.log('🔄 Forcing QR code generation...');
        this.sessionManager.forceQRGeneration();
        await this.initialize();
    }

    /**
     * Emit connection status to web dashboard
     */
    emitConnectionStatus(status) {
        try {
            const io = require('./web-server').io;
            if (io) {
                const state = this.sessionManager.getConnectionState();
                io.emit('connectionStatusUpdate', {
                    phoneNumber: 'main-instance',
                    status: status,
                    connectionState: state,
                    timestamp: new Date().toISOString()
                });
                console.log(`📡 Emitted connection status: ${status}`);
            }
        } catch (error) {
            console.log('⚠️ Web server not available for status emission');
        }
    }

    /**
     * Start heartbeat monitoring to keep connection state updated
     */
    startHeartbeatMonitoring() {
        // Update heartbeat every 30 seconds when connected
        setInterval(() => {
            if (this.isConnected && this.sock) {
                this.sessionManager.saveConnectionState({
                    connectionState: 'connected',
                    isReady: true,
                    isAuthenticated: true,
                    connectedNumber: this.sock.user?.id || null,
                    lastHeartbeat: new Date().toISOString(),
                    lastUpdate: new Date().toISOString()
                });
                
                // Emit connection status to dashboard
                this.emitConnectionStatus('connected');
            }
        }, 30000); // Update every 30 seconds
    }

    /**
     * Cross-platform directory deletion with retry logic
     */
    async deleteDirectoryWithRetry(dirPath, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Try to delete the directory
                fs.rmSync(dirPath, { recursive: true, force: true });
                return; // Success
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error; // Final attempt failed
                }
                
                console.log(`⚠️ Deletion attempt ${attempt} failed, retrying... (${error.message})`);
                
                // Wait before retry with exponential backoff
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Try to force close any remaining file handles
                try {
                    // Force garbage collection if available
                    if (global.gc) {
                        global.gc();
                    }
                } catch (gcError) {
                    // Ignore GC errors
                }
            }
        }
    }

    /**
     * Handle manual QR generation request
     */
    async handleManualQRRequest() {
        try {
            console.log('🔄 Manual QR generation requested from dashboard');
            
            // Clear current QR state
            this.isGeneratingQR = false;
            this.lastQRCode = null;
            this.lastQRTime = 0;
            
            // Disconnect current session to force new QR
            if (this.sock && this.isConnected) {
                console.log('🔌 Disconnecting current session for fresh QR...');
                try {
                    await this.sock.logout();
                    this.isConnected = false;
                    this.isConnecting = false;
                    console.log('✅ Session disconnected successfully');
                } catch (disconnectError) {
                    console.log('⚠️ Error disconnecting session:', disconnectError.message);
                }
            }
            
            // Clear session files to force fresh authentication
            const sessionDir = path.join(__dirname, '../data/whatsapp-session');
            if (fs.existsSync(sessionDir)) {
                try {
                    // Properly close all file handles first
                    if (this.sock) {
                        try {
                            // Close the socket connection
                            if (this.sock.ws && this.sock.ws.readyState === 1) {
                                this.sock.ws.close();
                            }
                            // Clear auth state to release file handles
                            if (this.sock.authState) {
                                this.sock.authState = null;
                            }
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                    }
                    
                    // Wait for file handles to be released
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Cross-platform file deletion with retry logic
                    await this.deleteDirectoryWithRetry(sessionDir);
                    console.log('🧹 Session directory cleared successfully');
                    
                } catch (cleanupError) {
                    console.log('⚠️ Session cleanup failed, will retry on next attempt:', cleanupError.message);
                    // Don't throw error - let the bot continue
                }
            }
            
            // CRITICAL: Always ensure session directory exists after cleanup
            try {
                if (!fs.existsSync(sessionDir)) {
                    fs.mkdirSync(sessionDir, { recursive: true });
                    console.log('✅ Created fresh session directory');
                }
            } catch (dirError) {
                console.log('⚠️ Could not create session directory:', dirError.message);
            }
            
            // Reset connection state
            this.sessionManager.saveConnectionState({
                connectionState: 'disconnected',
                isReady: false,
                isAuthenticated: false,
                connectedNumber: null,
                lastHeartbeat: new Date().toISOString(),
                connectionAttempts: 0,
                qrAttempts: 0 // Reset QR attempts for fresh start
            });
            
            // Emit status update
            this.emitConnectionStatus('disconnected');
            
            // Wait a moment then reinitialize to generate new QR
            setTimeout(() => {
                console.log('🔄 Reinitializing bot for fresh QR generation...');
                this.initialize();
            }, 2000);
            
            console.log('✅ Manual QR generation process started');
        } catch (error) {
            console.error('❌ Error in manual QR generation:', error);
        }
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        const state = this.sessionManager.getConnectionState();
        return {
            ...state,
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            uptime: Math.floor((Date.now() - this.startTime) / 1000)
        };
    }

    /**
     * Disconnect the bot
     */
    async disconnect() {
        try {
            if (this.sock) {
                await this.sock.logout();
                this.sock = null;
            }
            
            this.isConnected = false;
            this.isConnecting = false;
            
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }
            
            // Clear session on disconnect
            this.sessionManager.clearSession(true);
            
            console.log('✅ Bot disconnected and session cleared');
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
    }
}

module.exports = FixedWhatsAppBot;
