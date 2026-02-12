const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// Import utilities
const portUtils = require('./utils/portUtils');

// Import bot components (lazy-loaded elsewhere if needed). Avoid eager import to prevent side effects during web startup.
const { PATHS } = require('./config/config');
const configRoutes = require('./routes/configRoutes');
const customerRoutes = require('./routes/customerRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const auditRoutes = require('./routes/auditRoutes');
const conciergeRoutes = require('./routes/conciergeRoutes');
const configManagementService = require('./services/configManagementService');
const { connectDB } = require('./models');
const mongoose = require('mongoose');
const UltraRobustWhatsAppBot = require('./UltraRobustWhatsAppBot');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configuration
let PORT = process.env.WEB_PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || 'chauffeur-bot-secret-2024';


// Default admin credentials (change these!)
const BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || 10;
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'chauffeur2024', BCRYPT_SALT_ROUNDS)
};

// QR file watcherimage.png
let qrFileWatcher = null;
let lastQRTimestamp = null;

// Function to watch QR file for changes
function setupQRFileWatcher() {
  const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

  if (qrFileWatcher) {
    qrFileWatcher.close();
  }

  if (fs.existsSync(qrFilePath)) {
    try {
      const stats = fs.statSync(qrFilePath);
      lastQRTimestamp = stats.mtime.getTime();

      qrFileWatcher = fs.watch(qrFilePath, (eventType, filename) => {
        if (eventType === 'change') {
          try {
            const newStats = fs.statSync(qrFilePath);
            const newTimestamp = newStats.mtime.getTime();

            if (newTimestamp !== lastQRTimestamp) {
              lastQRTimestamp = newTimestamp;
              console.log('📱 QR file changed, notifying clients...');

              // Read the updated QR data
              const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));

              // Emit to all connected clients
              io.emit('qrCodeUpdated', {
                qrCode: qrData.qrCode,
                timestamp: qrData.timestamp,
                attempt: qrData.attempt,
                maxRetries: qrData.maxRetries,
                age: 'fresh'
              });

              console.log('✅ QR code update broadcasted to all clients');
            }
          } catch (error) {
            console.error('❌ Error reading updated QR file:', error);
          }
        }
      });

      console.log('👁️ QR file watcher set up successfully');
    } catch (error) {
      console.error('❌ Error setting up QR file watcher:', error);
    }
  } else {
    console.log('⚠️ QR file not found, watcher not set up');
  }
}

// Function to force QR refresh
function forceQRRefresh() {
  try {
    const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

    if (fs.existsSync(qrFilePath)) {
      const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));

      // Update timestamp to force refresh
      qrData.timestamp = new Date().toISOString();
      qrData.lastUpdated = new Date().toISOString();

      fs.writeFileSync(qrFilePath, JSON.stringify(qrData, null, 2));

      // Emit to all clients
      io.emit('qrCodeUpdated', {
        qrCode: qrData.qrCode,
        timestamp: qrData.timestamp,
        attempt: qrData.attempt,
        maxRetries: qrData.maxRetries,
        age: 'forced-refresh'
      });

      console.log('🔄 QR code refresh forced');
      return true;
    }
  } catch (error) {
    console.error('❌ Error forcing QR refresh:', error);
  }
  return false;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Store for WhatsApp instances and QR codes
const whatsappInstances = new Map();
const qrCodes = new Map();

