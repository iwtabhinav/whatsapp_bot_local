#!/usr/bin/env node

const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('../lib');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const OpenAI = require('openai');
const ExcelJS = require('exceljs');
const ffmpeg = require('fluent-ffmpeg');
const mongoose = require('mongoose');
const { connectDB, models } = require('./models');
const PricingService = require('./services/PricingService');

// Import new response system
const ResponseFormatter = require('./utils/ResponseFormatter');
const AIResponseGenerator = require('./utils/AIResponseGenerator');
const ContextManager = require('./utils/ContextManager');
const SessionValidator = require('./utils/SessionValidator');

// Language detection patterns
const LANGUAGE_PATTERNS = {
    hindi: /[\u0900-\u097F]/,  // Hindi Unicode range
    arabic: /[\u0600-\u06FF]/, // Arabic Unicode range
    chinese: /[\u4E00-\u9FFF]/, // Chinese Unicode range
    russian: /[\u0400-\u04FF]/, // Cyrillic Unicode range
    urdu: /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/ // Urdu Unicode range
};

// Multilingual prompts
const BOOKING_PROMPTS = {
    en: {
        welcome: "Welcome to VIP Chauffeur Services!",
        vehicle_options: `Available vehicles:
- Sedan: AED 120 base + AED 3/km
- SUV: AED 180 base + AED 4/km
- Luxury (Maybach): AED 350 base + AED 8/km
- Van (6+ seats): AED 220 base + AED 5/km`
    },
    hi: {
        welcome: "वीआईपी शोफर सेवाओं में आपका स्वागत है!",
        vehicle_options: `उपलब्ध वाहन:
- सेडान: AED 120 बेस + AED 3/किमी
- एसयूवी: AED 180 बेस + AED 4/किमी
- लग्जरी (मेबैक): AED 350 बेस + AED 8/किमी
- वैन (6+ सीटें): AED 220 बेस + AED 5/किमी`
    },
    ar: {
        welcome: "مرحباً بكم في خدمات VIP للسائقين!",
        vehicle_options: `السيارات المتوفرة:
- سيدان: 120 درهم أساسي + 3 درهم/كم
- دفع رباعي: 180 درهم أساسي + 4 درهم/كم
- فاخرة (مايباخ): 350 درهم أساسي + 8 درهم/كم
- فان (6+ مقاعد): 220 درهم أساسي + 5 درهم/كم`
    }
};

function detectLanguage(text) {
    for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
        if (pattern.test(text)) {
            return lang === 'hindi' ? 'hi' :
                lang === 'arabic' ? 'ar' :
                    lang === 'chinese' ? 'zh' :
                        lang === 'russian' ? 'ru' :
                            lang === 'urdu' ? 'ur' : 'en';
        }
    }
    return 'en';
}

class BookingManager {
    constructor() {
        this.sessionsFile = process.env.BOOKING_SESSIONS_FILE || './booking-sessions.json';
        this.contextsFile = process.env.BOOKING_CONTEXTS_FILE || './booking-contexts.json';
        this.sessions = {};
        this.contexts = {};
        this.customerHistory = {};
        this.metadata = { lastBookingId: 0, version: "1.0" };

        this.loadData();
    }

    loadData() {
        try {
            // Load booking contexts
            if (fs.existsSync(this.contextsFile)) {
                this.contexts = JSON.parse(fs.readFileSync(this.contextsFile, 'utf8'));
            } else {
                console.log('⚠️ No booking contexts found, using defaults');
                this.initializeDefaultContexts();
            }

            // Load or initialize sessions data
            if (fs.existsSync(this.sessionsFile)) {
                const data = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
                this.sessions = data.sessions || {};
                this.customerHistory = data.customerHistory || {};
                this.metadata = data.metadata || { lastBookingId: 0, version: "1.0" };
            } else {
                this.saveData();
            }
        } catch (error) {
            console.error('❌ Error loading booking data:', error);
        }
    }

    initializeDefaultContexts() {
        this.contexts = {
            chauffeur: {
                name: "VIP Chauffeur Service",
                requiredFields: {
                    guestName: {
                        prompt: "What's the guest's name?",
                        validation: "^[a-zA-Z\\s]+$"
                    },
                    conciergeName: {
                        prompt: "What's your name (concierge)?",
                        validation: "^[a-zA-Z\\s]+$"
                    },
                    pickupLocation: {
                        prompt: "Where should we pick up the guest?",
                        validation: "^.+$"
                    },
                    dropLocation: {
                        prompt: "Where should we drop off the guest?",
                        validation: "^.+$"
                    },
                    pickupTime: {
                        prompt: "When should we pick up? (e.g., 'tomorrow 2pm' or '2024-01-15 14:00')",
                        validation: "^.+$"
                    },
                    vehicleType: {
                        prompt: "What type of vehicle? (Sedan, SUV, Luxury, Van)",
                        validation: "^(Sedan|SUV|Luxury|Van)$",
                        options: ["Sedan", "SUV", "Luxury", "Van"]
                    }
                },
                optionalFields: {
                    specialInstructions: {
                        prompt: "Any special instructions?",
                        validation: "^.*$"
                    }
                },
                pricing: {
                    Sedan: { base: 120, perKm: 3 },
                    SUV: { base: 180, perKm: 4 },
                    Luxury: { base: 350, perKm: 8 },
                    Van: { base: 220, perKm: 5 }
                }
            }
        };
        this.saveData();
    }

    saveData() {
        try {
            const data = {
                sessions: this.sessions,
                customerHistory: this.customerHistory,
                metadata: this.metadata
            };
            fs.writeFileSync(this.sessionsFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('❌ Error saving booking data:', error);
        }
    }

    createSession(phoneNumber, contextType = 'chauffeur') {
        // Generate truly random booking ID to avoid conflicts
        const timestamp = Date.now().toString(36); // Base36 timestamp
        const random = Math.random().toString(36).substr(2, 4); // Random string
        let bookingId = `BK${timestamp}${random}`.toUpperCase();
        
        // Also increment counter for backup/reference
        this.metadata.lastBookingId++;
        
        // Ensure uniqueness by checking if ID already exists
        while (this.sessions[bookingId]) {
            const newRandom = Math.random().toString(36).substr(2, 4);
            bookingId = `BK${timestamp}${newRandom}`.toUpperCase();
            console.log(`🔄 Collision detected, generating new ID: ${bookingId}`);
        }
        
        console.log(`🆔 Generated unique booking ID: ${bookingId} (counter backup: ${this.metadata.lastBookingId})`);

        this.sessions[bookingId] = {
            bookingId,
            phoneNumber,
            contextType,
            status: 'pending',
            data: {},
            conversation: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Initialize customer history if not exists
        if (!this.customerHistory[phoneNumber]) {
            this.customerHistory[phoneNumber] = {
                bookings: [],
                totalBookings: 0,
                lastBooking: null
            };
        }

        this.saveData();
        console.log(`💾 Saved data with counter: ${this.metadata.lastBookingId}`);
        return bookingId;
    }

    updateSession(bookingId, message, role = 'user', data = null) {
        if (!this.sessions[bookingId]) return false;

        const session = this.sessions[bookingId];

        // Add message to conversation
        session.conversation.push({
            role,
            message,
            timestamp: new Date().toISOString()
        });

        // Update booking data if provided
        if (data) {
            session.data = { ...session.data, ...data };
        }

        session.updatedAt = new Date().toISOString();
        this.saveData();
        return true;
    }

    getMissingFields(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return [];

        // Use the new booking flow logic
        const requiredFields = ['customerName', 'pickupLocation', 'passengerCount'];

        // Add booking type specific fields
        if (session.data.bookingType === 'Transfer Booking') {
            requiredFields.push('dropLocation', 'luggageInfo');
        } else if (session.data.bookingType === 'Hourly Booking') {
            requiredFields.push('numberOfHours');
        } else {
            // Default to transfer booking fields if booking type not set
            requiredFields.push('dropLocation', 'luggageInfo');
        }

        return requiredFields.filter(field => !session.data[field]);
    }

    getNextPrompt(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return null;

        const context = this.contexts[session.contextType];
        if (!context) return null;

        const missingFields = this.getMissingFields(bookingId);
        if (missingFields.length === 0) return null;

        const nextField = missingFields[0];
        return context.requiredFields[nextField].prompt;
    }

    isBookingComplete(bookingId) {
        return this.getMissingFields(bookingId).length === 0;
    }

    async getBookingSummary(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return null;

        const context = this.contexts[session.contextType];
        if (!context) return null;

        const summary = {
            bookingId: session.bookingId,
            status: session.status,
            type: context.name,
            data: session.data,
            pricing: await this.calculatePrice(session)
        };

        return summary;
    }

    async calculatePrice(session) {
        try {
            if (!session.data.vehicleType) return null;

            // Use pricing service to get database pricing
            const pricing = await this.pricingService.calculateTransferPricing(
                session.data.vehicleType,
                process.env.DEFAULT_ESTIMATED_DISTANCE || 25
            );

            if (!pricing) return null;

            return {
                base: pricing.baseRate,
                perKm: pricing.perKmRate,
                distance: pricing.distance,
                total: pricing.totalAmount,
                currency: pricing.currency || 'AED'
            };
        } catch (error) {
            console.error('❌ Error calculating price:', error);
            
            // Fallback to context pricing if database fails
            const context = this.contexts[session.contextType];
            if (!context || !session.data.vehicleType) return null;

            const fallbackPricing = context.pricing[session.data.vehicleType];
            if (!fallbackPricing) return null;

            const estimatedDistance = process.env.DEFAULT_ESTIMATED_DISTANCE || 25;
            return {
                base: fallbackPricing.base,
                perKm: fallbackPricing.perKm,
                distance: estimatedDistance,
                total: fallbackPricing.base + (fallbackPricing.perKm * estimatedDistance),
                currency: 'AED'
            };
        }
    }

    completeBooking(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return false;

        session.status = 'confirmed';
        session.updatedAt = new Date().toISOString();

        // Update customer history
        const customerHistory = this.customerHistory[session.phoneNumber];
        customerHistory.bookings.push(bookingId);
        customerHistory.totalBookings++;
        customerHistory.lastBooking = bookingId;

        this.saveData();
        return true;
    }

    getCustomerHistory(phoneNumber) {
        return this.customerHistory[phoneNumber] || null;
    }

    getActiveSession(phoneNumber) {
        // First, clean up old confirmed sessions (older than 1 hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        Object.keys(this.sessions).forEach(bookingId => {
            const session = this.sessions[bookingId];
            if (session && session.status === 'confirmed' && session.confirmedAt) {
                const confirmedAt = new Date(session.confirmedAt);
                if (confirmedAt < oneHourAgo) {
                    console.log(`🧹 Cleaning up old confirmed session ${bookingId}`);
                    delete this.sessions[bookingId];
                }
            }
        });

        // Return only pending sessions
        return Object.values(this.sessions).find(
            session => session.phoneNumber === phoneNumber && session.status === 'pending'
        );
    }

    // Check if there are any existing sessions (including confirmed ones) for a phone number
    getExistingSession(phoneNumber) {
        return Object.values(this.sessions).find(
            session => session.phoneNumber === phoneNumber
        );
    }

    async confirmBooking(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) {
            console.log(`❌ Session not found for booking ${bookingId}`);
            return null;
        }

        // Generate confirmation ID
        const confirmationId = `CNF-${Date.now().toString().slice(-8)}`;

        // Update session status
        session.status = 'confirmed';
        session.confirmationId = confirmationId;
        session.confirmedAt = new Date().toISOString();
        session.updatedAt = new Date().toISOString();

        console.log(`✅ Booking ${bookingId} confirmed with confirmation ID ${confirmationId}`);

        // Save the updated session to memory
        this.saveData();

        // Save booking to database
        try {
            await this.saveBookingToDatabase(session);
            console.log(`✅ Booking ${bookingId} saved to database`);
        } catch (error) {
            console.error(`❌ Error saving booking ${bookingId} to database:`, error);
        }

        // Clean up the session after confirmation to allow new bookings
        // Keep it for a short time to allow payment processing, then remove
        setTimeout(() => {
            if (this.sessions[bookingId]) {
                console.log(`🧹 Cleaning up confirmed session ${bookingId}`);
                delete this.sessions[bookingId];
                this.saveData();
            }
        }, 30000); // 30 seconds delay to allow payment processing

