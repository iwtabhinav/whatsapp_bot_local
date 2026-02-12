/**
 * AIResponseGenerator - Intelligent response generation system
 * Implements context-aware AI responses with rich message formats
 */

const ResponseFormatter = require('./ResponseFormatter');

class AIResponseGenerator {
    constructor(openai, bookingManager) {
        this.openai = openai;
        this.bookingManager = bookingManager;
        this.intentPatterns = this.initializeIntentPatterns();
        this.entityPatterns = this.initializeEntityPatterns();
    }

    /**
     * Initialize intent detection patterns
     */
    initializeIntentPatterns() {
        return {
            BOOKING: {
                keywords: ['book', 'reserve', 'schedule', 'chauffeur', 'taxi', 'ride', 'pickup', 'transfer'],
                priority: 'high',
                responseType: 'interactive'
            },
            INQUIRY: {
                keywords: ['price', 'cost', 'rate', 'how much', 'pricing', 'quote', 'estimate'],
                priority: 'medium',
                responseType: 'informative'
            },
            SUPPORT: {
                keywords: ['help', 'support', 'issue', 'problem', 'cancel', 'modify', 'change'],
                priority: 'high',
                responseType: 'assistive'
            },
            LOCATION: {
                keywords: ['where', 'location', 'address', 'pickup', 'drop', 'here', 'nearby'],
                priority: 'medium',
                responseType: 'location_based'
            },
            VEHICLE: {
                keywords: ['vehicle', 'car', 'sedan', 'suv', 'luxury', 'van', 'type'],
                priority: 'medium',
                responseType: 'selection'
            },
            GENERAL: {
                keywords: ['hello', 'hi', 'thanks', 'thank you', 'goodbye', 'bye'],
                priority: 'low',
                responseType: 'conversational'
            }
        };
    }

    /**
     * Initialize entity extraction patterns
     */
    initializeEntityPatterns() {
        return {
            guestName: /(?:guest|name|passenger|rider)\s*(?:is|name|called)?\s*:?\s*([a-zA-Z\s]+)/i,
            vehicleType: /(?:vehicle|car|type)\s*(?:is|type)?\s*:?\s*(sedan|suv|luxury|van|maybach)/i,
            pickupLocation: /(?:pickup|from|collect|get)\s*(?:me|us)?\s*(?:from|at)?\s*:?\s*(.+?)(?:\s+to\s+|\s+drop\s+|\s+destination\s+|$)/i,
            dropLocation: /(?:drop|to|destination|go)\s*(?:me|us)?\s*(?:to|at)?\s*:?\s*(.+?)(?:\s+at\s+|\s+time\s+|\s+when\s+|$)/i,
            pickupTime: /(?:time|when|at|pickup)\s*(?:is|at)?\s*:?\s*([a-zA-Z0-9\s:,-]+)/i,
            phoneNumber: /(\+?[1-9]\d{1,14})/g,
            email: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
        };
    }

    /**
     * Main response generation method
     * @param {string} userMessage - User's message
     * @param {Object} context - Conversation context
     * @param {string} phoneNumber - User's phone number
     * @returns {Object} Generated response
     */
    async generateResponse(userMessage, context, phoneNumber) {
        try {
            // 1. Detect intent
            const intent = await this.detectIntent(userMessage);
            console.log(`🎯 Detected intent: ${intent.type} (${intent.confidence})`);

            // 2. Extract entities
            const entities = this.extractEntities(userMessage);
            console.log(`🔍 Extracted entities:`, entities);

            // 3. Update context
            const updatedContext = this.updateContext(context, intent, entities, phoneNumber);

            // 4. Generate response based on intent and context
            const response = await this.generateContextualResponse(intent, entities, updatedContext, userMessage);

            return {
                response,
                context: updatedContext,
                intent,
                entities
            };

        } catch (error) {
            console.error('❌ Error generating AI response:', error);
            return this.generateFallbackResponse(userMessage);
        }
    }