// Utility functions
const loadBookingSessions = () => {
  try {
    const data = fs.readFileSync(PATHS.BOOKING_SESSIONS, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { sessions: {}, customerHistory: {}, metadata: {} };
  }
};

const saveBookingSessions = (data) => {
  fs.writeFileSync(PATHS.BOOKING_SESSIONS, JSON.stringify(data, null, 2));
};

const loadConfig = () => {
  try {
    const configPath = path.join(__dirname, '../data/web-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }

  // Default configuration
  return {
    whatsappFlows: [
      {
        id: 'default',
        name: 'Default Booking Flow',
        steps: [
          { type: 'greeting', message: 'Welcome to Preimo Chauffeur Services!' },
          { type: 'collect_pickup', message: 'Where would you like to be picked up?' },
          { type: 'collect_destination', message: 'Where are you going?' },
          { type: 'collect_time', message: 'What time do you need the ride?' },
          { type: 'vehicle_selection', message: 'Please select your vehicle type:' },
          { type: 'confirmation', message: 'Please confirm your booking details:' }
        ]
      }
    ],
    gptPrompts: {
      bookingExtraction: `Extract booking information from the user message and return JSON with fields: pickupLocation, dropLocation, pickupTime, name, vehicleType, numberOfPassengers, luggageDetails, specialRequests.`,
      responseGeneration: `Generate a helpful and professional response for a luxury chauffeur service customer.`,
      voiceTranscription: `Process voice message for booking information extraction.`
    },
    paymentGateways: {
      stripe: { enabled: false, publicKey: '', secretKey: '' },
      paypal: { enabled: false, clientId: '', secretKey: '' },
      razorpay: { enabled: false, keyId: '', secretKey: '' }
    },
    settings: {
      currency: 'AED',
      timezone: 'Asia/Dubai',
      autoConfirmBookings: false,
      sendEmailNotifications: true
    },
    botMessages: {
      welcome: `*Welcome to Preimo Chauffeur Services* 🚘\n\nYour personal AI-powered booking assistant is ready to serve you!`,
      services: `*Our Premium Services*\n\n1. 🚗 Sedan - Perfect for 1-3 passengers\n2. 🚙 SUV - Ideal for 4-6 passengers\n3. 🏎️ Luxury - Experience ultimate comfort\n4. 🚐 Van - Great for groups up to 8\n\nReply with a number or type 'book' to start`,
      bookingOptions: `*How would you like to book?*\n\nChoose your preferred booking method:`,
      features: `🤖 *Bot Features*\n\n• 🧠 AI-powered conversation\n• 🌐 Multi-language support\n• 🎤 Voice message transcription\n• 📸 Image analysis\n• 📍 Live location tracking\n• 💳 Secure payments\n• 📱 iOS & Android compatible\n\n_Send 'help' for assistance_`
    }
  };
};

const saveConfig = (config) => {
  const configPath = path.join(__dirname, '../data/web-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Emit configuration update to all connected clients
  io.emit('configUpdated', config);
};

// Routes

// Login page
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/dashboard');
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Chauffeur Bot Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .login-container {
                background: white;
                padding: 2rem;
                border-radius: 10px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
                width: 100%;
                max-width: 400px;
            }
            .logo { text-align: center; margin-bottom: 2rem; }
            .logo h1 { color: #333; font-size: 1.8rem; }
            .logo p { color: #666; margin-top: 0.5rem; }
            .form-group { margin-bottom: 1rem; }
            label { display: block; margin-bottom: 0.5rem; color: #333; font-weight: 500; }
            input[type="text"], input[type="password"] {
                width: 100%;
                padding: 0.75rem;
                border: 2px solid #e1e5e9;
                border-radius: 5px;
                font-size: 1rem;
                transition: border-color 0.3s;
            }
            input[type="text"]:focus, input[type="password"]:focus {
                outline: none;
                border-color: #667eea;
            }
            .btn {
                width: 100%;
                padding: 0.75rem;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 5px;
                font-size: 1rem;
                cursor: pointer;
                transition: transform 0.2s;
            }
            .btn:hover { transform: translateY(-2px); }
            .error { color: #e74c3c; margin-top: 1rem; text-align: center; }
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="logo">
                <h1>🚗 Chauffeur Bot</h1>
                <p>Admin Dashboard</p>
            </div>
            <form method="POST" action="/login">
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" name="username" required>
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required>
                </div>
                <button type="submit" class="btn">Login</button>
                ${req.query.error ? '<div class="error">Invalid credentials</div>' : ''}
            </form>
        </div>
    </body>
    </html>
  `);
});

// Login handler
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_CREDENTIALS.username && bcrypt.compareSync(password, ADMIN_CREDENTIALS.passwordHash)) {
    console.log('✅ Login successful');
    req.session.authenticated = true;
    req.session.user = username;
    res.redirect('/dashboard');
  } else {
    console.log('❌ Login failed');
    res.redirect('/login?error=1');
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Config Manager
app.get('/config-manager.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/config-manager.html'));
});

// Customer Manager
app.get('/customer-manager.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/customer-manager.html'));
});

// API Routes

// AI Prompts Management API routes
app.get('/api/ai-prompts', requireAuth, (req, res) => {
  try {
    const promptsPath = path.join(__dirname, '../data/ai-prompts.json');
    let prompts = {};

    if (fs.existsSync(promptsPath)) {
      prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
    } else {
      // Load default prompts from config
      prompts = require('./config/config').AI_PROMPTS;
      // Save to file
      fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
    }

    res.json({
      success: true,
      data: prompts
    });
  } catch (error) {
    console.error('AI prompts API error:', error);
    res.status(500).json({ error: 'Failed to fetch AI prompts' });
  }
});

app.post('/api/ai-prompts', requireAuth, (req, res) => {
  try {
    const { prompts } = req.body;

    if (!prompts) {
      return res.status(400).json({ error: 'Prompts data is required' });
    }

    const promptsPath = path.join(__dirname, '../data/ai-prompts.json');
    fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));

    res.json({
      success: true,
      message: 'AI prompts updated successfully'
    });
  } catch (error) {
    console.error('AI prompts update error:', error);
    res.status(500).json({ error: 'Failed to update AI prompts' });
  }
});

// Chat logs API routes
app.get('/api/chat-logs', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, chatId, phoneNumber, bookingId, hours = 24 } = req.query;
    const { models } = require('./models');

    let query = {};
    if (chatId) query.chatId = chatId;
    if (phoneNumber) query.$or = [{ fromNumber: phoneNumber }, { toNumber: phoneNumber }];
    if (bookingId) query.bookingId = bookingId;

    // Time filter
    const since = new Date(Date.now() - (parseInt(hours) * 60 * 60 * 1000));
    query.timestamp = { $gte: since };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const logs = await models.ChatLog.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(offset)
      .lean();

    const total = await models.ChatLog.countDocuments(query);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Chat logs API error:', error);
    res.status(500).json({ error: 'Failed to fetch chat logs' });
  }
});

app.get('/api/chat-stats', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const { models } = require('./models');
    const stats = await models.ChatLog.getChatStats(start, end);

    const statData = stats[0] || {
      totalMessages: 0,
      incomingMessages: 0,
      outgoingMessages: 0,
      uniqueUsersCount: 0,
      bookingRelatedMessages: 0,
      aiProcessedMessages: 0
    };

    res.json({
      success: true,
      data: {
        totalMessages: statData.totalMessages,
        incomingMessages: statData.incomingMessages,
        outgoingMessages: statData.outgoingMessages,
        uniqueUsers: statData.uniqueUsersCount,
        bookingMessages: statData.bookingRelatedMessages,
        aiProcessedMessages: statData.aiProcessedMessages
      }
    });
  } catch (error) {
    console.error('Chat stats API error:', error);
    res.status(500).json({ error: 'Failed to fetch chat stats' });
  }
});

// Create sample chat logs for testing (only if no logs exist)
app.post('/api/chat-logs/create-sample', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    
    // Check if any chat logs exist
    const existingLogs = await models.ChatLog.countDocuments();
    if (existingLogs > 0) {
      return res.json({ success: false, message: 'Chat logs already exist' });
    }

    // Create sample chat logs
    const sampleLogs = [
      {
        chatId: '971543033535@c.us',
        messageId: 'sample_1',
        messageType: 'text',
        direction: 'incoming',
        fromNumber: '971543033535',
        fromName: 'Test User 1',
        toNumber: 'bot',
        messageBody: 'Hello, I need a chauffeur service',
        bookingId: 'BK-001',
        aiProcessed: true,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        isRead: true
      },
      {
        chatId: '971543033535@c.us',
        messageId: 'sample_2',
        messageType: 'text',
        direction: 'outgoing',
        fromNumber: 'bot',
        fromName: 'AI Bot',
        toNumber: '971543033535',
        messageBody: 'Hello! I\'d be happy to help you book a chauffeur service. Please provide your pickup location.',
        bookingId: 'BK-001',
        aiProcessed: true,
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000), // 2 hours ago + 30 seconds
        isRead: false
      },
      {
        chatId: '919928366889@c.us',
        messageId: 'sample_3',
        messageType: 'text',
        direction: 'incoming',
        fromNumber: '919928366889',
        fromName: 'Test User 2',
        toNumber: 'bot',
        messageBody: 'book chauffeur',
        bookingId: 'BK-002',
        aiProcessed: true,
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        isRead: true
      },
      {
        chatId: '919928366889@c.us',
        messageId: 'sample_4',
        messageType: 'text',
        direction: 'outgoing',
        fromNumber: 'bot',
        fromName: 'AI Bot',
        toNumber: '919928366889',
        messageBody: 'Great! Let\'s start your booking. What\'s your pickup location?',
        bookingId: 'BK-002',
        aiProcessed: true,
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000 + 15000), // 1 hour ago + 15 seconds
        isRead: false
      }
    ];

    await models.ChatLog.insertMany(sampleLogs);

    res.json({
      success: true,
      message: 'Sample chat logs created successfully',
      count: sampleLogs.length
    });
  } catch (error) {
    console.error('Error creating sample chat logs:', error);
    res.status(500).json({ error: 'Failed to create sample chat logs' });
  }
});

// Concierge management API routes
app.get('/api/concierges', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { page = 1, limit = 50, status, search } = req.query;

    let query = {};
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const concierges = await models.Concierge.find(query)
      .populate('uplineId', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(offset)
      .lean();

    const total = await models.Concierge.countDocuments(query);

    res.json({
      success: true,
      data: concierges,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Concierges API error:', error);
    res.status(500).json({ error: 'Failed to fetch concierges' });
  }
});

app.post('/api/concierges', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const {
      name, email, phone, paypalEmail, commissionRate = 10,
      uplineId, uplineCommissionRate = 2, minimumPayoutAmount = 50
    } = req.body;

    // Check if concierge already exists
    const existingConcierge = await models.Concierge.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingConcierge) {
      return res.status(400).json({
        error: 'Concierge with this email or phone already exists'
      });
    }

    // Create new concierge
    const concierge = new models.Concierge({
      name,
      email,
      phone,
      paypalEmail,
      commissionRate,
      minimumPayoutAmount,
      status: 'active',
      verificationStatus: 'pending'
    });

    // Handle upline relationship
    if (uplineId) {
      const upline = await models.Concierge.findById(uplineId);
      if (upline) {
        concierge.setUpline(uplineId, uplineCommissionRate);
        await upline.addDirectReferral(concierge._id);
      }
    }

    await concierge.save();

    // Auto-whitelist the concierge's phone number
    const fileUtils = require('./utils/fileUtils');
    const { PATHS } = require('./config/config');
    const whitelistedNumbers = fileUtils.loadJsonFile(PATHS.WHITELISTED_NUMBERS, []);

    if (!whitelistedNumbers.includes(phone)) {
      whitelistedNumbers.push(phone);
      fileUtils.saveJsonFile(PATHS.WHITELISTED_NUMBERS, whitelistedNumbers);
    }

    res.json({
      success: true,
      data: concierge,
      message: 'Concierge created successfully and added to whitelist'
    });
  } catch (error) {
    console.error('Create concierge error:', error);
    res.status(500).json({ error: 'Failed to create concierge' });
  }
});

app.put('/api/concierges/:id', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { id } = req.params;
    const updates = req.body;

    const concierge = await models.Concierge.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!concierge) {
      return res.status(404).json({ error: 'Concierge not found' });
    }

    res.json({
      success: true,
      data: concierge,
      message: 'Concierge updated successfully'
    });
  } catch (error) {
    console.error('Update concierge error:', error);
    res.status(500).json({ error: 'Failed to update concierge' });
  }
});

app.delete('/api/concierges/:id', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { id } = req.params;

    const concierge = await models.Concierge.findByIdAndDelete(id);

    if (!concierge) {
      return res.status(404).json({ error: 'Concierge not found' });
    }

    res.json({
      success: true,
      message: 'Concierge deleted successfully'
    });
  } catch (error) {
    console.error('Delete concierge error:', error);
    res.status(500).json({ error: 'Failed to delete concierge' });
  }
});

// Root route - redirect to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      bot: global.mainBot ? 'running' : 'stopped',
      webServer: 'running',
      database: 'file-based'
    },
    uptime: process.uptime()
  });
});

// Get booking sessions
app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { status, dateFrom, dateTo, limit = 50, page = 1 } = req.query;

    let query = {};

    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Apply date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.createdAt.$lte = new Date(dateTo);
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get bookings from database
    const bookings = await models.Booking.find(query)
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await models.Booking.countDocuments(query);

    // Format response
    const sessionsList = bookings.map(booking => {
      // Debug logging
      console.log('🔍 Booking data for API response:', {
        bookingId: booking.bookingId,
        customerId: booking.customerId,
        customerIdName: booking.customerId?.name,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone
      });
      
      return {
        id: booking.bookingId,
        bookingId: booking.bookingId,
        phoneNumber: booking.customerId?.phone || booking.customerPhone || 'Unknown',
        status: booking.status || 'pending',
        paymentStatus: booking.paymentStatus || 'pending',
        isPaid: booking.isPaid || false,
        data: {
          customerName: booking.customerId?.name || booking.customerName || 'Unknown',
          pickupLocation: booking.pickupLocation || 'Not specified',
          dropLocation: booking.dropLocation || 'Not specified',
          pickupTime: booking.pickupTime || booking.createdAt,
          vehicleType: booking.vehicleType || 'Not specified',
          bookingType: booking.bookingType || 'Not specified',
          numberOfPassengers: booking.numberOfPassengers || 1,
          luggageDetails: booking.specialRequests || '',
          specialRequests: booking.specialRequests || '',
          totalAmount: booking.totalAmount || 0,
          currency: booking.currency || 'AED'
        },
        timestamp: booking.createdAt,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      };
    });

    res.json({
      success: true,
      sessions: sessionsList.reduce((acc, session) => {
        acc[session.id] = session;
        return acc;
      }, {}),
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      filtered: sessionsList.length
    });
  } catch (error) {
    console.error('Error loading bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load bookings',
      sessions: {},
      total: 0,
      filtered: 0
    });
  }
});

// Get WhatsApp instances
app.get('/api/whatsapp/instances', requireAuth, (req, res) => {
  const instances = Array.from(whatsappInstances.entries()).map(([number, instance]) => ({
    phoneNumber: number,
    status: instance.status || 'unknown',
    connectedAt: instance.connectedAt,
    qrCode: qrCodes.get(number),
    countryCode: instance.countryCode || '971',
    name: instance.name || `WhatsApp ${number}`,
    description: instance.description || '',
    createdAt: instance.createdAt || new Date().toISOString(),
    lastUpdated: instance.lastUpdated || new Date().toISOString(),
    connected: !!instance.connected,
    isDefault: !!instance.isDefault
  }));

  // Check connection state file first
  const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');
  let mainInstanceStatus = 'disconnected';
  let connectedNumber = null;
  let lastHeartbeat = null;
  let statusMessage = null;

  if (fs.existsSync(connectionStateFile)) {
    try {
      const connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));

      // Check if state is recent (within last 5 minutes)
      const stateAge = Date.now() - new Date(connectionState.lastUpdate).getTime();
      const isStateRecent = stateAge < 300000; // 5 minutes

      if (isStateRecent) {
        mainInstanceStatus = connectionState.connectionState || 'disconnected';
        connectedNumber = connectionState.connectedNumber;
        lastHeartbeat = connectionState.lastHeartbeat;

        // Set appropriate status message
        switch (mainInstanceStatus) {
          case 'connected':
            statusMessage = `Connected as ${connectedNumber}`;
            break;
          case 'connecting':
            statusMessage = 'Attempting to restore session...';
            break;
          case 'initializing':
            statusMessage = 'Generating QR code for authentication...';
            break;
          case 'disconnected':
            statusMessage = 'Ready for new connection';
            break;
          default:
            statusMessage = 'Status unknown';
        }
      } else {
        statusMessage = `Last state: ${Math.round(stateAge / (60 * 1000))} minutes ago`;
      }
    } catch (error) {
      console.error('Error reading connection state:', error);
      statusMessage = 'Error reading connection state';
    }
  } else {
    // No state file exists - check if valid session exists
    try {
      const sessionDir = path.join(__dirname, '../data/whatsapp-session/session-enhanced-openai-chauffeur-bot');
      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir);
        const hasValidSession = files.some(file =>
          file.includes('Local State') || file.includes('Default')
        );

        if (hasValidSession) {
          mainInstanceStatus = 'checking';
          statusMessage = 'Valid session found, bot may auto-connect when started';
        } else {
          statusMessage = 'No valid session found';
        }
      } else {
        statusMessage = 'No previous session found';
      }
    } catch (error) {
      statusMessage = 'Error checking session files';
    }
  }

  // Add main bot instance
  const mainInstance = {
    number: connectedNumber || 'main-instance',
    status: mainInstanceStatus,
    lastHeartbeat: lastHeartbeat,
    statusMessage: statusMessage
  };

  // Only add QR code if we're definitely not connected and need initialization
  if (mainInstanceStatus !== 'connected' && mainInstanceStatus !== 'connecting' && mainInstanceStatus !== 'checking') {
    const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');
    if (fs.existsSync(qrFilePath)) {
      try {
        const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
        mainInstance.qrCode = qrData.qrCode;
        mainInstance.attempt = qrData.attempt;
        mainInstance.maxRetries = qrData.maxRetries;
        mainInstance.timestamp = qrData.timestamp;
        mainInstance.sessionRestoreAttempted = qrData.sessionRestoreAttempted;
        if (mainInstanceStatus === 'disconnected') {
          mainInstance.status = 'initializing';
        }
      } catch (error) {
        console.error('Error reading QR data:', error);
        mainInstance.qrCode = null;
        mainInstance.statusMessage = 'QR code file corrupted';
      }
    } else {
      // No QR file exists - check if bot process is available
      mainInstance.qrCode = null;
      if (mainInstanceStatus === 'disconnected') {
        // Check if bot process is running by looking for connection state
        const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');
        if (fs.existsSync(connectionStateFile)) {
          try {
            const connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));
            const stateAge = Date.now() - new Date(connectionState.lastUpdate).getTime();

            if (stateAge < 300000) { // 5 minutes
              mainInstance.statusMessage = 'Bot process active, QR generation in progress...';
              // Try to trigger QR generation
              setTimeout(() => {
                triggerQRGeneration();
              }, 1000);
            } else {
              mainInstance.statusMessage = 'Bot process may not be active - please restart the application';
            }
          } catch (error) {
            mainInstance.statusMessage = 'Unable to determine bot status - please restart the application';
          }
        } else {
          mainInstance.statusMessage = 'Bot process not detected - please restart the application';
        }
      }
    }
  }

  instances.unshift(mainInstance);
  res.json(instances);
});

// Get dashboard statistics
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');

    // Get booking statistics
    const totalBookings = await models.Booking.countDocuments();
    const ongoingBookings = await models.Booking.countDocuments({
      status: { $in: ['pending', 'confirmed', 'in_progress'] }
    });
    const paidBookings = await models.Booking.countDocuments({
      status: 'completed',
      paymentStatus: 'paid'
    });

    // Get WhatsApp connection status
    const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');
    let whatsappStatus = 'disconnected';
    let activeInstances = 0;

    if (fs.existsSync(connectionStateFile)) {
      try {
        const connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));
        whatsappStatus = connectionState.connectionState || 'disconnected';
        if (whatsappStatus === 'connected') {
          activeInstances = 1;
        }
      } catch (error) {
        console.error('Error reading connection state:', error);
      }
    }

    // Get recent bookings
    const recentBookings = await models.Booking.find()
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const formattedRecentBookings = recentBookings.map(booking => ({
      id: booking.bookingId,
      customerName: booking.customerId?.name || booking.customerName || 'Unknown',
      vehicleType: booking.vehicleType || 'Not specified',
      status: booking.status || 'pending',
      totalAmount: booking.totalAmount || 0,
      currency: booking.currency || 'AED',
      createdAt: booking.createdAt
    }));

    res.json({
      success: true,
      stats: {
        totalBookings,
        ongoingBookings,
        paidBookings,
        activeWhatsApp: activeInstances
      },
      recentBookings: formattedRecentBookings,
      whatsappStatus
    });
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load dashboard statistics',
      stats: {
        totalBookings: 0,
        ongoingBookings: 0,
        paidBookings: 0,
        activeWhatsApp: 0
      },
      recentBookings: []
    });
  }
});

// Get current QR code
app.get('/api/whatsapp/qr', requireAuth, (req, res) => {
  const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

  if (fs.existsSync(qrFilePath)) {
    try {
      const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
      res.json({
        success: true,
        qrCode: qrData.qrCode,
        attempt: qrData.attempt,
        maxRetries: qrData.maxRetries,
        timestamp: qrData.timestamp
      });
    } catch (error) {
      console.error('Error parsing QR data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to read QR code data',
        message: 'QR code file is corrupted'
      });
    }
  } else {
    res.json({
      success: false,
      message: 'No QR code available',
      needsGeneration: true
    });
  }
});

// Serve QR code image
app.get('/api/whatsapp/qr/image', requireAuth, async (req, res) => {
  const qrImagePath = path.join(__dirname, '../data/whatsapp-qr.png');
  const qrJsonPath = path.join(__dirname, '../data/whatsapp-qr.json');

  try {
    // Check if QR image exists and is valid
    if (fs.existsSync(qrImagePath) && fs.statSync(qrImagePath).size > 0) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(qrImagePath);
      return;
    }

    // Try to regenerate QR image from JSON data
    if (fs.existsSync(qrJsonPath)) {
      const qrData = JSON.parse(fs.readFileSync(qrJsonPath, 'utf8'));
      if (qrData.qrCode) {
        console.log('📱 Regenerating QR image from stored data...');

        const qrcode = require('qrcode');
        const qrDataURL = await qrcode.toDataURL(qrData.qrCode, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        // Convert data URL to buffer and save as PNG
        const base64Data = qrDataURL.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(qrImagePath, buffer);

        console.log('📱 QR image regenerated successfully');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(qrImagePath);
        return;
      }
    }

    // If no QR data available, return 404
    res.status(404).json({
      success: false,
      message: 'QR code image not found and no QR data available for regeneration'
    });
  } catch (error) {
    console.error('❌ Error serving QR image:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating QR code image'
    });
  }
});

// Serve QR code as data URL
app.get('/api/whatsapp/qr/data', requireAuth, (req, res) => {
  const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

  if (fs.existsSync(qrFilePath)) {
    try {
      const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
      res.json({
        success: true,
        qrCode: qrData.qrCode,
        qrDataURL: qrData.qrDataURL,
        timestamp: qrData.timestamp,
        attempt: qrData.attempt,
        maxRetries: qrData.maxRetries
      });
    } catch (error) {
      console.error('❌ Error reading QR data:', error);
      res.status(500).json({
        success: false,
        message: 'Error reading QR code data'
      });
    }
  } else {
    res.status(404).json({
      success: false,
      message: 'QR code data not found'
    });
  }
});

// Force QR code refresh
app.post('/api/whatsapp/qr/refresh', requireAuth, (req, res) => {
  try {
    const success = forceQRRefresh();
    if (success) {
      res.json({
        success: true,
        message: 'QR code refreshed successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No QR code file found to refresh'
      });
    }
  } catch (error) {
    console.error('Error forcing QR refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh QR code'
    });
  }
});

// Force new QR code generation
app.post('/api/whatsapp/qr/generate', requireAuth, async (req, res) => {
  try {
    console.log('🔄 Generating new QR code...');

    // Try to use the bot instance to force QR generation (resets attempt counter)
    if (global.mainBot && typeof global.mainBot.forceQRGeneration === 'function') {
      console.log('🔄 Using bot instance to force QR generation...');
      const success = await global.mainBot.forceQRGeneration();
      
      if (success) {
        console.log('✅ QR generation initiated via bot instance');
        
        // Clear existing QR data file to ensure fresh start
        const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');
        if (fs.existsSync(qrFilePath)) {
          try {
            fs.unlinkSync(qrFilePath);
            console.log('✅ Cleared existing QR data file');
          } catch (error) {
            console.log('⚠️ Could not clear QR data file:', error.message);
          }
        }
        
        return res.json({
          success: true,
          message: 'New QR code generation initiated with fresh attempt counter',
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('⚠️ Bot instance QR generation failed, falling back to session clearing...');
      }
    } else {
      console.log('⚠️ Bot instance not available, falling back to session clearing...');
    }

    // Fallback: Clear session files to force QR generation on next bot restart
    let qrGenerated = false;
    const sessionDir = path.join(__dirname, '../data/whatsapp-session');

    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log('✅ Session directory cleared');
        qrGenerated = true; // Consider this a success since we cleared the session
      } catch (error) {
        console.error('❌ Error clearing session directory:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to clear session directory',
          message: 'Unable to clear session files. Please check permissions.'
        });
      }
    } else {
      console.log('⚠️ Session directory does not exist, creating new one...');
      qrGenerated = true; // No session exists, so bot will generate QR on next connection
    }

    // Also clear existing QR data file to ensure fresh start
    const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');
    if (fs.existsSync(qrFilePath)) {
      try {
        fs.unlinkSync(qrFilePath);
        console.log('✅ Cleared existing QR data file');
      } catch (error) {
        console.log('⚠️ Could not clear QR data file:', error.message);
      }
    }

    if (!qrGenerated) {
      console.log('❌ QR generation failed');
      return res.status(500).json({
        success: false,
        error: 'QR generation failed',
        message: 'Unable to generate QR code. Please check bot logs for details.'
      });
    }

    // Wait for QR file to be written with multiple attempts
    let attempts = 0;
    const maxAttempts = 30; // Increased from 10 to 30 seconds
    const checkQRFile = () => {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          attempts++;

          try {
            const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');
            const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');

            if (fs.existsSync(qrFilePath)) {
              const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
              let connectionState = null;
              if (fs.existsSync(connectionStateFile)) {
                connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));
              }

              // Ensure attempt counter is valid (not exceeding maxRetries)
              if (qrData.attempt > qrData.maxRetries) {
                qrData.attempt = 1; // Reset to 1 if it exceeds max
                console.log('⚠️ Attempt counter exceeded max, resetting to 1');
              }

              clearInterval(checkInterval);
              resolve({ success: true, qrData, connectionState });
            } else if (attempts >= maxAttempts) {
              clearInterval(checkInterval);
              resolve({ success: false, error: 'QR file not found after maximum attempts. Bot may not be running or may need to be restarted.' });
            }
          } catch (err) {
            if (attempts >= maxAttempts) {
              clearInterval(checkInterval);
              resolve({ success: false, error: 'Error reading QR files', details: err.message });
            }
          }
        }, 1000); // Check every second
      });
    };

    const result = await checkQRFile();

    if (result.success) {
      return res.json({
        success: true,
        message: 'QR code generated successfully',
        qrData: result.qrData,
        connectionState: result.connectionState
      });
    } else {
      // If QR generation failed, try to trigger a manual QR generation
      console.log('⚠️ QR generation failed, attempting manual trigger...');
      
      // Try to trigger QR generation by calling the bot's forceQRGeneration if available
      if (global.mainBot && typeof global.mainBot.forceQRGeneration === 'function') {
        try {
          console.log('🔄 Attempting manual QR generation via bot instance...');
          const manualSuccess = await global.mainBot.forceQRGeneration();
          if (manualSuccess) {
            console.log('✅ Manual QR generation initiated');
            return res.json({
              success: true,
              message: 'QR generation initiated manually. Please wait a moment and refresh the page.',
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error('❌ Manual QR generation failed:', error);
        }
      }
      
      return res.status(500).json({
        success: false,
        error: result.error,
        details: result.details || 'QR generation completed but file not accessible. Bot may need to be restarted.',
        suggestion: 'Please restart the bot application and try again.'
      });
    }

    // Return success since we cleared the session
    return res.json({
      success: true,
      message: 'Session cleared successfully. Bot will generate new QR code with fresh attempt counter on next connection attempt.',
      qrData: null,
      connectionState: { isReady: false, needsQR: true }
    });

  } catch (error) {
    console.error('❌ Error in QR generation endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
      message: 'Please check bot logs for more details'
    });
  }
});

// Function to trigger QR generation
function triggerQRGeneration() {
  try {
    // Since bot runs in separate process, we can't access global variables directly
    // Instead, we'll rely on the bot to generate QR codes and save them to file
    console.log('🔄 Requesting QR generation from bot process...');

    // Check if we have a connection state file that indicates bot is ready
    const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');
    if (fs.existsSync(connectionStateFile)) {
      try {
        const connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));
        const stateAge = Date.now() - new Date(connectionState.lastUpdate).getTime();

        if (stateAge < 300000) { // 5 minutes
          console.log(`📱 Bot process state: ${connectionState.connectionState}`);
          if (connectionState.connectionState === 'connected' || connectionState.isAuthenticated) {
            console.log('✅ Already connected; skipping QR generation');
            return;
          }
          console.log('📱 Not connected; QR generation should happen automatically');
        } else {
          console.log('⚠️ Bot process may not be active, QR generation unavailable');
        }
      } catch (error) {
        console.log('⚠️ Error reading connection state, QR generation may be unavailable');
      }
    } else {
      console.log('⚠️ No connection state found, bot process may not be running');
    }
  } catch (error) {
    console.error('❌ Error triggering QR generation:', error);
  }
}

// Create new WhatsApp instance
app.post('/api/whatsapp/create', requireAuth, (req, res) => {
  try {
    const { phoneNumber, countryCode, name, description, status } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Validate phone number format
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format'
      });
    }

    // Upsert instance idempotently
    const existing = whatsappInstances.get(cleanNumber) || {};
    const instanceId = existing.id || uuidv4();

    whatsappInstances.set(cleanNumber, {
      id: instanceId,
      status: status || existing.status || 'initializing',
      phoneNumber: cleanNumber,
      countryCode: countryCode || existing.countryCode || '971',
      name: name || existing.name || '',
      description: description || existing.description || '',
      createdAt: existing.createdAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      connected: existing.connected || false,
      isDefault: existing.isDefault || false
    });

    // Generate QR code (will use real QR from bot if available)
    generateQRCode(cleanNumber).then(() => {
      // Emit status update to connected clients
      io.emit('instanceUpserted', {
        phoneNumber: cleanNumber,
        instanceId,
        status: status || existing.status || 'initializing',
        name: name || existing.name || '',
        countryCode: countryCode || existing.countryCode || '971'
      });
    }).catch(error => {
      console.error('Error generating QR code:', error);
    });

    res.json({
      success: true,
      instanceId,
      phoneNumber: cleanNumber,
      countryCode: countryCode || '971',
      name: name || '',
      status: status || 'initializing',
      message: 'Instance ready. QR will be available if not already connected.'
    });
  } catch (error) {
    console.error('Error creating WhatsApp instance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while creating instance'
    });
  }
});

// Refresh WhatsApp instance
app.post('/api/whatsapp/:number/refresh', requireAuth, (req, res) => {
  const { number } = req.params;

  if (whatsappInstances.has(number)) {
    // Update status and regenerate QR code
    const instance = whatsappInstances.get(number);
    instance.status = 'refreshing';
    whatsappInstances.set(number, instance);

    // Generate new QR code
    generateQRCode(number);

    res.json({ success: true, message: 'Instance refreshed' });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

// Update main WhatsApp number
app.post('/api/whatsapp/main-number', requireAuth, (req, res) => {
  try {
    const { phoneNumber, countryCode, name, description } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Validate phone number format
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format'
      });
    }

    // Save main number configuration
    const mainNumberConfig = {
      phoneNumber: cleanNumber,
      countryCode: countryCode || '971',
      name: name || 'Main WhatsApp Instance',
      description: description || '',
      updatedAt: new Date().toISOString()
    };

    // Save to file for persistence
    const configPath = path.join(__dirname, '../data/main-whatsapp-config.json');
    fs.writeFileSync(configPath, JSON.stringify(mainNumberConfig, null, 2));

    // Emit update to connected clients
    io.emit('mainNumberUpdated', mainNumberConfig);

    res.json({
      success: true,
      message: 'Main WhatsApp number updated successfully',
      config: mainNumberConfig
    });
  } catch (error) {
    console.error('Error updating main WhatsApp number:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while updating main number'
    });
  }
});

// Get main WhatsApp number configuration
app.get('/api/whatsapp/main-number', requireAuth, (req, res) => {
  try {
    const configPath = path.join(__dirname, '../data/main-whatsapp-config.json');

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json({
        success: true,
        config: config
      });
    } else {
      // Return default configuration
      res.json({
        success: true,
        config: {
          phoneNumber: '919928366889',
          countryCode: '91',
          name: 'Main WhatsApp Instance',
          description: 'Default main instance',
          updatedAt: new Date().toISOString()
        }
      });
    }
  } catch (error) {
    console.error('Error getting main WhatsApp number:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while getting main number'
    });
  }
});

// Disconnect main WhatsApp instance
app.post('/api/whatsapp/disconnect', requireAuth, (req, res) => {
  try {
    // Send disconnect signal to main process
    process.emit('disconnect-whatsapp');

    // Alternative: try to access global bot if available
    if (global.mainBot && global.mainBot.whatsapp) {
      global.mainBot.whatsapp.client.destroy().then(() => {
        console.log('🔌 Main WhatsApp instance disconnected via API');
        io.emit('instanceDisconnected', {
          phoneNumber: 'main-instance',
          timestamp: new Date().toISOString()
        });
      }).catch(error => {
        console.error('Error disconnecting main instance:', error);
      });
    }

    res.json({ success: true, message: 'Disconnect command sent' });
  } catch (error) {
    console.error('Error accessing bot instance:', error);
    res.status(500).json({ error: 'Failed to disconnect instance' });
  }
});

// Remove WhatsApp instance
app.delete('/api/whatsapp/:number', requireAuth, (req, res) => {
  const { number } = req.params;

  if (whatsappInstances.has(number)) {
    whatsappInstances.delete(number);
    qrCodes.delete(number);

    // Emit instance removal to connected clients
    io.emit('instanceRemoved', { phoneNumber: number });

    res.json({ success: true, message: 'Instance removed' });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

// Generate QR code for WhatsApp
async function generateQRCode(phoneNumber) {
  try {
    // Check if we have a real QR code from the bot
    const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

    if (fs.existsSync(qrFilePath)) {
      try {
        const qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
        const qrCodeDataURL = qrData.qrCode;

        qrCodes.set(phoneNumber, qrCodeDataURL);

        // Emit real QR code to connected clients immediately
        io.emit('qrCodeGenerated', {
          phoneNumber,
          qrCode: qrCodeDataURL,
          attempt: qrData.attempt,
          maxRetries: qrData.maxRetries,
          timestamp: qrData.timestamp,
          status: 'ready'
        });

        console.log('📱 Serving real WhatsApp QR code to web platform');
        return qrCodeDataURL;
      } catch (parseError) {
        console.error('❌ Error parsing QR code data:', parseError);
      }
    }

    // Fallback: generate placeholder if no real QR code available
    console.log('⚠️ No real QR code available, generating placeholder');
    const qrData = `Scan this QR code with WhatsApp to connect instance: ${phoneNumber}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrData);

    qrCodes.set(phoneNumber, qrCodeDataURL);

    // Emit placeholder QR code to connected clients
    io.emit('qrCodeGenerated', { phoneNumber, qrCode: qrCodeDataURL });

    return qrCodeDataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
  }
}

// Configuration Management Routes (Database-driven)
app.use('/api/config', configRoutes);

// Customer Management Routes
app.use('/api/customers', customerRoutes);

// Payment Management Routes (mounted later to avoid route conflicts)

// Audit Log Management Routes
app.use('/api/audit-logs', auditRoutes);
app.use('/api/concierges', conciergeRoutes);

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Send initial data
  socket.emit('bookingsUpdate', loadBookingSessions());
  socket.emit('configUpdate', loadConfig());
});

// Listen for configuration changes and emit to all clients
configManagementService.on('configChanged', (change) => {
  console.log(`📡 Broadcasting config change: ${change.key}`);
  io.emit('configChanged', change);
});

// Error handling
// Set up global io access for other modules
global.webPlatformIO = io;

// Set up event file polling for real-time updates
const eventsDir = path.join(__dirname, '../data/events');
const latestEventsFile = path.join(__dirname, '../data/latest-events.json');

// Watch for new events and emit to clients
if (fs.existsSync(eventsDir)) {
  fs.watch(eventsDir, (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.endsWith('.json')) {
      try {
        const eventFilePath = path.join(eventsDir, filename);
        if (fs.existsSync(eventFilePath)) {
          const eventData = JSON.parse(fs.readFileSync(eventFilePath, 'utf8'));
          io.emit(eventData.event, eventData.data);

          // Clean up old event files (keep only last 10)
          setTimeout(() => {
            try {
              fs.unlinkSync(eventFilePath);
            } catch (error) {
              // File might already be deleted
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Error processing event file:', error);
      }
    }
  });
}

// API endpoint to get real-time logs
app.get('/api/logs', requireAuth, (req, res) => {
  try {
    if (fs.existsSync(latestEventsFile)) {
      const events = JSON.parse(fs.readFileSync(latestEventsFile, 'utf8'));
      res.json({ success: true, events });
    } else {
      res.json({ success: true, events: [] });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// API endpoint to get live messages
app.get('/api/live-messages', requireAuth, (req, res) => {
  try {
    const liveMessagesFile = path.join(__dirname, '../data/live-messages.json');

    if (fs.existsSync(liveMessagesFile)) {
      const messages = JSON.parse(fs.readFileSync(liveMessagesFile, 'utf8'));
      res.json({ success: true, messages });
    } else {
      res.json({ success: true, messages: [] });
    }
  } catch (error) {
    console.error('Error loading live messages:', error);
    res.status(500).json({ error: 'Failed to load live messages' });
  }
});

// Payment processing API endpoints
app.post('/api/payments/process', requireAuth, async (req, res) => {
  try {
    const { bookingId, paymentData } = req.body;
    
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'Booking ID is required' });
    }

    // Get the bot instance
    const bot = global.mainBot;
    if (!bot || !bot.processPaymentCompletion) {
      return res.status(500).json({ success: false, error: 'Bot not available' });
    }

    // Process payment completion
    const result = await bot.processPaymentCompletion(bookingId, paymentData);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Payment processed successfully',
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Payment processing failed'
      });
    }
  } catch (error) {
    console.error('Payment processing API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PayPal webhook endpoint
app.post('/api/payments/paypal/webhook', (req, res) => {
  try {
    const webhookData = req.body;
    
    // Get the bot instance
    const bot = global.mainBot;
    if (!bot || !bot.handlePayPalWebhook) {
      return res.status(500).json({ success: false, error: 'Bot not available' });
    }

    // Process webhook asynchronously
    bot.handlePayPalWebhook(webhookData).then(result => {
      console.log('PayPal webhook processed:', result);
    }).catch(error => {
      console.error('PayPal webhook error:', error);
    });

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('PayPal webhook API error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get payment history for a booking
app.get('/api/payments/booking/:bookingId', requireAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { models } = require('./models');

    const payments = await models.Payment.find({ bookingCode: bookingId })
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    console.error('Get payment history API error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment history' });
  }
});

// Get all payments
app.get('/api/payments', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const { models } = require('./models');

    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const payments = await models.Payment.find(query)
      .populate('customerId', 'name phone')
      .populate('bookingId', 'bookingId pickupLocation dropLocation vehicleType')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(offset);

    const total = await models.Payment.countDocuments(query);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get payments API error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payments' });
  }
});

// Get individual payment details
app.get('/api/payments/:paymentId', requireAuth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { models } = require('./models');

    const payment = await models.Payment.findById(paymentId)
      .populate('customerId', 'name phone email')
      .populate('bookingId', 'bookingId pickupLocation dropLocation vehicleType customerName customerPhone');

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment details API error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payment details' });
  }
});

// Mark payment as completed
app.post('/api/payments/:paymentId/mark-completed', requireAuth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { models } = require('./models');

    const payment = await models.Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    // Update related booking
    if (payment.bookingId) {
      await models.Booking.findByIdAndUpdate(payment.bookingId, {
        isPaid: true,
        paymentStatus: 'paid',
        paymentDate: new Date(),
        paymentAmount: payment.amount
      });
    }

    res.json({
      success: true,
      message: 'Payment marked as completed'
    });
  } catch (error) {
    console.error('Mark payment completed API error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark payment as completed' });
  }
});

// API endpoint to get connection status with detailed info
app.get('/api/connection-status', requireAuth, (req, res) => {
  try {
    const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');
    const qrFilePath = path.join(__dirname, '../data/whatsapp-qr.json');

    let connectionState = {
      state: 'unknown',
      isReady: false,
      isAuthenticated: false,
      connectedNumber: null,
      lastHeartbeat: null,
      lastUpdate: new Date().toISOString()
    };

    let qrData = null;

    // Load connection state
    if (fs.existsSync(connectionStateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));
        connectionState = { ...connectionState, ...state };
      } catch (error) {
        console.log('Error reading connection state:', error.message);
      }
    }

    // Load QR data if available
    if (fs.existsSync(qrFilePath)) {
      try {
        qrData = JSON.parse(fs.readFileSync(qrFilePath, 'utf8'));
      } catch (error) {
        console.log('Error reading QR data:', error.message);
      }
    }

    // Determine status message
    let statusMessage = 'Unknown status';
    let statusColor = 'gray';

    switch (connectionState.state) {
      case 'connected':
      case 'ready':
        statusMessage = `Connected as ${connectionState.connectedNumber || 'Unknown'}`;
        statusColor = 'green';
        break;
      case 'connecting':
        statusMessage = 'Connecting to WhatsApp...';
        statusColor = 'yellow';
        break;
      case 'initializing':
        statusMessage = 'Generating QR code...';
        statusColor = 'blue';
        break;
      case 'disconnected':
        statusMessage = 'Disconnected - Ready for new connection';
        statusColor = 'red';
        break;
      case 'error':
        statusMessage = 'Connection error - Check logs';
        statusColor = 'red';
        break;
      default:
        statusMessage = 'Status unknown';
        statusColor = 'gray';
    }

    res.json({
      success: true,
      connectionState: {
        ...connectionState,
        statusMessage,
        statusColor,
        qrData: qrData ? {
          qrCode: qrData.qrCode,
          age: qrData.age || 0,
          status: qrData.status || 'unknown',
          attempt: qrData.attempt || 0,
          maxRetries: qrData.maxRetries || 15,
          expiresAt: qrData.expiresAt,
          timestamp: qrData.timestamp
        } : null
      }
    });
  } catch (error) {
    console.error('Error getting connection status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get connection status',
      connectionState: {
        state: 'error',
        isReady: false,
        isAuthenticated: false,
        connectedNumber: null,
        lastHeartbeat: null,
        statusMessage: 'Error loading status',
        statusColor: 'red'
      }
    });
  }
});

