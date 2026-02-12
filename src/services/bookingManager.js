const { loadJsonFile, saveJsonFile, saveBookingToExcel } = require('../utils/fileUtils');
const { PATHS, VEHICLE_RATES } = require('../config/config');

class BookingManager {
    constructor() {
        this.sessionsFile = PATHS.BOOKING_SESSIONS;
        this.contextsFile = PATHS.BOOKING_CONTEXTS;
        this.sessions = {};
        this.contexts = {};
        this.customerHistory = {};
        this.metadata = { lastBookingId: 0, lastConfirmationId: 0, version: "1.0" };

        // Initialize with default contexts if none exist
        this.contexts = {
            chauffeur: {
                name: 'Chauffeur Service',
                requiredFields: {
                    customerName: {
                        prompt: "What's your name?",
                        validation: ".*"
                    },
                    vehicleType: {
                        prompt: "Which vehicle would you prefer? (e.g., Lexus ES, BMW 5/7, Mercedes V/S Class)",
                        validation: "^(Lexus ES|BMW 5/7|Mercedes V/S Class)$",
                        options: ['Lexus ES', 'BMW 5/7', 'Mercedes V/S Class']
                    },
                    pickupLocation: {
                        prompt: "What's your pickup location?",
                        validation: ".*"
                    },
                    dropoffLocation: {
                        prompt: "What's your destination? (e.g., Airport, Hotel, Business Meeting)",
                        validation: ".*"
                    },
                    date: {
                        prompt: "What date would you like the service? (DD/MM/YYYY)",
                        validation: ".*"
                    },
                    time: {
                        prompt: "What time would you like to be picked up? (HH:MM)",
                        validation: ".*"
                    },
                    numberOfPassengers: {
                        prompt: "How many passengers will be traveling? (e.g., 1, 2, 3, 4)",
                        validation: ".*"
                    },
                    luggageDetails: {
                        prompt: "Do you have any luggage details? (e.g., 2 suitcases, 1 carry-on bag)",
                        validation: ".*"
                    },
                    specialRequests: {
                        prompt: "Do you have any special requests?",
                        validation: ".*"
                    }

                },
                pricing: VEHICLE_RATES
            }
        };

        this.loadData();
    }

    loadData() {
        try {
            // Load booking contexts
            const savedContexts = loadJsonFile(this.contextsFile, this.contexts);
            this.contexts = savedContexts;

            // Load or initialize sessions data
            const data = loadJsonFile(this.sessionsFile, {
                sessions: {},
                customerHistory: {},
                metadata: { lastBookingId: 0, lastConfirmationId: 0, version: "1.0" }
            });

            this.sessions = data.sessions || {};
            this.customerHistory = data.customerHistory || {};
            this.metadata = data.metadata || { lastBookingId: 0, lastConfirmationId: 0, version: "1.0" };

            // Clean up expired sessions
            this.cleanupExpiredSessions();

            console.log(`📋 Loaded ${Object.keys(this.sessions).length} active sessions`);
            console.log(`👥 Loaded ${Object.keys(this.customerHistory).length} customer records`);

        } catch (error) {
            console.error('❌ Error loading booking data:', error);
            // Initialize with empty data if load fails
            this.sessions = {};
            this.customerHistory = {};
            this.metadata = { lastBookingId: 0, lastConfirmationId: 0, version: "1.0" };
        }
    }

    saveData() {
        try {
            if (!this.sessionsFile) {
                throw new Error('Sessions file path not defined');
            }

            const data = {
                sessions: this.sessions || {},
                customerHistory: this.customerHistory || {},
                metadata: this.metadata || { lastBookingId: 0, lastConfirmationId: 0, version: "1.0" }
            };

            return saveJsonFile(this.sessionsFile, data);
        } catch (error) {
            console.error('❌ Error saving booking data:', error);
            return false;
        }
    }

    cleanupExpiredSessions() {
        const now = new Date();
        const expiryTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

        Object.entries(this.sessions).forEach(([bookingId, session]) => {
            const lastUpdate = new Date(session.updatedAt);
            if (now.getTime() - lastUpdate.getTime() > expiryTime) {
                console.log(`🧹 Cleaning up expired session: ${bookingId}`);
                delete this.sessions[bookingId];
            }
        });
    }