    /**
     * Detect user intent using AI and pattern matching
     * @param {string} message - User message
     * @returns {Object} Intent detection result
     */
    async detectIntent(message) {
        const lowerMessage = message.toLowerCase();

        // Pattern-based detection first (faster)
        for (const [intentType, config] of Object.entries(this.intentPatterns)) {
            const matches = config.keywords.filter(keyword =>
                lowerMessage.includes(keyword.toLowerCase())
            );

            if (matches.length > 0) {
                return {
                    type: intentType,
                    confidence: Math.min(matches.length / config.keywords.length, 1),
                    keywords: matches,
                    priority: config.priority,
                    responseType: config.responseType
                };
            }
        }

        // AI-based detection for complex cases
        if (this.openai) {
            try {
                const completion = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [
                        {
                            role: "system",
                            content: `Analyze the user's message and classify their intent. Return only the intent type from: BOOKING, INQUIRY, SUPPORT, LOCATION, VEHICLE, GENERAL`
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 10
                });

                const aiIntent = completion.choices[0].message.content.trim();
                if (this.intentPatterns[aiIntent]) {
                    return {
                        type: aiIntent,
                        confidence: 0.8,
                        keywords: [],
                        priority: this.intentPatterns[aiIntent].priority,
                        responseType: this.intentPatterns[aiIntent].responseType
                    };
                }
            } catch (error) {
                console.error('❌ AI intent detection failed:', error);
            }
        }

        // Default to general intent
        return {
            type: 'GENERAL',
            confidence: 0.3,
            keywords: [],
            priority: 'low',
            responseType: 'conversational'
        };
    }

    /**
     * Extract entities from user message
     * @param {string} message - User message
     * @returns {Object} Extracted entities
     */
    extractEntities(message) {
        const entities = {};

        for (const [entityType, pattern] of Object.entries(this.entityPatterns)) {
            const match = message.match(pattern);
            if (match) {
                entities[entityType] = match[1]?.trim() || match[0]?.trim();
            }
        }

        return entities;
    }

    /**
     * Update conversation context
     * @param {Object} context - Current context
     * @param {Object} intent - Detected intent
     * @param {Object} entities - Extracted entities
     * @param {string} phoneNumber - User phone number
     * @returns {Object} Updated context
     */
    updateContext(context, intent, entities, phoneNumber) {
        const updatedContext = {
            ...context,
            lastIntent: intent.type,
            lastEntities: entities,
            lastUpdate: new Date().toISOString(),
            phoneNumber
        };

        // Merge entities into context
        Object.entries(entities).forEach(([key, value]) => {
            if (value) {
                updatedContext[key] = value;
            }
        });

        return updatedContext;
    }

    /**
     * Generate contextual response based on intent and context
     * @param {Object} intent - Detected intent
     * @param {Object} entities - Extracted entities
     * @param {Object} context - Updated context
     * @param {string} originalMessage - Original user message
     * @returns {Object} Generated response
     */
    async generateContextualResponse(intent, entities, context, originalMessage) {
        switch (intent.type) {
            case 'BOOKING':
                return await this.generateBookingResponse(intent, entities, context, originalMessage);

            case 'INQUIRY':
                return await this.generateInquiryResponse(intent, entities, context, originalMessage);

            case 'SUPPORT':
                return await this.generateSupportResponse(intent, entities, context, originalMessage);

            case 'LOCATION':
                return await this.generateLocationResponse(intent, entities, context, originalMessage);

            case 'VEHICLE':
                return await this.generateVehicleResponse(intent, entities, context, originalMessage);

            case 'GENERAL':
            default:
                return await this.generateGeneralResponse(intent, entities, context, originalMessage);
        }
    }

    /**
     * Generate booking response
     */
    async generateBookingResponse(intent, entities, context, originalMessage) {
        // Check if we have an active booking session
        const activeSession = this.bookingManager?.getActiveSession(context.phoneNumber);

        if (activeSession) {
            // Continue existing booking flow
            return this.continueBookingFlow(activeSession, entities, context);
        } else {
            // Start new booking
            return this.startNewBooking(entities, context);
        }
    }

    /**
     * Start new booking flow
     */
    startNewBooking(entities, context) {
        // Create new booking session
        const bookingId = this.bookingManager?.createSession(context.phoneNumber, 'chauffeur');

        return {
            type: 'list',
            content: ResponseFormatter.createServiceSelectionList(),
            message: "🚗 *Welcome to VIP Chauffeur Services!*\n\nI'll help you book your chauffeur service. Please select the type of service you need:"
        };
    }