// API endpoint to get WhatsApp connection state
app.get('/api/whatsapp/state', requireAuth, (req, res) => {
  try {
    // Use the global bot instance if available
    if (global.mainBot && typeof global.mainBot.getConnectionState === 'function') {
      const state = global.mainBot.getConnectionState();
      res.json({
        success: true,
        connectionState: state
      });
      return;
    }

    // Check connection state file first
    const connectionStateFile = path.join(__dirname, '../data/whatsapp-connection-state.json');

    if (fs.existsSync(connectionStateFile)) {
      const connectionState = JSON.parse(fs.readFileSync(connectionStateFile, 'utf8'));

      // Check if state is recent (within last 5 minutes)
      const stateAge = Date.now() - new Date(connectionState.lastUpdate).getTime();
      if (stateAge < 300000) { // 5 minutes
        res.json({
          success: true,
          connectionState: connectionState
        });
        return;
      }
    }

    // Fallback to service in-memory state plus session file validation
    const whatsappService = require('./services/whatsappService');
    let state = whatsappService.getConnectionState();

    // If service reports not ready but we have a valid session on disk, surface 'connected'
    try {
      const hasSession = whatsappService.checkExistingSession && whatsappService.checkExistingSession();
      if (!state.isReady && hasSession) {
        state = {
          ...state,
          state: 'connected',
          isAuthenticated: true
        };
      }
    } catch (_) { }

    res.json({
      success: true,
      connectionState: state
    });
  } catch (error) {
    res.json({
      success: true,
      connectionState: {
        state: 'unknown',
        isReady: false,
        isAuthenticated: false,
        connectedNumber: null,
        lastHeartbeat: null
      }
    });
  }
});

