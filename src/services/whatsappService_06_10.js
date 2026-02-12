const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { PUPPETEER_OPTIONS, PATHS } = require('../config/config');
const { cleanupSessionFiles } = require('../utils/fileUtils');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.isAuthenticated = false;
    this.messageQueue = [];
    this.sessionPath = PATHS.SESSION_PATH;
    this.eventHandlers = {};
    this.connectedNumber = null;
    this.processedMessages = new Set();
    this.qrRetries = 0;
    this.maxQrRetries = 15; // WhatsApp standard is 15 attempts
    this.connectionState = 'disconnected';
    this.qrRefreshInterval = null;
    this.lastQRTime = null;
    this.qrExpiryTime = 60000; // QR expires after 60 seconds
    this.lastHeartbeat = null;
    this.heartbeatInterval = null;
    this.connectionStateFile = path.join(__dirname, '../../data/whatsapp-connection-state.json');

    // Clean up any stale QR codes on startup
    this.cleanupStaleQRCode();

    // Load previous connection state
    this.loadConnectionState();
  }

  cleanupStaleQRCode() {
    try {
      const qrFilePath = path.join(__dirname, '../../data/whatsapp-qr.json');

      if (fs.existsSync(qrFilePath)) {
        const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
        const qrAge = Date.now() - new Date(qrData.timestamp).getTime();

        // If QR code is older than 30 minutes, consider it stale
        if (qrAge > 1800000) { // 30 minutes
          console.log('🧹 Removing stale QR code from previous session...');
          fs.unlinkSync(qrFilePath);
        } else if (qrData.attempt >= qrData.maxRetries) {
          console.log('🧹 Removing exhausted QR code (max attempts reached)...');
          fs.unlinkSync(qrFilePath);
        }
      }
    } catch (error) {
      console.log('⚠️ Error cleaning up stale QR code:', error.message);
    }
  }

  async initialize() {
    console.warn('⚠️ Direct initialize() called - use initializeWithClient() instead');
    throw new Error('Use initializeWithClient() method for proper bot integration');
  }

  async initializeWithClient(client) {
    try {
      console.log('📱 Initializing WhatsApp connection with provided client...');
      console.log('⏳ This may take a few moments...');

      // Use the provided client instead of creating a new one
      this.client = client;

      // Set up event handlers if they exist
      if (this.eventHandlers && Object.keys(this.eventHandlers).length > 0) {
        console.log('📱 Setting up event handlers from bot...');
        this.setupEventHandlers(this.eventHandlers);
      } else {
        console.log('⚠️ No event handlers provided, setting up default handlers...');
        this.setupEventHandlers({});
      }

      console.log('📱 WhatsApp client initialized and ready');

      // Clear any stale QR codes and connection state
      this.clearQRCode();
      this.connectionState = 'disconnected';
      this.isReady = false;
      this.isAuthenticated = false;
      this.connectedNumber = null;
      this.qrRetries = 0;
      this.saveConnectionState();

      // Don't reinitialize the client since it's already initialized in the bot
      console.log('📱 Client already initialized by bot, ready for QR generation');

    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp with client:', error);
      await this.handleInitializationError(error);
    }
  }

  async forceStartAuthentication() {
    try {
      console.log('🔄 Forcing WhatsApp client authentication...');

      if (this.client && !this.client.pupBrowser) {
        console.log('📱 Starting WhatsApp client initialization...');
        await this.client.initialize();
      } else if (this.client && this.client.pupBrowser) {
        console.log('📱 Client already initialized, forcing QR generation...');
        // Force a new QR generation by restarting the client
        await this.client.destroy();
        await this.client.initialize();
      } else {
        console.log('❌ No client available for authentication');
      }
    } catch (error) {
      console.error('❌ Error forcing authentication:', error);
      // If initialization fails, try to restart
      setTimeout(() => {
        this.forceStartAuthentication();
      }, 5000);
    }
  }

  async forceQRGeneration() {
    try {
      console.log('🔄 Forcing QR code generation...');

      if (!this.client) {
        console.log('❌ No client available for QR generation');
        return false;
      }

      this.connectionState = 'disconnected';
      this.isReady = false;
      this.isAuthenticated = false;
      this.qrRetries = 0;
      this.saveConnectionState();

      // Clear any existing QR code
      this.clearQRCode();

      // Handle protocol errors gracefully
      try {
        // First try to logout cleanly
        if (this.client.pupPage && this.client.pupBrowser) {
          try {
            await this.client.logout();
            console.log('✅ Logged out cleanly');
          } catch (logoutError) {
            console.log('⚠️ Logout failed, proceeding with destroy:', logoutError.message);
          }
        }
      } catch (error) {
        console.log('⚠️ Error during logout:', error.message);
      }

      // Destroy the client with proper error handling
      try {
        await this.client.destroy();
        console.log('✅ Client destroyed successfully');
      } catch (destroyError) {
        console.log('⚠️ Error during destroy:', destroyError.message);
        // Continue anyway as the client might be in a bad state
      }

      // Wait a moment before reinitializing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Reinitialize the client
      try {
        await this.client.initialize();
        console.log('✅ Client reinitialized for QR generation');
        return true;
      } catch (initError) {
        console.error('❌ Error during reinitialization:', initError.message);

        // If initialization fails due to protocol errors, try to clean up and retry
        if (initError.message.includes('Protocol error') ||
          initError.message.includes('Target closed') ||
          initError.message.includes('Session closed')) {

          console.log('🔄 Protocol error detected, attempting cleanup and retry...');

          // Kill any remaining Chrome processes
          try {
            if (process.platform === 'darwin') {
              require('child_process').execSync('pkill -f "Google Chrome"', { stdio: 'ignore' });
            }
          } catch (killError) {
            console.log('⚠️ Error killing Chrome processes:', killError.message);
          }

          // Wait longer before retry
          await new Promise(resolve => setTimeout(resolve, 5000));

          try {
            await this.client.initialize();
            console.log('✅ Client reinitialized after cleanup');
            return true;
          } catch (retryError) {
            console.error('❌ Retry failed:', retryError.message);
            this.connectionState = 'error';
            this.saveConnectionState();
            return false;
          }
        }

        this.connectionState = 'error';
        this.saveConnectionState();
        return false;
      }
    } catch (error) {
      console.error('❌ Error forcing QR generation:', error);
      this.connectionState = 'error';
      this.saveConnectionState();
      return false;
    }
  }

  // Method to ensure QR generation happens
  async ensureQRGeneration() {
    console.log('🔍 Ensuring QR code generation...');

    // Set state to disconnected to force QR
    this.connectionState = 'disconnected';
    this.isReady = false;
    this.isAuthenticated = false;
    this.qrRetries = 0;
    this.saveConnectionState();

    // Force authentication with proper error handling
    try {
      console.log('🔄 Forcing WhatsApp client initialization for QR generation...');

      if (this.client) {
        // Destroy existing client if it exists
        if (this.client.pupBrowser) {
          await this.client.destroy();
        }

        // Reinitialize to force QR generation
        await this.client.initialize();
        console.log('✅ Client reinitialized for QR generation');
      } else {
        console.log('❌ No client available for QR generation');
      }
    } catch (error) {
      console.error('❌ Error during QR generation:', error);
      // Retry after 5 seconds
      setTimeout(() => {
        this.ensureQRGeneration();
      }, 5000);
    }
  }

  async handleInitializationError(error) {
    if (error.message.includes('Cannot read properties of null') ||
      error.message.includes('webVersionCache') ||
      error.message.includes('Protocol error') ||
      error.message.includes('Target closed') ||
      error.message.includes('Initialization timeout')) {

      console.log('🔄 Attempting recovery...');
      try {
        await cleanupSessionFiles(this.sessionPath);

        // Kill any existing Chrome processes on macOS
        if (process.platform === 'darwin') {
          require('child_process').execSync('pkill -f "Google Chrome"');
        }

        // Wait before retrying
        console.log('⏳ Waiting before retry...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Retry initialization
        console.log('🔄 Retrying initialization...');
        // Note: Cannot reinitialize without a client - this should be handled by the bot
        console.log('⚠️ Retry requires new client initialization from bot');
        this.connectionState = 'disconnected';
        this.saveConnectionState();
        return;
      } catch (retryError) {
        console.error('❌ Failed to recover:', retryError);
        console.log('⚠️ Please try restarting the application');
      }
    }

    process.exit(1);
  }

  async getConnectedNumber() {
    try {
      if (!this.client || !this.isReady) {
        return null;
      }

      if (this.connectedNumber) {
        return this.connectedNumber;
      }

      // Get the client info using the correct method
      const info = await this.client.info;
      if (!info || !info.wid) {
        console.log('⚠️ Could not get connected number');
        return null;
      }

      // Remove @c.us and any + prefix
      this.connectedNumber = info.wid._serialized.split('@')[0].replace('+', '');
      return this.connectedNumber;
    } catch (error) {
      console.error('❌ Error getting connected number:', error);
      return null;
    }
  }

  notifyWebPlatform(event, data) {
    try {
      // Use a more robust way to get io without circular dependency
      const fs = require('fs');
      const path = require('path');

      // Save event to a file that web platform can watch
      const eventData = {
        event,
        data,
        timestamp: new Date().toISOString()
      };

      const eventsDir = path.join(__dirname, '../../data/events');
      if (!fs.existsSync(eventsDir)) {
        fs.mkdirSync(eventsDir, { recursive: true });
      }

      // Save individual event file
      const eventFile = path.join(eventsDir, `${Date.now()}-${event}.json`);
      fs.writeFileSync(eventFile, JSON.stringify(eventData, null, 2));

      // Also update latest events log
      const latestEventsFile = path.join(__dirname, '../../data/latest-events.json');
      let latestEvents = [];

      if (fs.existsSync(latestEventsFile)) {
        try {
          latestEvents = JSON.parse(fs.readFileSync(latestEventsFile, 'utf8'));
        } catch (error) {
          latestEvents = [];
        }
      }

      // Add new event and keep only last 50 events
      latestEvents.unshift(eventData);
      latestEvents = latestEvents.slice(0, 50);

      fs.writeFileSync(latestEventsFile, JSON.stringify(latestEvents, null, 2));

      console.log(`📡 Event logged: ${event} (Attempt ${data.attempt || 'N/A'})`);

      // Try direct io notification if available (fallback)
      try {
        global.webPlatformIO && global.webPlatformIO.emit(event, data);
      } catch (error) {
        // Ignore if not available
      }
    } catch (error) {
      console.log(`📱 Event logging failed: ${event}`, error.message);
    }
  }

  logLiveMessage(message) {
    try {
      const fs = require('fs');
      const path = require('path');

      // Extract phone number from message.from
      const phoneNumber = message.from ? message.from.split('@')[0] : 'unknown';

      // Check if sender is whitelisted
      const userManager = require('./userManager');
      const isWhitelisted = userManager.isWhitelisted ? userManager.isWhitelisted(phoneNumber) : false;

      const liveMessage = {
        id: message.id?._serialized || `${Date.now()}_${phoneNumber}`,
        from: message.from,
        phoneNumber: phoneNumber,
        body: message.body || '',
        type: message.type || 'text',
        timestamp: new Date(message.timestamp ? message.timestamp * 1000 : Date.now()).toISOString(),
        fromMe: message.fromMe || false,
        isWhitelisted: isWhitelisted,
        hasMedia: message.hasMedia || false,
        mediaType: message.hasMedia ? message.type : null,
        direction: message.fromMe ? 'outgoing' : 'incoming',
        processed: false
      };

      // Save to live messages file
      const liveMessagesFile = path.join(__dirname, '../../data/live-messages.json');
      let liveMessages = [];

      if (fs.existsSync(liveMessagesFile)) {
        try {
          liveMessages = JSON.parse(fs.readFileSync(liveMessagesFile, 'utf8'));
        } catch (error) {
          liveMessages = [];
        }
      }

      // Add new message and keep only last 100 messages
      liveMessages.unshift(liveMessage);
      liveMessages = liveMessages.slice(0, 100);

      fs.writeFileSync(liveMessagesFile, JSON.stringify(liveMessages, null, 2));

      // Notify web platform
      this.notifyWebPlatform('liveMessage', liveMessage);

      console.log(`📱 Live message logged: ${phoneNumber} (${isWhitelisted ? 'whitelisted' : 'not whitelisted'})`);

    } catch (error) {
      console.log('⚠️ Error logging live message:', error.message);
    }
  }

  setupEventHandlers(handlers) {
    if (!this.client) {
      console.log('⚠️ No client available for event handlers');
      return;
    }

    console.log('📱 Setting up WhatsApp event handlers...');

    // Store the handlers for later use
    this.eventHandlers = handlers || {};

    // Set up the message handler
    this.setupMessageHandler();

    // QR Code generation with refresh policy
    this.client.on('qr', async (qr) => {
      console.log(`\n📱 QR CODE - Attempt ${this.qrRetries + 1} of ${this.maxQrRetries}`);
      console.log('==========================================');
      qrcode.generate(qr, { small: true });
      console.log('\n🔗 Steps to connect:');
      console.log('1. Open WhatsApp on your phone');
      console.log('2. Go to Settings > Linked Devices');
      console.log('3. Tap "Link a Device"');
      console.log('4. Scan the QR code above');
      console.log('\n⏳ Waiting for connection...');

      this.qrRetries++;
      this.lastQRTime = Date.now();

      // Clear any existing QR refresh interval
      if (this.qrRefreshInterval) {
        clearInterval(this.qrRefreshInterval);
      }

      // Generate QR code data URL for web platform
      try {
        const qrDataURL = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        // Save QR code data to file for web platform
        const qrData = {
          qrCode: qrDataURL,
          qrData: qr,
          timestamp: new Date().toISOString(),
          attempt: this.qrRetries,
          maxRetries: this.maxQrRetries,
          sessionRestoreAttempted: false,
          forceRefresh: true,
          isValidWhatsAppQR: true,
          lastUpdated: new Date().toISOString(),
          expiresAt: new Date(Date.now() + this.qrExpiryTime).toISOString(),
          age: 0,
          status: 'active'
        };

        // Ensure data directory exists
        const dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        // Save QR data
        fs.writeFileSync(
          path.join(dataDir, 'whatsapp-qr.json'),
          JSON.stringify(qrData, null, 2)
        );

        // Update connection state to initializing
        this.connectionState = 'initializing';
        this.saveConnectionState();

        // Notify web platform
        this.notifyWebPlatform('qrGenerated', {
          phoneNumber: 'main-instance',
          qrCode: qrDataURL,
          attempt: this.qrRetries,
          maxRetries: this.maxQrRetries,
          sessionRestoreAttempted: false,
          expiresAt: qrData.expiresAt,
          age: 0
        });

        // Start QR refresh monitoring
        this.startQRRefreshMonitoring();

        console.log('📱 QR code saved for web platform access');
        console.log(`📊 QR Code Information:`);
        console.log(`   Attempt: ${this.qrRetries}/${this.maxQrRetries}`);
        console.log(`   Generated: Fresh (just created)`);
        console.log(`   Expires: ${qrData.expiresAt}`);
        console.log(`   Data URL Length: ${qrDataURL.length} characters`);
        console.log(`   Format: ✅ Valid PNG base64`);
      } catch (error) {
        console.error('❌ Error generating QR code for web platform:', error);
      }

      if (this.qrRetries >= this.maxQrRetries) {
        console.log('⚠️ Maximum QR code attempts reached. Restarting...');
        this.handleRestart();
      }
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⌛ Loading: ${percent}% - ${message}`);
    });

    // Authentication events
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp client authenticated successfully');
      this.isAuthenticated = true;
      this.connectionState = 'authenticated';
      this.saveConnectionState();

      // Notify web platform
      this.notifyWebPlatform('instanceAuthenticated', {
        phoneNumber: 'main-instance',
        status: 'authenticated',
        timestamp: new Date().toISOString()
      });
    });

    this.client.on('auth_failure', (msg) => {
      console.log('❌ WhatsApp authentication failed:', msg);
      this.isAuthenticated = false;
      this.connectionState = 'auth_failed';
      this.saveConnectionState();
    });

    // Ready event - this is crucial for message handling
    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      this.connectionState = 'ready';
      this.saveConnectionState();

      // Ensure message handler is properly set up when client is ready
      this.setupMessageHandler();

      // Notify web platform
      this.notifyWebPlatform('instanceReady', {
        phoneNumber: 'main-instance',
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    });

    // Disconnection events
    this.client.on('disconnected', async (reason) => {
      console.log('🔌 WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.isAuthenticated = false;
      this.connectionState = 'disconnected';
      this.saveConnectionState();

      // Notify web platform
      this.notifyWebPlatform('instanceDisconnected', {
        phoneNumber: 'main-instance',
        reason: reason,
        timestamp: new Date().toISOString()
      });

      if (reason === 'NAVIGATION') {
        console.log('🔄 Navigation disconnection, attempting restart...');
        setTimeout(async () => {
          await this.handleRestart();
        }, 30000); // Wait 30 seconds before restarting
      } else if (reason === 'LOGOUT') {
        console.log('🚪 User logged out, clearing session...');
        await cleanupSessionFiles(this.sessionPath);
        await this.handleRestart();
      } else {
        console.log('❌ Unexpected disconnection, attempting restart...');
        await this.handleRestart();
      }
    });
  }

  setupMessageHandler() {
    if (!this.client) {
      console.log('⚠️ No client available for message handler');
      return;
    }

    console.log('📨 Setting up message handler...');

    // Remove existing message listeners to prevent duplicates
    this.client.removeAllListeners('message');
    this.client.removeAllListeners('message_create');

    // Set up message handlers for both incoming and outgoing messages
    this.client.on('message', async (message) => {
      console.log('📨 WhatsApp service received message:', message.body?.substring(0, 50));
      console.log('📨 Message from:', message.from);
      console.log('📨 Message type:', message.type);

      // Log live message for dashboard
      this.logLiveMessage(message);

      if (this.eventHandlers && this.eventHandlers.onMessage) {
        console.log('📨 Calling bot event handler...');
        try {
          await this.eventHandlers.onMessage(message);
          console.log('✅ Bot event handler completed');
        } catch (error) {
          console.error('❌ Error in bot event handler:', error);
        }
      } else {
        console.log('⚠️ No event handler set up for messages');
      }
    });

    // Also observe message_create but avoid re-processing to prevent duplicates and group messages
    this.client.on('message_create', async (message) => {
      try {
        if (message.from && message.from.endsWith('@g.us')) {
          return; // ignore groups entirely
        }
        console.log('📨 message_create:', message.body?.substring(0, 50));
        // Only log outgoing messages; do not call onMessage here to avoid duplicate handling
        if (message.fromMe) {
          console.log('➡️ Outgoing message recorded');
        }
      } catch (_) { }
    });

    console.log('✅ Message handler set up successfully');
  }

  // Method to ensure QR generation happens
  async ensureQRGeneration() {
    console.log('🔍 Ensuring QR code generation...');

    // Set state to disconnected to force QR
    this.connectionState = 'disconnected';
    this.isReady = false;
    this.isAuthenticated = false;
    this.qrRetries = 0;
    this.saveConnectionState();

    // Force authentication with proper error handling
    try {
      console.log('🔄 Forcing WhatsApp client initialization for QR generation...');

      if (this.client) {
        // Destroy existing client if it exists
        if (this.client.pupBrowser) {
          await this.client.destroy();
        }

        // Reinitialize to force QR generation
        await this.client.initialize();
        console.log('✅ Client reinitialized for QR generation');
      } else {
        console.log('❌ No client available for QR generation');
      }
    } catch (error) {
      console.error('❌ Error during QR generation:', error);
      // Retry after 5 seconds
      setTimeout(() => {
        this.ensureQRGeneration();
      }, 5000);
    }
  }

  // Method to ensure event handlers are properly connected
  ensureEventHandlersConnected() {
    if (this.eventHandlers && Object.keys(this.eventHandlers).length > 0) {
      console.log('📱 Ensuring event handlers are properly connected...');
      this.setupMessageHandler();
      return true;
    } else {
      console.log('⚠️ No event handlers available to connect');
      return false;
    }
  }

  // Method to check if event handlers are properly set up
  areEventHandlersConnected() {
    return !!(this.eventHandlers && this.eventHandlers.onMessage);
  }

  // Message chunking functionality to handle long messages
  async sendChunkedMessage(to, content, options = {}) {
    const maxChunkSize = 3000; // WhatsApp recommended limit
    const chunks = [];

    if (typeof content === 'string') {
      // Split long messages into chunks
      for (let i = 0; i < content.length; i += maxChunkSize) {
        chunks.push(content.substring(i, i + maxChunkSize));
      }
    } else {
      // For object content, convert to string and chunk
      const contentStr = JSON.stringify(content);
      for (let i = 0; i < contentStr.length; i += maxChunkSize) {
        chunks.push(contentStr.substring(i, i + maxChunkSize));
      }
    }

    console.log(`📤 Sending ${chunks.length} message chunks`);

    // Send chunks with delay to prevent rate limiting
    for (let i = 0; i < chunks.length; i++) {
      try {
        await this.sendMessage(to, chunks[i], options);
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between chunks
        }
      } catch (error) {
        console.error(`❌ Error sending chunk ${i + 1}:`, error);
        // Continue with next chunk even if one fails
      }
    }
  }

  async sendMessage(to, content, options = {}) {
    try {
      console.log(`📤 Sending message to ${to}`);

      // Ensure client is ready before attempting to send
      if (!this.client || !this.isReady) {
        console.log('⚠️ WhatsApp client not ready, skipping send');
        return null;
      }

      // Ensure content is a string
      let messageContent = '';
      if (typeof content === 'string') {
        messageContent = content;
      } else if (typeof content === 'object') {
        messageContent = JSON.stringify(content);
      } else {
        messageContent = String(content);
      }

      // Validate message content
      if (!messageContent || messageContent.trim() === '') {
        console.log('⚠️ Empty message content, skipping send');
        return;
      }

      // Clean up message content to prevent serialization issues
      messageContent = messageContent
        .replace(/\u0000/g, '') // Remove null characters
        .replace(/\uFFFD/g, '') // Remove replacement characters
        .trim();

      // Use chunking for long messages instead of truncating
      if (messageContent.length > 3000) {
        console.log('📤 Message too long, using chunking');
        return await this.sendChunkedMessage(to, messageContent, options);
      }

      // Try sending with retry mechanism
      // Resolve chat id
      const chatId = to.includes('@') ? to : await (async () => {
        try {
          const number = String(to).replace(/\D/g, '');
          const waid = await this.client.getNumberId(number);
          return waid?._serialized || `${number}@c.us`;
        } catch (_) {
          return `${String(to).replace(/\D/g, '')}@c.us`;
        }
      })();

      // Try multiple sending methods to handle different WhatsApp Web.js versions
      let result = null;

      // Method 1: Try direct client send
      try {
        result = await this.client.sendMessage(chatId, messageContent);
        console.log('✅ Message sent successfully via direct client send');
        return result;
      } catch (error1) {
        console.log('⚠️ Direct client send failed, trying chat object method...');

        // Method 2: Try via chat object
        try {
          const chat = await this.client.getChatById(chatId);
          if (chat && chat.sendMessage) {
            result = await chat.sendMessage(messageContent);
            console.log('✅ Message sent successfully via chat object');
            return result;
          } else {
            throw new Error('Chat object not available or sendMessage method missing');
          }
        } catch (error2) {
          console.log('⚠️ Chat object method failed, trying fallback...');

          // Method 3: Fallback to basic send
          try {
            // Try to create a basic message
            result = await this.client.sendMessage(chatId, messageContent, {
              sendSeen: false,
              linkPreview: false
            });
            console.log('✅ Message sent successfully via fallback method');
            return result;
          } catch (error3) {
            console.error('❌ All sending methods failed:', {
              error1: error1?.message || error1,
              error2: error2?.message || error2,
              error3: error3?.message || error3
            });
            return null;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      return null;
    }
  }

  async sendInteractiveMessage(to, text, options) {
    try {
      const { Buttons } = require('whatsapp-web.js');

      // Create buttons for WhatsApp Web.js format
      const buttons = options.buttons.map((btn, index) => new Buttons(
        btn.text,
        btn.id || `btn_${index}`,
        btn.description || ''
      ));

      // Send message with buttons using correct WhatsApp Web.js format
      const sentMessage = await this.client.sendMessage(to, text, {
        buttons: buttons,
        footer: options.footer || 'Tap a button to respond'
      });

      console.log('🔘 Sent interactive message with buttons:', buttons.map(b => b.body).join(', '));
      return sentMessage;

    } catch (error) {
      console.error('❌ Error sending interactive message, falling back to text:', error);
      // Fallback to text message with numbered options
      const fallbackText = text + '\n\n' + options.buttons.map((btn, i) => `${i + 1}. ${btn.text}`).join('\n') + '\n\n' + (options.footer || '');
      await this.client.sendMessage(to, fallbackText);
    }
  }

  async sendListMessage(to, text, options) {
    try {
      const sections = options.sections || [];

      const list = {
        body: text,
        buttonText: options.buttonText || 'Select Option',
        sections: sections,
        title: options.title || '',
        footer: options.footer || ''
      };

      await this.client.sendMessage(to, '', {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: text },
          action: {
            button: options.buttonText || 'Select Option',
            sections: sections
          }
        }
      });

      console.log('📋 Sent list message with', sections.length, 'sections');

    } catch (error) {
      console.error('❌ Error sending list message, falling back to text:', error);
      // Fallback to numbered text options
      let fallbackText = text + '\n\n';
      sections.forEach((section, sIndex) => {
        if (section.title) fallbackText += `*${section.title}*\n`;
        section.rows.forEach((row, rIndex) => {
          fallbackText += `${sIndex * 10 + rIndex + 1}. ${row.title}\n`;
        });
      });
      await this.client.sendMessage(to, fallbackText);
    }
  }

  async processQueuedMessages() {
    while (this.messageQueue.length > 0) {
      const { to, content } = this.messageQueue.shift();
      await this.sendMessage(to, content);
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      try {
        this.lastHeartbeat = new Date();

        // Check if event handlers are still connected
        if (this.isReady && !this.areEventHandlersConnected()) {
          console.log('⚠️ Event handlers disconnected, attempting to reconnect...');
          this.ensureEventHandlersConnected();
        }

        console.log('💓 Heartbeat: WhatsApp service is alive');
      } catch (error) {
        console.error('❌ Error in heartbeat:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  async attemptReconnection() {
    try {
      console.log('🔄 Attempting automatic reconnection...');

      // Check if we still have valid session files
      const hasValidSession = this.checkSessionExists();

      if (hasValidSession) {
        console.log('✅ Valid session found - attempting to restore connection');

        // Update state to indicate reconnection attempt
        this.connectionState = 'reconnecting';
        this.isReady = false;
        this.saveConnectionState();

        // Notify web platform of reconnection attempt
        this.notifyWebPlatform('instanceReconnecting', {
          phoneNumber: this.connectedNumber || 'main-instance',
          timestamp: new Date().toISOString()
        });

        // Don't destroy the client, just reinitialize
        if (this.client && typeof this.client.initialize === 'function') {
          await this.client.initialize();
          console.log('🔄 Client reinitialization started');
        }

      } else {
        console.log('❌ No valid session for reconnection - manual authentication required');
        this.connectionState = 'disconnected';
        this.isReady = false;
        this.isAuthenticated = false;
        this.connectedNumber = null;
        this.saveConnectionState();

        this.notifyWebPlatform('instanceDisconnected', {
          phoneNumber: 'main-instance',
          reason: 'session_expired',
          requiresAuth: true,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('❌ Error during reconnection attempt:', error);
      this.connectionState = 'error';
      this.saveConnectionState();
    }
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  loadConnectionState() {
    try {
      if (fs.existsSync(this.connectionStateFile)) {
        const state = JSON.parse(fs.readFileSync(this.connectionStateFile, 'utf8'));

        // Check if session files exist
        const sessionExists = this.checkSessionExists();

        // Only restore if the state is recent (within last 6 hours) and session exists
        const stateAge = Date.now() - new Date(state.lastUpdate).getTime();
        const maxAge = 6 * 60 * 60 * 1000; // 6 hours instead of 1 hour

        if (stateAge < maxAge && sessionExists) {
          console.log(`📱 Found recent connection state (${Math.round(stateAge / (60 * 1000))} minutes old) with valid session`);

          // Always attempt to restore if we have a valid session
          this.connectionState = 'connecting'; // Set to connecting to attempt restore
          this.isReady = false; // Will be set to true when 'ready' event fires
          this.isAuthenticated = state.isAuthenticated || false;
          this.connectedNumber = state.connectedNumber;
          this.lastHeartbeat = state.lastHeartbeat ? new Date(state.lastHeartbeat) : null;

          // Clear any existing QR code since we have a valid session
          this.clearQRCode();

          console.log(`🔄 Will attempt to restore session for number: ${this.connectedNumber || 'unknown'}`);
          return true;
        } else if (!sessionExists) {
          console.log('📱 State file exists but no valid session found - will need fresh authentication');
        } else {
          console.log(`📱 Connection state too old (${Math.round(stateAge / (60 * 60 * 1000))} hours) - will need fresh authentication`);
        }
      }

      // No state file exists, but check if we have valid session files
      const sessionExists = this.checkSessionExists();
      if (sessionExists) {
        console.log('📱 No state file but valid session found - attempting restoration');

        // Create a basic state indicating we should try to restore
        this.connectionState = 'connecting';
        this.isReady = false;
        this.isAuthenticated = false;
        this.connectedNumber = null;
        this.lastHeartbeat = null;

        // Clear any old QR codes since we might be able to restore
        this.clearQRCode();

        // Save this connecting state
        this.saveConnectionState();

        return true; // Attempt restoration
      }

      console.log('📱 No previous connection state or session found - will need fresh authentication');
      this.connectionState = 'disconnected';
      this.saveConnectionState();

    } catch (error) {
      console.log('⚠️ Error loading connection state:', error.message);
    }
  }

  checkSessionExists() {
    try {
      // Check if session directory exists and has files
      const sessionDir = path.join(this.sessionPath, 'enhanced-openai-chauffeur-bot');
      if (!fs.existsSync(sessionDir)) {
        console.log('📂 No session directory found');
        return false;
      }

      const files = fs.readdirSync(sessionDir);
      if (files.length === 0) {
        console.log('📂 Session directory is empty');
        return false;
      }

      // Check for Default directory which contains important session data
      const defaultDir = path.join(sessionDir, 'Default');
      if (!fs.existsSync(defaultDir)) {
        console.log('📂 No Default session directory found');
        return false;
      }

      const defaultFiles = fs.readdirSync(defaultDir);

      // Look for key session files that indicate a valid WhatsApp session
      const hasSessionStorage = defaultFiles.some(file =>
        file.includes('Local Storage') ||
        file.includes('Session Storage')
      );

      const hasCookies = defaultFiles.some(file =>
        file.includes('Cookies') ||
        file.includes('Network')
      );

      const hasDatabase = defaultFiles.some(file =>
        file.endsWith('.ldb') ||
        file.endsWith('.log') ||
        file.includes('IndexedDB')
      );

      // Check for WhatsApp specific files
      const indexedDBDir = path.join(defaultDir, 'IndexedDB');
      let hasWhatsAppData = false;

      if (fs.existsSync(indexedDBDir)) {
        const indexedDBFiles = fs.readdirSync(indexedDBDir);
        hasWhatsAppData = indexedDBFiles.some(file =>
          file.includes('whatsapp') || file.includes('web.whatsapp.com')
        );
      }

      // Also check for session files in main directory
      const hasMainSessionFiles = files.some(file =>
        file.includes('session') ||
        file.includes('auth') ||
        file === 'Local State' ||
        file === 'Preferences'
      );

      const sessionValid = (hasSessionStorage || hasCookies || hasDatabase || hasWhatsAppData || hasMainSessionFiles) && defaultFiles.length > 5;

      console.log(`📂 Session validation:
        - Directory: ${sessionDir} (${files.length} files)
        - Default dir: ${defaultFiles.length} files
        - Session storage: ${hasSessionStorage}
        - Cookies: ${hasCookies}
        - Database files: ${hasDatabase}
        - WhatsApp data: ${hasWhatsAppData}
        - Main session files: ${hasMainSessionFiles}
        - Valid session: ${sessionValid}`);

      return sessionValid;
    } catch (error) {
      console.log('⚠️ Error checking session:', error.message);
      return false;
    }
  }

  saveConnectionState() {
    try {
      const state = {
        connectionState: this.connectionState,
        isReady: this.isReady,
        isAuthenticated: this.isAuthenticated,
        connectedNumber: this.connectedNumber,
        lastHeartbeat: this.lastHeartbeat,
        lastUpdate: new Date().toISOString()
      };

      // Ensure data directory exists
      const dataDir = path.dirname(this.connectionStateFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(this.connectionStateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.log('⚠️ Error saving connection state:', error.message);
    }
  }

  clearQRCode() {
    try {
      const dataDir = path.join(__dirname, '../../data');
      const qrFilePath = path.join(dataDir, 'whatsapp-qr.json');
      if (fs.existsSync(qrFilePath)) {
        fs.unlinkSync(qrFilePath);
        console.log('🧹 Cleared QR code file - already connected');
      }

      // Clear QR refresh monitoring
      if (this.qrRefreshInterval) {
        clearInterval(this.qrRefreshInterval);
        this.qrRefreshInterval = null;
      }
    } catch (error) {
      console.log('⚠️ Error clearing QR code:', error.message);
    }
  }

  startQRRefreshMonitoring() {
    // Clear any existing interval
    if (this.qrRefreshInterval) {
      clearInterval(this.qrRefreshInterval);
    }

    // Monitor QR code age and refresh if needed
    this.qrRefreshInterval = setInterval(() => {
      try {
        const qrFilePath = path.join(__dirname, '../../data/whatsapp-qr.json');

        if (fs.existsSync(qrFilePath)) {
          const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
          const now = Date.now();
          const qrTime = new Date(qrData.timestamp).getTime();
          const age = now - qrTime;

          // Update age in file
          qrData.age = Math.floor(age / 1000);
          qrData.status = age > this.qrExpiryTime ? 'expired' : 'active';

          // Save updated QR data
          fs.writeFileSync(qrFilePath, JSON.stringify(qrData, null, 2));

          // Notify web platform of age update
          this.notifyWebPlatform('qrAgeUpdate', {
            phoneNumber: 'main-instance',
            age: qrData.age,
            status: qrData.status,
            expiresAt: qrData.expiresAt,
            attempt: qrData.attempt
          });

          // If QR is expired and we haven't reached max retries, request new QR
          if (age > this.qrExpiryTime && this.qrRetries < this.maxQrRetries) {
            console.log('⏰ QR code expired, requesting new one...');
            this.notifyWebPlatform('qrExpired', {
              phoneNumber: 'main-instance',
              age: qrData.age,
              attempt: qrData.attempt,
              maxRetries: this.maxQrRetries
            });

            // Force new QR generation
            this.forceQRGeneration();
          }
        }
      } catch (error) {
        console.log('⚠️ Error in QR refresh monitoring:', error.message);
      }
    }, 5000); // Check every 5 seconds
  }

  getConnectionState() {
    return {
      state: this.connectionState,
      isReady: this.isReady,
      isAuthenticated: this.isAuthenticated,
      connectedNumber: this.connectedNumber,
      lastHeartbeat: this.lastHeartbeat
    };
  }

  // Method to manually check connection state
  async checkConnectionState() {
    try {
      if (this.client && this.client.pupBrowser) {
        // Check if client is authenticated
        const isAuthenticated = this.client.authStrategy && this.client.authStrategy.isAuthenticated;

        if (isAuthenticated) {
          console.log('🔍 Client is authenticated, updating connection state...');
          this.isAuthenticated = true;
          this.connectionState = 'connected';

          // Try to get connected number
          try {
            this.connectedNumber = await this.getConnectedNumber();
            console.log(`📱 Connected number: ${this.connectedNumber || 'Unknown'}`);
          } catch (error) {
            console.error('⚠️ Error getting connected number:', error);
          }

          this.saveConnectionState();

          // Notify web platform
          this.notifyWebPlatform('instanceConnected', {
            phoneNumber: this.connectedNumber || 'main-instance',
            status: 'connected',
            restored: true,
            timestamp: new Date().toISOString()
          });

          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('❌ Error checking connection state:', error);
      return false;
    }
  }

  async handleRestart() {
    try {
      console.log('🔄 Restarting WhatsApp client...');
      this.qrRetries = 0;
      this.connectionState = 'restarting';

      // Stop heartbeat
      this.stopHeartbeat();

      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }

      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, 5000));

      this.connectionState = 'disconnected';
      this.saveConnectionState();
    } catch (error) {
      console.error('❌ Error during restart:', error);
      this.connectionState = 'error';
      this.saveConnectionState();
    }
  }

  async downloadMedia(message) {
    try {
      if (!message.hasMedia) {
        return null;
      }

      console.log('📥 Downloading media from message...');

      // Download the media
      const mediaData = await message.downloadMedia();
      if (!mediaData) {
        throw new Error('Failed to download media data');
      }

      console.log('✅ Media downloaded successfully');
      return {
        data: mediaData.data,
        mimetype: mediaData.mimetype,
        filename: mediaData.filename
      };
    } catch (error) {
      console.error('❌ Error downloading media:', error);
      throw error;
    }
  }
}

module.exports = new WhatsAppService(); 