    /**
     * Continue existing booking flow
     */
    continueBookingFlow(session, entities, context) {
        // Update session with new entities
        if (Object.keys(entities).length > 0) {
            this.bookingManager?.updateSession(session.bookingId, null, 'system', entities);
        }

        // Check what information is still needed
        const missingFields = this.bookingManager?.getMissingFields(session.bookingId) || [];

        if (missingFields.length === 0) {
            // Booking is complete, show confirmation
            const summary = this.bookingManager?.getBookingSummary(session.bookingId);
            return {
                type: 'buttons',
                content: ResponseFormatter.createBookingConfirmationButtons(summary?.data || {}),
                message: "📋 *Booking Details Complete!*\n\nPlease review and confirm your booking:"
            };
        } else {
            // Ask for next missing field
            const nextField = missingFields[0];
            const nextPrompt = this.bookingManager?.getNextPrompt(session.bookingId);

            if (nextField === 'vehicleType') {
                return {
                    type: 'list',
                    content: ResponseFormatter.createVehicleSelectionList(),
                    message: "🚗 *Choose Your Vehicle*\n\nPlease select your preferred vehicle type:"
                };
            } else if (nextField === 'pickupLocation' || nextField === 'dropLocation') {
                return {
                    type: 'buttons',
                    content: ResponseFormatter.createLocationRequestMessage(),
                    message: nextPrompt || "📍 *Location Required*\n\nPlease share your location:"
                };
            } else {
                return {
                    type: 'text',
                    content: { text: nextPrompt || `Please provide ${nextField}` },
                    message: nextPrompt || `Please provide ${nextField}`
                };
            }
        }
    }

    /**
     * Generate inquiry response
     */
    async generateInquiryResponse(intent, entities, context, originalMessage) {
        const pricingInfo = `💰 *VIP Chauffeur Pricing*\n\n` +
            `🚗 **Sedan** - AED 120 base + AED 3/km\n` +
            `🚙 **SUV** - AED 180 base + AED 4/km\n` +
            `✨ **Luxury (Maybach)** - AED 350 base + AED 8/km\n` +
            `🚐 **Van** - AED 220 base + AED 5/km\n\n` +
            `*All prices include professional chauffeur*`;

        return {
            type: 'buttons',
            content: ResponseFormatter.createButtonMessage({
                header: "💰 Pricing Information",
                body: pricingInfo,
                footer: "Ready to book?",
                buttons: [
                    { id: "book_now", text: "🚗 Book Now", type: 1 },
                    { id: "get_quote", text: "📊 Get Quote", type: 1 },
                    { id: "view_services", text: "📋 View Services", type: 1 }
                ]
            }),
            message: pricingInfo
        };
    }

    /**
     * Generate support response
     */
    async generateSupportResponse(intent, entities, context, originalMessage) {
        return {
            type: 'buttons',
            content: ResponseFormatter.createHelpMessage(),
            message: "🆘 *How can I help you?*\n\nI'm here to assist with your chauffeur service needs. Please select an option:"
        };
    }

    /**
     * Generate location response
     */
    async generateLocationResponse(intent, entities, context, originalMessage) {
        return {
            type: 'buttons',
            content: ResponseFormatter.createLocationRequestMessage(),
            message: "📍 *Location Information*\n\nI can help you with location-related services. Please share your location or let me know what you need:"
        };
    }

    /**
     * Generate vehicle response
     */
    async generateVehicleResponse(intent, entities, context, originalMessage) {
        return {
            type: 'list',
            content: ResponseFormatter.createVehicleSelectionList(),
            message: "🚗 *Vehicle Selection*\n\nHere are our available vehicles. Please choose your preference:"
        };
    }

    /**
     * Generate general response
     */
    async generateGeneralResponse(intent, entities, context, originalMessage) {
        if (this.openai) {
            try {
                const completion = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [
                        {
                            role: "system",
                            content: `You are a VIP Chauffeur service assistant. Respond to the user's message in a friendly, professional way. If they want to book, guide them to say "book chauffeur". Keep responses concise and helpful.`
                        },
                        {
                            role: "user",
                            content: originalMessage
                        }
                    ],
                    max_tokens: 150,
                    temperature: 0.7
                });

                const aiResponse = completion.choices[0].message.content;
                return {
                    type: 'text',
                    content: { text: aiResponse },
                    message: aiResponse
                };
            } catch (error) {
                console.error('❌ AI general response failed:', error);
            }
        }

        // Fallback response
        return {
            type: 'buttons',
            content: ResponseFormatter.createHelpMessage(),
            message: "👋 *Hello! Welcome to VIP Chauffeur Services!*\n\nI'm here to help you book your chauffeur service. How can I assist you today?"
        };
    }

    /**
     * Generate fallback response when AI fails
     */
    generateFallbackResponse(userMessage) {
        return {
            type: 'buttons',
            content: ResponseFormatter.createHelpMessage(),
            message: "I apologize, but I'm having trouble processing your request. Please try one of the options below:",
            context: {},
            intent: { type: 'GENERAL', confidence: 0.1 },
            entities: {}
        };
    }
}

module.exports = AIResponseGenerator;