// Whitelist Management APIs
const userManager = require('./services/userManager');

// Get whitelisted numbers
app.get('/api/whitelist', requireAuth, (req, res) => {
  try {
    const numbers = userManager.getWhitelistedNumbers();
    res.json({
      success: true,
      whitelistedNumbers: numbers
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get whitelisted numbers' });
  }
});

// Add number to whitelist
app.post('/api/whitelist/add', requireAuth, (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const success = userManager.addToWhitelist(phoneNumber);

    if (success) {
      res.json({ success: true, message: 'Number added to whitelist' });
    } else {
      res.status(500).json({ error: 'Failed to add number to whitelist' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to add number to whitelist' });
  }
});

// Remove number from whitelist
app.delete('/api/whitelist/remove/:phoneNumber', requireAuth, (req, res) => {
  try {
    const { phoneNumber } = req.params;

    const success = userManager.removeFromWhitelist(phoneNumber);

    if (success) {
      res.json({ success: true, message: 'Number removed from whitelist' });
    } else {
      res.status(500).json({ error: 'Failed to remove number from whitelist' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove number from whitelist' });
  }
});

// Bulk update whitelist
app.put('/api/whitelist/bulk', requireAuth, (req, res) => {
  try {
    const { numbers } = req.body;

    if (!Array.isArray(numbers)) {
      return res.status(400).json({ error: 'Numbers array is required' });
    }

    const success = userManager.bulkUpdateWhitelist(numbers);

    if (success) {
      res.json({ success: true, message: 'Whitelist updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update whitelist' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update whitelist' });
  }
});

// Flow Management APIs
app.get('/api/flows', requireAuth, (req, res) => {
  try {
    const flowsFile = path.join(__dirname, '../data/conversation-flows.json');
    let flows = [];

    if (fs.existsSync(flowsFile)) {
      flows = JSON.parse(fs.readFileSync(flowsFile, 'utf8'));
    }

    res.json({
      success: true,
      flows: flows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load flows' });
  }
});

app.post('/api/flows/save', requireAuth, (req, res) => {
  try {
    const flow = req.body;
    const flowsFile = path.join(__dirname, '../data/conversation-flows.json');

    let flows = [];
    if (fs.existsSync(flowsFile)) {
      flows = JSON.parse(fs.readFileSync(flowsFile, 'utf8'));
    }

    // Update existing flow or add new one
    const existingIndex = flows.findIndex(f => f.id === flow.id);
    if (existingIndex >= 0) {
      flows[existingIndex] = flow;
    } else {
      flows.push(flow);
    }

    // Ensure data directory exists
    const dataDir = path.dirname(flowsFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(flowsFile, JSON.stringify(flows, null, 2));

    res.json({ success: true, message: 'Flow saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save flow' });
  }
});

app.delete('/api/flows/delete/:flowId', requireAuth, (req, res) => {
  try {
    const { flowId } = req.params;
    const flowsFile = path.join(__dirname, '../data/conversation-flows.json');

    if (!fs.existsSync(flowsFile)) {
      return res.status(404).json({ error: 'No flows found' });
    }

    let flows = JSON.parse(fs.readFileSync(flowsFile, 'utf8'));
    flows = flows.filter(f => f.id !== flowId);

    fs.writeFileSync(flowsFile, JSON.stringify(flows, null, 2));

    res.json({ success: true, message: 'Flow deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete flow' });
  }
});

// Get all flows
app.get('/api/flows', requireAuth, (req, res) => {
  try {
    const flowsFile = path.join(__dirname, '../data/conversation-flows.json');
    let flows = [];

    if (fs.existsSync(flowsFile)) {
      flows = JSON.parse(fs.readFileSync(flowsFile, 'utf8'));
    }

    res.json({ success: true, flows });
  } catch (error) {
    console.error('Error loading flows:', error);
    res.status(500).json({ success: false, error: 'Failed to load flows', flows: [] });
  }
});

// Get flow templates
app.get('/api/flows/templates/:templateType', requireAuth, (req, res) => {
  try {
    const { templateType } = req.params;
    let template;

    switch (templateType) {
      case 'booking':
        template = {
          id: 'booking_template_' + Date.now(),
          name: 'Booking Flow Template',
          description: 'Complete chauffeur booking conversation flow',
          steps: [
            {
              id: 'greeting',
              type: 'message',
              content: '🚗 Welcome to Preimo Chauffeur Services! How can I assist you today?',
              nextStep: 'service_selection'
            },
            {
              id: 'service_selection',
              type: 'question',
              content: 'What type of service do you need?\n\n1️⃣ Airport Transfer\n2️⃣ City Tour\n3️⃣ Business Meeting\n4️⃣ Special Event\n\nPlease type the number of your choice:',
              conditions: [
                { input: '1', nextStep: 'airport_details' },
                { input: '2', nextStep: 'tour_details' },
                { input: '3', nextStep: 'business_details' },
                { input: '4', nextStep: 'event_details' }
              ],
              nextStep: 'pickup_location'
            },
            {
              id: 'pickup_location',
              type: 'question',
              content: '📍 Please provide your pickup location:',
              nextStep: 'destination'
            },
            {
              id: 'destination',
              type: 'question',
              content: '🎯 Where would you like to go?',
              nextStep: 'pickup_time'
            },
            {
              id: 'pickup_time',
              type: 'question',
              content: '⏰ When do you need the pickup? (Please provide date and time)',
              nextStep: 'vehicle_type'
            },
            {
              id: 'vehicle_type',
              type: 'question',
              content: '🚙 Choose your vehicle type:\n\n1️⃣ Economy Sedan\n2️⃣ Luxury Sedan\n3️⃣ SUV\n4️⃣ Van (up to 8 passengers)\n\nPlease type the number:',
              conditions: [
                { input: '1', nextStep: 'passenger_count' },
                { input: '2', nextStep: 'passenger_count' },
                { input: '3', nextStep: 'passenger_count' },
                { input: '4', nextStep: 'passenger_count' }
              ],
              nextStep: 'passenger_count'
            },
            {
              id: 'passenger_count',
              type: 'question',
              content: '👥 How many passengers will be traveling?',
              nextStep: 'customer_name'
            },
            {
              id: 'customer_name',
              type: 'question',
              content: '📝 Please provide your name for the booking:',
              nextStep: 'confirmation'
            },
            {
              id: 'confirmation',
              type: 'message',
              content: '✅ Thank you! Your booking request has been received. We will send you a confirmation with pricing and payment details shortly.',
              nextStep: null
            }
          ],
          triggers: ['book', 'booking', 'ride', 'car', 'chauffeur'],
          isActive: true
        };
        break;

      case 'support':
        template = {
          id: 'support_template_' + Date.now(),
          name: 'Customer Support Flow',
          description: 'Handle customer support inquiries',
          steps: [
            {
              id: 'support_greeting',
              type: 'message',
              content: '👋 Hello! I\'m here to help you with any questions or concerns.',
              nextStep: 'support_menu'
            },
            {
              id: 'support_menu',
              type: 'question',
              content: 'How can I assist you today?\n\n1️⃣ Track my booking\n2️⃣ Modify my booking\n3️⃣ Cancel my booking\n4️⃣ Pricing information\n5️⃣ Other inquiry\n\nPlease type the number:',
              conditions: [
                { input: '1', nextStep: 'track_booking' },
                { input: '2', nextStep: 'modify_booking' },
                { input: '3', nextStep: 'cancel_booking' },
                { input: '4', nextStep: 'pricing_info' },
                { input: '5', nextStep: 'other_inquiry' }
              ],
              nextStep: 'other_inquiry'
            },
            {
              id: 'track_booking',
              type: 'question',
              content: '🔍 Please provide your booking ID or phone number to track your booking:',
              nextStep: 'track_result'
            },
            {
              id: 'track_result',
              type: 'message',
              content: '📊 I\'ve found your booking! Let me get the details for you...',
              nextStep: null
            },
            {
              id: 'other_inquiry',
              type: 'question',
              content: '💬 Please describe your question or concern, and I\'ll do my best to help:',
              nextStep: 'inquiry_response'
            },
            {
              id: 'inquiry_response',
              type: 'message',
              content: '🙏 Thank you for your inquiry. Our team will review your message and respond shortly.',
              nextStep: null
            }
          ],
          triggers: ['help', 'support', 'question', 'issue', 'problem'],
          isActive: true
        };
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid template type. Available: booking, support'
        });
    }

    res.json({ success: true, template });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create template'
    });
  }
});

// Payment Gateway APIs
app.get('/api/payments/gateways', requireAuth, async (req, res) => {
  try {
    console.log('🔍 Payment gateways request received');

    // For now, return default gateways to fix the immediate issue
    const defaultGateways = [
      { name: 'stripe', displayName: 'Stripe', enabled: false, isDefault: false, config: {} },
      { name: 'paypal', displayName: 'PayPal', enabled: true, isDefault: true, config: {} },
      { name: 'cash', displayName: 'Cash', enabled: true, isDefault: false, config: {} }
    ];

    // Also return keyed object for backward-compat with dashboard JS expecting Object.entries()
    const keyed = defaultGateways.reduce((acc, g) => {
      acc[g.name] = { enabled: g.enabled, isDefault: g.isDefault, config: g.config };
      return acc;
    }, {});

    console.log('✅ Returning default gateways');
    return res.json({ success: true, gateways: defaultGateways, ...keyed });


  } catch (error) {
    console.error('Error loading payment gateways:', error);
    res.status(500).json({ error: 'Failed to load payment gateways' });
  }
});

app.post('/api/payments/gateways', requireAuth, async (req, res) => {
  try {
    const { gateways } = req.body;

    // Check database connection
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    // Convert gateways array to payment settings format
    const paymentSettings = {
      defaultGateway: 'paypal', // Default
      paypalEnabled: false,
      stripeEnabled: false,
      cashEnabled: false,
      paypalClientId: '',
      paypalClientSecret: '',
      stripePublishableKey: '',
      stripeSecretKey: '',
      currency: 'AED',
      minimumPayout: 100,
      autoPayout: false,
      payoutSchedule: 'weekly',
      refundPolicy: {
        allowed: true,
        timeLimit: 24,
        percentage: 100
      }
    };

    // Update based on gateways configuration
    gateways.forEach(gateway => {
      if (gateway.name === 'paypal') {
        paymentSettings.paypalEnabled = gateway.enabled;
        if (gateway.isDefault) paymentSettings.defaultGateway = 'paypal';
        if (gateway.config.clientId) paymentSettings.paypalClientId = gateway.config.clientId;
        if (gateway.config.clientSecret) paymentSettings.paypalClientSecret = gateway.config.clientSecret;
      } else if (gateway.name === 'stripe') {
        paymentSettings.stripeEnabled = gateway.enabled;
        if (gateway.isDefault) paymentSettings.defaultGateway = 'stripe';
        if (gateway.config.publishableKey) paymentSettings.stripePublishableKey = gateway.config.publishableKey;
        if (gateway.config.secretKey) paymentSettings.stripeSecretKey = gateway.config.secretKey;
      } else if (gateway.name === 'cash') {
        paymentSettings.cashEnabled = gateway.enabled;
        if (gateway.isDefault) paymentSettings.defaultGateway = 'cash';
      }
    });

    // Save to database
    await configManagementService.setConfig('PAYMENT_SETTINGS', paymentSettings, 'Payment gateway configuration');

    res.json({ success: true, message: 'Payment gateways saved successfully' });
  } catch (error) {
    console.error('Error saving payment gateways:', error);
    res.status(500).json({ error: 'Failed to save payment gateways' });
  }
});

app.post('/api/payments/send-link', requireAuth, (req, res) => {
  try {
    const { bookingId, gateway } = req.body;

    // Load booking data
    const bookingsFile = path.join(__dirname, '../data/booking-sessions.json');
    if (!fs.existsSync(bookingsFile)) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingsData = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));
    const booking = Object.values(bookingsData.sessions || {}).find(s => s.bookingId === bookingId);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Generate payment link (mock implementation)
    const paymentLink = `https://payment.example.com/${gateway}/${bookingId}?amount=${booking.data?.estimatedCost || 100}`;

    // In a real implementation, you would:
    // 1. Use the selected gateway's API to create a payment link
    // 2. Send the link via WhatsApp to the customer
    // 3. Store the payment link reference

    console.log(`📧 Payment link generated for booking ${bookingId}:`, paymentLink);
    console.log(`💰 Amount: AED ${booking.data?.estimatedCost || 100}`);
    console.log(`📱 Customer: ${booking.phoneNumber}`);

    // Simulate sending WhatsApp message with payment link
    const paymentMessage = `💳 *Payment Link*\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Amount: AED ${booking.data?.estimatedCost || 100}\n\n` +
      `Click here to pay: ${paymentLink}\n\n` +
      `This link will expire in 24 hours.\n` +
      `For any issues, contact support.`;

    // Here you would actually send the WhatsApp message
    // await whatsapp.sendMessage(booking.phoneNumber + '@c.us', paymentMessage);

    res.json({
      success: true,
      message: 'Payment link sent successfully',
      paymentLink: paymentLink
    });
  } catch (error) {
    console.error('Error sending payment link:', error);
    res.status(500).json({ error: 'Failed to send payment link' });
  }
});

app.post('/api/bookings/mark-paid', requireAuth, (req, res) => {
  try {
    const { bookingId } = req.body;

    // Load booking data
    const bookingsFile = path.join(__dirname, '../data/booking-sessions.json');
    if (!fs.existsSync(bookingsFile)) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingsData = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));

    // Find and update booking
    let bookingFound = false;
    Object.keys(bookingsData.sessions || {}).forEach(sessionId => {
      if (bookingsData.sessions[sessionId].bookingId === bookingId) {
        bookingsData.sessions[sessionId].status = 'paid';
        bookingsData.sessions[sessionId].paidAt = new Date().toISOString();
        bookingFound = true;
      }
    });

    if (!bookingFound) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Save updated data
    fs.writeFileSync(bookingsFile, JSON.stringify(bookingsData, null, 2));

    // Emit update to connected clients
    io.emit('bookingsUpdate', bookingsData);

    res.json({ success: true, message: 'Booking marked as paid' });
  } catch (error) {
    console.error('Error marking booking as paid:', error);
    res.status(500).json({ error: 'Failed to mark booking as paid' });
  }
});

// Pricing Configuration APIs - Now using database
app.get('/api/pricing/rates', requireAuth, async (req, res) => {
  try {
    const configManagementService = require('./services/configManagementService');
    const pricingConfig = await configManagementService.getConfig('PRICING_CONFIG', {});

    res.json({ success: true, rates: pricingConfig });
  } catch (error) {
    console.error('Error loading pricing rates:', error);
    res.status(500).json({ success: false, error: 'Failed to load pricing rates' });
  }
});

app.post('/api/pricing/save', requireAuth, async (req, res) => {
  try {
    const pricingConfig = req.body;
    const configManagementService = require('./services/configManagementService');

    // Save to database
    await configManagementService.setConfig('PRICING_CONFIG', pricingConfig, 'Pricing and rates configuration');

    // Notify connected clients about the update
    io.emit('pricingConfigUpdated', pricingConfig);

    // Update bot configuration if available
    if (global.mainBot && global.mainBot.updatePricingConfig) {
      global.mainBot.updatePricingConfig(pricingConfig);
    }

    res.json({ success: true, message: 'Pricing configuration saved successfully' });
  } catch (error) {
    console.error('Error saving pricing configuration:', error);
    res.status(500).json({ success: false, error: 'Failed to save pricing configuration' });
  }
});

// AI Prompts Configuration APIs - Now using database
app.get('/api/prompts', requireAuth, async (req, res) => {
  try {
    const configManagementService = require('./services/configManagementService');
    const prompts = await configManagementService.getConfig('AI_PROMPTS', {});

    res.json({ success: true, prompts });
  } catch (error) {
    console.error('Error loading AI prompts:', error);
    res.status(500).json({ success: false, error: 'Failed to load AI prompts' });
  }
});

app.post('/api/prompts/save', requireAuth, async (req, res) => {
  try {
    const prompts = req.body;
    const configManagementService = require('./services/configManagementService');

    // Save to database
    await configManagementService.setConfig('AI_PROMPTS', prompts, 'AI prompts configuration');

    // Notify connected clients about the update
    io.emit('promptsConfigUpdated', prompts);

    // Update bot configuration if available
    if (global.mainBot && global.mainBot.updatePromptsConfig) {
      global.mainBot.updatePromptsConfig(prompts);
    }

    res.json({ success: true, message: 'AI prompts saved successfully' });
  } catch (error) {
    console.error('Error saving AI prompts:', error);
    res.status(500).json({ success: false, error: 'Failed to save AI prompts' });
  }
});

// Payment Gateways Configuration APIs
app.post('/api/payments/save', requireAuth, (req, res) => {
  try {
    const gateways = req.body;
    const gatewaysFile = path.join(__dirname, '../data/payment-gateways.json');

    // Ensure data directory exists
    const dataDir = path.dirname(gatewaysFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save payment gateways configuration
    fs.writeFileSync(gatewaysFile, JSON.stringify(gateways, null, 2));

    // Notify connected clients about the update
    io.emit('paymentConfigUpdated', gateways);

    // Update bot configuration if available
    if (global.mainBot && global.mainBot.updatePaymentConfig) {
      global.mainBot.updatePaymentConfig(gateways);
    }

    res.json({ success: true, message: 'Payment gateways saved successfully' });
  } catch (error) {
    console.error('Error saving payment gateways:', error);
    res.status(500).json({ success: false, error: 'Failed to save payment gateways' });
  }
});

// Calculate price based on configuration
app.post('/api/pricing/calculate', requireAuth, (req, res) => {
  try {
    const { vehicleType, distance, duration, pickupTime, isAirport, passengers } = req.body;

    // Load pricing configuration
    const pricingFile = path.join(__dirname, '../data/pricing-config.json');
    let pricingConfig = {};

    if (fs.existsSync(pricingFile)) {
      pricingConfig = JSON.parse(fs.readFileSync(pricingFile, 'utf8'));
    }

    // Get vehicle rates
    const vehicleRates = pricingConfig.rates?.[vehicleType] || pricingConfig.rates?.economy || {};
    const calculation = pricingConfig.calculation || {};
    const surcharges = pricingConfig.surcharges || {};
    const discounts = pricingConfig.discounts || {};

    if (!vehicleRates.enabled) {
      return res.status(400).json({
        success: false,
        error: `${vehicleType} vehicle type is not available`
      });
    }

    // Base calculation
    let totalPrice = 0;
    const breakdown = {};

    // Time-based calculation
    const minDuration = calculation.minBookingDuration || 1;
    const actualDuration = Math.max(duration || minDuration, minDuration);
    const timeCharge = actualDuration * vehicleRates.baseRate;
    breakdown.timeCharge = timeCharge;
    totalPrice += timeCharge;

    // Distance-based calculation
    if (distance > 0) {
      const distanceCharge = distance * vehicleRates.kmRate;
      breakdown.distanceCharge = distanceCharge;
      totalPrice += distanceCharge;
    }

    // Minimum fare check
    if (totalPrice < vehicleRates.minFare) {
      breakdown.minimumFareAdjustment = vehicleRates.minFare - totalPrice;
      totalPrice = vehicleRates.minFare;
    }

    // Airport surcharge
    if (isAirport && calculation.airportSurcharge > 0) {
      breakdown.airportSurcharge = calculation.airportSurcharge;
      totalPrice += calculation.airportSurcharge;
    }

    // Night surcharge
    if (surcharges.night?.enabled && pickupTime) {
      const pickupHour = new Date(pickupTime).getHours();
      const nightStart = parseInt(surcharges.night.startTime.split(':')[0]);
      const nightEnd = parseInt(surcharges.night.endTime.split(':')[0]);

      const isNightTime = nightStart > nightEnd ?
        (pickupHour >= nightStart || pickupHour < nightEnd) :
        (pickupHour >= nightStart && pickupHour < nightEnd);

      if (isNightTime) {
        const nightSurcharge = totalPrice * (surcharges.night.rate / 100);
        breakdown.nightSurcharge = nightSurcharge;
        totalPrice += nightSurcharge;
      }
    }

    // Weekend surcharge
    if (surcharges.weekend?.enabled && pickupTime) {
      const pickupDay = new Date(pickupTime).getDay();
      const isWeekend = (
        (pickupDay === 5 && surcharges.weekend.friday) ||
        (pickupDay === 6 && surcharges.weekend.saturday) ||
        (pickupDay === 0 && surcharges.weekend.sunday)
      );

      if (isWeekend) {
        const weekendSurcharge = totalPrice * (surcharges.weekend.rate / 100);
        breakdown.weekendSurcharge = weekendSurcharge;
        totalPrice += weekendSurcharge;
      }
    }

    // Service fee
    if (calculation.serviceFeePercentage > 0) {
      const serviceFee = totalPrice * (calculation.serviceFeePercentage / 100);
      breakdown.serviceFee = serviceFee;
      totalPrice += serviceFee;
    }

    // VAT/Tax
    if (calculation.vatPercentage > 0) {
      const vat = totalPrice * (calculation.vatPercentage / 100);
      breakdown.vat = vat;
      totalPrice += vat;
    }

    const result = {
      success: true,
      vehicleType,
      totalPrice: Math.round(totalPrice * 100) / 100,
      currency: pricingConfig.currency || 'AED',
      breakdown,
      calculatedAt: new Date().toISOString()
    };

    res.json(result);
  } catch (error) {
    console.error('Error calculating price:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate price' });
  }
});

// Error handling middleware (must be after all routes)
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// MISSING API ENDPOINTS - ADDING CRITICAL ONES
// =============================================================================

// Get bookings from database
app.get('/api/bookings/database', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { status, dateFrom, dateTo, limit = 50, page = 1 } = req.query;

    let query = {};

    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Apply date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const bookings = await models.Booking.find(query)
      .populate('customerId', 'name phone email')
      .populate('referrerId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await models.Booking.countDocuments(query);

    res.json({
      success: true,
      bookings: bookings,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('Error loading bookings from database:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load bookings',
      bookings: [],
      total: 0
    });
  }
});

// Create new booking
app.post('/api/bookings/create', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const bookingData = req.body;

    // Create customer if not exists
    let customer = await models.Customer.findOne({ phone: bookingData.customerPhone });
    if (!customer) {
      customer = await models.Customer.create({
        name: bookingData.customerName,
        phone: bookingData.customerPhone,
        email: bookingData.customerEmail || null
      });
    }

    // Link to concierge if provided
    let referrerId = null;
    if (bookingData.conciergeId) {
      const concierge = await models.Concierge.findById(bookingData.conciergeId).lean();
      if (concierge) referrerId = concierge._id;
    }

    // Create booking
    const booking = await models.Booking.create({
      customerId: customer._id,
      customerName: bookingData.customerName,
      customerPhone: bookingData.customerPhone,
      pickupLocation: bookingData.pickupLocation,
      dropLocation: bookingData.dropLocation,
      pickupTime: new Date(bookingData.pickupTime),
      vehicleType: bookingData.vehicleType,
      numberOfPassengers: bookingData.numberOfPassengers || 1,
      bookingAmount: bookingData.bookingAmount,
      baseFare: bookingData.baseFare,
      distanceFare: bookingData.distanceFare,
      timeFare: bookingData.timeFare,
      subtotal: bookingData.subtotal,
      bookingAmount: bookingData.bookingAmount,
      referrerId,
      referrerCommissionRate: bookingData.referrerCommissionRate || 10,
      status: 'pending',
      paymentStatus: 'pending',
      isPaid: false
    });

    res.json({
      success: true,
      booking: booking,
      message: 'Booking created successfully'
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking'
    });
  }
});

// Update/edit booking
app.put('/api/bookings/:bookingId', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { bookingId } = req.params;
    const updates = req.body || {};

    // Disallow updates to immutable identifiers
    delete updates._id;
    delete updates.id;
    delete updates.bookingId;
    delete updates.customerId;

    // Map concierge if provided
    if (updates.conciergeId) {
      const concierge = await models.Concierge.findById(updates.conciergeId).lean();
      updates.referrerId = concierge ? concierge._id : null;
      delete updates.conciergeId;
    }

    const booking = await models.Booking.findOneAndUpdate(
      { bookingId },
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    res.json({ success: true, booking, message: 'Booking updated successfully' });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ success: false, error: 'Failed to update booking' });
  }
});