    createSession(phoneNumber) {
        if (!phoneNumber) {
            throw new Error('Phone number is required');
        }

        // Clean up any existing sessions for this number
        this.clearSession(phoneNumber);

        // Auto-increment booking ID
        this.metadata.lastBookingId++;
        const bookingId = `BK${String(this.metadata.lastBookingId).padStart(6, '0')}`;

        this.sessions[bookingId] = {
            bookingId,
            phoneNumber,
            status: 'in_progress',
            data: {},
            processedMessages: [],
            lastPromptSent: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save the updated metadata
        this.saveData();
        return bookingId;
    }

    getSession(bookingId) {
        return this.sessions[bookingId];
    }

    getActiveSession(phoneNumber) {
        return Object.values(this.sessions).find(
            session => session.phoneNumber === phoneNumber &&
                ['in_progress', 'awaiting_confirmation'].includes(session.status)
        );
    }

    clearSession(phoneNumber) {
        const existingSessions = Object.values(this.sessions)
            .filter(session => session.phoneNumber === phoneNumber);

        existingSessions.forEach(session => {
            delete this.sessions[session.bookingId];
        });
    }

    updateSession(bookingId, message, role = 'user', data = null) {
        const session = this.sessions[bookingId];
        if (!session) return false;

        // Update data if provided
        if (data) {
            session.data = { ...session.data, ...data };
        }

        session.updatedAt = new Date().toISOString();
        return true;
    }

    async confirmBooking(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return null;

        // Auto-increment confirmation ID
        this.metadata.lastConfirmationId++;
        const confirmationId = `CNF${String(this.metadata.lastConfirmationId).padStart(6, '0')}`;

        // Update session status
        session.status = 'confirmed';
        session.confirmationId = confirmationId;
        session.confirmedAt = new Date().toISOString();

        // Update customer history
        if (!this.customerHistory[session.phoneNumber]) {
            this.customerHistory[session.phoneNumber] = {
                bookings: [],
                totalBookings: 0,
                lastBooking: null
            };
        }

        this.customerHistory[session.phoneNumber].bookings.push({
            bookingId,
            confirmationId,
            data: session.data,
            confirmedAt: session.confirmedAt
        });

        this.customerHistory[session.phoneNumber].totalBookings++;
        this.customerHistory[session.phoneNumber].lastBooking = session.data;

        // Save the updated data
        this.saveData();
        return confirmationId;
    }

    isMessageProcessed(session, messageId) {
        return session.processedMessages.includes(messageId);
    }

    markMessageProcessed(session, messageId) {
        if (!session.processedMessages.includes(messageId)) {
            session.processedMessages.push(messageId);
            // Keep only last 20 messages
            if (session.processedMessages.length > 20) {
                session.processedMessages = session.processedMessages.slice(-20);
            }
        }
    }

    getMissingFields(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return [];

        const context = this.contexts[session.contextType];
        if (!context) return [];

        const requiredFields = Object.keys(context.requiredFields);
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

    getBookingSummary(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return null;

        const context = this.contexts[session.contextType];
        if (!context) return null;

        const summary = {
            bookingId: session.bookingId,
            status: session.status,
            type: context.name,
            data: session.data,
            pricing: this.calculatePrice(session)
        };

        return summary;
    }

    calculatePrice(session) {
        const context = this.contexts[session.contextType];
        if (!context || !session.data.vehicleType) return null;

        const pricing = context.pricing[session.data.vehicleType];
        if (!pricing) return null;

        if (pricing.flat) {
            return {
                base: pricing.flat,
                total: pricing.flat
            };
        } else {
            const estimatedDistance = 25; // Default distance in km
            return {
                base: pricing.base,
                perKm: pricing.perKm,
                distance: estimatedDistance,
                total: pricing.base + (pricing.perKm * estimatedDistance)
            };
        }
    }

    async completeBooking(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return false;

        session.status = 'confirmed';
        session.updatedAt = new Date().toISOString();

        // Update customer history
        const customerHistory = this.customerHistory[session.phoneNumber];
        customerHistory.bookings.push(bookingId);
        customerHistory.totalBookings++;
        customerHistory.lastBooking = bookingId;

        // Save to Excel
        const bookingData = {
            bookingId: session.bookingId,
            timestamp: session.createdAt,
            phoneNumber: session.phoneNumber,
            ...session.data,
            ...this.calculatePrice(session),
            status: session.status
        };

        await saveBookingToExcel(bookingData);
        this.saveData();
        return true;
    }

    getCustomerHistory(phoneNumber) {
        return this.customerHistory[phoneNumber] || null;
    }

    cancelBooking(bookingId) {
        const session = this.sessions[bookingId];
        if (!session) return false;

        session.status = 'cancelled';
        session.updatedAt = new Date().toISOString();
        this.saveData();
        return true;
    }
}

module.exports = new BookingManager(); 