        return confirmationId;
    }

    async saveBookingToDatabase(session) {
        try {
            const { models } = require('./models');
            
            // Ensure customer exists and get customer ID
            const customer = await this.ensureCustomerExists(session.phoneNumber, session.data.customerName);
            
            // Map vehicle type to enum values
            const vehicleTypeMap = {
                'Sedan': 'sedan',
                'SUV': 'suv', 
                'Van': 'van',
                'Luxury': 'luxury'
            };
            
            // Get pricing data
            const pricing = session.data.pricing || {};
            const totalAmount = pricing.total || 0;
            
            // Map session data to booking model schema
            const bookingData = {
                bookingId: session.bookingId,
                customerId: customer._id, // Use actual ObjectId from customer
                customerName: session.data.customerName || 'Unknown',
                customerPhone: session.phoneNumber,
                pickupLocation: session.data.pickupLocation || 'Not specified',
                dropLocation: session.data.dropLocation || 'Not specified', // Required field
                pickupTime: session.data.pickupTime ? new Date(session.data.pickupTime) : new Date(),
                vehicleType: vehicleTypeMap[session.data.vehicleType] || 'sedan', // Map to enum
                numberOfPassengers: parseInt(session.data.passengerCount) || 1,
                
                // Pricing fields (all required)
                baseFare: pricing.base || 0,
                distanceFare: pricing.perKm || 0,
                timeFare: pricing.hourly || 0,
                subtotal: totalAmount,
                bookingAmount: totalAmount,
                
                // Payment information
                paymentStatus: 'pending',
                paymentMethod: 'paypal',
                isPaid: false,
                
                // Booking status
                status: this.mapSessionStatusToBookingStatus(session.status),
                
                // Additional information
                specialRequests: session.data.specialRequests || '',
                notes: session.data.notes || '',
                
                // System fields
                createdAt: session.createdAt ? new Date(session.createdAt) : new Date(),
                updatedAt: new Date(),
                createdBy: 'whatsapp_bot',
                conversationId: session.phoneNumber
            };

            // Save or update booking
            const existingBooking = await models.Booking.findOne({ bookingId: session.bookingId });
            if (existingBooking) {
                await models.Booking.updateOne({ bookingId: session.bookingId }, bookingData);
                console.log(`📝 Updated booking ${session.bookingId} in database`);
            } else {
                await models.Booking.create(bookingData);
                console.log(`✅ Created booking ${session.bookingId} in database`);
            }

            // Update customer record
            await this.updateCustomerRecord(session.phoneNumber, session.data.customerName, bookingData);

        } catch (error) {
            console.error(`❌ Error saving booking ${session.bookingId} to database:`, error);
            throw error;
        }
    }

    async ensureCustomerExists(phoneNumber, customerName) {
        try {
            const { models } = require('./models');
            
            // Check if customer already exists
            let customer = await models.Customer.findOne({ phone: phoneNumber });
            
            if (!customer) {
                // Create new customer
                customer = await models.Customer.create({
                    name: customerName || 'Unknown',
                    phone: phoneNumber,
                    email: null,
                    status: 'active',
                    totalBookings: 0,
                    completedBookings: 0,
                    cancelledBookings: 0,
                    totalSpent: 0,
                    customerTier: 'bronze',
                    loyaltyPoints: 0,
                    isVIP: false,
                    whatsappNumber: phoneNumber,
                    lastWhatsappActivity: new Date(),
                    firstBookingAt: null,
                    lastBookingAt: null,
                    lastActivityAt: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                console.log(`✅ Created new customer: ${customerName} (${phoneNumber})`);
            }
            
            return customer;
        } catch (error) {
            console.error(`❌ Error ensuring customer exists:`, error);
            throw error;
        }
    }

    async updateCustomerRecord(phoneNumber, customerName, bookingData) {
        try {
            const { models } = require('./models');
            
            await models.Customer.updateOne(
                { phone: phoneNumber },
                {
                    $inc: { totalBookings: 1 },
                    $set: {
                        lastBookingAt: new Date(),
                        lastActivityAt: new Date(),
                        updatedAt: new Date()
                    }
                }
            );
            
            console.log(`📝 Updated customer record for ${phoneNumber}`);
        } catch (error) {
            console.error(`❌ Error updating customer record:`, error);
            // Don't throw error as this is not critical
        }
    }

    mapSessionStatusToBookingStatus(sessionStatus) {
        const statusMap = {
            'pending': 'pending',
            'confirmed': 'confirmed',
            'cancelled': 'cancelled',
            'completed': 'completed'
        };
        return statusMap[sessionStatus] || 'pending';
    }
}

class UltraRobustWhatsAppBot extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            authDir: process.env.WHATSAPP_SESSION_PATH || './data/whatsapp-session',
            printQRInTerminal: false, // Disabled by default, will be controlled by autoGenerateQR flag
            generateHighQualityLinkPreview: true,
            browser: ['UltraRobustBot', 'Chrome', '4.0.0'],
            ...config
        };

        this.sock = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 10; // Reasonable limit but higher than 5
        this.qrAttempts = 0; // Separate counter for QR generation attempts
        this.reconnectTimeout = null;
        this.lastReconnectTime = 0;
        this.minReconnectInterval = 15000; // Reduced from 30 to 15 seconds

        // AI and Database properties
        this.openai = null;
        this.bookingManager = null;
        this.pricingService = new PricingService();
        this.userSessions = new Map();
        this.registeredUsers = new Map();
        this.mediaAuthorizedNumbers = new Set();
        this.whitelistedNumbers = new Set();
        this.mediaDir = process.env.MEDIA_DIR || './media-files';
        this.messageQueue = [];
        this.errorCooldown = new Map(); // Track error messages to prevent spam
        this.lastQRCode = null; // Track last QR code to prevent duplicate processing
        this.lastQRTime = 0; // Track when QR was last generated
        this.qrMinAge = 5000; // Minimum 5 seconds between QR generations
        this.isGeneratingQR = false; // Flag to prevent duplicate QR generation
        this.autoGenerateQR = false; // Flag to control automatic QR generation - disabled by default, only enabled when manually triggered

        // Message deduplication and rate limiting
        this.processedMessages = new Set(); // Track processed message IDs
        this.messageRateLimit = new Map(); // Track message rate per phone number
        this.maxMessagesPerMinute = 200; // Increased limit - maximum messages per minute per number
        this.messageCooldown = 10; // Reduced cooldown - minimum 10ms between messages (was 25ms)

        // Connection settings for better stability
        this.connectionSettings = {
            connectTimeoutMs: 60000, // 60 seconds - reduced for faster failure detection
            defaultQueryTimeoutMs: 0, // No timeout
            keepAliveIntervalMs: 30000, // 30 seconds - reduced interval
            retryRequestDelayMs: 2000, // 2 seconds delay between retries
            maxMsgRetryCount: 2, // Reduced retries for faster failure detection
            markOnlineOnConnect: false, // Don't mark online immediately
            syncFullHistory: false, // Don't sync full history
            fireInitQueries: false, // Don't fire initial queries immediately
            shouldSyncHistoryMessage: () => false, // Don't sync history
            shouldIgnoreJid: (jid) => {
                // Ignore status messages and broadcasts
                return jid.endsWith('@broadcast') || jid.endsWith('@newsletter');
            },
            // Additional stability settings
            patchMessageBeforeSending: (message) => {
                // Ensure message has proper structure
                if (message && typeof message === 'object') {
                    return message;
                }
                return { text: 'Hello' };
            },
            // Reduce connection pressure
            getMessage: async (key) => {
                return {
                    conversation: "Hello! I'm an ultra-robust WhatsApp bot."
                };
            }
        };

        // Analytics and tracking
        this.analytics = {
            messagesProcessed: 0,
            bookingsCreated: 0,
            bookingsCompleted: 0,
            aiResponsesGenerated: 0,
            voiceMessagesProcessed: 0,
            imageMessagesProcessed: 0,
            errorsEncountered: 0,
            startTime: new Date(),
            lastActivity: new Date()
        };

        // NEW: Enhanced response system
        this.responseFormatter = ResponseFormatter;
        this.aiResponseGenerator = null;
        this.contextManager = new ContextManager();
        this.sessionValidator = new SessionValidator(this.config.authDir);

        // Heartbeat mechanism to keep dashboard status updated
        this.heartbeatInterval = null;
        this.startHeartbeat();

        // Enhanced connection settings - More stable and less aggressive
        // Merge with existing connectionSettings to avoid conflicts
        this.connectionSettings = {
            ...this.connectionSettings,
            connectTimeoutMs: 90000, // 90 seconds - even more time to connect
            keepAliveIntervalMs: 45000, // 45 seconds - less frequent keepalive
            retryRequestDelayMs: 3000, // 3 seconds - slower retry
            maxMsgRetryCount: 1, // Even lower retry count
            markOnlineOnConnect: false,
            defaultQueryTimeoutMs: 60000, // 60 seconds - much more time for queries
            connectCooldownMs: 15000, // 15 seconds - longer cooldown
            qrTimeout: 180000, // 3 minutes - longer QR timeout
            // Additional stability improvements
            emitOwnEvents: false, // Reduce event overhead
            shouldHandleMessage: () => true, // Handle all messages
            shouldMsgRetryStore: () => false, // Disable message retry storage
            // Additional stability settings
            shouldIgnoreJid: (jid) => false,
            shouldSyncHistoryMessage: () => false,
            generateHighQualityLinkPreview: false,
            // Don't restart on auth fail - try to use existing session
            restartOnAuthFail: false,
            // Reduce connection overhead
            syncFullHistory: false,
            fireInitQueries: false,
            // Add connection stability
            msgRetryCounterCache: new (require('node-cache'))({
                stdTTL: 3600, // 1 hour
                useClones: false
            }),
            // Longer timeouts for stability
            linkPreviewImageThumbnailWidth: 192,
            transactionOpts: {
                maxCommitRetries: 3,
                delayBetweenTriesMs: 3000
            }
        };

        this.initializeAI();
        this.initializeBookingManager();
        this.createMediaDirectory();
        this.setupEventHandlers();
        this.startErrorCooldownCleanup();
        this.startWhitelistRefresh();
        this.initializeWhitelistedNumbers().catch(error => {
            console.error('❌ Error initializing whitelisted numbers:', error);
        });
        console.log('🚀 UltraRobustWhatsAppBot constructor completed');
    }

    initializeAI() {
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey || apiKey === 'your-openai-api-key-here') {
            console.log('❌ Please set your OPENAI_API_KEY environment variable');
            console.log('💡 Example: export OPENAI_API_KEY="sk-..."');
            console.log('🔑 Get your API key from: https://platform.openai.com/api-keys');
            return;
        }

        this.openai = new OpenAI({
            apiKey: apiKey
        });

        // Initialize AI Response Generator
        this.aiResponseGenerator = new AIResponseGenerator(this.openai, this.bookingManager);

        console.log('🤖 OpenAI initialized with API key');
        console.log('🎤 Whisper API ready for audio transcription');
        console.log('👁️ Vision API ready for image analysis (GPT-4o)');
        console.log('🧠 AI Response Generator initialized');
    }

    initializeBookingManager() {
        this.bookingManager = new BookingManager();
        console.log('📋 Booking Manager initialized');
    }

    async initializeWhitelistedNumbers() {
        try {
            // Load whitelisted numbers from database via userManager
            const userManagerPromise = require('./services/userManager');
            const userManager = await userManagerPromise;
            
            // Wait for userManager to be ready
            await userManager.waitUntilReady();
            
            const dbNumbers = userManager.getWhitelistedNumbers();
            
            // Clear existing numbers
            this.whitelistedNumbers.clear();
            this.mediaAuthorizedNumbers.clear();
            
            // Add numbers from database
            dbNumbers.forEach(number => {
                const cleanNumber = number.replace(/[\+\s\-]/g, '');
                this.whitelistedNumbers.add(cleanNumber);
                this.mediaAuthorizedNumbers.add(cleanNumber);
            });

            console.log(`📱 Whitelisted ${this.whitelistedNumbers.size} numbers for AI processing`);
            console.log(`📋 Numbers: ${Array.from(this.whitelistedNumbers).join(', ')}`);
        } catch (error) {
            console.error('❌ Error loading whitelisted numbers from database:', error);
            
            // Fallback to default numbers
        const whitelistedNumbers = [
            '971543033535',
            '919928366889',
            '919694035681',
            '971561880302',
            '971563905407',
            '919887158554',
            '971509935854',
                '971501476598'
        ];

        whitelistedNumbers.forEach(number => {
            const cleanNumber = number.replace(/[\+\s\-]/g, '');
            this.whitelistedNumbers.add(cleanNumber);
            this.mediaAuthorizedNumbers.add(cleanNumber);
        });

            console.log(`📱 Using fallback whitelist with ${this.whitelistedNumbers.size} numbers`);
        }
    }

    // Method to refresh whitelist from database
    async refreshWhitelist() {
        try {
            const userManager = require('./services/userManager');
            
            // Wait for userManager to be ready
            await userManager.waitUntilReady();
            
            const dbNumbers = userManager.getWhitelistedNumbers();
            
            // Clear existing numbers
            this.whitelistedNumbers.clear();
            this.mediaAuthorizedNumbers.clear();
            
            // Add numbers from database
            dbNumbers.forEach(number => {
                const cleanNumber = number.replace(/[\+\s\-]/g, '');
                this.whitelistedNumbers.add(cleanNumber);
                this.mediaAuthorizedNumbers.add(cleanNumber);
            });
            
            console.log(`🔄 Refreshed whitelist: ${this.whitelistedNumbers.size} numbers`);
            console.log(`📱 Current whitelisted numbers: ${Array.from(this.whitelistedNumbers).join(', ')}`);
        } catch (error) {
            console.error('❌ Error refreshing whitelist:', error);
        }
    }

    // Start periodic whitelist refresh
    startWhitelistRefresh() {
        // Refresh whitelist every 5 minutes
        setInterval(async () => {
            try {
                await this.refreshWhitelist();
            } catch (error) {
                console.error('❌ Error in periodic whitelist refresh:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    createMediaDirectory() {
        if (!fs.existsSync(this.mediaDir)) {
            fs.mkdirSync(this.mediaDir, { recursive: true });
            console.log(`📁 Created media directory: ${this.mediaDir}`);
        }
    }

    startErrorCooldownCleanup() {
        // Clean up error cooldown every 5 minutes
        setInterval(() => {
            const now = Date.now();
            const cooldownPeriod = 30000; // 30 seconds

            for (const [phoneNumber, lastErrorTime] of this.errorCooldown.entries()) {
                if (now - lastErrorTime > cooldownPeriod * 2) { // Remove after 1 minute
                    this.errorCooldown.delete(phoneNumber);
                }
            }
        }, 5 * 60 * 1000); // Every 5 minutes

        // Clean up rate limiting data every 10 minutes
        setInterval(() => {
            const now = Date.now();
            const rateLimitPeriod = 60000; // 1 minute

            for (const [key, data] of this.messageRateLimit.entries()) {
                if (typeof data === 'object' && data.resetTime && now > data.resetTime) {
                    this.messageRateLimit.delete(key);
                } else if (typeof data === 'number' && now - data > rateLimitPeriod * 2) {
                    this.messageRateLimit.delete(key);
                }
            }

            // Clean up processed messages if too many
            if (this.processedMessages.size > 2000) {
                const messagesArray = Array.from(this.processedMessages);
                this.processedMessages.clear();
                messagesArray.slice(-1000).forEach(id => this.processedMessages.add(id));
            }
        }, 10 * 60 * 1000); // Every 10 minutes
    }

    isWhitelisted(phoneNumber) {
        if (!phoneNumber) return false;
        // Remove all non-digit characters except + at the beginning
        const cleanNumber = phoneNumber.replace(/[^\d+]/g, '').replace(/^\+/, '');
        return this.whitelistedNumbers.has(cleanNumber);
    }

    isMediaAuthorized(phoneNumber) {
        if (!phoneNumber) return false;
        // Remove all non-digit characters except + at the beginning
        const cleanNumber = phoneNumber.replace(/[^\d+]/g, '').replace(/^\+/, '');
        return this.mediaAuthorizedNumbers.has(cleanNumber);
    }

    // Check if message should be processed (deduplication and rate limiting)
    shouldProcessMessage(msg) {
        const messageId = msg.key.id;
        const phoneNumber = msg.key.remoteJid.replace('@c.us', '');
        const now = Date.now();

        // Check if this is an interactive response - these should always be processed
        const isInteractive = msg.message.interactiveResponseMessage || msg.message.listResponseMessage || msg.message.buttonsMessage;

        // Check if message was already processed (but allow interactive messages to be reprocessed)
        // Only skip if the exact same message ID was processed within the last 30 seconds
        const recentlyProcessed = this.processedMessages.has(messageId) && !isInteractive;
        if (recentlyProcessed) {
            // Check timestamp to avoid blocking legitimate retries
            const messageTime = msg.messageTimestamp * 1000;
            const timeSinceMessage = Date.now() - messageTime;
            
            if (timeSinceMessage < 30000) { // Only skip if less than 30 seconds old
                console.log(`⚠️ Skipping recent duplicate message: ${messageId} (${Math.round(timeSinceMessage/1000)}s ago)`);
                return false;
            } else {
                console.log(`✅ Allowing older message to be reprocessed: ${messageId} (${Math.round(timeSinceMessage/1000)}s ago)`);
            }
        }

        // Check rate limiting
        const rateLimitKey = phoneNumber;
        const rateLimitData = this.messageRateLimit.get(rateLimitKey) || { count: 0, resetTime: now + 60000 };

        if (now > rateLimitData.resetTime) {
            // Reset rate limit
            rateLimitData.count = 0;
            rateLimitData.resetTime = now + 60000;
        }

        if (rateLimitData.count >= this.maxMessagesPerMinute) {
            console.log(`⚠️ Rate limit exceeded for ${phoneNumber}: ${rateLimitData.count}/${this.maxMessagesPerMinute} messages per minute`);
            console.log(`🔄 Rate limit will reset in ${Math.round((rateLimitData.resetTime - now) / 1000)} seconds`);
            return false;
        }
        
        // Debug: Log rate limit status for active users
        if (rateLimitData.count > 1) {
            console.log(`📊 Rate limit status for ${phoneNumber}: ${rateLimitData.count}/${this.maxMessagesPerMinute} messages`);
        }

        // Check message cooldown (but allow interactive responses to bypass cooldown)
        const lastMessageTime = this.messageRateLimit.get(`${phoneNumber}_last`) || 0;
        if (now - lastMessageTime < this.messageCooldown && !isInteractive) {
            console.log(`⚠️ Message cooldown active for ${phoneNumber}: ${now - lastMessageTime}ms < ${this.messageCooldown}ms`);
            return false;
        }

        // For interactive responses, always allow processing
        if (isInteractive) {
            console.log(`✅ Interactive response bypassing cooldown for ${phoneNumber}`);
        }

        // Update rate limiting data
        rateLimitData.count++;
        this.messageRateLimit.set(rateLimitKey, rateLimitData);
        this.messageRateLimit.set(`${phoneNumber}_last`, now);

        // Mark message as processed
        this.processedMessages.add(messageId);

        // Clean up old processed messages (keep only last 1000)
        if (this.processedMessages.size > 1000) {
            const messagesArray = Array.from(this.processedMessages);
            this.processedMessages.clear();
            messagesArray.slice(-500).forEach(id => this.processedMessages.add(id));
        }

        return true;
    }

    // Check if message is from bot itself
    isBotMessage(msg) {
        // First check if message is from the bot itself (fromMe flag)
        if (msg.key.fromMe) {
            return true;
        }

        // For interactive responses, never treat as bot message
        const isInteractive = msg.message.interactiveResponseMessage ||
            msg.message.listResponseMessage ||
            msg.message.buttonsMessage;

        if (isInteractive) {
            return false;
        }

        const messageText = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';

        // Only check for very specific bot patterns that are unlikely to be user input
        const botPatterns = [
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            'Ultra-Robust AI Bot Status',
            'I apologize, but I encountered an error',
            'Media processing is limited to authorized numbers'
        ];

        // Only return true if it's a very specific bot pattern AND the message is very long
        const matchesPattern = botPatterns.some(pattern => messageText.includes(pattern));
        const isLongMessage = messageText.length > 100; // Only consider long messages as potential bot messages
        
        return matchesPattern && isLongMessage;
    }

    // Check if message is a skip command
    isSkipCommand(messageText) {
        const skipCommands = ['none', 'skip', 'na', 'n/a', 'not applicable', 'no', 'nothing'];
        const lowerText = messageText.toLowerCase().trim();
        return skipCommands.includes(lowerText);
    }

    // Handle skip command
    async handleSkipCommand(msg, phoneNumber, session) {
        const sessionData = this.bookingManager.sessions[session.bookingId];
        const data = sessionData.data;
        const bookingType = data.bookingType;

        // Get missing fields
        const missingFields = this.getMissingFieldsForSession(sessionData);

        if (missingFields.length === 0) {
            await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
            return;
        }

        const nextField = missingFields[0];

        // Set default values based on field
        switch (nextField) {
            case 'numberOfHours':
                this.bookingManager.updateSession(session.bookingId, null, 'system', {
                    numberOfHours: '2'
                });
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "⏭️ *Skipped hours - using default 2 hours*\n\nMoving to next step..."
                });
                break;
            case 'luggageInfo':
                this.bookingManager.updateSession(session.bookingId, null, 'system', {
                    luggageInfo: 'None'
                });
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "⏭️ *Skipped luggage info*\n\nMoving to next step..."
                });
                break;
            case 'passengerCount':
                this.bookingManager.updateSession(session.bookingId, null, 'system', {
                    passengerCount: '1'
                });
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "⏭️ *Skipped passenger count - using default 1 passenger*\n\nMoving to next step..."
                });
                break;
            case 'specialRequests':
                this.bookingManager.updateSession(session.bookingId, null, 'system', {
                    specialRequests: 'None'
                });
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "⏭️ *Skipped special requests - using default: None*\n\nMoving to next step..."
                });
                break;
            default:
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "⏭️ *Skipped current step*\n\nMoving to next step..."
                });
                break;
        }

        // Wait a moment then continue with missing info analysis
        setTimeout(async () => {
            await this.analyzeAndRequestMissingInfo(msg, phoneNumber, session);
        }, 500);
    }

    // Validate input for different steps
    validateInput(messageText, step, bookingType) {
        const lowerText = messageText.toLowerCase().trim();

        switch (step) {
            case 1: // Booking type
                if (lowerText.includes('transfer') || lowerText.includes('from') || lowerText.includes('to')) {
                    return { valid: true, value: 'Transfer Booking' };
                } else if (lowerText.includes('hourly') || lowerText.includes('hours') || lowerText.includes('hour')) {
                    return { valid: true, value: 'Hourly Booking' };
                }
                return { valid: false, message: "Please select either 'Transfer Booking' or 'Hourly Booking'" };

            case 2: // Vehicle type
                const vehicleTypes = ['sedan', 'suv', 'luxury', 'van'];
                for (const vehicle of vehicleTypes) {
                    if (lowerText.includes(vehicle)) {
                        return { valid: true, value: vehicle.charAt(0).toUpperCase() + vehicle.slice(1) };
                    }
                }
                return { valid: false, message: "Please select a valid vehicle type (Sedan, SUV, Luxury, or Van)" };

            case 3: // Customer name
                if (lowerText.length < 2) {
                    return { valid: false, message: "Please provide a valid name (at least 2 characters)" };
                }
                return { valid: true, value: messageText.trim() };

            case 4: // Pickup location
                if (lowerText.length < 3) {
                    return { valid: false, message: "Please provide a valid pickup location" };
                }
                return { valid: true, value: messageText.trim() };

            case 5: // Drop location (transfer only)
                if (lowerText.length < 3) {
                    return { valid: false, message: "Please provide a valid drop location" };
                }
                return { valid: true, value: messageText.trim() };

            case 6: // Number of hours (hourly booking only)
                const hours = this.extractHours(messageText);
                if (!hours || hours < 1 || hours > 24) {
                    return { valid: false, message: "Please enter a valid number of hours (1-24)" };
                }
                return { valid: true, value: hours.toString() };

            case 7: // Luggage info (both booking types)
                const luggageMatch = lowerText.match(/(\d+)\s*(?:bag|suitcase|luggage|piece)/);
                if (luggageMatch) {
                    const count = parseInt(luggageMatch[1]);
                    if (count >= 0 && count <= 10) {
                        return { valid: true, value: `${count} pieces` };
                    }
                }
                // Try to extract number directly
                const numberMatch = lowerText.match(/(\d+)/);
                if (numberMatch) {
                    const count = parseInt(numberMatch[1]);
                    if (count >= 0 && count <= 10) {
                        return { valid: true, value: `${count} pieces` };
                    }
                }
                return { valid: false, message: "Please enter a valid number of luggage pieces (0-10)" };

            case 8: // Passenger count
                const passengers = this.extractPassengerCount(messageText);
                if (!passengers || passengers < 1 || passengers > 20) {
                    return { valid: false, message: "Please enter a valid number of passengers (1-20)" };
                }
                return { valid: true, value: passengers.toString() };

            case 9: // Special requests
                // For special requests, we accept any input including "none"
                const specialRequest = messageText.trim().toLowerCase();
                if (specialRequest === 'none' || specialRequest === 'no' || specialRequest === 'skip') {
                    return { valid: true, value: 'None' };
                }
                return { valid: true, value: messageText.trim() };

            default:
                return { valid: true, value: messageText.trim() };
        }
    }

    // Extract hours from text
    extractHours(text) {
        const lowerText = text.toLowerCase().trim();

        // Remove common words
        const cleanText = lowerText.replace(/\b(hours?|hrs?|h)\b/g, '').trim();

        // Extract number
        const match = cleanText.match(/(\d+)/);
        if (match) {
            const hours = parseInt(match[1]);
            if (hours >= 1 && hours <= 24) {
                return hours;
            }
        }

        return null;
    }

    // Extract passenger count from text
    extractPassengerCount(text) {
        const lowerText = text.toLowerCase().trim();

        // Remove common words
        const cleanText = lowerText.replace(/\b(passengers?|people|person|pax)\b/g, '').trim();

        // Extract number
        const match = cleanText.match(/(\d+)/);
        if (match) {
            const count = parseInt(match[1]);
            if (count >= 1 && count <= 20) {
                return count;
            }
        }

        return null;
    }

   

    async initialize() {
        if (this.isConnecting) {
            console.log('⏳ Already connecting, please wait...');
            return;
        }

        // Check if connection is already healthy - don't reinitialize unnecessarily
        if (this.isConnectionHealthy()) {
            console.log('✅ Connection is already healthy, skipping reinitialization');
            this.saveConnectionState(); // Update state file
            return;
        }

        // Initialize whitelisted numbers from database
        await this.initializeWhitelistedNumbers();

        // Migrate existing bookings to database
        await this.saveAllBookingsToDatabase();

        // Check session validity first
        const sessionStatus = this.sessionValidator.getSessionStatus();
        console.log('🔍 Session validation:', sessionStatus);

        // Force QR generation if no valid session or if we want to start fresh
        if (!sessionStatus.isValid || sessionStatus.needsQR) {
            console.log(`⚠️ ${sessionStatus.reason || 'No valid session found'}`);
            console.log('🔄 Clearing session and forcing QR code generation...');
            this.sessionValidator.clearInvalidSession();
            
            // Set initial state to disconnected to trigger QR generation
            this.isConnected = false;
            this.isConnecting = false;
            this.saveConnectionState('disconnected');
        } else {
            console.log('✅ Valid session found, attempting to reconnect...');
            // Only clear corrupted sessions after more attempts to prevent premature QR regeneration
            if (this.connectionAttempts > 15) {
                console.log('🔄 Multiple connection failures with valid session - likely corrupted, forcing QR regeneration...');
                this.sessionValidator.clearInvalidSession();
                this.isConnected = false;
                this.isConnecting = false;
                this.saveConnectionState('disconnected');
            }
        }

        const now = Date.now();
        if (now - this.lastReconnectTime < this.minReconnectInterval) {
            const waitTime = this.minReconnectInterval - (now - this.lastReconnectTime);
            console.log(`⏳ Waiting ${Math.ceil(waitTime / 1000)} seconds before reconnecting...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.isConnecting = true;
        this.connectionAttempts++;
        this.lastReconnectTime = Date.now();

        try {
            console.log(`🔄 Ultra-Robust Connection attempt ${this.connectionAttempts}/${this.maxConnectionAttempts}`);

            // Clear any existing connection
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (e) {
                    // Ignore logout errors
                }
                this.sock = null;
            }

            // Wait a bit before reconnecting (shorter for faster connection)
            const waitTime = sessionStatus.isValid ? 2000 : 1000;
            console.log(`⏳ Waiting ${waitTime / 1000} seconds before connecting...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Clear any existing connection state
            this.isConnected = false;
            this.isConnecting = false;
            
            // If no valid session, ensure we're in disconnected state for QR generation
            if (!sessionStatus.isValid || sessionStatus.needsQR) {
                console.log('🔄 No valid session - will generate QR code');
                this.saveConnectionState('disconnected');
            }

            // Get latest version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

            // Setup auth state
            const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);

            // Create socket with enhanced settings
            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }), // Silent logging to reduce noise
                printQRInTerminal: this.autoGenerateQR, // Use autoGenerateQR flag to control terminal QR display
                auth: state,
                browser: this.config.browser,
                generateHighQualityLinkPreview: this.config.generateHighQualityLinkPreview,
                ...this.connectionSettings,
                getMessage: async (key) => {
                    return {
                        conversation: "Hello! I'm an ultra-robust WhatsApp bot."
                    };
                }
            });

            // Save credentials when updated
            this.sock.ev.on('creds.update', saveCreds);

            // Setup event handlers
            this.setupSocketEventHandlers();

            console.log('✅ Ultra-Robust Bot initialized successfully!');
            console.log('📱 Scan the QR code with your WhatsApp app to start using the bot.');
            console.log('💬 Send !help to any chat to see available commands.');

            // Emit ready event
            this.emit('ready', { bot: this });

        } catch (error) {
            console.error(`❌ Ultra-Robust Connection failed (attempt ${this.connectionAttempts}):`, error.message);
            console.error(`🔍 Error details:`, error);
            this.isConnecting = false;

            // Check if this is a session-related error
            if (error.message.includes('session') || error.message.includes('auth') || error.message.includes('credentials')) {
                console.log('🔄 Session-related error detected, clearing session...');
                this.sessionValidator.clearInvalidSession();
            }

            if (this.connectionAttempts < this.maxConnectionAttempts) {
                const delay = Math.min(10000 + (this.connectionAttempts * 5000), 30000); // 10s, 15s, 20s, 25s, 30s max
                console.log(`🔄 Retrying in ${delay / 1000} seconds... (attempt ${this.connectionAttempts + 1}/${this.maxConnectionAttempts})`);
                this.reconnectTimeout = setTimeout(() => {
                    this.initialize();
                }, delay);
            } else {
                console.error('❌ Max connection attempts reached. Resetting counter and continuing...');

                // Reset connection attempts to start over
                this.connectionAttempts = 0;
                this.qrAttempts = 0; // Also reset QR attempts counter
                this.isConnecting = false;

                console.log('💡 Troubleshooting tips:');
                console.log('   1. Check your internet connection');
                console.log('   2. Close ALL WhatsApp Web sessions in browsers');
                console.log('   3. Wait 5-10 minutes before retrying');
                console.log('   4. Session cleared - fresh QR will be generated on next attempt');
                console.log('   5. Restart your router if DNS issues persist');
                console.log('   6. Use !qr command to force QR code generation');

                this.emit('error', { error, bot: this });

                // Clear any existing session to force fresh QR generation
                try {
                    const sessionDir = path.join(__dirname, '../data/whatsapp-session');
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                        console.log('🧹 Cleared session directory to force fresh QR generation');
                    }
                } catch (clearError) {
                    console.log('⚠️ Could not clear session directory:', clearError.message);
                }

                // Wait a bit before trying again with reset counter
                console.log('🔄 Waiting 3 seconds before retrying with reset counter...');
                setTimeout(() => {
                    console.log('🔄 Retrying with reset attempt counter...');
                    this.initialize().catch((retryError) => {
                        console.error('❌ Retry failed:', retryError.message);
                        // Don't exit, just log and try again later
                        setTimeout(() => {
                            console.log('🔄 Scheduling another retry...');
                            this.initialize();
                        }, 30000); // Try again in 30 seconds
                    });
                }, 3000); // Wait 3 seconds
            }
        }
    }

    setupEventHandlers() {
        // This method is called in constructor
    }

    setupSocketEventHandlers() {
        if (!this.sock) return;

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Emit connection status for all states
            if (connection) {
                // Map Baileys connection states to dashboard states
                let dashboardState;
                switch (connection) {
                    case 'open':
                        dashboardState = 'connected';
                        break;
                    case 'connecting':
                        dashboardState = 'connecting';
                        break;
                    case 'close':
                        dashboardState = 'disconnected';
                        break;
                    default:
                        dashboardState = connection; // Pass through other states
                }
                this.emitConnectionStatus(dashboardState);
            }

            if (qr) {
                const now = Date.now();
                const timeSinceLastQR = now - this.lastQRTime;

                console.log('🔍 QR Code Debug Info:');
                console.log(`🔍 autoGenerateQR: ${this.autoGenerateQR}`);
                console.log(`🔍 lastQRCode === qr: ${this.lastQRCode === qr}`);
                console.log(`🔍 timeSinceLastQR: ${Math.round(timeSinceLastQR / 1000)}s (min: ${this.qrMinAge / 1000}s)`);
                console.log(`🔍 isGeneratingQR: ${this.isGeneratingQR}`);

                // Process QR if auto-generation is enabled AND it's different from the last one AND not already generating
                // Removed time restriction to process QR codes immediately
                if (this.autoGenerateQR && this.lastQRCode !== qr && !this.isGeneratingQR) {
                    this.isGeneratingQR = true; // Set flag to prevent duplicate generation
                    
                    
                    console.log('📱 QR Code received, scan it with your WhatsApp app');
                    console.log('📱 Open WhatsApp > Settings > Linked Devices > Link a Device');
                    console.log('📱 Make sure to scan the QR code within 2 minutes');
                    console.log(`⏰ QR age: ${Math.round(timeSinceLastQR / 1000)}s (min: ${this.qrMinAge / 1000}s)`);
                    console.log(`📱 QR Code length: ${qr.length} characters`);
                    console.log('=====================================');
                    qrcode.generate(qr, { small: true });
                    console.log('=====================================');

                    // Store the QR code and time to prevent duplicate processing
                    this.lastQRCode = qr;
                    this.lastQRTime = now;

                    // Update connection state
                    this.isConnected = false;
                    this.isConnecting = false;
                    
                    // Update connection state file immediately
                    this.saveConnectionState('qr_required');

                    // Emit QR status
                    this.emitConnectionStatus('qr_required');

                    // Emit WebSocket event for real-time QR updates
                    this.emitWebSocketEvent('connectionStateChanged', {
                        state: 'qr_required',
                        isReady: false,
                        isAuthenticated: false,
                        qrCode: qr,
                        timestamp: new Date().toISOString()
                    });

                    // Emit QR code to web server for dashboard update
                    try {
                        const io = require('./web-server').io;
                        if (io) {
                            // Generate QR data URL for web dashboard (async)
                            const qrcode = require('qrcode');
                            qrcode.toDataURL(qr, {
                                width: 300,
                                margin: 2,
                                errorCorrectionLevel: 'M',
                                color: {
                                    dark: '#000000',
                                    light: '#FFFFFF'
                                }
                            }).then(qrDataURL => {
                                // Increment QR attempts counter
                                this.qrAttempts++;
                                
                                // Reset QR attempts if it exceeds max limit
                                if (this.qrAttempts > this.maxConnectionAttempts) {
                                    console.log('🔄 QR attempts exceeded max limit, resetting to 1');
                                    this.qrAttempts = 1;
                                }
                                
                                // Emit immediately to web dashboard
                                io.emit('qrCodeGenerated', {
                                    phoneNumber: 'main-instance',
                                    qrCode: qrDataURL,
                                    attempt: this.qrAttempts,
                                    maxRetries: this.maxConnectionAttempts,
                                    timestamp: new Date().toISOString(),
                                    status: 'ready'
                                });
                                console.log('📱 QR code emitted to web dashboard immediately');

                                // Also save QR code for persistence
                                this.saveQRCode(qr);
                                
                                // Reset flag after successful generation
                                this.isGeneratingQR = false;
                            }).catch(error => {
                                console.log('⚠️ Could not generate QR data URL:', error.message);
                                console.error('❌ QR Code that failed:', qr.substring(0, 100) + '...');
                                this.isGeneratingQR = false; // Reset flag on error
                                
                                // Still try to save the raw QR code
                                this.saveQRCode(qr);
                            });
                        } else {
                            this.isGeneratingQR = false; // Reset flag if no web server
                        }
                    } catch (error) {
                        console.log('⚠️ Could not emit QR to web server:', error.message);
                        this.isGeneratingQR = false; // Reset flag on error
                    }
                } else if (!this.autoGenerateQR) {
                    console.log('📱 QR code received but auto-generation is disabled. Click "Generate New QR" button to generate QR code.');
                    
                    // Store the QR code for manual generation later
                    this.lastQRCode = qr;
                    this.lastQRTime = now;
                } else if (this.lastQRCode === qr) {
                    console.log('📱 Same QR code received, skipping duplicate processing');
                } else if (this.isGeneratingQR) {
                    console.log('📱 QR generation already in progress, skipping duplicate');
                } else {
                    console.log(`⏰ QR code too recent (${Math.round(timeSinceLastQR / 1000)}s), waiting ${Math.round((this.qrMinAge - timeSinceLastQR) / 1000)}s more...`);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('🔌 Connection closed due to:', lastDisconnect?.error?.message || 'Unknown error');
                console.log('🔄 Reconnecting:', shouldReconnect ? 'Yes' : 'No');

                if (shouldReconnect) {
                    this.isConnected = false;
                    this.isConnecting = false;

                    // Clear any existing timeout
                    if (this.reconnectTimeout) {
                        clearTimeout(this.reconnectTimeout);
                    }

                    // Wait much longer before reconnecting - give time to scan QR
                    const delay = Math.min(10000 + (this.connectionAttempts * 5000), 30000); // 10s, 15s, 20s, 25s, 30s max
                    console.log(`🔄 Reconnecting in ${delay / 1000} seconds... (attempt ${this.connectionAttempts + 1})`);
                    this.reconnectTimeout = setTimeout(() => {
                        this.initialize();
                    }, delay);
                } else {
                    console.log('❌ Logged out. Will attempt to reconnect...');
                    this.emit('disconnected', { reason: 'loggedOut', bot: this });

                    // Don't exit the process, try to reconnect
                    this.isConnected = false;
                    this.isConnecting = false;

                    // Stop heartbeat when disconnected
                    this.stopHeartbeat();

                    // Emit WebSocket event for dashboard update
                    this.emitConnectionStatus('disconnected');

                    // Try to reconnect after a delay
                    setTimeout(() => {
                        console.log('🔄 Attempting to reconnect after logout...');
                        this.initialize();
                    }, 10000); // Try again in 10 seconds
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp Bot is ready and connected!');
                
                // Disable auto QR generation since we're now connected
                this.autoGenerateQR = false;
                console.log('🔄 Auto QR generation disabled - bot is connected');
                
                
                // Use the new reset function to ensure proper state management
                this.resetConnectionState();

                // Start heartbeat to keep status updated
                this.startHeartbeat();

                // Emit connected event
                this.emit('connected', { bot: this });

                // Emit WebSocket event for real-time updates
                this.emitWebSocketEvent('connectionStateChanged', {
                    state: 'connected',
                    isReady: true,
                    isAuthenticated: true,
                    connectedNumber: this.sock?.user?.id?.replace('@c.us', '') || 'Unknown',
                    timestamp: new Date().toISOString()
                });

                // Emit bot ready event
                this.emitWebSocketEvent('botReady', {
                    message: 'Bot is ready and connected!',
                    connectedNumber: this.sock?.user?.id?.replace('@c.us', '') || 'Unknown',
                    timestamp: new Date().toISOString()
                });
            } else if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
                this.isConnecting = true;
                this.isConnected = false;
                this.qrCodeGenerated = false; // Reset QR status when connecting
                
                // Save connecting state
                this.saveConnectionState();

                // Emit WebSocket event for dashboard update
                this.emitConnectionStatus('connecting');

                // Emit WebSocket event for real-time updates
                this.emitWebSocketEvent('connectionStateChanged', {
                    state: 'connecting',
                    isReady: false,
                    isAuthenticated: false,
                    timestamp: new Date().toISOString()
                });

                this.emit('connecting', { bot: this });
            }
        });

        // Handle messages
        this.sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            const phoneNumber = msg.key.remoteJid.replace('@c.us', '');

            // Check if message should be processed (deduplication and rate limiting)
            if (!this.shouldProcessMessage(msg)) {
                return;
            }

            // Check if message is from bot itself
            if (this.isBotMessage(msg)) {
                console.log(`⚠️ Skipping bot-generated message to prevent loops`);
                return;
            }

            // Check if message is from whitelisted number
            if (!this.isWhitelisted(phoneNumber)) {
                console.log(`🚫 Message from ${phoneNumber} ignored: not whitelisted.`);
                console.log(`📋 Whitelisted numbers: ${Array.from(this.whitelistedNumbers).join(', ')}`);
                console.log(`🔍 Cleaned number for comparison: ${phoneNumber.replace(/[^\d+]/g, '').replace(/^\+/, '')}`);
                return;
            }
            
            // Debug: Log successful whitelist match
            console.log(`✅ Message from whitelisted number ${phoneNumber} - processing...`);

            // Debug: Log message structure
            console.log(`🔍 Message structure from ${phoneNumber}:`, {
                hasConversation: !!msg.message.conversation,
                hasExtendedText: !!msg.message.extendedTextMessage,
                hasImageMessage: !!msg.message.imageMessage,
                hasInteractiveResponse: !!msg.message.interactiveResponseMessage,
                hasListResponse: !!msg.message.listResponseMessage,
                hasListMessage: !!msg.message.listMessage,
                hasButtonsMessage: !!msg.message.buttonsMessage,
                messageKeys: Object.keys(msg.message)
            });

            const messageText = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                '';

            // Handle interactive message responses FIRST (all types)
            if (msg.message.interactiveResponseMessage || msg.message.listResponseMessage || msg.message.buttonsMessage) {
                console.log(`🎯 Interactive response received from ${phoneNumber}`);
                if (msg.message.interactiveResponseMessage) {
                    console.log(`🎯 Interactive response details:`, JSON.stringify(msg.message.interactiveResponseMessage, null, 2));
                }
                if (msg.message.listResponseMessage) {
                    console.log(`🎯 List response details:`, JSON.stringify(msg.message.listResponseMessage, null, 2));
                }
                if (msg.message.buttonsMessage) {
                    console.log(`🎯 Button message details:`, JSON.stringify(msg.message.buttonsMessage, null, 2));
                }
                await this.handleInteractiveResponse(msg);
                return;
            }

            if (messageText && messageText.startsWith('!')) {
                console.log(`🎯 Command received: ${messageText}`);
                this.handleCommand(msg);
            } else {
                // Process with AI for booking
                await this.processMessage(msg);
            }

            // Emit message event
            this.emit('message', { message: msg, bot: this });
        });
    }

    // Emit connection status to web dashboard
    emitConnectionStatus(status) {
        try {
            // Write connection status to file for web server to read
            const connectionState = {
                connectionState: status,
                isReady: status === 'connected',
                isAuthenticated: status === 'connected',
                connectedNumber: status === 'connected' ? this.sock.user?.id?.replace('@c.us', '') : null,
                lastHeartbeat: new Date().toISOString(),
                lastUpdate: new Date().toISOString()
            };

            const stateFilePath = path.join(__dirname, '../data/whatsapp-connection-state.json');
            fs.writeFileSync(stateFilePath, JSON.stringify(connectionState, null, 2));

            console.log(`📡 Connection status emitted: ${status}`);
        } catch (error) {
            console.error('❌ Error emitting connection status:', error);
        }
    }

    // Emit WebSocket events for real-time updates
    emitWebSocketEvent(eventName, data) {
        try {
            const io = require('./web-server').io;
            if (io) {
                io.emit(eventName, data);
                console.log(`📡 Emitted WebSocket event: ${eventName}`);
            }
        } catch (error) {
            console.log(`⚠️ Could not emit WebSocket event ${eventName}:`, error.message);
        }
    }

    // Start heartbeat to keep dashboard status updated
    startHeartbeat() {
        // Clear any existing heartbeat
        this.stopHeartbeat();
        
        // Start new heartbeat every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.sock) {
                try {
                    // Update connection status with current state
                    this.emitConnectionStatus('connected');
                    console.log('💓 Heartbeat: Dashboard status updated');
                } catch (error) {
                    console.error('❌ Error in heartbeat:', error);
                }
            }
        }, 30000); // 30 seconds
        
        console.log('💓 Heartbeat started - will update dashboard every 30 seconds');
    }

    // Stop heartbeat
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('💓 Heartbeat stopped');
        }
    }

    // Save connection state to file for persistence
    saveConnectionState() {
        try {
            const now = new Date().toISOString();
            const connectionState = {
                connectionState: this.isConnected ? 'connected' : (this.isConnecting ? 'connecting' : 'disconnected'),
                isReady: this.isConnected,
                isAuthenticated: this.isConnected,
                // Ensure we never show initializing when we're connected
                status: this.isConnected ? 'connected' : (this.isConnecting ? 'connecting' : 'disconnected'),
                connectedNumber: this.sock?.user?.id?.replace('@c.us', '') || null,
                lastHeartbeat: now,
                lastUpdate: now,
                // Additional stability metrics for dashboard
                connectionAttempts: this.connectionAttempts || 0,
                maxConnectionAttempts: this.maxConnectionAttempts || 10,
                qrCodeGenerated: this.qrCodeGenerated || false,
                lastReconnectTime: this.lastReconnectTime || null,
                uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
                stabilityScore: this.calculateStabilityScore(),
                lastQRTime: this.qrGenerationTime || null,
                version: "1.0.0"
            };

            const fs = require('fs');
            const path = require('path');
            const stateFilePath = path.join(__dirname, '../data/whatsapp-connection-state.json');
            
            // Ensure data directory exists
            const dataDir = path.dirname(stateFilePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            fs.writeFileSync(stateFilePath, JSON.stringify(connectionState, null, 2));
            console.log(`💾 Connection state saved: ${connectionState.connectionState} (attempts: ${connectionState.connectionAttempts}/${connectionState.maxConnectionAttempts})`);
            
            // Also save to file for dashboard access
            this.saveConnectionState(connectionState.connectionState);
        } catch (error) {
            console.error('❌ Error saving connection state:', error);
        }
    }

    calculateStabilityScore() {
        if (!this.startTime) return 0;
        
        const uptime = Date.now() - this.startTime;
        const uptimeHours = uptime / (1000 * 60 * 60);
        const attempts = this.connectionAttempts || 0;
        const reconnectsPerHour = attempts / Math.max(uptimeHours, 0.1);
        
        // Calculate stability score (0-100)
        if (reconnectsPerHour < 1) return 95;
        if (reconnectsPerHour < 2) return 85;
        if (reconnectsPerHour < 3) return 70;
        if (reconnectsPerHour < 5) return 50;
        if (reconnectsPerHour < 10) return 30;
        return 10;
    }

    // Reset all connection state when successfully connected
    resetConnectionState() {
        console.log('🔄 Resetting connection state to CONNECTED');
        this.isConnected = true;
        this.isConnecting = false;
        this.connectionAttempts = 0;
        this.qrAttempts = 0;
        this.qrCodeGenerated = false;
        
        // Clear any timeouts
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        // Force save the connection state
        this.saveConnectionState();
        
        // Emit status update to dashboard
        this.emitConnectionStatus('connected');
        
        console.log('✅ Connection state reset complete - status should show CONNECTED');
    }

    // Check if connection is healthy and should not be reinitialized
    isConnectionHealthy() {
        try {
            // Check if socket exists and is connected
            if (!this.sock || !this.isConnected) {
                return false;
            }

            // Check if we have a valid user ID
            if (!this.sock.user || !this.sock.user.id) {
                return false;
            }

            // Check if the connection is not in an error state
            if (this.sock.ws && this.sock.ws.readyState !== 1) { // 1 = OPEN
                return false;
            }

            return true;
        } catch (error) {
            console.log('⚠️ Error checking connection health:', error.message);
            return false;
        }
    }

    async saveQRCode(qr) {
        try {
            // Generate QR code as data URL first
            const qrcode = require('qrcode');
            const qrDataURL = await qrcode.toDataURL(qr, {
                width: 300,
                margin: 2,
                errorCorrectionLevel: 'M',
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            });

            const qrData = {
                qrCode: qrDataURL, // Save as data URL instead of raw QR data
                qrData: qr, // Keep raw data for reference
                timestamp: new Date().toISOString(),
                attempt: this.qrAttempts,
                maxRetries: this.maxConnectionAttempts,
                age: 'fresh'
            };

            // Ensure data directory exists
            const dataDir = path.join(__dirname, '../data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const qrFilePath = path.join(dataDir, 'whatsapp-qr.json');
            fs.writeFileSync(qrFilePath, JSON.stringify(qrData, null, 2));

            // Also save connection state
            const connectionState = {
                connectionState: 'initializing',
                isReady: false,
                isAuthenticated: false,
                connectedNumber: null,
                lastHeartbeat: new Date().toISOString(),
                lastUpdate: new Date().toISOString()
            };

            const stateFilePath = path.join(dataDir, 'whatsapp-connection-state.json');
            fs.writeFileSync(stateFilePath, JSON.stringify(connectionState, null, 2));

            // Generate QR code image for web dashboard
            try {
                const qrImagePath = path.join(dataDir, 'whatsapp-qr.png');

                // Convert data URL to buffer and save as PNG
                const base64Data = qrDataURL.replace(/^data:image\/png;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(qrImagePath, buffer);

                console.log('📱 QR code image saved for web dashboard:', qrImagePath);
                console.log('📱 QR image file exists:', fs.existsSync(qrImagePath));
                console.log('📱 QR image file size:', fs.statSync(qrImagePath).size, 'bytes');

                // Also save QR data URL for web server
                const qrDataWithURL = {
                    ...qrData,
                    qrDataURL: qrDataURL,
                    imagePath: qrImagePath
                };
                fs.writeFileSync(qrFilePath, JSON.stringify(qrDataWithURL, null, 2));

            } catch (imageError) {
                console.error('❌ Error generating QR code image:', imageError);
                // Try to create a simple fallback QR image
                try {
                    const simpleQR = await qrcode.toBuffer(qr, {
                        width: 300,
                        margin: 2
                    });
                    fs.writeFileSync(qrImagePath, simpleQR);
                    console.log('📱 Fallback QR image created');
                } catch (fallbackError) {
                    console.error('❌ Error creating fallback QR image:', fallbackError);
                }
            }

        } catch (error) {
            console.error('Error saving QR code:', error);
        }
    }

    // Method to check if QR image exists and regenerate if needed
    async ensureQRImageExists() {
        try {
            const dataDir = path.join(__dirname, '../data');
            const qrImagePath = path.join(dataDir, 'whatsapp-qr.png');
            const qrJsonPath = path.join(dataDir, 'whatsapp-qr.json');

            // Check if QR image exists and is valid
            if (!fs.existsSync(qrImagePath) || fs.statSync(qrImagePath).size === 0) {
                console.log('📱 QR image missing or empty, attempting to regenerate...');

                // Try to read QR data from JSON file
                if (fs.existsSync(qrJsonPath)) {
                    const qrData = JSON.parse(fs.readFileSync(qrJsonPath, 'utf8'));
                    if (qrData.qrCode) {
                        await this.saveQRCode(qrData.qrCode);
                        console.log('📱 QR image regenerated from stored data');
                        return true;
                    }
                }

                console.log('❌ No QR data available for regeneration');
                return false;
            }

            console.log('📱 QR image exists and is valid');
            return true;
        } catch (error) {
            console.error('❌ Error checking QR image:', error);
            return false;
        }
    }

    async processMessage(msg) {
        try {
            const phoneNumber = msg.key.remoteJid.replace('@c.us', '');

            // Skip processing if this is an interactive response (already handled)
            if (msg.message.interactiveResponseMessage || msg.message.listResponseMessage) {
                console.log(`⚠️ Skipping processMessage for interactive response from ${phoneNumber}`);
                return;
            }

            console.log(`📨 Processing message from: ${phoneNumber}`);
            console.log(`📝 Message content: ${msg.message.conversation || msg.message.extendedTextMessage?.text || 'Media message'}`);

            // Update analytics
            this.analytics.messagesProcessed++;
            this.analytics.lastActivity = new Date();

            // Save incoming message to chat logs (only for whitelisted numbers)
            await this.saveIncomingMessage(msg, phoneNumber);

            let messageText = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                '';

            // Handle location messages
            if (msg.message.locationMessage) {
                await this.handleLocationMessage(msg, phoneNumber);
                return;
            }

            // Handle media messages - Keep audio-based inputs active for booking flow
            if (msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage) {
                if (!this.isMediaAuthorized(phoneNumber)) {
                    await this.sendMessage(msg.key.remoteJid,
                        'Media processing is limited to authorized numbers. Please send text instead.');
                    return;
                }

                // Track media processing
                if (msg.message.audioMessage) {
                    this.analytics.voiceMessagesProcessed++;
                } else if (msg.message.imageMessage) {
                    this.analytics.imageMessagesProcessed++;
                }

                const processedMedia = await this.processMediaMessage(msg);
                if (processedMedia) {
                    messageText = processedMedia;
                    console.log('📝 Processed media message text:', messageText);

                    // If we have a booking session, process the media as part of booking flow
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    if (session) {
                        await this.processBookingStep(msg, phoneNumber, messageText, session);
                        return;
                    }
                } else {
                    // If media processing didn't return text, acknowledge the media
                    await this.sendMessage(msg.key.remoteJid, 'I received your media message. Please send a text message if you need assistance.');
                    return;
                }
            }

            // Bot message detection is now handled in the main message handler
            // This check is redundant but kept for extra safety

            // Skip processing if message text is empty (e.g., media without caption)
            if (!messageText || messageText.trim() === '') {
                console.log('⚠️ Skipping empty message text');
                return;
            }

            // Check for booking command or if message contains booking intent
            const bookingIntent = messageText.toLowerCase().match(/\b(book|booking|reserve|schedule|chauffeur|taxi|ride)\b/);

            // Also check for list selection patterns
            const isListSelection = messageText.includes('Book Now') ||
                messageText.includes('Voice Booking') ||
                messageText.includes('Image Booking') ||
                messageText.includes('View Services') ||
                messageText.includes('Hourly Booking') ||
                messageText.includes('Transfer Booking') ||
                messageText.includes('Sedan') ||
                messageText.includes('SUV') ||
                messageText.includes('Luxury') ||
                messageText.includes('Van');

            console.log(`🔍 Booking intent check: "${messageText}" -> ${bookingIntent ? 'FOUND' : 'NOT FOUND'}`);
            console.log(`🔍 List selection check: "${messageText}" -> ${isListSelection ? 'FOUND' : 'NOT FOUND'}`);

            // Get or create booking session
            let session = this.bookingManager.getActiveSession(phoneNumber);

            // Check if there's any existing session (including confirmed ones)
            const existingSession = this.bookingManager.getExistingSession(phoneNumber);

            // If session exists and user sends booking command again, show current status
            if (session && bookingIntent) {
                console.log(`📋 User sent booking command but session already exists: ${session.bookingId}`);
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: `You already have an active booking session (${session.bookingId}). Let me continue with your current booking.`
                });
                
                // Continue with existing session instead of returning
                await this.processBookingStep(msg, phoneNumber, messageText, session);
                return;
            }

            // If there's a confirmed session and user tries to start new booking, clean it up and start fresh
            if (existingSession && existingSession.status === 'confirmed' && bookingIntent) {
                console.log(`🧹 Found confirmed session ${existingSession.bookingId}, cleaning up to start new booking`);
                delete this.bookingManager.sessions[existingSession.bookingId];
                this.bookingManager.saveData();
                session = null; // Reset session to null so new one can be created
            }

            // Skip if this is a response to an interactive message (already handled)
            if (msg.message.interactiveResponseMessage || msg.message.listResponseMessage) {
                console.log('⚠️ Skipping regular processing for interactive response');
                return;
            }

            // Only create new session if no session exists and user intends to book
            if ((bookingIntent || isListSelection || (msg.message.imageMessage && messageText.toLowerCase().includes('need'))) && !session) {
                const contextType = messageText.toLowerCase().includes('airport') ? 'airport' : 'chauffeur';
                const bookingId = this.bookingManager.createSession(phoneNumber, contextType);
                session = this.bookingManager.sessions[bookingId];

                // Track booking creation
                this.analytics.bookingsCreated++;

                // Send welcome message with rich format
                const welcomeResponse = this.responseFormatter.createListMessage(
                    "🚗 *Welcome to VIP Chauffeur Services!*",
                    "I'll help you book your chauffeur service. Choose an option:",
                    [
                        {
                            id: "book_now",
                            title: "📝 Book Now",
                            description: "Start a new booking with our AI assistant"
                        },
                        {
                            id: "voice_booking",
                            title: "🎤 Voice Booking",
                            description: "Send a voice message with your requirements"
                        },
                        {
                            id: "image_booking",
                            title: "📷 Image Booking",
                            description: "Share an image with booking details"
                        },
                        {
                            id: "view_services",
                            title: "🚗 View Services",
                            description: "See available vehicle options and pricing"
                        }
                    ]
                );
                await this.sock.sendMessage(msg.key.remoteJid, welcomeResponse);
            }

            // Handle list selections specifically
            if (isListSelection && session) {
                console.log(`🎯 Processing list selection: "${messageText}"`);

                // Process the selection through the booking flow
                if (messageText.includes('Book Now')) {
                    console.log(`📋 Book Now selected by ${phoneNumber}`);
                    await this.startBookingProcess(msg, phoneNumber);
                } else if (messageText.includes('View Services')) {
                    await this.showVehicleOptions(msg, phoneNumber);
                } else if (messageText.includes('Voice Booking')) {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: "🎤 Please send a voice message with your booking requirements and I'll process it using AI."
                    });
                } else if (messageText.includes('Image Booking')) {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: "📷 Please share an image with your booking details and I'll analyze it using AI vision."
                    });
                } else if (messageText.includes('Hourly Booking')) {
                    await this.handleBookingTypeSelection(msg, phoneNumber, 'Hourly Booking');
                } else if (messageText.includes('Transfer Booking')) {
                    await this.handleBookingTypeSelection(msg, phoneNumber, 'Transfer Booking');
                } else if (messageText.includes('Sedan')) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Sedan');
                } else if (messageText.includes('SUV')) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'SUV');
                } else if (messageText.includes('Luxury')) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Luxury');
                } else if (messageText.includes('Van')) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Van');
                } else {
                    // Process through AI booking flow
                    await this.processBookingStep(msg, phoneNumber, messageText, session);
                }
                return;
            }

            // If we have a session, process as part of booking flow
            if (session) {
                await this.processBookingStep(msg, phoneNumber, messageText, session);
            } else {
                // NEW: Use AI Response Generator for enhanced responses
                if (this.aiResponseGenerator) {
                    const userContext = this.contextManager.getUserContext(phoneNumber);

                    // Detect language and update context
                    const detectedLanguage = detectLanguage(messageText);
                    userContext.preferredLanguage = detectedLanguage;
                    this.contextManager.updateContext(phoneNumber, userContext);

                    // Generate personalized response using advanced AI features
                    const personalizedResponse = await this.generatePersonalizedResponse(messageText, phoneNumber);

                    if (personalizedResponse) {
                        // Send personalized response
                        await this.sock.sendMessage(msg.key.remoteJid, { text: personalizedResponse });

                        // Track AI response
                        this.analytics.aiResponsesGenerated++;

                        // Add to context history
                        this.contextManager.addMessageToHistory(phoneNumber, msg, 'user');
                        this.contextManager.addMessageToHistory(phoneNumber, {
                            key: { id: Date.now().toString() },
                            message: { conversation: personalizedResponse }
                        }, 'assistant');
                    } else {
                        // Fallback to AI Response Generator
                        const aiResponse = await this.aiResponseGenerator.generateResponse(messageText, userContext, phoneNumber);

                        // Track AI response
                        this.analytics.aiResponsesGenerated++;

                        // Add message to context history
                        this.contextManager.addMessageToHistory(phoneNumber, msg, 'user');

                        // Send AI-generated response with rich formats
                        await this.sendAIResponse(msg.key.remoteJid, aiResponse);

                        // Add bot response to context history
                        this.contextManager.addMessageToHistory(phoneNumber, {
                            key: { id: Date.now().toString() },
                            message: { conversation: aiResponse.message }
                        }, 'assistant');
                    }

                } else {
                    // Fallback to old system
                    await this.handleGeneralQuery(msg, phoneNumber, messageText);
                }
            }

        } catch (error) {
            console.error('❌ Error processing message:', error);

            // Track error
            this.analytics.errorsEncountered++;

            // Check if we've sent an error message recently to this number
            const phoneNumber = msg.key.remoteJid.replace('@c.us', '');
            const now = Date.now();
            const lastErrorTime = this.errorCooldown.get(phoneNumber) || 0;
            const cooldownPeriod = 30000; // 30 seconds cooldown

            if (now - lastErrorTime > cooldownPeriod) {
                await this.sendMessage(msg.key.remoteJid,
                    'I apologize, but I encountered an error processing your message. Please try again or send "book chauffeur" to start a new booking.');
                this.errorCooldown.set(phoneNumber, now);
            } else {
                console.log(`⚠️ Skipping error message to ${phoneNumber} due to cooldown`);
            }
        }
    }

    // Process list selection without creating infinite loops
    async processListSelection(phoneNumber, selectionText, originalMsg) {
        try {
            console.log(`🎯 Processing list selection: "${selectionText}" for ${phoneNumber}`);

            // Get or create booking session
            let session = this.bookingManager.getActiveSession(phoneNumber);

            // Handle specific list selections
            if (selectionText.includes('Book Now')) {
                console.log(`📋 Book Now selected by ${phoneNumber}`);
                await this.startBookingProcess(originalMsg, phoneNumber);
            } else if (selectionText.includes('View Services')) {
                await this.showVehicleOptions(originalMsg, phoneNumber);
            } else if (selectionText.includes('Voice Booking')) {
                await this.sock.sendMessage(originalMsg.key.remoteJid, {
                    text: "🎤 Please send a voice message with your booking requirements and I'll process it using AI."
                });
            } else if (selectionText.includes('Image Booking')) {
                await this.sock.sendMessage(originalMsg.key.remoteJid, {
                    text: "📷 Please share an image with your booking details and I'll analyze it using AI vision."
                });
            } else if (selectionText.includes('Hourly Booking')) {
                await this.handleBookingTypeSelection(originalMsg, phoneNumber, 'Hourly Booking');
            } else if (selectionText.includes('Transfer Booking')) {
                await this.handleBookingTypeSelection(originalMsg, phoneNumber, 'Transfer Booking');
            } else if (selectionText.includes('Sedan')) {
                await this.handleVehicleSelection(originalMsg, phoneNumber, 'Sedan');
            } else if (selectionText.includes('SUV')) {
                await this.handleVehicleSelection(originalMsg, phoneNumber, 'SUV');
            } else if (selectionText.includes('Luxury')) {
                await this.handleVehicleSelection(originalMsg, phoneNumber, 'Luxury');
            } else if (selectionText.includes('Van')) {
                await this.handleVehicleSelection(originalMsg, phoneNumber, 'Van');
            } else if (selectionText.includes('✅ Confirm') || selectionText.includes('Confirm')) {
                console.log(`🔘 Confirmation selected by ${phoneNumber}`);
                await this.handleConfirmationButton('confirm_booking', originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('✏️ Edit') || selectionText.includes('Edit')) {
                console.log(`🔘 Edit selected by ${phoneNumber}`);
                await this.handleConfirmationButton('edit_booking', originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('❌ Cancel') || selectionText.includes('Cancel')) {
                console.log(`🔘 Cancel selected by ${phoneNumber}`);
                await this.handleConfirmationButton('cancel_booking', originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('⏰ Number of Hours')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit number of hours selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'numberOfHours',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing numberOfHours`);
                }
                await this.askForNumberOfHours(originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('👤 Customer Name')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit customer name selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'customerName',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing customerName`);
                }
                await this.askForCustomerName(originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('📍 Pickup Location')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit pickup location selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'pickupLocation',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing pickupLocation`);
                }
                await this.askForPickupLocation(originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('👥 Passenger Count')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit passenger count selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'passengerCount',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing passengerCount`);
                }
                await this.askForPassengerCount(originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('🚗 Vehicle Type')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit vehicle type selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'vehicleType',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing vehicleType`);
                }
                await this.showVehicleTypeMenu(originalMsg.key.remoteJid, phoneNumber);
            } else if (selectionText.includes('📋 Booking Type')) {
                // Mark session as editing and set the field being edited
                const session = this.bookingManager.getActiveSession(phoneNumber);
                console.log(`🔧 Edit booking type selected for session:`, session?.bookingId);
                if (session) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        isEditing: true,
                        editingField: 'bookingType',
                        editStartedAt: new Date().toISOString()
                    });
                    console.log(`✅ Session marked as editing bookingType`);
                }
                await this.showBookingTypeMenu(originalMsg.key.remoteJid, phoneNumber);
            } else if (session) {
                // If we have a session, process as part of booking flow
                await this.processBookingStep(originalMsg, phoneNumber, selectionText, session);
            } else {
                // Generic response for unhandled selections
                await this.sock.sendMessage(originalMsg.key.remoteJid, {
                    text: `You selected: ${selectionText}\n\nI'm processing your selection. Please wait...`
                });
            }
        } catch (error) {
            console.error('❌ Error processing list selection:', error);
            await this.sock.sendMessage(originalMsg.key.remoteJid, {
                text: "Sorry, I encountered an error processing your selection. Please try again."
            });
        }
    }

    async handleInteractiveResponse(msg) {
        try {
            const phoneNumber = msg.key.remoteJid.replace('@c.us', '');

            // Check if number is whitelisted
            if (!this.isWhitelisted(phoneNumber)) {
                console.log(`🚫 Interactive response from ${phoneNumber} ignored: not whitelisted.`);
                return;
            }

            // Handle all interactive message types
            const interactiveResponse = msg.message.interactiveResponseMessage || msg.message.listResponseMessage || msg.message.buttonsMessage;
            let responseType = 'unknown';
            if (msg.message.interactiveResponseMessage) responseType = 'interactive';
            else if (msg.message.listResponseMessage) responseType = 'list';
            else if (msg.message.buttonsMessage) responseType = 'buttons';

            console.log(`🎯 ${responseType} response received from ${phoneNumber}:`, JSON.stringify(interactiveResponse, null, 2));

            // Handle button responses from interactive messages
            if (interactiveResponse.buttonReply) {
                const buttonId = interactiveResponse.buttonReply.id;
                const buttonText = interactiveResponse.buttonReply.title;

                console.log(`🔘 Button clicked: ${buttonId} - ${buttonText}`);

                // Handle booking flow button responses
                if (buttonId === 'confirm_booking') {
                    await this.handleBookingConfirmation(msg, phoneNumber);
                } else if (buttonId === 'edit_booking') {
                    await this.showEditOptions(msg.key.remoteJid, phoneNumber);
                } else if (buttonId === 'cancel_booking') {
                    await this.handleBookingCancel(msg, phoneNumber);
                } else if (buttonId === 'book_now') {
                    await this.startBookingProcess(msg, phoneNumber);
                } else if (buttonId === 'view_services') {
                    await this.showVehicleOptions(msg, phoneNumber);
                } else if (buttonId === 'make_payment' || buttonId === 'pay_now') {
                    await this.sendPaymentLink(msg.key.remoteJid, phoneNumber);
                } else if (buttonId === 'view_booking') {
                    await this.showBookingDetails(msg, phoneNumber);
                } else if (buttonId === 'contact_support') {
                    await this.showSupportOptions(msg, phoneNumber);
                } else if (buttonId === 'contact_driver') {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: "📞 *Contact Driver*\n\nDriver: Ahmed Hassan\nPhone: +971501234567\n\nYour driver will be available for your booking."
                    });
                } else if (buttonId === 'book_again') {
                    await this.startBookingProcess(msg, phoneNumber);
                } else if (buttonId === 'continue_booking') {
                    await this.continueExistingBooking(msg, phoneNumber);
                } else if (buttonId === 'cancel_booking') {
                    await this.cancelAndStartNewBooking(msg, phoneNumber);
                } else if (buttonId === 'view_booking') {
                    await this.showBookingDetails(msg, phoneNumber);
                } else {
                    // Generic button response
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `You selected: ${buttonText}\n\nHow can I help you further?`
                    });
                }
            }

            // Handle button messages (different from interactive button responses)
            else if (msg.message.buttonsMessage) {
                console.log(`🔘 Button message received from ${phoneNumber}`);

                // Button messages don't have buttonReply, they have the button content directly
                // We need to extract the button information from the message content
                const buttonMessage = msg.message.buttonsMessage;

                if (buttonMessage.contentText) {
                    console.log(`📝 Button message content: ${buttonMessage.contentText}`);

                    // Check if this is a confirmation message
                    if (buttonMessage.contentText.includes('Action Required') ||
                        buttonMessage.contentText.includes('confirmation') ||
                        buttonMessage.contentText.includes('confirm')) {
                        console.log(`✅ Confirmation message detected, processing booking confirmation`);

                        // Get the current session and process confirmation directly
                        const session = this.bookingManager.getActiveSession(phoneNumber);
                        if (session) {
                            // Process the confirmation directly instead of just showing it
                            await this.processBookingConfirmation(msg.key.remoteJid, phoneNumber, session);
                        } else {
                            await this.sock.sendMessage(msg.key.remoteJid, {
                                text: "❌ No active booking session found. Please start a new booking."
                            });
                        }
                    } else {
                        // Process the button message content as a regular message
                        // This will handle cases where buttons are used for navigation
                        await this.processMessage(msg);
                    }
                }
            }

            // Handle interactive button responses (when user clicks a button)
            else if (msg.message.interactiveResponseMessage && msg.message.interactiveResponseMessage.buttonReply) {
                console.log(`🔘 Interactive button response received from ${phoneNumber}`);

                const buttonReply = msg.message.interactiveResponseMessage.buttonReply;
                const buttonId = buttonReply.id;
                const buttonText = buttonReply.title;

                console.log(`🔘 Button clicked: ${buttonId} - "${buttonText}"`);

                // Handle confirmation buttons
                if (buttonId === 'confirm_booking' || buttonId === 'edit_booking' || buttonId === 'cancel_booking') {
                    await this.handleConfirmationButton(buttonId, msg.key.remoteJid, phoneNumber);
                } else {
                    // Handle other button types
                    console.log(`⚠️ Unknown button ID: ${buttonId}`);
                    await this.processMessage(msg);
                }
            }

            // Handle button responses that come as regular messages (fallback)
            else if (msg.message.conversation || msg.message.extendedTextMessage) {
                const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

                console.log(`📝 Processing message text: "${messageText}"`);

                // Check if user has an active session and is in confirmation state
                const session = this.bookingManager.getActiveSession(phoneNumber);
                if (session && session.data && Object.keys(session.data).length > 5) {
                    // Check if session is being edited - don't process confirmation during editing
                    if (session.data.isEditing) {
                        console.log(`⏸️ Session is being edited, skipping confirmation processing`);
                        return;
                    }

                    // User has a complete booking session, any message should be treated as confirmation
                    console.log(`🔘 User has complete booking session, processing confirmation: ${messageText}`);
                    await this.processBookingConfirmation(msg.key.remoteJid, phoneNumber, session);
                    return;
                }

                // Check if this is a button response by looking for button text patterns
                if (messageText.includes('✅ Confirm & Pay') || messageText.includes('Confirm & Pay') ||
                    messageText.includes('Confirm') || messageText.includes('confirm')) {
                    console.log(`🔘 Confirmation button clicked via text: ${messageText}`);
                    await this.handleConfirmationButton('confirm_booking', msg.key.remoteJid, phoneNumber);
                } else if (messageText.includes('✏️ Edit Details') || messageText.includes('Edit Details') ||
                    messageText.includes('Edit') || messageText.includes('edit')) {
                    console.log(`🔘 Edit button clicked via text: ${messageText}`);
                    await this.handleConfirmationButton('edit_booking', msg.key.remoteJid, phoneNumber);
                } else if (messageText.includes('❌ Cancel Booking') || messageText.includes('Cancel Booking') ||
                    messageText.includes('Cancel') || messageText.includes('cancel')) {
                    console.log(`🔘 Cancel button clicked via text: ${messageText}`);
                    await this.handleConfirmationButton('cancel_booking', msg.key.remoteJid, phoneNumber);
                } else {
                    // Process as regular message
                    await this.processMessage(msg);
                }
            }

            // Handle list responses (both interactiveResponseMessage.listReply and listResponseMessage)
            else if (interactiveResponse.listReply || interactiveResponse.singleSelectReply || interactiveResponse.title || interactiveResponse.description) {
                let listId, listTitle, selectionText;

                // Check for nested structure first
                if (interactiveResponse.listReply || interactiveResponse.singleSelectReply) {
                    const listReply = interactiveResponse.listReply || interactiveResponse.singleSelectReply;
                    listId = listReply.id || listReply.selectedRowId;
                    listTitle = listReply.title || listReply.selectedRowTitle;
                    console.log(`📋 Nested list response: ${listId} - ${listTitle}`);
                }
                // Check for direct structure
                else if (interactiveResponse.title || interactiveResponse.description) {
                    listId = interactiveResponse.title || interactiveResponse.id;
                    listTitle = interactiveResponse.description || interactiveResponse.title;
                    console.log(`📋 Direct list response: ${listId} - ${listTitle}`);
                }

                console.log(`📋 Full response object:`, JSON.stringify(interactiveResponse, null, 2));

                // Convert list selection to text for AI processing
                if (listTitle && listTitle !== 'undefined') {
                    selectionText = listTitle;
                } else if (interactiveResponse.title && interactiveResponse.title !== 'undefined') {
                    selectionText = interactiveResponse.title;
                } else if (interactiveResponse.description && interactiveResponse.description !== 'undefined') {
                    selectionText = interactiveResponse.description;
                } else {
                    // Fallback: try to extract from context info
                    if (interactiveResponse.contextInfo && interactiveResponse.contextInfo.quotedMessage) {
                        const quotedMsg = interactiveResponse.contextInfo.quotedMessage;
                        if (quotedMsg.listMessage && quotedMsg.listMessage.sections) {
                            // Find the selected row by matching the title
                            for (const section of quotedMsg.listMessage.sections) {
                                if (section.rows) {
                                    for (const row of section.rows) {
                                        if (row.title && interactiveResponse.title && row.title.includes(interactiveResponse.title.replace(/[📝🎤📷🚗]/g, '').trim())) {
                                            selectionText = row.title;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                console.log(`📝 Converted selection to text: "${selectionText}"`);

                // If we have a valid selection text, process it through AI booking flow
                if (selectionText && selectionText !== 'undefined' && selectionText.trim() !== '') {
                    console.log(`🤖 Processing selection as text: "${selectionText}"`);

                    // Process the selection directly without creating a new message object
                    // to avoid infinite loops
                    await this.processListSelection(phoneNumber, selectionText, msg);
                    return;
                }

                // Fallback to original handling if text conversion fails
                if (listId === 'book_now' || (listId && listId.includes('Book Now'))) {
                    console.log(`📋 Book Now selected by ${phoneNumber}`);
                    await this.startBookingProcess(msg, phoneNumber);
                } else if (listId === 'hourly_booking' || (listId && listId.includes('Hourly'))) {
                    await this.handleBookingTypeSelection(msg, phoneNumber, 'Hourly Booking');
                } else if (listId === 'transfer_booking' || (listId && listId.includes('Transfer'))) {
                    await this.handleBookingTypeSelection(msg, phoneNumber, 'Transfer Booking');
                } else if (listId === 'vehicle_sedan' || (listId && listId.includes('Sedan'))) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Sedan');
                } else if (listId === 'vehicle_suv' || (listId && listId.includes('SUV'))) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'SUV');
                } else if (listId === 'vehicle_luxury' || (listId && listId.includes('Luxury'))) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Luxury');
                } else if (listId === 'vehicle_van' || (listId && listId.includes('Van'))) {
                    await this.handleVehicleSelection(msg, phoneNumber, 'Van');
                } else if (listId === 'edit_booking_type') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit booking type selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'bookingType',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing bookingType`);
                    }
                    await this.showBookingTypeMenu(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_vehicle_type') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit vehicle type selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'vehicleType',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing vehicleType`);
                    }
                    await this.showVehicleTypeMenu(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_customer_name') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit customer name selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'customerName',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing customerName`);
                    }
                    await this.askForCustomerName(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_pickup_location') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit pickup location selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'pickupLocation',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing pickupLocation`);
                    }
                    await this.askForPickupLocation(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_drop_location') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit drop location selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'dropLocation',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing dropLocation`);
                    }
                    await this.askForDropLocation(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_luggage_info') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit luggage info selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'luggageInfo',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing luggageInfo`);
                    }
                    await this.askForLuggageInfo(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'confirm_booking' || (listId && listId.includes('Confirm'))) {
                    console.log(`🔘 Confirmation selected by ${phoneNumber}`);
                    await this.handleConfirmationButton('confirm_booking', msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_booking' || (listId && listId.includes('Edit'))) {
                    console.log(`🔘 Edit selected by ${phoneNumber}`);
                    await this.handleConfirmationButton('edit_booking', msg.key.remoteJid, phoneNumber);
                } else if (listId === 'cancel_booking' || (listId && listId.includes('Cancel'))) {
                    console.log(`🔘 Cancel selected by ${phoneNumber}`);
                    await this.handleConfirmationButton('cancel_booking', msg.key.remoteJid, phoneNumber);
                } else if (listId === 'back_to_confirmation' || (listId && listId.includes('Back to Confirmation'))) {
                    console.log(`🔘 Back to confirmation selected by ${phoneNumber}`);
                    // Clear editing state and show confirmation again
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: false,
                            editCompletedAt: new Date().toISOString()
                        });
                        await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
                    }
                } else if (listId === 'edit_passenger_count') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit passenger count selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'passengerCount',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing passengerCount`);
                    }
                    await this.askForPassengerCount(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_number_of_hours') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit number of hours selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'numberOfHours',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing numberOfHours`);
                    }
                    await this.askForNumberOfHours(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'edit_special_requests') {
                    // Mark session as editing and set the field being edited
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    console.log(`🔧 Edit special requests selected for session:`, session?.bookingId);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: true,
                            editingField: 'specialRequests',
                            editStartedAt: new Date().toISOString()
                        });
                        console.log(`✅ Session marked as editing specialRequests`);
                    }
                    await this.askForSpecialRequests(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'move_to_confirmation') {
                    // Move to confirmation screen - show details first
                    console.log(`🔘 Move to confirmation selected by ${phoneNumber}`);

                    // Clear editing state first
                    const session = this.bookingManager.getActiveSession(phoneNumber);
                    if (session) {
                        this.bookingManager.updateSession(session.bookingId, null, 'system', {
                            isEditing: false,
                            editingField: null,
                            editCompletedAt: new Date().toISOString()
                        });
                    }

                    // Show confirmation details
                    await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
                } else if (listId === 'special_water_bottle') {
                    await this.handleSpecialRequestSelection(msg, phoneNumber, 'Water Bottle');
                } else if (listId === 'special_baby_seat') {
                    await this.handleSpecialRequestSelection(msg, phoneNumber, 'Baby Seat');
                } else if (listId === 'special_wheelchair') {
                    await this.handleSpecialRequestSelection(msg, phoneNumber, 'Wheelchair Access');
                } else if (listId === 'special_none') {
                    await this.handleSpecialRequestSelection(msg, phoneNumber, 'None');
                } else if (listId === 'luggage_0') {
                    await this.handleLuggageSelection(msg, phoneNumber, '0 pieces');
                } else if (listId === 'luggage_1') {
                    await this.handleLuggageSelection(msg, phoneNumber, '1 piece');
                } else if (listId === 'luggage_2') {
                    await this.handleLuggageSelection(msg, phoneNumber, '2 pieces');
                } else if (listId === 'luggage_3') {
                    await this.handleLuggageSelection(msg, phoneNumber, '3 pieces');
                } else if (listId === 'luggage_4') {
                    await this.handleLuggageSelection(msg, phoneNumber, '4 pieces');
                } else if (listId === 'luggage_5') {
                    await this.handleLuggageSelection(msg, phoneNumber, '5+ pieces');
                } else if (listId === 'voice_booking') {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: "🎤 Please send a voice message with your booking requirements and I'll process it using AI."
                    });
                } else if (listId === 'image_booking') {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: "📷 Please share an image with your booking details and I'll analyze it using AI vision."
                    });
                } else if (listId === 'view_services') {
                    await this.showVehicleOptions(msg, phoneNumber);
                } else {
                    console.log(`⚠️ Unhandled list response: ${listId} - ${listTitle}`);
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `You selected: ${listTitle}\n\nI'm processing your selection. Please wait...`
                    });
                }
            }
            // Handle other types of interactive responses
            else {
                console.log(`⚠️ Unhandled interactive response type:`, Object.keys(interactiveResponse));
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: "I received your selection but couldn't process it. Please try again."
                });
            }

        } catch (error) {
            console.error('❌ Error handling interactive response:', error);
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "Sorry, I encountered an error processing your selection. Please try again."
            });
        }
    }

    async startBookingProcess(msg, phoneNumber) {
        console.log(`🚀 Starting booking process for ${phoneNumber}`);

        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            console.log(`📋 Creating new booking session for ${phoneNumber}`);
            const bookingId = this.bookingManager.createSession(phoneNumber, 'chauffeur');
            const newSession = this.bookingManager.sessions[bookingId];

            // Initialize current step
            this.bookingManager.updateSession(bookingId, null, 'system', { currentStep: 1 });

            // Track booking creation
            this.analytics.bookingsCreated++;

            console.log(`📋 New session created: ${bookingId}, current step: 1`);

            // Step 1: Booking Type Selection
            console.log(`📋 About to show booking type menu to ${msg.key.remoteJid}`);
            await this.showBookingTypeMenu(msg.key.remoteJid, phoneNumber);
            console.log(`✅ Booking type menu sent successfully`);
        } else {
            console.log(`📋 Existing session found: ${session.bookingId}, current step: ${session.data.currentStep}`);

            // If session exists but no current step, reset to step 1
            if (!session.data.currentStep) {
                this.bookingManager.updateSession(session.bookingId, null, 'system', { currentStep: 1 });
                await this.showBookingTypeMenu(msg.key.remoteJid, phoneNumber);
            } else {
                // Continue with existing session - show options
                await this.sock.sendMessage(msg.key.remoteJid, {
                    text: `You already have an active booking session (${session.bookingId}). What would you like to do?`,
                    buttons: [
                        { buttonId: 'continue_booking', buttonText: { displayText: 'Continue Booking' }, type: 1 },
                        { buttonId: 'cancel_booking', buttonText: { displayText: 'Cancel & Start New' }, type: 1 },
                        { buttonId: 'view_booking', buttonText: { displayText: 'View Current Details' }, type: 1 }
                    ],
                    headerType: 1
                });
            }
        }
    }

    // Step 1: Show booking type menu
    async showBookingTypeMenu(jid, phoneNumber) {
        console.log(`📋 Showing booking type menu for ${phoneNumber}`);

        // Get dynamic step numbers (booking type is always step 1)
        const stepNumber = 1;
        const totalSteps = 9; // Default total steps for display

        const bookingTypeResponse = this.responseFormatter.createListMessage(
            `🚗 *Step ${stepNumber}/${totalSteps}: Choose Booking Type*`,
            `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\nWelcome to VIP Chauffeur Services!\nPlease select your booking type:`,
            [
                {
                    id: "hourly_booking",
                    title: "⏰ Hourly Booking",
                    description: "Book for multiple hours with flexible timing"
                },
                {
                    id: "transfer_booking",
                    title: "🚕 Transfer Booking",
                    description: "Point-to-point transfer service"
                }
            ]
        );

        console.log(`📋 Sending booking type menu to ${jid}`);
        await this.sock.sendMessage(jid, bookingTypeResponse);
        console.log(`✅ Booking type menu sent successfully`);
    }

    // Step 2: Show vehicle type menu
    async showVehicleTypeMenu(jid, phoneNumber) {
        // Get dynamic step numbers (vehicle type is always step 2)
        const stepNumber = 2;
        const totalSteps = 9; // Default total steps for display

        const vehicleResponse = this.responseFormatter.createListMessage(
            `🚗 *Step ${stepNumber}/${totalSteps}: Select Vehicle Type*`,
            `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\nChoose your preferred vehicle:`,
            [
                {
                    id: "vehicle_sedan",
                    title: "🚙 Sedan",
                    description: "AED 120 base + AED 3/km - Perfect for 1-4 passengers"
                },
                {
                    id: "vehicle_suv",
                    title: "🚗 SUV",
                    description: "AED 180 base + AED 4/km - Great for 1-6 passengers"
                },
                {
                    id: "vehicle_luxury",
                    title: "🏎️ Luxury (Maybach)",
                    description: "AED 350 base + AED 8/km - Premium experience for 1-4 passengers"
                },
                {
                    id: "vehicle_van",
                    title: "🚐 Van (6+ seats)",
                    description: "AED 220 base + AED 5/km - Ideal for groups of 6+ passengers"
                }
            ]
        );
        await this.sock.sendMessage(jid, vehicleResponse);
    }

    // Step 3: Ask for customer name
    async askForCustomerName(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Transfer Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('customerName', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        if (isEditing) {
            // If editing, just ask for new name (editingField already set)
            await this.sock.sendMessage(jid, {
                text: "👤 *Edit Customer Name*\n\nPlease provide the new customer's full name:"
            });
        } else {
            await this.sock.sendMessage(jid, {
                text: progressText + `👤 *Step ${stepNumber}/${totalSteps}: Customer Information*\n\nPlease provide the customer's full name:`
            });
        }
    }

    // Step 4: Ask for pickup location
    async askForPickupLocation(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Transfer Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('pickupLocation', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        if (isEditing) {
            // If editing, ask for new pickup location
            await this.sock.sendMessage(jid, {
                text: "📍 *Edit Pickup Location*\n\nPlease provide the new pickup location:\n\n• Send your current location\n• Or type the address\n• Or share location on map"
            });
        } else {
            await this.sock.sendMessage(jid, {
                text: progressText + `📍 *Step ${stepNumber}/${totalSteps}: Pickup Location*\n\nPlease share your pickup location:\n\n• Send your current location\n• Or type the address\n• Or share location on map`
            });
        }
    }

    // Step 5: Ask for drop location (only for transfer booking)
    async askForDropLocation(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Transfer Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('dropLocation', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        if (isEditing) {
            // If editing, ask for new drop location
            await this.sock.sendMessage(jid, {
                text: "🎯 *Edit Drop-off Location*\n\nPlease provide the new drop-off location:\n\n• Send your destination location\n• Or type the address\n• Or share location on map"
            });
        } else {
            await this.sock.sendMessage(jid, {
                text: progressText + `🎯 *Step ${stepNumber}/${totalSteps}: Drop-off Location*\n\nPlease share your drop-off location:\n\n• Send your destination location\n• Or type the address\n• Or share location on map`
            });
        }
    }

    // Step 6: Ask for luggage information (for both booking types)
    async askForLuggageInfo(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Transfer Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('luggageInfo', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        // Show luggage selection menu for both booking types
        const luggageResponse = this.responseFormatter.createListMessage(
            isEditing ? "🧳 *Edit Luggage Count*" : `🧳 *Step ${stepNumber}/${totalSteps}: Luggage Count*`,
            progressText + (isEditing ? "Please select the new number of luggage pieces:" : "How many pieces of luggage will you have?"),
            [
                {
                    id: "luggage_0",
                    title: "0 pieces",
                    description: "No luggage"
                },
                {
                    id: "luggage_1",
                    title: "1 piece",
                    description: "Small bag or backpack"
                },
                {
                    id: "luggage_2",
                    title: "2 pieces",
                    description: "Small suitcase + handbag"
                },
                {
                    id: "luggage_3",
                    title: "3 pieces",
                    description: "Medium suitcase + 2 small bags"
                },
                {
                    id: "luggage_4",
                    title: "4 pieces",
                    description: "Large suitcase + 3 small bags"
                },
                {
                    id: "luggage_5",
                    title: "5+ pieces",
                    description: "Multiple large suitcases"
                }
            ]
        );
        await this.sock.sendMessage(jid, luggageResponse);
    }

    // Step 7: Ask for number of hours (for hourly booking)
    async askForNumberOfHours(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Hourly Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('numberOfHours', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        if (isEditing) {
            // If editing, ask for new number of hours
            await this.sock.sendMessage(jid, {
                text: "⏰ *Edit Number of Hours*\n\nPlease provide the new number of hours:\n\nEnter the number of hours (e.g., 2, 4, 8, 12):"
            });
        } else {
            await this.sock.sendMessage(jid, {
                text: progressText + `⏰ *Step ${stepNumber}/${totalSteps}: Number of Hours*\n\nHow many hours do you need the chauffeur service?\n\nPlease enter the number of hours (e.g., 2, 4, 8, 12):`
            });
        }
    }


    // Step 8: Ask for number of passengers
    async askForPassengerCount(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        const isEditing = session && session.data.isEditing;
        const bookingType = session ? session.data.bookingType : 'Transfer Booking';

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('passengerCount', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        if (isEditing) {
            // If editing, ask for new passenger count
            await this.sock.sendMessage(jid, {
                text: "👥 *Edit Number of Passengers*\n\nPlease provide the new number of passengers:\n\nEnter the number of passengers (1-20):"
            });
        } else {
            await this.sock.sendMessage(jid, {
                text: progressText + `👥 *Step ${stepNumber}/${totalSteps}: Number of Passengers*\n\nHow many passengers will be traveling?\n\nPlease enter the number of passengers (1-20):`
            });
        }
    }

    // Step 9: Ask for special requests
    async askForSpecialRequests(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) return;

        const isEditing = session.data.isEditing;
        const bookingType = session.data.bookingType;

        // Get dynamic step numbers
        const stepNumber = this.getDisplayStepNumber('specialRequests', bookingType);
        const totalSteps = this.getTotalSteps(bookingType);

        // Show progress indicator
        const progressText = isEditing ? "" : `📋 *Booking Progress: ${stepNumber}/${totalSteps}*\n\n`;

        const specialRequestsMessage = ResponseFormatter.createListMessage({
            header: isEditing ? "🎯 Edit Special Requests" : `🎯 Step ${stepNumber}/${totalSteps}: Special Requests`,
            body: progressText + (isEditing ? "Please select new special requests for your booking:" : "Do you have any special requests for your booking?"),
            footer: "Select an option or type your request",
            rows: [
                {
                    id: "special_water_bottle",
                    title: "💧 Water Bottle",
                    description: "Request complimentary water bottles"
                },
                {
                    id: "special_baby_seat",
                    title: "👶 Baby Seat",
                    description: "Request child safety seat"
                },
                {
                    id: "special_wheelchair",
                    title: "♿ Wheelchair Access",
                    description: "Request wheelchair accessible vehicle"
                },
                {
                    id: "special_none",
                    title: "❌ No Special Requests",
                    description: "Continue without special requests"
                }
            ],
            buttonText: "Select Request"
        });

        await this.sock.sendMessage(jid, specialRequestsMessage);
    }

    // Step 8: Show booking confirmation
    async showBookingConfirmation(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(jid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        const bookingDetails = await this.formatBookingConfirmation(session);

        // Create confirmation list menu as requested
        const confirmationMessage = {
            text: `📋 *Booking Confirmation*\n\n${bookingDetails}\n\nPlease review your booking details and choose an action:`,
            sections: [
                {
                    title: "🎯 *Confirmation Options*",
                    rows: [
                        {
                            id: "confirm_booking",
                            title: "✅ Confirm & Pay",
                            description: "Confirm booking and proceed to payment"
                        },
                        {
                            id: "edit_booking",
                            title: "✏️ Edit Details",
                            description: "Modify booking details"
                        },
                        {
                            id: "cancel_booking",
                            title: "❌ Cancel Booking",
                            description: "Cancel this booking"
                        }
                    ]
                }
            ],
            buttonText: "Select Action",
            headerType: 1
        };

        await this.sock.sendMessage(jid, confirmationMessage);
    }

    // Format booking confirmation details with dynamic pricing
    async formatBookingConfirmation(session) {
        let details = `*Booking ID:* ${session.bookingId}\n`;
        details += `*Booking Type:* ${session.data.bookingType || 'Not specified'}\n`;
        details += `*Vehicle Type:* ${session.data.vehicleType || 'Not specified'}\n`;
        details += `*Customer Name:* ${session.data.customerName || 'Not specified'}\n`;
        details += `*Pickup Location:* ${session.data.pickupLocation || 'Not specified'}\n`;

        if (session.data.bookingType === 'Transfer Booking') {
            details += `*Drop Location:* ${session.data.dropLocation || 'Not specified'}\n`;
        }

        if (session.data.bookingType === 'Hourly Booking') {
            details += `*Number of Hours:* ${session.data.numberOfHours || 'Not specified'}\n`;
        } else {
            details += `*Luggage Info:* ${session.data.luggageInfo || 'Not specified'}\n`;
        }
        details += `*Passengers:* ${session.data.passengerCount || 'Not specified'}\n`;
        details += `*Special Requests:* ${session.data.specialRequests || 'None'}\n`;

        // Calculate dynamic pricing
        if (session.data.vehicleType) {
            try {
                console.log('🔄 Attempting to calculate pricing for confirmation');
                const pricing = await this.calculateBookingPricing(session);

                if (pricing && pricing.finalPrice) {
                    console.log('✅ Pricing calculated successfully, formatting details');
                    details += `\n*Pricing Details:*\n`;
                    details += `• Base Rate: ${pricing.currency || 'AED'} ${pricing.baseRate}\n`;

                    if (session.data.bookingType === 'Transfer Booking') {
                        details += `• Per KM: ${pricing.currency || 'AED'} ${pricing.perKmRate}\n`;
                        details += `• Distance: ${pricing.distance} km\n`;
                        details += `• Distance Cost: ${pricing.currency || 'AED'} ${pricing.distancePrice}\n`;
                    } else if (session.data.bookingType === 'Hourly Booking') {
                        details += `• Per Hour: ${pricing.currency || 'AED'} ${pricing.perHourRate}\n`;
                        details += `• Hours: ${session.data.numberOfHours || pricing.hours}\n`;
                        details += `• Hourly Cost: ${pricing.currency || 'AED'} ${pricing.hourlyPrice}\n`;
                    }

                    details += `• Subtotal: ${pricing.currency || 'AED'} ${pricing.subtotal}\n`;

                    if (pricing.surgeMultiplier && pricing.surgeMultiplier > 1.0) {
                        details += `• Surge Multiplier: ${pricing.surgeMultiplier}x\n`;
                        if (pricing.appliedFactors) {
                            const factors = [];
                            if (pricing.appliedFactors.peakHour) factors.push('Peak Hour');
                            if (pricing.appliedFactors.weekend) factors.push('Weekend');
                            if (pricing.appliedFactors.holiday) factors.push('Holiday');
                            if (factors.length > 0) {
                                details += `• Applied: ${factors.join(', ')}\n`;
                            }
                        }
                    }

                    details += `• *Final Price: ${pricing.currency || 'AED'} ${pricing.finalPrice}*\n`;

                    if (pricing.status === 'fallback') {
                        details += `\n*Note: Estimated pricing used due to system maintenance*\n`;
                    }

                    // Store pricing in session for later use
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        pricing: pricing,
                        calculatedAt: new Date().toISOString()
                    });
                } else {
                    throw new Error('Invalid pricing object returned');
                }

            } catch (error) {
                console.error('❌ Error calculating pricing:', error);
                console.log('🔄 Using emergency fallback pricing display');

                // Emergency fallback to default pricing
                const defaultPricing = this.getVehiclePricing(session.data.vehicleType);
                details += `\n*Pricing (Estimated):*\n`;
                details += `• Base Rate: AED ${defaultPricing.base}\n`;
                details += `• Per KM: AED ${defaultPricing.perKm}\n`;
                details += `• *Estimated Total: AED ${defaultPricing.estimatedTotal}*\n`;
                details += `\n*Note: System maintenance - final pricing will be confirmed*\n`;
            }
        } else {
            details += `\n*Pricing will be calculated after vehicle selection*\n`;
        }

        return details;
    }

    // Get vehicle pricing
    getVehiclePricing(vehicleType) {
        const pricing = {
            'Sedan': { base: 120, perKm: 3, estimatedTotal: 195 },
            'SUV': { base: 180, perKm: 4, estimatedTotal: 280 },
            'Luxury': { base: 350, perKm: 8, estimatedTotal: 550 },
            'Van': { base: 220, perKm: 5, estimatedTotal: 345 }
        };
        return pricing[vehicleType] || { base: 0, perKm: 0, estimatedTotal: 0 };
    }

    // Get fallback pricing when service fails
    getFallbackPricing(vehicleType, bookingType, numberOfHours) {
        console.log(`🔄 Using fallback pricing for ${vehicleType} - ${bookingType}`);

        const pricing = {
            'Sedan': { baseRate: 120, perHourRate: 25, perKmRate: 3, minimumCharge: 120 },
            'SUV': { baseRate: 180, perHourRate: 35, perKmRate: 4, minimumCharge: 180 },
            'Luxury': { baseRate: 350, perHourRate: 60, perKmRate: 8, minimumCharge: 350 },
            'Van': { baseRate: 220, perHourRate: 40, perKmRate: 5, minimumCharge: 220 }
        };

        const vehiclePricing = pricing[vehicleType] || pricing['Sedan'];
        const hours = parseInt(numberOfHours) || 2;

        if (bookingType === 'Hourly Booking') {
            const hourlyPrice = vehiclePricing.perHourRate * hours;
            const subtotal = vehiclePricing.baseRate + hourlyPrice;
            const finalPrice = Math.max(subtotal, vehiclePricing.minimumCharge);

            console.log(`✅ Fallback hourly pricing: AED ${finalPrice} (${hours} hours)`);

            return {
                baseRate: vehiclePricing.baseRate,
                perHourRate: vehiclePricing.perHourRate,
                hours: hours,
                hourlyPrice: hourlyPrice,
                subtotal: subtotal,
                minimumCharge: vehiclePricing.minimumCharge,
                finalPrice: finalPrice,
                currency: 'AED',
                bookingType: 'Hourly',
                status: 'fallback',
                calculatedAt: new Date(),
                surgeMultiplier: 1.0
            };
        } else {
            // Transfer booking - estimate 25km distance
            const distance = 25;
            const distancePrice = vehiclePricing.perKmRate * distance;
            const subtotal = vehiclePricing.baseRate + distancePrice;
            const finalPrice = Math.max(subtotal, vehiclePricing.minimumCharge);

            console.log(`✅ Fallback transfer pricing: AED ${finalPrice} (${distance}km)`);

            return {
                baseRate: vehiclePricing.baseRate,
                perKmRate: vehiclePricing.perKmRate,
                distance: distance,
                distancePrice: distancePrice,
                subtotal: subtotal,
                minimumCharge: vehiclePricing.minimumCharge,
                finalPrice: finalPrice,
                currency: 'AED',
                bookingType: 'Transfer',
                status: 'fallback',
                calculatedAt: new Date(),
                surgeMultiplier: 1.0,
                distanceInfo: {
                    distance: distance,
                    duration: Math.round((distance / 30) * 60), // Estimated duration
                    status: 'estimated'
                }
            };
        }
    }

    // Handle confirmation button clicks
    async handleConfirmationButton(buttonId, jid, phoneNumber) {
        console.log(`🔘 Handling confirmation button: ${buttonId}`);

        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(jid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        switch (buttonId) {
            case 'confirm_booking':
                await this.processBookingConfirmation(jid, phoneNumber, session);
                break;
            case 'edit_booking':
                await this.showEditOptions(jid, phoneNumber);
                break;
            case 'cancel_booking':
                await this.cancelBooking(jid, phoneNumber, session);
                break;
            default:
                console.log(`⚠️ Unknown confirmation button: ${buttonId}`);
        }
    }

    // Process booking confirmation and generate payment link
    async processBookingConfirmation(jid, phoneNumber, session) {
        try {
            console.log('✅ Processing booking confirmation...');

            // Check if session is cancelled or being edited
            if (session.data.status === 'cancelled') {
                console.log('⚠️ Cannot confirm cancelled booking');
                await this.sock.sendMessage(jid, {
                    text: "❌ This booking has been cancelled. Please start a new booking."
                });
                return;
            }

            // Clear editing state if it exists
            if (session.data.isEditing) {
                console.log('🔄 Clearing editing state before confirmation');
                this.bookingManager.updateSession(session.bookingId, null, 'system', {
                    isEditing: false,
                    editingField: null,
                    editCompletedAt: new Date().toISOString()
                });
            }

            // Confirm the booking in the system
            const confirmationId = await this.bookingManager.confirmBooking(session.bookingId);

            if (!confirmationId) {
                throw new Error('Failed to confirm booking');
            }

            // Generate payment link
            const paymentLink = await this.generatePaymentLink(session);

            // Send confirmation message with payment link
            const confirmationMessage = `🎉 *Booking Confirmed Successfully!*\n\n` +
                `*Confirmation ID:* ${confirmationId}\n` +
                `*Booking ID:* ${session.bookingId}\n\n` +
                `💳 *Payment Link:*\n${paymentLink}\n\n` +
                `⏰ *Payment expires in 24 hours*\n` +
                `📞 *Contact us if you need assistance*\n\n` +
                `Thank you for choosing our service!`;

            console.log(`📤 Sending confirmation message with payment link: ${paymentLink}`);

            await this.sock.sendMessage(jid, {
                text: confirmationMessage
            });

            console.log(`✅ Booking ${session.bookingId} confirmed with payment link sent`);

        } catch (error) {
            console.error('❌ Error processing booking confirmation:', error);
            await this.sock.sendMessage(jid, {
                text: "❌ Sorry, there was an error confirming your booking. Please try again or contact support."
            });
        }
    }

    // Generate payment link for booking
    async generatePaymentLink(session) {
        try {
            console.log('💳 Generating payment link...');

            // Get pricing from session or calculate fallback
            let pricing = session.data.pricing;
            if (!pricing) {
                pricing = await this.calculateBookingPricing(session);
            }

            const amount = pricing.finalPrice || 200; // Default fallback amount
            const currency = pricing.currency || 'AED';

            // Generate PayPal.me link (proper format)
            const paypalUsername = process.env.PAYPAL_USERNAME || 'vipchauffeur';
            const description = `Booking ${session.bookingId} - ${session.data.vehicleType || 'Chauffeur Service'}`;

            // PayPal.me format: https://paypal.me/username/amount
            const paymentLink = `https://paypal.me/${paypalUsername}/${amount}${currency}?description=${encodeURIComponent(description)}`;

            console.log(`✅ Payment link generated: ${paymentLink}`);
            return paymentLink;

        } catch (error) {
            console.error('❌ Error generating payment link:', error);
            // Return a fallback payment instruction
            return `Please contact us at +971-50-123-4567 to complete payment for booking ${session.bookingId}`;
        }
    }

    // Cancel booking
    async cancelBooking(jid, phoneNumber, session) {
        try {
            console.log(`❌ Cancelling booking ${session.bookingId}`);

            // Update session status to cancelled and clear the session
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
            });

            // Remove the session to prevent further processing
            this.bookingManager.sessions[session.bookingId] = null;
            delete this.bookingManager.sessions[session.bookingId];

            await this.sock.sendMessage(jid, {
                text: `❌ *Booking Cancelled*\n\nBooking ${session.bookingId} has been cancelled.\n\nType "book" to start a new booking.`
            });

        } catch (error) {
            console.error('❌ Error cancelling booking:', error);
            await this.sock.sendMessage(jid, {
                text: "❌ Error cancelling booking. Please try again."
            });
        }
    }


    // Send payment link
    async sendPaymentLink(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(jid, {
                text: "❌ No active booking session found."
            });
            return;
        }

        // Calculate pricing
        const pricing = await this.calculateBookingPricing(session);
        const totalAmount = pricing.finalPrice || pricing.total || 0;

        // Generate PayPal payment link
        const paypalUrl = this.generatePayPalPaymentLink(session, totalAmount);

        const paymentResponse = this.responseFormatter.createButtonMessage(
            "💳 *Payment Required*",
            `*Booking ID:* ${session.bookingId}\n*Total Amount:* AED ${totalAmount}\n\nPlease complete your payment to confirm the booking.\n\n*PayPal Payment Link:*\n${paypalUrl}`,
            [
                { id: "pay_now", text: "💳 Pay with PayPal" },
                { id: "view_booking", text: "📋 View Booking Details" },
                { id: "contact_support", text: "📞 Contact Support" }
            ]
        );
        await this.sock.sendMessage(jid, paymentResponse);
    }

    // Generate PayPal payment link
    generatePayPalPaymentLink(session, amount) {
        // Use a more realistic PayPal.me link format
        const businessEmail = "vipchauffeur"; // Replace with actual PayPal username
        const baseUrl = `https://www.paypal.me/${businessEmail}`;

        const params = new URLSearchParams({
            amount: amount,
            currency: 'AED',
            description: `VIP Chauffeur Booking - ${session.bookingId}`,
            item_name: `${session.data.bookingType} - ${session.data.vehicleType}`,
            custom: session.bookingId
        });

        return `${baseUrl}?${params.toString()}`;
    }

    // Continue existing booking
    async continueExistingBooking(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking session found. Starting a new booking process..."
            });
            await this.startBookingProcess(msg, phoneNumber);
            return;
        }

        // Continue with the existing session by analyzing missing fields
        await this.sock.sendMessage(msg.key.remoteJid, {
            text: `✅ Continuing with your booking (${session.bookingId})...`
        });

        // Analyze what's missing and continue the flow
        setTimeout(async () => {
            await this.analyzeAndRequestMissingInfo(msg, phoneNumber, session);
        }, 1000);
    }

    // Cancel existing booking and start new one
    async cancelAndStartNewBooking(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (session) {
            // Cancel the existing session
            this.bookingManager.cancelSession(session.bookingId);
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: `❌ Cancelled booking ${session.bookingId}\n\nStarting a new booking process...`
            });
        } else {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "Starting a new booking process..."
            });
        }

        // Start new booking process
        setTimeout(async () => {
            await this.startBookingProcess(msg, phoneNumber);
        }, 1000);
    }

    // Send driver information
    async sendDriverInfo(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(jid, {
                text: "❌ No active booking session found."
            });
            return;
        }

        // Simulate driver assignment
        const driverInfo = {
            name: "Ahmed Hassan",
            phone: "+971501234567",
            vehicle: session.data.vehicleType,
            plateNumber: "ABC-1234",
            rating: "4.9",
            experience: "5 years"
        };

        const driverResponse = this.responseFormatter.createButtonMessage(
            "👨‍✈️ *Driver Assigned*",
            `*Booking Confirmed!*\n\n*Driver Details:*\n• Name: ${driverInfo.name}\n• Phone: ${driverInfo.phone}\n• Vehicle: ${driverInfo.vehicle}\n• Plate: ${driverInfo.plateNumber}\n• Rating: ⭐ ${driverInfo.rating}\n• Experience: ${driverInfo.experience}\n\nYour driver will contact you 30 minutes before pickup.`,
            [
                { id: "contact_driver", text: "📞 Contact Driver" },
                { id: "view_booking", text: "📋 View Booking" },
                { id: "book_again", text: "🔄 Book Again" }
            ]
        );
        await this.sock.sendMessage(jid, driverResponse);
    }

    // Handle booking type selection
    async handleBookingTypeSelection(msg, phoneNumber, bookingType) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        // Check if this is an edit operation
        if (session.data.isEditing && session.data.editingField === 'bookingType') {
            // Update the booking type during edit
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                bookingType: bookingType,
                isEditing: false,
                editingField: null,
                editCompletedAt: new Date().toISOString()
            });

            console.log(`✅ Updated bookingType during edit: ${bookingType}`);

            // Recalculate pricing due to booking type change
            console.log(`💰 Recalculating pricing due to bookingType update`);
            await this.calculateBookingPricing(session);

            // Show edit options instead of confirmation
            await this.showEditOptions(msg.key.remoteJid, phoneNumber);
        } else {
            // Regular booking flow
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                bookingType: bookingType,
                currentStep: 2
            });

            // Show vehicle menu immediately
            await this.showVehicleTypeMenu(msg.key.remoteJid, phoneNumber);
        }
    }

    // Handle vehicle selection
    async handleVehicleSelection(msg, phoneNumber, vehicleType) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        // Check if this is an edit operation
        if (session.data.isEditing && session.data.editingField === 'vehicleType') {
            // Update the vehicle type during edit
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                vehicleType: vehicleType,
                isEditing: false,
                editingField: null,
                editCompletedAt: new Date().toISOString()
            });

            console.log(`✅ Updated vehicleType during edit: ${vehicleType}`);

            // Recalculate pricing due to vehicle type change
            console.log(`💰 Recalculating pricing due to vehicleType update`);
            await this.calculateBookingPricing(session);

            // Show edit options instead of confirmation
            await this.showEditOptions(msg.key.remoteJid, phoneNumber);
        } else {
            // Regular booking flow
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                vehicleType: vehicleType,
                currentStep: 3
            });

            // Ask for customer name immediately
            await this.askForCustomerName(msg.key.remoteJid, phoneNumber);
        }
    }

    // Handle special request selection
    async handleSpecialRequestSelection(msg, phoneNumber, specialRequest) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        // Update session with special request and set current step
        this.bookingManager.updateSession(session.bookingId, null, 'system', {
            specialRequests: specialRequest,
            currentStep: 9
        });

        console.log(`🎯 Special request selected: ${specialRequest} for session ${session.bookingId}`);

        // Check if this is an edit operation
        if (session.data.isEditing && session.data.editingField === 'specialRequests') {
            // Update the special request during edit
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                specialRequests: specialRequest,
                isEditing: false,
                editingField: null,
                editCompletedAt: new Date().toISOString()
            });

            console.log(`✅ Updated specialRequests during edit: ${specialRequest}`);

            // Show edit options instead of confirmation
            await this.showEditOptions(msg.key.remoteJid, phoneNumber);
        } else {
            // Regular booking flow - move to confirmation
            await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
        }
    }

    // Handle luggage selection
    async handleLuggageSelection(msg, phoneNumber, luggageCount) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking session found. Please start a new booking."
            });
            return;
        }

        // Check if this is an edit operation
        if (session.data.isEditing && session.data.editingField === 'luggageInfo') {
            // Update the luggage info during edit
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                luggageInfo: luggageCount,
                isEditing: false,
                editingField: null,
                editCompletedAt: new Date().toISOString()
            });

            console.log(`✅ Updated luggageInfo during edit: ${luggageCount}`);

            // Show edit options instead of confirmation
            await this.showEditOptions(msg.key.remoteJid, phoneNumber);
        } else {
            // Regular booking flow
            this.bookingManager.updateSession(session.bookingId, null, 'system', {
                luggageInfo: luggageCount
            });

            console.log(`✅ Updated luggageInfo: ${luggageCount}`);

            // Move to next step based on booking type
            const updatedSession = this.bookingManager.sessions[session.bookingId];
            const stillMissing = this.getMissingFieldsForSession(updatedSession);

            if (stillMissing.length === 0) {
                await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
            } else {
                // Ask for the next missing field
                await this.analyzeAndRequestMissingInfo(msg, phoneNumber, updatedSession);
            }
        }
    }

    // Show edit options after updating a field
    async showEditOptions(jid, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            await this.sock.sendMessage(jid, {
                text: "❌ No active booking session found."
            });
            return;
        }

        const editResponse = this.responseFormatter.createListMessage(
            "✏️ *Edit Booking Details*",
            "What would you like to edit next?",
            [
                {
                    id: "edit_booking_type",
                    title: "📋 Booking Type",
                    description: `Current: ${session.data.bookingType || 'Not set'}`
                },
                {
                    id: "edit_vehicle_type",
                    title: "🚗 Vehicle Type",
                    description: `Current: ${session.data.vehicleType || 'Not set'}`
                },
                {
                    id: "edit_customer_name",
                    title: "👤 Customer Name",
                    description: `Current: ${session.data.customerName || 'Not set'}`
                },
                {
                    id: "edit_pickup_location",
                    title: "📍 Pickup Location",
                    description: `Current: ${session.data.pickupLocation || 'Not set'}`
                },
                {
                    id: "edit_drop_location",
                    title: "🎯 Drop Location",
                    description: `Current: ${session.data.dropLocation || 'Not set'}`
                },
                {
                    id: "edit_luggage_info",
                    title: "🧳 Luggage Info",
                    description: `Current: ${session.data.luggageInfo || 'Not set'}`
                },
                {
                    id: "edit_passenger_count",
                    title: "👥 Passenger Count",
                    description: `Current: ${session.data.passengerCount || 'Not set'}`
                },
                {
                    id: "edit_number_of_hours",
                    title: "⏰ Number of Hours",
                    description: `Current: ${session.data.numberOfHours || 'Not set'}`
                },
                {
                    id: "edit_special_requests",
                    title: "🎯 Special Requests",
                    description: `Current: ${session.data.specialRequests || 'Not set'}`
                },
                {
                    id: "move_to_confirmation",
                    title: "✅ Move to Confirmation",
                    description: "Review and confirm your booking"
                }
            ]
        );

        await this.sock.sendMessage(jid, editResponse);
    }

    // Extract booking information using AI
    async extractBookingInfo(messageText, session) {
        try {
            if (!this.openai) {
                console.log('❌ OpenAI not available for information extraction');
                return {};
            }

            const currentStep = session.data.currentStep || 1;
            const existingData = session.data || {};

            // Create context for AI extraction
            const context = `
Current booking session data:
- Booking Type: ${existingData.bookingType || 'Not specified'}
- Vehicle Type: ${existingData.vehicleType || 'Not specified'}
- Customer Name: ${existingData.customerName || 'Not specified'}
- Pickup Location: ${existingData.pickupLocation || 'Not specified'}
- Drop Location: ${existingData.dropLocation || 'Not specified'}
- Luggage Info: ${existingData.luggageInfo || 'Not specified'}
- Passenger Count: ${existingData.passengerCount || 'Not specified'}
- Special Requests: ${existingData.specialRequests || 'Not specified'}

Current step: ${currentStep}

Customer message: "${messageText}"

Please extract any booking information from this message and return ONLY a JSON object with the fields that can be extracted. 
If no relevant information is found, return an empty object {}.

Fields to look for:
- customerName: Customer's full name
- pickupLocation: Pickup address/location
- dropLocation: Destination address/location
- luggageInfo: Information about luggage
- passengerCount: Number of passengers (as number)
- specialRequests: Any special requests or requirements
- pickupTime: Preferred pickup time
- pickupDate: Preferred pickup date

Return only valid JSON, no other text.
            `;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a booking information extractor. Extract relevant booking details from customer messages and return only valid JSON.'
                    },
                    {
                        role: 'user',
                        content: context
                    }
                ],
                max_tokens: 500,
                temperature: 0.1
            });

            const extractedText = response.choices[0].message.content.trim();
            console.log('🤖 AI extracted information:', extractedText);

            // Try to parse the JSON response
            try {
                const extractedInfo = JSON.parse(extractedText);
                console.log('✅ Successfully parsed extracted information:', extractedInfo);
                return extractedInfo;
            } catch (parseError) {
                console.error('❌ Error parsing AI response:', parseError);
                return {};
            }

        } catch (error) {
            console.error('❌ Error extracting booking information:', error);
            return {};
        }
    }

    // Process booking step based on missing information analysis
    async processBookingStep(msg, phoneNumber, messageText, session) {
        try {
            console.log(`📋 Processing booking for session ${session.bookingId}`);
            console.log(`📊 Current data:`, session.data);

            // Check if this is an edit operation first
            const isEditing = session.data.isEditing;
            const editingField = session.data.editingField;
            console.log(`🔍 Edit status - isEditing: ${isEditing}, editingField: ${editingField}`);

            if (isEditing && editingField) {
                // Handle edit operation
                console.log(`🔧 Processing edit for field: ${editingField}`);

                // Update session with message
                this.bookingManager.updateSession(session.bookingId, messageText);

                // Get updated session
                const updatedSession = this.bookingManager.sessions[session.bookingId];

                // Validate the field being edited
                const fieldStep = this.getFieldStep(editingField);
                const validation = this.validateInput(messageText, fieldStep, updatedSession.data.bookingType);
                console.log(`🔍 Edit validation result for "${messageText}" on field ${editingField}:`, validation);

                if (validation.valid) {
                    // Update the specific field being edited
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        [editingField]: validation.value,
                        isEditing: false,
                        editingField: null,
                        editCompletedAt: new Date().toISOString()
                    });

                    console.log(`✅ Updated ${editingField} during edit: ${validation.value}`);

                    // Get updated session to verify the change
                    const finalSession = this.bookingManager.sessions[session.bookingId];
                    console.log(`🔍 Session data after edit update:`, JSON.stringify(finalSession.data, null, 2));

                    // Recalculate pricing if cost-related field was updated
                    const costRelatedFields = ['vehicleType', 'bookingType', 'numberOfHours', 'pickupLocation', 'dropLocation', 'passengerCount'];
                    if (costRelatedFields.includes(editingField)) {
                        console.log(`💰 Recalculating pricing due to ${editingField} update`);
                        await this.calculateBookingPricing(finalSession);
                    }

                    // Show edit options instead of confirmation
                    await this.showEditOptions(msg.key.remoteJid, phoneNumber);
                    return;
                } else {
                    // Invalid input for edit, ask again
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `❌ ${validation.message}\n\nPlease try again:`
                    });
                    await this.askForMissingField(msg, phoneNumber, editingField, session.data.bookingType);
                    return;
                }
            } else {
                // Regular booking flow
                // Update session with message
                this.bookingManager.updateSession(session.bookingId, messageText);

                // Check for skip commands
                if (this.isSkipCommand(messageText)) {
                    console.log(`⏭️ Skip command detected: "${messageText}"`);
                    await this.handleSkipCommand(msg, phoneNumber, session);
                    return;
                }

                // Get current missing fields
                const missingFields = this.getMissingFieldsForSession(session);

                if (missingFields.length === 0) {
                    console.log(`✅ All required information collected, showing confirmation`);
                    await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
                    return;
                }

                const nextField = missingFields[0];
                console.log(`📝 Processing input for field: ${nextField}`);

                // Regular validation and processing
                const fieldStep = this.getFieldStep(nextField);
                const validation = this.validateInput(messageText, fieldStep, session.data.bookingType);
                console.log(`🔍 Regular validation result for "${messageText}":`, validation);

                if (validation.valid) {
                    // Update the field
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        [nextField]: validation.value
                    });

                    console.log(`✅ Updated ${nextField}: ${validation.value}`);

                    // Get updated session
                    const updatedSession = this.bookingManager.sessions[session.bookingId];
                    const stillMissing = this.getMissingFieldsForSession(updatedSession);

                    if (stillMissing.length === 0) {
                        await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
                    } else {
                        await this.analyzeAndRequestMissingInfo(msg, phoneNumber, updatedSession);
                    }
                } else {
                    // Invalid input, ask again
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `❌ ${validation.message}\n\nPlease try again:`
                    });
                    await this.askForMissingField(msg, phoneNumber, nextField, session.data.bookingType);
                }
            }
        } catch (error) {
            console.error('❌ Error processing booking step:', error);
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Sorry, there was an error processing your request. Please try again.'
            });
        }
    }

    // Analyze collected information and request missing data
    async analyzeAndRequestMissingInfo(msg, phoneNumber, session) {
        const sessionData = this.bookingManager.sessions[session.bookingId];
        const data = sessionData.data;
        const bookingType = data.bookingType;

        console.log(`🔍 Analyzing booking data for ${bookingType}:`, data);

        // Check what's missing
        const missingFields = this.getMissingFieldsForSession(sessionData);

        console.log(`📋 Missing fields:`, missingFields);

        // If no missing fields, show confirmation
        if (missingFields.length === 0) {
            console.log(`✅ All required information collected, showing confirmation`);
            await this.showBookingConfirmation(msg.key.remoteJid, phoneNumber);
            return;
        }

        // Ask for the first missing field
        const nextField = missingFields[0];
        await this.askForMissingField(msg, phoneNumber, nextField, bookingType);
    }

    // Get required fields based on booking type
    getRequiredFieldsForBookingType(bookingType) {
        const baseFields = ['bookingType', 'vehicleType', 'customerName', 'pickupLocation', 'luggageInfo', 'passengerCount', 'specialRequests'];

        if (bookingType === 'Transfer Booking') {
            return [...baseFields, 'dropLocation'];
        } else if (bookingType === 'Hourly Booking') {
            return [...baseFields, 'numberOfHours'];
        }

        return baseFields;
    }

    // Get missing fields for current session
    getMissingFieldsForSession(session) {
        const data = session.data;
        const bookingType = data.bookingType;
        const requiredFields = this.getRequiredFieldsForBookingType(bookingType);

        return requiredFields.filter(field => {
            const value = data[field];
            return !value || value.trim() === '' || value === 'Not specified';
        });
    }

    // Get step number for field validation
    getFieldStep(field) {
        const fieldSteps = {
            'bookingType': 1,
            'vehicleType': 2,
            'customerName': 3,
            'pickupLocation': 4,
            'dropLocation': 5,        
            'numberOfHours': 6,       // Step 6 for Hourly Booking
            'luggageInfo': 7,
            'passengerCount': 8,
            'specialRequests': 9
        };
        return fieldSteps[field] || 1;
    }

    // Get display step number for a field based on booking type
    getDisplayStepNumber(field, bookingType) {
        const requiredFields = this.getRequiredFieldsForBookingType(bookingType);
        const fieldIndex = requiredFields.indexOf(field);
        return fieldIndex + 1; // 1-based indexing
    }

    // Get total steps for booking type
    getTotalSteps(bookingType) {
        const requiredFields = this.getRequiredFieldsForBookingType(bookingType);
        return requiredFields.length;
    }

    // Ask for specific missing field
    async askForMissingField(msg, phoneNumber, field, bookingType) {
        const jid = msg.key.remoteJid;

        switch (field) {
            case 'bookingType':
                await this.showBookingTypeMenu(jid, phoneNumber);
                break;
            case 'vehicleType':
                await this.showVehicleTypeMenu(jid, phoneNumber);
                break;
            case 'customerName':
                await this.askForCustomerName(jid, phoneNumber);
                break;
            case 'pickupLocation':
                await this.askForPickupLocation(jid, phoneNumber);
                break;
            case 'dropLocation':
                await this.askForDropLocation(jid, phoneNumber);
                break;
            case 'numberOfHours':
                await this.askForNumberOfHours(jid, phoneNumber);
                break;
            case 'luggageInfo':
                await this.askForLuggageInfo(jid, phoneNumber);
                break;
            case 'passengerCount':
                await this.askForPassengerCount(jid, phoneNumber);
                break;
            case 'specialRequests':
                await this.askForSpecialRequests(jid, phoneNumber);
                break;
            default:
                await this.sock.sendMessage(jid, {
                    text: `Please provide ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}:`
                });
        }
    }

    // Get missing booking fields for current session
    getMissingBookingFields(session) {
        const requiredFields = ['customerName', 'pickupLocation', 'luggageInfo', 'passengerCount'];

        // Add drop location only for transfer booking
        if (session.data.bookingType === 'Transfer Booking') {
            requiredFields.push('dropLocation');
        }

        // Add number of hours only for hourly booking
        if (session.data.bookingType === 'Hourly Booking') {
            requiredFields.push('numberOfHours');
        }

        return requiredFields.filter(field => !session.data[field]);
    }

    // Calculate dynamic pricing for booking
    async calculateBookingPricing(session) {
        try {
            const vehicleType = session.data.vehicleType;
            const bookingType = session.data.bookingType;

            console.log(`🔄 Calculating pricing for ${vehicleType} - ${bookingType}`);

            // Check if database is connected first
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.log('⚠️ Database not connected, using fallback pricing immediately');
                return this.getFallbackPricing(session.data.vehicleType, session.data.bookingType, session.data.numberOfHours);
            }

            if (bookingType === 'Transfer Booking') {
                // Calculate distance-based pricing
                const pickupLocation = this.parseLocation(session.data.pickupLocation);
                const dropLocation = this.parseLocation(session.data.dropLocation);

                if (pickupLocation && dropLocation) {
                    const pricing = await this.pricingService.calculateTransferPricing(
                        vehicleType,
                        pickupLocation,
                        dropLocation
                    );
                    console.log('✅ Transfer pricing calculated successfully');
                    return pricing;
                } else {
                    // Fallback to estimated pricing
                    const pricing = await this.pricingService.calculateTransferPricing(
                        vehicleType,
                        { latitude: 25.2048, longitude: 55.2708 }, // Dubai default
                        { latitude: 25.2048, longitude: 55.2708 }  // Dubai default
                    );
                    console.log('✅ Transfer pricing calculated with default locations');
                    return pricing;
                }
            } else {
                // Calculate hourly pricing
                const hours = parseInt(session.data.numberOfHours) || this.parseHours(session.data.luggageInfo) || 2; // Default 2 hours
                const pricing = await this.pricingService.calculateHourlyPricing(vehicleType, hours);
                console.log('✅ Hourly pricing calculated successfully');
                return pricing;
            }
        } catch (error) {
            console.error('❌ Error calculating booking pricing:', error);
            console.log('🔄 Using comprehensive fallback pricing');
            // Return fallback pricing
            return this.getFallbackPricing(session.data.vehicleType, session.data.bookingType, session.data.numberOfHours);
        }
    }

    // Parse location from text (simplified - in real app, use geocoding API)
    parseLocation(locationText) {
        if (!locationText) return null;

        // This is a simplified implementation
        // In a real app, you would use a geocoding service like Google Maps API
        const locationMap = {
            'dubai mall': { latitude: 25.1972, longitude: 55.2796 },
            'burj khalifa': { latitude: 25.1972, longitude: 55.2744 },
            'dubai airport': { latitude: 25.2532, longitude: 55.3657 },
            'jumeirah beach': { latitude: 25.1972, longitude: 55.2744 },
            'downtown dubai': { latitude: 25.1972, longitude: 55.2744 }
        };

        const lowerText = locationText.toLowerCase();
        for (const [key, coords] of Object.entries(locationMap)) {
            if (lowerText.includes(key)) {
                return coords;
            }
        }

        // Return Dubai center as default
        return { latitude: 25.2048, longitude: 55.2708 };
    }

    // Parse hours from luggage info (simplified)
    parseHours(luggageInfo) {
        if (!luggageInfo) return 2;

        const text = luggageInfo.toLowerCase();
        const hourMatch = text.match(/(\d+)\s*hour/i);
        if (hourMatch) {
            return parseInt(hourMatch[1]);
        }

        // Default based on luggage amount
        if (text.includes('many') || text.includes('lots')) return 4;
        if (text.includes('few') || text.includes('little')) return 2;

        return 2; // Default 2 hours
    }

    // Simulate payment confirmation (in real app, this would come from payment webhook)
    async simulatePaymentConfirmation(phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (!session) {
            return false;
        }

        // Mark payment as confirmed
        this.bookingManager.updateSession(session.bookingId, null, 'system', {
            paymentStatus: 'confirmed',
            paymentDate: new Date().toISOString()
        });

        // Save to database
        await this.saveBookingToDatabase(session);

        // Send driver information
        await this.sendDriverInfo(session.phoneNumber + '@c.us', phoneNumber);

        return true;
    }

    // Initialize default pricing configurations in database
    async initializeDefaultPricing() {
        try {
            if (!models.PricingConfig) {
                console.log('⚠️ PricingConfig model not available');
                return false;
            }

            const defaultConfigs = [
                {
                    vehicleType: 'Sedan',
                    baseRate: 120,
                    perKmRate: 3,
                    perHourRate: 25,
                    minimumCharge: 120,
                    currency: 'AED',
                    surgeMultiplier: 1.0,
                    peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                    weekendMultiplier: 1.1,
                    holidayMultiplier: 1.3
                },
                {
                    vehicleType: 'SUV',
                    baseRate: 180,
                    perKmRate: 4,
                    perHourRate: 35,
                    minimumCharge: 180,
                    currency: 'AED',
                    surgeMultiplier: 1.0,
                    peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                    weekendMultiplier: 1.1,
                    holidayMultiplier: 1.3
                },
                {
                    vehicleType: 'Luxury',
                    baseRate: 350,
                    perKmRate: 8,
                    perHourRate: 60,
                    minimumCharge: 350,
                    currency: 'AED',
                    surgeMultiplier: 1.0,
                    peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                    weekendMultiplier: 1.1,
                    holidayMultiplier: 1.3
                },
                {
                    vehicleType: 'Van',
                    baseRate: 220,
                    perKmRate: 5,
                    perHourRate: 40,
                    minimumCharge: 220,
                    currency: 'AED',
                    surgeMultiplier: 1.0,
                    peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                    weekendMultiplier: 1.1,
                    holidayMultiplier: 1.3
                }
            ];

            for (const config of defaultConfigs) {
                await models.PricingConfig.findOneAndUpdate(
                    { vehicleType: config.vehicleType },
                    config,
                    { upsert: true, new: true }
                );
                console.log(`✅ Pricing config initialized for ${config.vehicleType}`);
            }

            // Clear pricing cache
            this.pricingService.clearCache();

            return true;
        } catch (error) {
            console.error('❌ Error initializing default pricing:', error);
            return false;
        }
    }

    async showVehicleOptions(msg, phoneNumber) {
        const vehicleResponse = this.responseFormatter.createListMessage(
            "🚗 *Available Vehicles*",
            "Choose your preferred vehicle type:",
            [
                {
                    id: "sedan_details",
                    title: "🚙 Sedan",
                    description: "AED 120 base + AED 3/km - Perfect for 1-4 passengers"
                },
                {
                    id: "suv_details",
                    title: "🚗 SUV",
                    description: "AED 180 base + AED 4/km - Great for 1-6 passengers"
                },
                {
                    id: "luxury_details",
                    title: "🏎️ Luxury (Maybach)",
                    description: "AED 350 base + AED 8/km - Premium experience for 1-4 passengers"
                },
                {
                    id: "van_details",
                    title: "🚐 Van (6+ seats)",
                    description: "AED 220 base + AED 5/km - Ideal for groups of 6+ passengers"
                }
            ]
        );
        // await this.sock.sendMessage(msg.key.remoteJid, vehicleResponse);
    }

    async handleBookingConfirmation(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (session) {
            // Mark booking as confirmed
            this.bookingManager.updateSession(session.bookingId, null, 'system', { status: 'confirmed' });

            // Track booking completion
            this.analytics.bookingsCompleted++;

            // Save to database
            await this.saveBookingToDatabase(session);

            // Send payment link
            await this.sendPaymentLink(msg.key.remoteJid, phoneNumber);
        }
    }

    async handleBookingEdit(msg, phoneNumber) {
        await this.sock.sendMessage(msg.key.remoteJid, {
            text: "✏️ *Edit Booking*\n\nWhich detail would you like to change?\n\nReply with the field name (e.g., 'guest name', 'pickup location', 'vehicle type') and I'll help you update it."
        });
    }

    async handleBookingCancel(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (session) {
            // Mark booking as cancelled
            this.bookingManager.updateSession(session.bookingId, null, 'system', { status: 'cancelled' });

            // Save to database
            await this.saveBookingToDatabase(session);

            // Remove from active sessions
            delete this.bookingManager.sessions[session.bookingId];

            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ *Booking Cancelled*\n\nYour booking has been cancelled successfully. You can start a new booking anytime by sending 'book chauffeur' or using the menu options."
            });
        }
    }

    async handleLocationMessage(msg, phoneNumber) {
        try {
            // Check if number is whitelisted
            if (!this.isWhitelisted(phoneNumber)) {
                console.log(`🚫 Location message from ${phoneNumber} ignored: not whitelisted.`);
                return;
            }

            const location = msg.message.locationMessage;
            const latitude = location.degreesLatitude;
            const longitude = location.degreesLongitude;
            const name = location.name || 'Shared Location';

            console.log(`📍 Location received from ${phoneNumber}: ${name} (${latitude}, ${longitude})`);

            // Get or create booking session
            let session = this.bookingManager.getActiveSession(phoneNumber);

            if (session) {
                // Update session with location data
                const locationData = {
                    latitude: latitude,
                    longitude: longitude,
                    name: name,
                    timestamp: new Date().toISOString()
                };

                // Determine if this is pickup or drop location based on session state and booking type
                const missingFields = this.bookingManager.getMissingFields(session.bookingId);
                if (missingFields.includes('pickupLocation')) {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        pickupLocation: name,
                        pickupCoordinates: locationData
                    });

                    // Check booking type to determine next step
                    if (session.data.bookingType === 'Transfer Booking') {
                        await this.sock.sendMessage(msg.key.remoteJid, {
                            text: `📍 *Pickup location set to: ${name}*\n\nNow please provide the drop-off location.`
                        });
                    } else {
                        // For hourly booking, ask for number of hours
                        await this.sock.sendMessage(msg.key.remoteJid, {
                            text: `📍 *Pickup location set to: ${name}*\n\nNow please tell me how many hours you need the chauffeur service.`
                        });
                    }
                } else if (missingFields.includes('dropLocation') && session.data.bookingType === 'Transfer Booking') {
                    this.bookingManager.updateSession(session.bookingId, null, 'system', {
                        dropLocation: name,
                        dropCoordinates: locationData
                    });
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `📍 *Drop-off location set to: ${name}*\n\nGreat! Now let me know about your luggage requirements.`
                    });
                } else {
                    await this.sock.sendMessage(msg.key.remoteJid, {
                        text: `📍 *Location received: ${name}*\n\nI've noted this location. How can I help you with your booking?`
                    });
                }
            } else {
                // No active session - ask if they want to start booking
                const locationResponse = this.responseFormatter.createButtonMessage(
                    `📍 *Location Received: ${name}*`,
                    "I see you've shared a location. Would you like to start a booking with this location?",
                    [
                        { id: "start_booking_pickup", text: "🚗 Use as Pickup Location" },
                        { id: "start_booking_drop", text: "🎯 Use as Drop Location" },
                        { id: "view_services", text: "📋 View Services First" }
                    ]
                );
                await this.sock.sendMessage(msg.key.remoteJid, locationResponse);
            }

        } catch (error) {
            console.error('❌ Error handling location message:', error);
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "Sorry, I couldn't process the location. Please try again or send a text message."
            });
        }
    }

    async handlePaymentRequest(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (session) {
            const summary = this.bookingManager.getBookingSummary(session.bookingId);
            const totalAmount = summary.pricing ? summary.pricing.total : 0;

            // Create payment message with payment link
            const paymentResponse = this.responseFormatter.createPaymentMessage(
                "💳 *Payment Required*",
                `Total Amount: AED ${totalAmount}`,
                `https://payment.example.com/pay/${session.bookingId}`,
                "Pay Now"
            );
            await this.sock.sendMessage(msg.key.remoteJid, paymentResponse);

            // Also send alternative payment options
            const paymentOptions = this.responseFormatter.createButtonMessage(
                "💳 *Payment Options*",
                "Choose your preferred payment method:",
                [
                    { id: "card_payment", text: "💳 Credit/Debit Card" },
                    { id: "bank_transfer", text: "🏦 Bank Transfer" },
                    { id: "cash_payment", text: "💵 Cash on Service" },
                    { id: "paypal_payment", text: "🅿️ PayPal" }
                ]
            );
            await this.sock.sendMessage(msg.key.remoteJid, paymentOptions);
        } else {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking found. Please start a new booking first."
            });
        }
    }

    async showBookingDetails(msg, phoneNumber) {
        const session = this.bookingManager.getActiveSession(phoneNumber);
        if (session) {
            const summary = this.bookingManager.getBookingSummary(session.bookingId);
            const detailsMessage = this.formatBookingSummary(summary);

            const detailsResponse = this.responseFormatter.createButtonMessage(
                "📋 *Your Booking Details*",
                detailsMessage,
                [
                    { id: "edit_booking", text: "✏️ Edit Booking" },
                    { id: "make_payment", text: "💳 Make Payment" },
                    { id: "cancel_booking", text: "❌ Cancel Booking" }
                ]
            );
            await this.sock.sendMessage(msg.key.remoteJid, detailsResponse);
        } else {
            await this.sock.sendMessage(msg.key.remoteJid, {
                text: "❌ No active booking found. Please start a new booking first."
            });
        }
    }

    async showSupportOptions(msg, phoneNumber) {
        const supportResponse = this.responseFormatter.createListMessage(
            "📞 *Contact Support*",
            "How can we help you?",
            [
                {
                    id: "phone_support",
                    title: "📞 Call Support",
                    description: "Speak directly with our support team"
                },
                {
                    id: "whatsapp_support",
                    title: "💬 WhatsApp Support",
                    description: "Chat with our support team on WhatsApp"
                },
                {
                    id: "email_support",
                    title: "📧 Email Support",
                    description: "Send us an email with your query"
                },
                {
                    id: "live_chat",
                    title: "💬 Live Chat",
                    description: "Start a live chat session"
                }
            ]
        );
        await this.sock.sendMessage(msg.key.remoteJid, supportResponse);
    }

    async sendLocalizedMessage(jid, messageKey, phoneNumber, ...args) {
        try {
            const userContext = this.contextManager.getUserContext(phoneNumber);
            const language = userContext.preferredLanguage || 'en';

            let message;
            if (language === 'hi' && BOOKING_PROMPTS.hi[messageKey]) {
                message = BOOKING_PROMPTS.hi[messageKey];
            } else if (language === 'ar' && BOOKING_PROMPTS.ar[messageKey]) {
                message = BOOKING_PROMPTS.ar[messageKey];
            } else {
                message = BOOKING_PROMPTS.en[messageKey] || messageKey;
            }

            // Format message with arguments if provided
            if (args.length > 0) {
                message = message.replace(/\{(\d+)\}/g, (match, index) => args[parseInt(index)] || match);
            }

            await this.sock.sendMessage(jid, { text: message });
        } catch (error) {
            console.error('❌ Error sending localized message:', error);
            await this.sock.sendMessage(jid, { text: messageKey });
        }
    }

    async sendAIResponse(jid, aiResponse) {
        try {
            // Validate AI response before processing
            if (!aiResponse || !aiResponse.message) {
                console.log('⚠️ Invalid AI response, sending fallback');
                await this.sock.sendMessage(jid, { text: 'I received your message but couldn\'t process it properly.' });
                return;
            }

            if (aiResponse.type === 'list') {
                await this.sock.sendMessage(jid, aiResponse.content);
            } else if (aiResponse.type === 'buttons') {
                await this.sock.sendMessage(jid, aiResponse.content);
            } else if (aiResponse.type === 'location') {
                await this.sock.sendMessage(jid, aiResponse.content);
            } else if (aiResponse.type === 'payment') {
                await this.sock.sendMessage(jid, aiResponse.content);
            } else if (aiResponse.type === 'media') {
                await this.sock.sendMessage(jid, aiResponse.content);
            } else {
                // Default to text message - ensure message is a string
                const messageText = typeof aiResponse.message === 'string' ? aiResponse.message : 'I received your message.';
                await this.sock.sendMessage(jid, { text: messageText });
            }

            console.log(`📤 Sent AI response: ${aiResponse.type} - ${aiResponse.message.substring(0, 50)}...`);
        } catch (error) {
            console.error('❌ Error sending AI response:', error);

            // Check if it's the specific URL extraction error
            if (error.message && error.message.includes('Cannot read properties of undefined (reading \'match\')')) {
                console.log('🔧 Detected URL extraction error, sending simple text response');
                try {
                    // Send a simple text message without any URL processing
                    const fallbackMessage = aiResponse && aiResponse.message ? aiResponse.message : 'I received your message.';
                    await this.sock.sendMessage(jid, { text: fallbackMessage });
                    console.log(`✅ Simple text response sent`);
                } catch (fallbackError) {
                    console.error('❌ Even fallback failed:', fallbackError);
                    // Last resort - send a basic message
                    await this.sock.sendMessage(jid, { text: 'I received your message. Please try again.' });
                }
            } else {
                // Send a simple fallback message for other errors
                try {
                    const fallbackMessage = aiResponse && aiResponse.message ? aiResponse.message : 'I apologize, but I encountered an error processing your message. Please try again or send "book chauffeur" to start a new booking.';
                    await this.sock.sendMessage(jid, { text: fallbackMessage });
                } catch (fallbackError) {
                    console.error('❌ All fallback attempts failed:', fallbackError);
                }
            }
        }
    }

    async processMediaMessage(msg) {
        try {
            let mediaData = null;
            let mimeType = '';

            if (msg.message.imageMessage) {
                mediaData = msg.message.imageMessage;
                mimeType = 'image/jpeg';
            } else if (msg.message.videoMessage) {
                mediaData = msg.message.videoMessage;
                mimeType = 'video/mp4';
            } else if (msg.message.audioMessage) {
                mediaData = msg.message.audioMessage;
                mimeType = 'audio/ogg';
            }

            if (!mediaData) return null;

            // For now, return a placeholder - in a real implementation, you'd download and process the media
            if (mimeType.startsWith('audio/')) {
                return await this.transcribeAudio(mediaData, msg);
            } else if (mimeType.startsWith('image/')) {
                return await this.analyzeImage(mediaData, msg);
            }

            return null;
        } catch (error) {
            console.error('❌ Error processing media:', error);
            return null;
        }
    }

    async transcribeAudio(mediaData, msg) {
        try {
            console.log('🎤 Transcribing audio with Whisper...');

            if (!this.openai) {
                console.log('❌ OpenAI not initialized');
                return "OpenAI not available. Please provide your booking details in text format.";
            }

            // Download the audio file
            const audioBuffer = await this.downloadMedia(mediaData, msg);
            if (!audioBuffer) {
                return "Could not download audio file. Please try again.";
            }

            // Convert to MP3 if needed
            const convertedBuffer = await this.convertAudioToMp3(audioBuffer);

            // Create a temporary file for Whisper API
            const tempFilePath = path.join(this.mediaDir, `temp_audio_${Date.now()}.mp3`);
            fs.writeFileSync(tempFilePath, convertedBuffer);

            try {
                // Transcribe using Whisper API
                const transcription = await this.openai.audio.transcriptions.create({
                    file: fs.createReadStream(tempFilePath),
                    model: "whisper-1",
                    language: "en", // Auto-detect language
                    response_format: "text"
                });

                console.log('✅ Audio transcribed successfully');
                return transcription;

            } finally {
                // Clean up temporary file
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            }

        } catch (error) {
            console.error('❌ Error transcribing audio:', error);
            return "Sorry, I couldn't process the audio. Please provide your booking details in text format.";
        }
    }

    async analyzeImage(mediaData, msg) {
        try {
            console.log('👁️ Analyzing image with Vision API...');

            if (!this.openai) {
                console.log('❌ OpenAI not initialized');
                return "OpenAI not available. Please provide your booking details in text format.";
            }

            // Download the image file
            const imageBuffer = await this.downloadMedia(mediaData, msg);
            if (!imageBuffer) {
                return "Could not download image file. Please try again.";
            }

            // Convert to base64 for Vision API
            const base64Image = imageBuffer.toString('base64');
            const mimeType = mediaData.mimetype || 'image/jpeg';

            try {
                // Analyze using GPT-4 Vision API
                const response = await this.openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Analyze this image for booking information. Extract any text, locations, dates, times, or booking details. If it contains booking information, format it as a booking request. If it's just a general image, describe what you see."
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:${mimeType};base64,${base64Image}`
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 500,
                    temperature: 0.1
                });

                const analysis = response.choices[0].message.content;
                console.log('✅ Image analyzed successfully');
                return analysis;

            } catch (visionError) {
                console.error('❌ Vision API error:', visionError);
                return "I can see the image but couldn't analyze it properly. Please provide your booking details in text format.";
            }

        } catch (error) {
            console.error('❌ Error analyzing image:', error);
            return "Sorry, I couldn't process the image. Please provide your booking details in text format.";
        }
    }

    // Helper method to download media from WhatsApp
    async downloadMedia(mediaData, message) {
        try {
            if (!this.sock) {
                console.log('❌ WhatsApp socket not available');
                return null;
            }

            // Import the correct downloadMediaMessage function
            const { downloadMediaMessage } = require('../lib/Utils/messages');

            // Create a proper message object for downloadMediaMessage
            const messageObj = {
                message: {
                    audioMessage: mediaData
                },
                key: message.key
            };

            const buffer = await downloadMediaMessage(messageObj, 'buffer', {}, this.sock);
            if (!buffer) {
                console.log('❌ Could not download media');
                return null;
            }

            return buffer;
        } catch (error) {
            console.error('❌ Error downloading media:', error);
            return null;
        }
    }

    // Helper method to convert audio to MP3
    async convertAudioToMp3(audioBuffer) {
        try {
            // For now, return the buffer as-is
            // In a real implementation, you would use ffmpeg to convert
            return audioBuffer;
        } catch (error) {
            console.error('❌ Error converting audio:', error);
            return audioBuffer; // Return original buffer as fallback
        }
    }

    extractBookingInfoBasic(text) {
        const info = {};
        const lowerText = text.toLowerCase();

        // Extract customer name
        const nameMatch = lowerText.match(/(?:name is|i am|call me|i'm)\s+([a-zA-Z\s]+)/);
        if (nameMatch) {
            info.customerName = nameMatch[1].trim();
        }

        // Extract booking type
        if (lowerText.includes('hourly') || lowerText.includes('hours')) {
            info.bookingType = 'Hourly Booking';
        } else if (lowerText.includes('transfer') || lowerText.includes('from') || lowerText.includes('to')) {
            info.bookingType = 'Transfer Booking';
        }

        // Extract vehicle type
        const vehicleTypes = ['sedan', 'suv', 'luxury', 'van'];
        for (const vehicle of vehicleTypes) {
            if (lowerText.includes(vehicle)) {
                info.vehicleType = vehicle.charAt(0).toUpperCase() + vehicle.slice(1);
                break;
            }
        }

        // Extract pickup location
        const pickupMatch = lowerText.match(/(?:pickup|from|pick up)\s+(?:at|from)?\s*([^,]+)/);
        if (pickupMatch) {
            info.pickupLocation = pickupMatch[1].trim();
        }

        // Extract drop location
        const dropMatch = lowerText.match(/(?:drop|to|destination)\s+(?:at|to)?\s*([^,]+)/);
        if (dropMatch) {
            info.dropLocation = dropMatch[1].trim();
        }

        // Extract passenger count
        const passengerMatch = lowerText.match(/(\d+)\s*(?:passenger|people|person|pax)/);
        if (passengerMatch) {
            info.passengerCount = parseInt(passengerMatch[1]);
        }

        // Extract luggage info
        const luggageMatch = lowerText.match(/(\d+)\s*(?:bag|suitcase|luggage|piece)/);
        if (luggageMatch) {
            info.luggageInfo = `${luggageMatch[1]} ${luggageMatch[0].includes('bag') ? 'bags' : 'pieces'}`;
        }

        // Extract special requests
        const specialRequests = [];
        if (lowerText.includes('baby seat') || lowerText.includes('baby')) {
            specialRequests.push('Baby Seat');
        }
        if (lowerText.includes('wheelchair') || lowerText.includes('wheel chair')) {
            specialRequests.push('Wheelchair Access');
        }
        if (lowerText.includes('water bottle') || lowerText.includes('water')) {
            specialRequests.push('Water Bottle');
        }
        if (specialRequests.length > 0) {
            info.specialRequests = specialRequests;
        }

        console.log(`🔍 Basic extraction result:`, info);
        return info;
    }

    async extractBookingInfo(text, contextType) {
        if (!this.openai) return {};

        try {
            // Check if bookingManager and contexts exist
            if (!this.bookingManager || !this.bookingManager.contexts) {
                console.log('⚠️ Booking manager or contexts not available, using default extraction');
                return this.extractBookingInfoBasic(text);
            }

            const context = this.bookingManager.contexts[contextType];
            if (!context) {
                console.log(`⚠️ Context ${contextType} not found, using basic extraction`);
                return this.extractBookingInfoBasic(text);
            }

            // Check if we should skip AI processing to avoid rate limits
            if (text.includes('What\'s the guest\'s name?') || text.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
                console.log('⚠️ Skipping AI processing for bot-generated message to avoid rate limits');
                return {};
            }

            const completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo", // Use cheaper model to avoid rate limits
                messages: [
                    {
                        role: "system",
                        content: `You are a booking information extractor. Extract booking information and return it in JSON format.

Required fields to extract:
${Object.entries(context.requiredFields).map(([field, config]) => `- ${field}: ${config.validation}`).join('\n')}

Rules:
1. Only extract information that is explicitly mentioned
2. Format dates as YYYY-MM-DD HH:mm
3. Vehicle types must be exactly one of: ${context.requiredFields.vehicleType.options.join(', ')}
4. If a field is not found, do not include it in the JSON
5. Return an empty JSON object {} if no valid information is found

Example response format:
{
  "guestName": "John Smith",
  "vehicleType": "Sedan",
  "pickupLocation": "Dubai Mall"
}`
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                temperature: 0.1
            });

            let extractedInfo;
            try {
                const content = completion.choices[0].message.content.trim();
                const jsonStart = content.indexOf('{');
                const jsonEnd = content.lastIndexOf('}') + 1;
                if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    const jsonStr = content.slice(jsonStart, jsonEnd);
                    extractedInfo = JSON.parse(jsonStr);
                } else {
                    return {};
                }
            } catch (parseError) {
                console.error('❌ Error parsing OpenAI response:', parseError);
                return {};
            }

            return this.validateExtractedInfo(extractedInfo, context);

        } catch (error) {
            console.error('❌ Error extracting booking info:', error);
            return {};
        }
    }

    validateExtractedInfo(info, context) {
        if (!info || typeof info !== 'object') return {};

        const validated = {};

        try {
            // Validate required fields
            Object.entries(context.requiredFields).forEach(([field, config]) => {
                if (info[field] && new RegExp(config.validation).test(info[field])) {
                    validated[field] = info[field];
                }
            });

            // Validate optional fields
            if (context.optionalFields) {
                Object.entries(context.optionalFields).forEach(([field, config]) => {
                    if (info[field] && new RegExp(config.validation).test(info[field])) {
                        validated[field] = info[field];
                    }
                });
            }

            return validated;
        } catch (error) {
            console.error('❌ Error validating extracted info:', error);
            return {};
        }
    }

    formatBookingSummary(summary) {
        if (!summary) return 'Error generating booking summary';

        let message = `📋 *Booking Summary (${summary.bookingId})*\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `🎯 *Service:* ${summary.type}\n\n`;

        // Add booking details
        Object.entries(summary.data).forEach(([key, value]) => {
            const icon = this.getFieldIcon(key);
            message += `${icon} *${this.formatFieldName(key)}:* ${value}\n`;
        });

        // Add pricing
        if (summary.pricing) {
            message += `\n💰 *Pricing:*\n`;
            message += `• *Base Rate:* AED ${summary.pricing.base}\n`;
            message += `• *Per KM:* AED ${summary.pricing.perKm}\n`;
            message += `• *Est. Distance:* ${summary.pricing.distance} km\n`;
            message += `• *Est. Total:* AED ${summary.pricing.total}\n`;
        }

        return message;
    }

    getFieldIcon(field) {
        const icons = {
            guestName: '👤',
            conciergeName: '🏨',
            pickupLocation: '📍',
            dropLocation: '🎯',
            pickupTime: '🕐',
            vehicleType: '🚗',
            flightNumber: '✈️',
            address: '📍',
            specialInstructions: '📝'
        };
        return icons[field] || '•';
    }

    formatFieldName(field) {
        return field
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    async handleGeneralQuery(msg, phoneNumber, messageText) {
        if (!this.openai) {
            await this.sendMessage(msg.key.remoteJid,
                'Hello! I\'m the VIP Chauffeur booking assistant. Send "book chauffeur" to start booking your ride!');
            return;
        }

        try {
            const systemPrompt = `You are a VIP Chauffeur service assistant. A customer has sent a message that might contain booking details or a general query.

Parse the following message and respond appropriately:
1. If it contains booking details (dates, locations, vehicle preferences), suggest starting a formal booking,
2. If it's a general query, provide helpful information about our services,
3. Keep responses professional but friendly,
4. If they want to book, remind them to say "book chauffeur" to start the formal booking process.

Available Services:
- Chauffeur Service (Point to Point),
- Airport Transfers,
- Full Day Service (10 hours),

Vehicle Options:
- Sedan (AED 120 + 3/km),
- SUV (AED 180 + 4/km),
- Luxury/Maybach (AED 350 + 8/km),
- Van (6+ seats) (AED 220 + 5/km)`;

            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: messageText }
                ],
                max_tokens: 250,
                temperature: 0.7
            });

            const aiResponse = response.choices[0].message.content;
            await this.sendMessage(msg.key.remoteJid, aiResponse);

        } catch (error) {
            console.error('❌ Error in handleGeneralQuery:', error);
            await this.sendMessage(msg.key.remoteJid,
                'Hello! I\'m the VIP Chauffeur booking assistant. Send "book chauffeur" to start booking your ride!');
        }
    }

    async sendMessage(jid, message, messageType = 'text', bookingId = null) {
        try {
            const formattedMessage = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${message}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
            await this.sock.sendMessage(jid, { text: formattedMessage });
            console.log(`📤 Sent: ${formattedMessage.substring(0, 50)}...`);
            
            // Save outgoing message to chat logs
            await this.saveOutgoingMessage(jid, message, messageType, bookingId);
        } catch (error) {
            console.error('❌ Error sending message:', error);
        }
    }

    async handleCommand(msg) {
        const messageText = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            '';

        if (!messageText.startsWith('!')) return;

        const args = messageText.slice(1).split(' ');
        const command = args[0];
        const commandArgs = args.slice(1);

        const jid = msg.key.remoteJid;

        try {
            switch (command) {
                case 'help':
                    await this.sendHelpMessage(jid);
                    break;
                case 'text':
                    await this.sendTextMessage(jid, commandArgs.join(' '));
                    break;
                case 'buttons':
                    await this.sendButtonsMessage(jid, commandArgs.join(' '));
                    break;
                case 'list':
                    await this.sendListMessage(jid, commandArgs.join(' '));
                    break;
                case 'image':
                    await this.sendImageMessage(jid, commandArgs[0], commandArgs.slice(1).join(' '));
                    break;
                case 'video':
                    await this.sendVideoMessage(jid, commandArgs[0], commandArgs.slice(1).join(' '));
                    break;
                case 'audio':
                    await this.sendAudioMessage(jid, commandArgs[0]);
                    break;
                case 'location':
                    await this.sendLocationMessage(jid, parseFloat(commandArgs[0]), parseFloat(commandArgs[1]), commandArgs[2]);
                    break;
                case 'contact':
                    await this.sendContactMessage(jid, commandArgs[0], commandArgs[1], commandArgs[2]);
                    break;
                case 'status':
                    await this.sendStatusMessage(jid);
                    break;
                case 'book':
                    // Handle !book command by redirecting to natural language processing
                    console.log(`🎯 !book command received, redirecting to booking flow`);
                    await this.processMessage(msg);
                    break;
                case 'qr':
                    console.log('🔄 Forcing QR code generation...');
                    this.sessionValidator.forceQRGeneration();
                    await this.initialize();
                    break;
                case 'simulate-payment':
                    const phoneNumber = msg.key.remoteJid.replace('@c.us', '');
                    const success = await this.simulatePaymentConfirmation(phoneNumber);
                    if (success) {
                        await this.sock.sendMessage(jid, {
                            text: "✅ Payment simulation completed! Driver information has been sent."
                        });
                    } else {
                        await this.sock.sendMessage(jid, {
                            text: "❌ No active booking found for payment simulation."
                        });
                    }
                    break;
                case 'init-pricing':
                    await this.initializeDefaultPricing();
                    await this.sock.sendMessage(jid, {
                        text: "✅ Default pricing configurations initialized in database."
                    });
                    break;
                default:
                    await this.sock.sendMessage(jid, {
                        text: `❌ Unknown command: !${command}\nType !help for available commands.`
                    });
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await this.sock.sendMessage(jid, {
                text: `❌ Error executing command: ${error.message}`
            });
        }
    }

    async sendHelpMessage(jid) {
        const helpText = `🤖 *Ultra-Robust AI WhatsApp Bot Commands*

🚗 *Enhanced Booking System:*
• Send "book chauffeur" - Start step-by-step booking flow
• Send "book taxi" - Alternative booking command
• Send voice messages - AI transcription for booking
• Send images - AI analysis for booking details

📋 *Booking Flow Steps:*
1. Select booking type (Hourly/Transfer)
2. Choose vehicle type (Sedan/SUV/Luxury/Van)
3. Enter customer name
4. Share pickup location
5. Share drop location (Transfer only)
6. Provide luggage information
7. Enter passenger count
8. Confirm booking details
9. Complete payment
10. Receive driver information

📝 *Basic Messages:*
• !text <message> - Send a text message
• !buttons <text> - Send buttons message
• !list <text> - Send list message

📊 *Media Messages:*
• !image <url> <caption> - Send image
• !video <url> <caption> - Send video
• !audio <url> - Send audio

📍 *Location & Contact:*
• !location <lat> <lng> <name> - Send location
• !contact <name> <phone> <email> - Send contact

🔧 *Bot Status & Testing:*
• !status - Get bot status with analytics
• !help - Show this help
• !qr - Force QR code generation
• !simulate-payment - Test payment confirmation
• !init-pricing - Initialize default pricing in database

🧠 *AI Features:*
• Natural language booking processing
• Voice message transcription (Whisper)
• Image analysis for booking details
• Multilingual support (EN, HI, AR, ZH, RU, UR)
• Smart conversation flow with session management
• Interactive rich messages (Lists, Buttons, Location)
• Payment integration with confirmation
• Location sharing and extraction
• Media message processing
• Sentiment analysis and personalization
• Dynamic pricing calculation from database
• Distance-based pricing for transfers
• Hourly-based pricing for hourly bookings
• Surge pricing (peak hours, weekends, holidays)

🎯 *Rich Message Types:*
• Interactive lists for booking type/vehicle selection
• Button responses for confirmation/edit/cancel
• Location sharing for pickup/drop points
• Payment links with confirmation flow
• Driver information with contact options
• Media messages with AI analysis

This is an ultra-robust bot with complete booking flow management!`;

        await this.sock.sendMessage(jid, { text: helpText });
    }

    async sendTextMessage(jid, text) {
        const message = text || 'Hello! This is a text message from the ultra-robust bot.';
        await this.sock.sendMessage(jid, { text: message });
    }

    async sendButtonsMessage(jid, text) {
        const message = text || 'Choose an option:';
        await this.sock.sendMessage(jid, {
            text: message,
            buttons: [
                { buttonId: 'btn1', buttonText: { displayText: 'Option 1' }, type: 1 },
                { buttonId: 'btn2', buttonText: { displayText: 'Option 2' }, type: 1 },
                { buttonId: 'btn3', buttonText: { displayText: 'Option 3' }, type: 1 }
            ],
            headerType: 1
        });
    }

    async sendListMessage(jid, text) {
        const message = text || 'Choose from the list:';
        await this.sock.sendMessage(jid, {
            text: message,
            sections: [{
                title: 'Main Menu',
                rows: [
                    { id: 'row1', title: 'Option 1', description: 'Description for option 1' },
                    { id: 'row2', title: 'Option 2', description: 'Description for option 2' },
                    { id: 'row3', title: 'Option 3', description: 'Description for option 3' }
                ]
            }],
            buttonText: 'Select',
            headerType: 1
        });
    }

    async sendImageMessage(jid, url, caption) {
        const imageUrl = url || 'https://via.placeholder.com/300x200/0000FF/FFFFFF?text=Sample+Image';
        const imageCaption = caption || 'This is an image message from the ultra-robust bot!';

        await this.sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: imageCaption
        });
    }

    async sendVideoMessage(jid, url, caption) {
        const videoUrl = url || 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';
        const videoCaption = caption || 'This is a video message from the ultra-robust bot!';

        await this.sock.sendMessage(jid, {
            video: { url: videoUrl },
            caption: videoCaption
        });
    }

    async sendAudioMessage(jid, url) {
        const audioUrl = url || 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav';

        await this.sock.sendMessage(jid, {
            audio: { url: audioUrl },
            ptt: true
        });
    }

    async sendLocationMessage(jid, lat, lng, name) {
        const latitude = lat || 40.7128;
        const longitude = lng || -74.0060;
        const locationName = name || 'New York City';

        await this.sock.sendMessage(jid, {
            location: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name: locationName
            }
        });
    }

    async sendContactMessage(jid, name, phone, email) {
        const contactName = name || 'John Doe';
        const contactPhone = phone || '+1234567890';
        const contactEmail = email || 'john@example.com';

        await this.sock.sendMessage(jid, {
            contacts: {
                displayName: contactName,
                contacts: [{
                    displayName: contactName,
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nORG:Example Org\nTEL:${contactPhone}\nEMAIL:${contactEmail}\nEND:VCARD`
                }]
            }
        });
    }

    async sendStatusMessage(jid) {
        const sessionStatus = this.sessionValidator.getSessionStatus();
        const analytics = this.getAnalytics();

        const status = `🤖 *Ultra-Robust AI Bot Status*

✅ *Connection:* ${this.isConnected ? 'Connected' : 'Disconnected'}
🔄 *Connection Attempts:* ${this.connectionAttempts}/${this.maxConnectionAttempts}
📱 *QR Attempts:* ${this.qrAttempts}/${this.maxConnectionAttempts}
⏰ *Uptime:* ${analytics.uptime.formatted}
💾 *Memory:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
🆔 *Process ID:* ${process.pid}

🔍 *Session Status:*
• Valid: ${sessionStatus.isValid ? '✅' : '❌'}
• Reason: ${sessionStatus.reason}
• Needs QR: ${sessionStatus.needsQR ? 'Yes' : 'No'}

🧠 *AI Features:*
• OpenAI: ${this.openai ? '✅ Active' : '❌ Inactive'}
• Booking Manager: ${this.bookingManager ? '✅ Active' : '❌ Inactive'}
• AI Response Generator: ${this.aiResponseGenerator ? '✅ Active' : '❌ Inactive'}
• Context Manager: ${this.contextManager ? '✅ Active' : '❌ Inactive'}
• Whitelisted Numbers: ${this.whitelistedNumbers.size}
• Active Sessions: ${this.bookingManager ? Object.keys(this.bookingManager.sessions).length : 0}

📊 *Analytics:*
• Messages Processed: ${analytics.messagesProcessed}
• Bookings Created: ${analytics.bookingsCreated}
• Bookings Completed: ${analytics.bookingsCompleted}
• AI Responses: ${analytics.aiResponsesGenerated}
• Voice Messages: ${analytics.voiceMessagesProcessed}
• Image Messages: ${analytics.imageMessagesProcessed}
• Errors: ${analytics.errorsEncountered}

📈 *Performance:*
• Messages/Hour: ${analytics.performance.messagesPerHour.toFixed(1)}
• Booking Success Rate: ${analytics.performance.bookingSuccessRate}%
• Error Rate: ${analytics.performance.errorRate}%

🚗 *Booking System:*
• Natural language processing
• Voice transcription ready
• Image analysis ready
• Multilingual support (EN, HI, AR)
• Rich message formats (Lists, Buttons, Location, Media)
• Interactive responses
• Payment integration
• Location sharing
• AI-powered conversation flow
• Advanced analytics tracking

This bot has ultra-robust connection handling and AI-powered booking!`;

        await this.sock.sendMessage(jid, { text: status });
    }

    // Get connection state for web dashboard
    getConnectionState() {
        return {
            state: this.isConnected ? 'connected' : (this.isConnecting ? 'connecting' : 'disconnected'),
            isReady: this.isConnected,
            isAuthenticated: this.isConnected,
            connectedNumber: this.isConnected ? 'main-instance' : null,
            lastHeartbeat: new Date().toISOString(),
            lastUpdate: new Date().toISOString()
        };
    }

    // Get analytics data
    getAnalytics() {
        const uptime = Date.now() - this.analytics.startTime.getTime();
        const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
        const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));

        return {
            ...this.analytics,
            uptime: {
                total: uptime,
                hours: uptimeHours,
                minutes: uptimeMinutes,
                formatted: `${uptimeHours}h ${uptimeMinutes}m`
            },
            performance: {
                messagesPerHour: this.analytics.messagesProcessed / Math.max(uptimeHours, 1),
                bookingSuccessRate: this.analytics.bookingsCreated > 0 ?
                    (this.analytics.bookingsCompleted / this.analytics.bookingsCreated * 100).toFixed(1) : 0,
                errorRate: this.analytics.messagesProcessed > 0 ?
                    (this.analytics.errorsEncountered / this.analytics.messagesProcessed * 100).toFixed(1) : 0
            }
        };
    }

    // Save connection state to file
    saveConnectionState(state) {
        try {
            const connectionState = {
                connectionState: state,
                isReady: state === 'connected',
                isAuthenticated: state === 'connected',
                connectedNumber: state === 'connected' ? this.connectedNumber : null,
                lastHeartbeat: new Date().toISOString(),
                lastUpdate: new Date().toISOString(),
                connectionAttempts: this.connectionAttempts || 0,
                maxConnectionAttempts: this.maxConnectionAttempts || 10
            };

            const stateFilePath = path.join(__dirname, '../data/whatsapp-connection-state.json');
            const dataDir = path.dirname(stateFilePath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(stateFilePath, JSON.stringify(connectionState, null, 2));
            console.log(`💾 Connection state saved: ${state}`);
        } catch (error) {
            console.error('❌ Error saving connection state:', error);
        }
    }

    // Force QR generation for web dashboard
    async forceQRGeneration() {
        try {
            console.log('🔄 Forcing QR code generation...');
            console.log('📱 This will clear the current session and generate a fresh QR code');
            
            // Enable auto QR generation for manual trigger
            this.autoGenerateQR = true;
            console.log('🔄 Auto QR generation enabled for manual trigger');
            
            // Clear existing socket to force recreation with new settings
            if (this.sock) {
                try {
                    console.log('🔌 Disconnecting existing socket...');
                    await this.sock.logout();
                    this.isConnected = false;
                    this.isConnecting = false;
                    console.log('✅ Socket disconnected successfully');
                } catch (e) {
                    console.log('⚠️ Error disconnecting socket:', e.message);
                }
                this.sock = null;
            }
            
            // Clear session directory to force fresh QR
            const sessionDir = path.join(__dirname, '../data/whatsapp-session');
            if (fs.existsSync(sessionDir)) {
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    console.log('🧹 Session directory cleared');
                } catch (clearError) {
                    console.log('⚠️ Error clearing session:', clearError.message);
                }
            }
            
            this.sessionValidator.forceQRGeneration();
            this.connectionAttempts = 0; // Reset connection attempts
            this.qrAttempts = 0; // Reset QR attempts
            this.isGeneratingQR = false; // Reset QR generation flag
            
            // Save disconnected state
            this.saveConnectionState('disconnected');
            
            // Wait a moment before reinitializing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await this.initialize();
            return true;
        } catch (error) {
            console.error('Error forcing QR generation:', error);
            this.autoGenerateQR = false; // Ensure flag is reset on error
            return false;
        }
    }


    // Clear session and force fresh QR
    async clearSessionAndForceQR() {
        try {
            console.log('🔄 Clearing session and forcing fresh QR generation...');
            // Enable auto QR generation temporarily for manual trigger
            this.autoGenerateQR = true;
            this.sessionValidator.clearInvalidSession();
            this.connectionAttempts = 0;
            this.qrAttempts = 0; // Reset QR attempts
            this.isConnected = false;
            this.isConnecting = false;

            // Clear any existing socket
            if (this.sock) {
                try {
                    await this.sock.logout();
                } catch (e) {
                    // Ignore logout errors
                }
                this.sock = null;
            }

            // Wait a bit then reinitialize
            setTimeout(() => {
                this.initialize();
            }, 2000);

            // Disable auto QR generation after manual trigger
            setTimeout(() => {
                this.autoGenerateQR = false;
                console.log('🔄 Auto QR generation disabled after manual trigger');
            }, 30000); // Keep enabled for 30 seconds to allow QR generation

            return true;
        } catch (error) {
            console.error('Error clearing session:', error);
            this.autoGenerateQR = false; // Ensure flag is reset on error
            return false;
        }
    }


    // Save individual booking to database
    async saveBookingToDatabase(session) {
        try {
            const { models } = require('./models');
            
            // Map session data to booking model
            const bookingData = {
                bookingId: session.bookingId,
                customerId: session.data.customerName ? session.data.customerName.toLowerCase().replace(/\s+/g, '_') : null,
                customerName: session.data.customerName,
                customerPhone: session.phoneNumber,
                pickupLocation: session.data.pickupLocation,
                dropLocation: session.data.dropLocation || null,
                pickupTime: session.data.pickupTime || new Date(),
                vehicleType: session.data.vehicleType,
                bookingType: session.data.bookingType,
                numberOfHours: session.data.numberOfHours || null,
                luggageInfo: session.data.luggageInfo,
                passengerCount: parseInt(session.data.passengerCount) || 1,
                specialRequests: session.data.specialRequests || 'None',
                pricing: session.data.pricing || {},
                status: this.mapSessionStatusToBookingStatus(session.status),
                confirmationId: session.confirmationId || null,
                paymentStatus: session.data.paymentStatus || 'pending',
                paymentMethod: session.data.paymentMethod || null,
                paymentId: session.data.paymentId || null,
                driverId: session.data.driverId || null,
                driverName: session.data.driverName || null,
                notes: session.data.notes || '',
                createdAt: session.createdAt || new Date(),
                updatedAt: new Date()
            };

            // Ensure customer exists
            await this.ensureCustomerExists(session.phoneNumber, session.data.customerName);

            // Save or update booking
            const existingBooking = await models.Booking.findOne({ bookingId: session.bookingId });
            if (existingBooking) {
                await models.Booking.updateOne({ bookingId: session.bookingId }, bookingData);
                console.log(`📝 Updated booking ${session.bookingId} in database`);
            } else {
                await models.Booking.create(bookingData);
                console.log(`✅ Created booking ${session.bookingId} in database`);
            }

            // Update customer record
            await this.updateCustomerRecord(session.phoneNumber, session.data.customerName, bookingData);

        } catch (error) {
            console.error(`❌ Error saving booking ${session.bookingId} to database:`, error);
            throw error;
        }
    }

    // Map session status to booking status
    mapSessionStatusToBookingStatus(sessionStatus) {
        const statusMap = {
            'active': 'confirmed',
            'confirmed': 'confirmed',
            'completed': 'completed',
            'cancelled': 'cancelled',
            'pending': 'pending'
        };
        return statusMap[sessionStatus] || 'pending';
    }

    // Ensure customer exists in database
    async ensureCustomerExists(phoneNumber, customerName) {
        try {
            const { models } = require('./models');
            
            const existingCustomer = await models.Customer.findOne({ phoneNumber });
            if (!existingCustomer) {
                await models.Customer.create({
                    phoneNumber,
                    name: customerName,
                    email: null,
                    totalBookings: 0,
                    totalSpent: 0,
                    lastBookingDate: null,
                    lastPaymentDate: null,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                console.log(`👤 Created new customer: ${customerName} (${phoneNumber})`);
            }
        } catch (error) {
            console.error('❌ Error ensuring customer exists:', error);
        }
    }

    // Update customer record with booking info
    async updateCustomerRecord(phoneNumber, customerName, bookingData) {
        try {
            const { models } = require('./models');
            
            await models.Customer.updateOne(
                { phoneNumber },
                {
                    name: customerName,
                    totalBookings: { $inc: 1 },
                    lastBookingDate: new Date(),
                    updatedAt: new Date()
                }
            );
        } catch (error) {
            console.error('❌ Error updating customer record:', error);
        }
    }

    async saveAllBookingsToDatabase() {
        try {
            console.log('🔄 Migrating existing bookings to database...');
            let savedCount = 0;
            let errorCount = 0;

            // Check if sessions exist and is an object
            if (!this.sessions || typeof this.sessions !== 'object') {
                console.log('ℹ️ No existing sessions to migrate');
                return { savedCount: 0, errorCount: 0 };
            }

            for (const [bookingId, session] of Object.entries(this.sessions)) {
                try {
                    await this.saveBookingToDatabase(session);
                    savedCount++;
                } catch (error) {
                    console.error(`❌ Error saving booking ${bookingId}:`, error);
                    errorCount++;
                }
            }

            console.log(`✅ Migration completed: ${savedCount} bookings saved, ${errorCount} errors`);
            return { savedCount, errorCount };
        } catch (error) {
            console.error('❌ Error during booking migration:', error);
            return { savedCount: 0, errorCount: 1 };
        }
    }

    async updateCustomerRecord(phoneNumber, session) {
        try {
            if (!models.Customer) {
                console.log('⚠️ Customer model not available');
                return false;
            }

            const customerData = {
                phoneNumber: phoneNumber,
                name: session.data.guestName || 'Unknown',
                lastBookingDate: new Date(session.updatedAt),
                totalBookings: this.bookingManager.customerHistory[phoneNumber]?.totalBookings || 1,
                preferredVehicleType: session.data.vehicleType || 'Sedan',
                lastUpdated: new Date()
            };

            // Check if customer exists
            const existingCustomer = await models.Customer.findOne({ phoneNumber: phoneNumber });

            if (existingCustomer) {
                // Update existing customer
                await models.Customer.updateOne(
                    { phoneNumber: phoneNumber },
                    { $set: customerData }
                );
                console.log(`✅ Updated customer ${phoneNumber} in database`);
            } else {
                // Create new customer
                const newCustomer = new models.Customer(customerData);
                await newCustomer.save();
                console.log(`✅ Created customer ${phoneNumber} in database`);
            }

            return true;
        } catch (error) {
            console.error('❌ Error updating customer record:', error);
            return false;
        }
    }

    // Process payment completion
    async processPaymentCompletion(bookingId, paymentData) {
        try {
            console.log(`💳 Processing payment completion for booking ${bookingId}`);
            
            // Find the booking
            const booking = await models.Booking.findOne({ bookingId: bookingId });
            if (!booking) {
                throw new Error(`Booking ${bookingId} not found`);
            }

            // Create payment record
            const payment = new models.Payment({
                bookingId: booking._id,
                bookingCode: bookingId,
                customerId: booking.customerId,
                amount: paymentData.amount || booking.bookingAmount,
                currency: paymentData.currency || 'AED',
                paymentMethod: paymentData.paymentMethod || 'paypal',
                paypalOrderId: paymentData.paypalOrderId,
                paypalTransactionId: paymentData.paypalTransactionId,
                paypalPayerEmail: paymentData.paypalPayerEmail,
                status: 'completed',
                completedAt: new Date(),
                description: `Payment for booking ${bookingId}`,
                notes: paymentData.notes || ''
            });

            await payment.save();
            console.log(`✅ Payment record created: ${payment.paymentId}`);

            // Update booking payment status
            booking.isPaid = true;
            booking.paymentStatus = 'paid';
            booking.paymentDate = new Date();
            booking.paymentAmount = payment.amount;
            booking.paypalTxnId = payment.paypalTransactionId;
            booking.updatedAt = new Date();

            await booking.save();
            console.log(`✅ Booking ${bookingId} marked as paid`);

            // Update customer record
            await this.updateCustomerPaymentStats(booking.customerId, payment.amount);

            // Send confirmation message to customer
            await this.sendPaymentConfirmation(booking, payment);

            return {
                success: true,
                paymentId: payment.paymentId,
                bookingId: bookingId,
                amount: payment.amount
            };

        } catch (error) {
            console.error(`❌ Error processing payment completion for booking ${bookingId}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Update customer payment statistics
    async updateCustomerPaymentStats(customerId, amount) {
        try {
            const customer = await models.Customer.findById(customerId);
            if (customer) {
                customer.totalSpent = (customer.totalSpent || 0) + amount;
                customer.lastPaymentDate = new Date();
                await customer.save();
                console.log(`✅ Updated customer payment stats for ${customer.name}`);
            }
        } catch (error) {
            console.error('❌ Error updating customer payment stats:', error);
        }
    }

    // Send payment confirmation message
    async sendPaymentConfirmation(booking, payment) {
        try {
            const customerPhone = booking.customerPhone;
            const jid = `${customerPhone}@s.whatsapp.net`;

            const message = `✅ *Payment Confirmed!*

🎉 Thank you for your payment!

📋 *Booking Details:*
• Booking ID: ${booking.bookingId}
• Payment ID: ${payment.paymentId}
• Amount: ${payment.amount} ${payment.currency}
• Payment Method: ${payment.paymentMethod.toUpperCase()}
• Date: ${new Date().toLocaleString()}

🚗 *Trip Details:*
• From: ${booking.pickupLocation}
• To: ${booking.dropLocation}
• Vehicle: ${booking.vehicleType}
• Pickup Time: ${new Date(booking.pickupTime).toLocaleString()}

Your booking is now confirmed and ready for pickup!

Thank you for choosing our service! 🚗✨`;

            await this.sock.sendMessage(jid, { text: message });
            console.log(`✅ Payment confirmation sent to ${customerPhone}`);

        } catch (error) {
            console.error('❌ Error sending payment confirmation:', error);
        }
    }

    // Handle PayPal webhook (if needed)
    async handlePayPalWebhook(webhookData) {
        try {
            console.log('🔔 Processing PayPal webhook:', webhookData.event_type);

            if (webhookData.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
                const resource = webhookData.resource;
                const customId = resource.custom_id; // This should contain the booking ID
                
                if (customId && customId.startsWith('BK-')) {
                    const paymentData = {
                        amount: parseFloat(resource.amount.value),
                        currency: resource.amount.currency_code,
                        paymentMethod: 'paypal',
                        paypalOrderId: resource.id,
                        paypalTransactionId: resource.id,
                        paypalPayerEmail: resource.payer?.email_address,
                        notes: 'Payment via PayPal webhook'
                    };

                    const result = await this.processPaymentCompletion(customId, paymentData);
                    console.log('✅ PayPal webhook processed:', result);
                    return result;
                }
            }

            return { success: false, message: 'Webhook event not processed' };

        } catch (error) {
            console.error('❌ Error handling PayPal webhook:', error);
            return { success: false, error: error.message };
        }
    }

    // Save chat log to database
    async saveChatLog(messageData) {
        try {
            if (!models.ChatLog) {
                console.log('⚠️ ChatLog model not available');
                return false;
            }

            const chatLog = new models.ChatLog({
                chatId: messageData.chatId || messageData.jid,
                messageId: messageData.messageId || messageData.id,
                messageType: messageData.messageType || 'text',
                direction: messageData.direction || 'incoming',
                fromNumber: messageData.fromNumber || messageData.from,
                fromName: messageData.fromName || '',
                toNumber: messageData.toNumber || messageData.to,
                messageBody: messageData.messageBody || messageData.body || '',
                mediaUrl: messageData.mediaUrl || '',
                mediaType: messageData.mediaType || '',
                mediaFilename: messageData.mediaFilename || '',
                bookingId: messageData.bookingId || null,
                aiProcessed: messageData.aiProcessed || false,
                aiResponse: messageData.aiResponse || '',
                timestamp: messageData.timestamp || new Date(),
                isRead: messageData.isRead || false,
                metadata: messageData.metadata || {}
            });

            await chatLog.save();
            console.log(`✅ Chat log saved: ${messageData.messageId}`);
            return true;

        } catch (error) {
            console.error('❌ Error saving chat log:', error);
            return false;
        }
    }

    // Get chat logs for a specific booking
    async getBookingChatLogs(bookingId) {
        try {
            if (!models.ChatLog) {
                console.log('⚠️ ChatLog model not available');
                return [];
            }

            const logs = await models.ChatLog.find({ bookingId: bookingId })
                .sort({ timestamp: 1 })
                .lean();

            return logs;
        } catch (error) {
            console.error('❌ Error getting booking chat logs:', error);
            return [];
        }
    }

    // Save incoming message to chat logs
    async saveIncomingMessage(msg, phoneNumber) {
        try {
            const messageData = {
                chatId: msg.key.remoteJid,
                messageId: msg.key.id,
                messageType: this.getMessageType(msg),
                direction: 'incoming',
                fromNumber: phoneNumber,
                fromName: msg.pushName || '',
                toNumber: 'bot',
                messageBody: this.getMessageBody(msg),
                mediaUrl: this.getMediaUrl(msg),
                mediaType: this.getMediaType(msg),
                mediaFilename: this.getMediaFilename(msg),
                bookingId: this.getBookingIdFromMessage(msg, phoneNumber),
                aiProcessed: false,
                timestamp: new Date(msg.messageTimestamp * 1000),
                isRead: true,
                metadata: {
                    messageTimestamp: msg.messageTimestamp,
                    pushName: msg.pushName,
                    messageType: msg.message
                }
            };

            await this.saveChatLog(messageData);
        } catch (error) {
            console.error('❌ Error saving incoming message:', error);
        }
    }

    // Save outgoing message to chat logs
    async saveOutgoingMessage(jid, message, messageType = 'text', bookingId = null) {
        try {
            const phoneNumber = jid.replace('@c.us', '');
            const messageData = {
                chatId: jid,
                messageId: `out_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                messageType: messageType,
                direction: 'outgoing',
                fromNumber: 'bot',
                fromName: 'AI Bot',
                toNumber: phoneNumber,
                messageBody: typeof message === 'string' ? message : JSON.stringify(message),
                mediaUrl: '',
                mediaType: '',
                mediaFilename: '',
                bookingId: bookingId,
                aiProcessed: true,
                timestamp: new Date(),
                isRead: false,
                metadata: {
                    messageType: messageType,
                    isBotGenerated: true
                }
            };

            await this.saveChatLog(messageData);
        } catch (error) {
            console.error('❌ Error saving outgoing message:', error);
        }
    }

    // Helper functions for message processing
    getMessageType(msg) {
        if (msg.message.conversation || msg.message.extendedTextMessage) return 'text';
        if (msg.message.imageMessage) return 'image';
        if (msg.message.videoMessage) return 'video';
        if (msg.message.audioMessage) return 'audio';
        if (msg.message.documentMessage) return 'document';
        if (msg.message.locationMessage) return 'location';
        if (msg.message.contactMessage) return 'contact';
        return 'text';
    }

    getMessageBody(msg) {
        return msg.message.conversation ||
               msg.message.extendedTextMessage?.text ||
               msg.message.imageMessage?.caption ||
               msg.message.videoMessage?.caption ||
               msg.message.documentMessage?.caption ||
               msg.message.locationMessage ? 'Location shared' :
               msg.message.contactMessage ? 'Contact shared' :
               'Media message';
    }

    getMediaUrl(msg) {
        if (msg.message.imageMessage) return msg.message.imageMessage.url || '';
        if (msg.message.videoMessage) return msg.message.videoMessage.url || '';
        if (msg.message.audioMessage) return msg.message.audioMessage.url || '';
        if (msg.message.documentMessage) return msg.message.documentMessage.url || '';
        return '';
    }

    getMediaType(msg) {
        if (msg.message.imageMessage) return msg.message.imageMessage.mimetype || '';
        if (msg.message.videoMessage) return msg.message.videoMessage.mimetype || '';
        if (msg.message.audioMessage) return msg.message.audioMessage.mimetype || '';
        if (msg.message.documentMessage) return msg.message.documentMessage.mimetype || '';
        return '';
    }

    getMediaFilename(msg) {
        if (msg.message.documentMessage) return msg.message.documentMessage.fileName || '';
        return '';
    }

    getBookingIdFromMessage(msg, phoneNumber) {
        // Check if there's an active booking session for this phone number
        const session = this.bookingManager.getActiveSession(phoneNumber);
        return session ? session.bookingId : null;
    }

    async getBookingHistory(phoneNumber, limit = 10) {
        try {
            if (!models.Booking) {
                console.log('⚠️ Booking model not available');
                return [];
            }

            const bookings = await models.Booking
                .find({ phoneNumber: phoneNumber })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return bookings;
        } catch (error) {
            console.error('❌ Error fetching booking history:', error);
            return [];
        }
    }

    async getCustomerStats(phoneNumber) {
        try {
            if (!models.Customer || !models.Booking) {
                console.log('⚠️ Database models not available');
                return null;
            }

            const customer = await models.Customer.findOne({ phoneNumber: phoneNumber });
            const bookings = await models.Booking.find({ phoneNumber: phoneNumber });

            if (!customer) {
                return null;
            }

            const stats = {
                totalBookings: bookings.length,
                completedBookings: bookings.filter(b => b.status === 'confirmed').length,
                pendingBookings: bookings.filter(b => b.status === 'pending').length,
                preferredVehicleType: customer.preferredVehicleType,
                lastBookingDate: customer.lastBookingDate,
                averageBookingValue: this.calculateAverageBookingValue(bookings),
                totalSpent: this.calculateTotalSpent(bookings)
            };

            return stats;
        } catch (error) {
            console.error('❌ Error fetching customer stats:', error);
            return null;
        }
    }

    calculateAverageBookingValue(bookings) {
        const completedBookings = bookings.filter(b => b.status === 'confirmed' && b.data.pricing);
        if (completedBookings.length === 0) return 0;

        const totalValue = completedBookings.reduce((sum, booking) => {
            return sum + (booking.data.pricing.total || 0);
        }, 0);

        return Math.round(totalValue / completedBookings.length);
    }

    calculateTotalSpent(bookings) {
        const completedBookings = bookings.filter(b => b.status === 'confirmed' && b.data.pricing);

        return completedBookings.reduce((sum, booking) => {
            return sum + (booking.data.pricing.total || 0);
        }, 0);
    }

    // Advanced AI features
    async analyzeSentiment(text) {
        try {
            if (!this.openai) return null;

            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "Analyze the sentiment of the given text. Return only one of: positive, negative, neutral. Be concise."
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                max_tokens: 10,
                temperature: 0.1
            });

            return response.choices[0].message.content.trim().toLowerCase();
        } catch (error) {
            console.error('❌ Error analyzing sentiment:', error);
            return null;
        }
    }

    async generatePersonalizedResponse(text, phoneNumber) {
        try {
            if (!this.openai) return null;

            // Get customer stats for personalization
            const customerStats = await this.getCustomerStats(phoneNumber);
            const sentiment = await this.analyzeSentiment(text);

            let personalizationContext = "";
            if (customerStats) {
                personalizationContext = `Customer has ${customerStats.totalBookings} previous bookings, prefers ${customerStats.preferredVehicleType}, and has spent AED ${customerStats.totalSpent} total.`;
            }

            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: `You are a VIP Chauffeur service assistant. ${personalizationContext} The customer's message has a ${sentiment} sentiment. Respond in a personalized, professional manner.`
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                max_tokens: 200,
                temperature: 0.7
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error('❌ Error generating personalized response:', error);
            return null;
        }
    }

    // Graceful shutdown
    async shutdown() {
        console.log('\n🛑 Shutting down ultra-robust bot...');

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (e) {
                // Ignore logout errors
            }
        }

        this.emit('shutdown', { bot: this });
        process.exit(0);
    }
}

// If this file is run directly, start the bot
if (require.main === module) {
    console.log('🚀 Starting Ultra-Robust AI WhatsApp Bot...');
    console.log('🧠 AI-powered taxi booking system');
    console.log('📊 Database integration enabled');

    const bot = new UltraRobustWhatsAppBot();

    // Start the bot
    bot.initialize().then(() => {
        console.log('✅ Ultra-Robust AI Bot is ready!');
        console.log('🚗 AI booking system activated');
        console.log('🎤 Voice transcription ready');
        console.log('👁️ Image analysis ready');
        console.log('🤖 Ultra-Robust AI Bot is running and ready to receive messages');
        console.log('💬 Send "book chauffeur" to any whitelisted number to start booking');
    }).catch((error) => {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    });

    // Set max listeners to prevent memory leak warning
    process.setMaxListeners(20);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, shutting down gracefully...');
        await bot.shutdown();
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
        await bot.shutdown();
    });

    // Handle unhandled promise rejections to prevent crashes
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
        // Don't exit the process, just log the error
        // Continue running the bot
    });

    // Handle uncaught exceptions to prevent crashes
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        // Don't exit the process, just log the error
        // Continue running the bot
    });
}

module.exports = UltraRobustWhatsAppBot;