// Send payment link for specific booking
app.post('/api/bookings/:bookingId/payment-link', requireAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { amount, description } = req.body || {};
    const { models } = require('./models');

    const booking = await models.Booking.findOne({ bookingId });
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const paymentService = require('./services/paymentService');
    const result = await paymentService.generatePaymentLink({
      bookingId: booking.bookingId,
      amount: amount || booking.bookingAmount,
      description: description || `Booking #${booking.bookingId} - ${booking.vehicleType}`,
      vehicleType: booking.vehicleType,
      pickupLocation: booking.pickupLocation,
      dropLocation: booking.dropLocation,
      pickupTime: booking.pickupTime
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Payment link failed' });
    }

    // Notify customer and concierge with payment link
    try {
      const whatsappService = require('./services/whatsappService');
      const paymentMsg = `💳 Payment link for booking ${booking.bookingId}:\n${result.paymentLink}\nThis link will expire in 24 hours.`;
      await whatsappService.sendMessage(`${booking.customerPhone}@c.us`, paymentMsg);
      if (booking.referrerId) {
        const concierge = await models.Concierge.findById(booking.referrerId);
        if (concierge?.phone) {
          await whatsappService.sendMessage(`${concierge.phone}@c.us`, `📨 Payment link sent to customer for booking ${booking.bookingId}.`);
        }
      }
    } catch (_) { }

    res.json({ success: true, paymentLink: result.paymentLink, paymentId: result.paymentId });
  } catch (error) {
    console.error('Error sending booking payment link:', error);
    res.status(500).json({ success: false, error: 'Failed to send payment link' });
  }
});

// Mark booking as paid
app.post('/api/bookings/mark-paid', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { bookingId, paymentMethod = 'paypal', transactionId } = req.body;

    const booking = await models.Booking.findOne({ bookingId });
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    booking.isPaid = true;
    booking.paymentStatus = 'paid';
    booking.paymentMethod = paymentMethod;
    booking.paypalTxnId = transactionId;
    booking.paymentDate = new Date();
    await booking.save();

    // Create commission if there's a referrer
    if (booking.referrerId) {
      const bookingEngine = require('./services/bookingEngineService');
      await bookingEngine.createCommissionRecord(booking);
    }

    res.json({
      success: true,
      message: 'Booking marked as paid successfully'
    });
  } catch (error) {
    console.error('Error marking booking as paid:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark booking as paid'
    });
  }
});

// Mark booking as paid (RESTful by bookingId)
app.post('/api/bookings/:bookingId/mark-paid', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { bookingId } = req.params;
    const { paymentMethod = 'cash', transactionId } = req.body || {};

    const booking = await models.Booking.findOne({ bookingId });
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    booking.isPaid = true;
    booking.paymentStatus = 'paid';
    booking.paymentMethod = paymentMethod;
    if (transactionId) booking.paypalTxnId = transactionId;
    booking.paymentDate = new Date();
    await booking.save();

    // Handle concierge referral and commission if applicable
    if (booking.referrerId) {
      try {
        const conciergeService = require('./services/conciergeService');
        const commissionData = await conciergeService.calculateCommission(booking.bookingId, booking.referrerId);
        if (commissionData) {
          await conciergeService.createCommissionRecord(commissionData);
          console.log(`✅ Commission record created for concierge ${booking.referrerId} via manual mark-paid`);
        }
      } catch (commissionError) {
        console.warn('⚠️ Commission creation failed in manual mark-paid:', commissionError.message);
      }
    }

    // Notify customer and concierge (if available)
    try {
      const whatsappService = require('./services/whatsappService');
      const msg = `✅ Payment received for booking ${booking.bookingId}. Thank you!`;
      await whatsappService.sendMessage(`${booking.customerPhone}@c.us`, msg);
      if (booking.referrerId) {
        const concierge = await models.Concierge.findById(booking.referrerId);
        if (concierge?.phone) {
          await whatsappService.sendMessage(`${concierge.phone}@c.us`, `💰 Booking ${booking.bookingId} marked paid. Commission will be processed.`);
        }
      }
    } catch (_) { }

    res.json({ success: true, message: 'Booking marked as paid' });
  } catch (error) {
    console.error('Error marking booking as paid (REST):', error);
    res.status(500).json({ success: false, error: 'Failed to mark booking as paid' });
  }
});

// Get payment status
app.get('/api/payments/status/:bookingId', requireAuth, async (req, res) => {
  try {
    const { models } = require('./models');
    const { bookingId } = req.params;

    const booking = await models.Booking.findOne({ bookingId });
    const payment = await models.Payment
      .findOne(booking ? { bookingId: booking._id } : { bookingCode: bookingId })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      booking: {
        bookingId: booking ? booking.bookingId : bookingId,
        isPaid: booking ? booking.isPaid : false,
        paymentStatus: booking ? booking.paymentStatus : 'pending',
        paymentMethod: booking ? booking.paymentMethod : undefined,
        paypalTxnId: booking ? booking.paypalTxnId : undefined,
        paymentDate: booking ? booking.paymentDate : undefined
      },
      payment: payment ? {
        paymentId: payment.paymentId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        paypalOrderId: payment.paypalOrderId,
        paypalTransactionId: payment.paypalTransactionId,
        createdAt: payment.createdAt,
        completedAt: payment.completedAt
      } : null
    });
  } catch (error) {
    console.error('Error getting payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment status'
    });
  }
});

// Send payment link
app.post('/api/payments/send-link', requireAuth, async (req, res) => {
  try {
    const { bookingId, amount, description } = req.body;

    // Get booking details from database first
    const { models } = require('./models');
    const booking = await models.Booking.findOne({ bookingId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    // Generate payment link using PayPal
    const paymentService = require('./services/paymentService');
    const paymentData = {
      bookingId: booking.bookingId,
      amount: amount || booking.bookingAmount,
      vehicleType: booking.vehicleType,
      pickupLocation: booking.pickupLocation,
      dropLocation: booking.dropLocation,
      pickupTime: booking.pickupTime,
      description: description || `Preimo Chauffeur Service - ${booking.vehicleType} from ${booking.pickupLocation} to ${booking.dropLocation}`
    };

    const result = await paymentService.generatePaymentLink(paymentData);

    if (result.success) {
      res.json({
        success: true,
        paymentLink: result.paymentLink,
        paymentId: result.paymentId,
        message: 'Payment link generated successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to generate payment link',
        fallbackMessage: result.fallbackMessage
      });
    }
  } catch (error) {
    console.error('Error generating payment link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate payment link'
    });
  }
});

// Payment routes
app.get('/payment/success', async (req, res) => {
  try {
    const { booking_id, paymentId, PayerID, token } = req.query;

    if (!paymentId || !PayerID) {
      return res.redirect(`/payment/cancel?booking_id=${booking_id}&error=missing_params`);
    }

    // Execute the payment
    const paypalService = require('./services/paypalService');
    const result = await paypalService.executePayment(paymentId || token, PayerID);

    if (result.success) {
      // Update booking status
      const { models } = require('./models');
      const booking = await models.Booking.findOne({ bookingId: booking_id });

      if (booking) {
        booking.markAsPaid(result.transactionId, booking.bookingAmount);
        await booking.save();

        // Create commission if there's a referrer
        if (booking.referrerId) {
          const bookingEngine = require('./services/bookingEngineService');
          await bookingEngine.createCommissionRecord(booking);
        }
      }

      res.send(`
        <html>
          <head><title>Payment Successful</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: green;">✅ Payment Successful!</h1>
            <p>Your booking <strong>${booking_id}</strong> has been confirmed.</p>
            <p>Transaction ID: <strong>${result.transactionId}</strong></p>
            <p>You will receive a confirmation message on WhatsApp shortly.</p>
            <button onclick="window.close()" style="padding: 10px 20px; background: #007cba; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
          </body>
        </html>
      `);
    } else {
      res.redirect(`/payment/cancel?booking_id=${booking_id}&error=execution_failed`);
    }
  } catch (error) {
    console.error('Payment success error:', error);
    res.redirect(`/payment/cancel?booking_id=${req.query.booking_id}&error=server_error`);
  }
});

app.get('/payment/cancel', (req, res) => {
  const { booking_id, error } = req.query;

  res.send(`
    <html>
      <head><title>Payment Cancelled</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: red;">❌ Payment Cancelled</h1>
        <p>Your payment for booking <strong>${booking_id}</strong> was not completed.</p>
        ${error ? `<p>Error: ${error}</p>` : ''}
        <p>Please contact our support team if you need assistance.</p>
        <button onclick="window.close()" style="padding: 10px 20px; background: #666; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
      </body>
    </html>
  `);
});

// PayPal Webhook listener (for asynchronous updates)
app.post('/api/paypal/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const paypalService = require('./services/paypalService');
    const verification = await paypalService.verifyWebhookSignature(req.headers, req.body.toString(), process.env.PAYPAL_WEBHOOK_ID);
    if (!verification.success) {
      return res.status(400).json({ success: false });
    }
    const result = await paypalService.processWebhookEvent(verification.event);
    return res.json({ success: true, result });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return res.status(500).json({ success: false });
  }
});

// Serve static files (must be after all routes but before 404 handler)
app.use(express.static(path.join(__dirname, '../public')));

// Finally mount payment routes to avoid clashing with earlier specific endpoints
app.use('/api/payments', paymentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    port: PORT
  });
});

// 404 handler (must be last)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Startup function with port cleanup and retry logic
async function startServer() {
  try {
    // Check if port is in use first
    const isPortInUse = await portUtils.isPortInUse(PORT);
    if (isPortInUse) {
      console.log(`⚠️ Port ${PORT} is in use, attempting to free it...`);
      await portUtils.killPortProcess(PORT);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      // Check again after cleanup
      const stillInUse = await portUtils.isPortInUse(PORT);
      if (stillInUse) {
        console.log(`⚠️ Port ${PORT} still in use after cleanup, trying alternative port...`);
        // Try to find an available port
        const availablePort = await portUtils.findAvailablePort(PORT + 1, 5);
        console.log(`🔄 Using alternative port: ${availablePort}`);
        process.env.WEB_PORT = availablePort;
        PORT = availablePort;
      }
    }

    // Initialize data directory structure
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    console.log('✅ Data directory structure initialized');

    // Initialize config management service
    await configManagementService.initialize();
    console.log('✅ Config management service initialized');

    console.log('🚀 Web server startup sequence initiated');

    // Start server with retry logic
    let retryCount = 0;
    const maxRetries = 3;
    
    const tryStartServer = () => {
      return new Promise((resolve, reject) => {
        const serverInstance = server.listen(PORT, () => {
          console.log(`🌐 Web server running on http://localhost:${PORT}`);
          console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
          const shownPassword = process.env.ADMIN_PASSWORD || 'chauffeur2024';
          console.log(`🔐 Default login: ${ADMIN_CREDENTIALS.username} / ${shownPassword}`);

          // Set up QR file watcher after server starts
          setTimeout(() => {
            setupQRFileWatcher();
          }, 2000);
          
          resolve();
        });

        serverInstance.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${PORT} is still in use, retrying... (${retryCount + 1}/${maxRetries})`);
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(async () => {
                await portUtils.killPortProcess(PORT);
                await new Promise(resolve => setTimeout(resolve, 1000));
                tryStartServer().then(resolve).catch(reject);
              }, 1000);
            } else {
              reject(error);
            }
          } else {
            reject(error);
          }
        });
      });
    };

    await tryStartServer();

  } catch (error) {
    console.error('❌ Failed to start web server:', error.message);
    process.exit(1);
  }
}

// Enhanced error handling to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception in web server:', error);
  console.error('Stack trace:', error.stack);
  // Don't exit immediately, try to recover
  console.log('🔄 Attempting to recover from uncaught exception...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection in web server:', reason);
  console.error('Promise:', promise);
  // Don't exit immediately, try to recover
  console.log('🔄 Attempting to recover from unhandled rejection...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down web server gracefully...');
  server.close(() => {
    console.log('✅ Web server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down web server gracefully...');
  server.close(() => {
    console.log('✅ Web server stopped');
    process.exit(0);
  });
});

// Catch-all route for 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Start the server
startServer();

// Export for use in other modules
module.exports = { app, io, whatsappInstances, qrCodes }; 