/**
 * ContextManager - Manages conversation context and user sessions
 * Implements intelligent context tracking for seamless conversations
 */

class ContextManager {
    constructor() {
        this.userContexts = new Map();
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
        this.maxContextHistory = 50; // Maximum messages to keep in context
    }

    /**
     * Get or create user context
     * @param {string} phoneNumber - User's phone number
     * @returns {Object} User context
     */
    getUserContext(phoneNumber) {
        if (!this.userContexts.has(phoneNumber)) {
            this.userContexts.set(phoneNumber, {
                phoneNumber,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                conversationHistory: [],
                currentIntent: null,
                currentSession: null,
                preferences: {},
                metadata: {}
            });
        }

        const context = this.userContexts.get(phoneNumber);
        context.lastActivity = new Date().toISOString();
        return context;
    }

    /**
     * Update user context with new information
     * @param {string} phoneNumber - User's phone number
     * @param {Object} updates - Context updates
     */
    updateUserContext(phoneNumber, updates) {
        const context = this.getUserContext(phoneNumber);

        // Merge updates into context
        Object.assign(context, updates);
        context.lastActivity = new Date().toISOString();

        // Clean up old conversation history if needed
        if (context.conversationHistory.length > this.maxContextHistory) {
            context.conversationHistory = context.conversationHistory.slice(-this.maxContextHistory);
        }

        this.userContexts.set(phoneNumber, context);
    }

    /**
     * Add message to conversation history
     * @param {string} phoneNumber - User's phone number
     * @param {Object} message - Message object
     * @param {string} role - Message role (user, assistant, system)
     */
    addMessageToHistory(phoneNumber, message, role = 'user') {
        const context = this.getUserContext(phoneNumber);

        context.conversationHistory.push({
            role,
            message,
            timestamp: new Date().toISOString(),
            messageId: message.key?.id || Date.now().toString()
        });

        this.updateUserContext(phoneNumber, context);
    }

    /**
     * Get conversation history for context
     * @param {string} phoneNumber - User's phone number
     * @param {number} limit - Number of recent messages to return
     * @returns {Array} Conversation history
     */
    getConversationHistory(phoneNumber, limit = 10) {
        const context = this.getUserContext(phoneNumber);
        return context.conversationHistory.slice(-limit);
    }

    /**
     * Set current intent for user
     * @param {string} phoneNumber - User's phone number
     * @param {string} intent - Current intent
     * @param {number} confidence - Intent confidence score
     */
    setCurrentIntent(phoneNumber, intent, confidence = 1.0) {
        this.updateUserContext(phoneNumber, {
            currentIntent: { type: intent, confidence, timestamp: new Date().toISOString() }
        });
    }

    /**
     * Get current intent for user
     * @param {string} phoneNumber - User's phone number
     * @returns {Object|null} Current intent
     */
    getCurrentIntent(phoneNumber) {
        const context = this.getUserContext(phoneNumber);
        return context.currentIntent;
    }

    /**
     * Set current booking session
     * @param {string} phoneNumber - User's phone number
     * @param {string} sessionId - Booking session ID
     */
    setCurrentSession(phoneNumber, sessionId) {
        this.updateUserContext(phoneNumber, {
            currentSession: { id: sessionId, timestamp: new Date().toISOString() }
        });
    }

    /**
     * Get current booking session
     * @param {string} phoneNumber - User's phone number
     * @returns {Object|null} Current session
     */
    getCurrentSession(phoneNumber) {
        const context = this.getUserContext(phoneNumber);
        return context.currentSession;
    }

    /**
     * Clear current session
     * @param {string} phoneNumber - User's phone number
     */
    clearCurrentSession(phoneNumber) {
        this.updateUserContext(phoneNumber, {
            currentSession: null
        });
    }

    /**
     * Update user preferences
     * @param {string} phoneNumber - User's phone number
     * @param {Object} preferences - User preferences
     */
    updatePreferences(phoneNumber, preferences) {
        const context = this.getUserContext(phoneNumber);
        context.preferences = { ...context.preferences, ...preferences };
        this.updateUserContext(phoneNumber, context);
    }

    /**
     * Get user preferences
     * @param {string} phoneNumber - User's phone number
     * @returns {Object} User preferences
     */
    getPreferences(phoneNumber) {
        const context = this.getUserContext(phoneNumber);
        return context.preferences;
    }

    /**
     * Set metadata for user
     * @param {string} phoneNumber - User's phone number
     * @param {Object} metadata - Metadata to store
     */
    setMetadata(phoneNumber, metadata) {
        const context = this.getUserContext(phoneNumber);
        context.metadata = { ...context.metadata, ...metadata };
        this.updateUserContext(phoneNumber, context);
    }

    /**
     * Get metadata for user
     * @param {string} phoneNumber - User's phone number
     * @returns {Object} User metadata
     */
    getMetadata(phoneNumber) {
        const context = this.getUserContext(phoneNumber);
        return context.metadata;
    }

    /**
     * Check if user context has expired
     * @param {string} phoneNumber - User's phone number
     * @returns {boolean} True if context has expired
     */
    isContextExpired(phoneNumber) {
        const context = this.getUserContext(phoneNumber);
        const now = new Date();
        const lastActivity = new Date(context.lastActivity);
        return (now - lastActivity) > this.sessionTimeout;
    }

    /**
     * Clean up expired contexts
     */
    cleanupExpiredContexts() {
        const now = new Date();
        const expiredUsers = [];

        for (const [phoneNumber, context] of this.userContexts.entries()) {
            const lastActivity = new Date(context.lastActivity);
            if ((now - lastActivity) > this.sessionTimeout) {
                expiredUsers.push(phoneNumber);
            }
        }

        expiredUsers.forEach(phoneNumber => {
            this.userContexts.delete(phoneNumber);
            console.log(`🧹 Cleaned up expired context for ${phoneNumber}`);
        });

        return expiredUsers.length;
    }

    /**
     * Get context summary for user
     * @param {string} phoneNumber - User's phone number
     * @returns {Object} Context summary
     */
    getContextSummary(phoneNumber) {
        const context = this.getUserContext(phoneNumber);

        return {
            phoneNumber: context.phoneNumber,
            createdAt: context.createdAt,
            lastActivity: context.lastActivity,
            messageCount: context.conversationHistory.length,
            currentIntent: context.currentIntent,
            currentSession: context.currentSession,
            preferences: context.preferences,
            metadata: context.metadata,
            isExpired: this.isContextExpired(phoneNumber)
        };
    }

    /**
     * Reset user context
     * @param {string} phoneNumber - User's phone number
     */
    resetUserContext(phoneNumber) {
        this.userContexts.delete(phoneNumber);
        console.log(`🔄 Reset context for ${phoneNumber}`);
    }

    /**
     * Get all active contexts
     * @returns {Array} Array of context summaries
     */
    getAllActiveContexts() {
        const contexts = [];
        for (const [phoneNumber, context] of this.userContexts.entries()) {
            if (!this.isContextExpired(phoneNumber)) {
                contexts.push(this.getContextSummary(phoneNumber));
            }
        }
        return contexts;
    }

    /**
     * Get context statistics
     * @returns {Object} Context statistics
     */
    getContextStats() {
        const totalContexts = this.userContexts.size;
        const activeContexts = this.getAllActiveContexts().length;
        const expiredContexts = totalContexts - activeContexts;

        return {
            total: totalContexts,
            active: activeContexts,
            expired: expiredContexts,
            memoryUsage: process.memoryUsage().heapUsed
        };
    }

    /**
     * Start periodic cleanup
     * @param {number} interval - Cleanup interval in milliseconds
     */
    startPeriodicCleanup(interval = 5 * 60 * 1000) { // 5 minutes
        setInterval(() => {
            const cleaned = this.cleanupExpiredContexts();
            if (cleaned > 0) {
                console.log(`🧹 Periodic cleanup: removed ${cleaned} expired contexts`);
            }
        }, interval);
    }

    /**
     * Update user context
     * @param {string} phoneNumber - User's phone number
     * @param {Object} context - Updated context
     */
    updateContext(phoneNumber, context) {
        if (this.userContexts.has(phoneNumber)) {
            const existingContext = this.userContexts.get(phoneNumber);
            this.userContexts.set(phoneNumber, {
                ...existingContext,
                ...context,
                lastUpdated: new Date().toISOString()
            });
        } else {
            this.userContexts.set(phoneNumber, {
                ...context,
                lastUpdated: new Date().toISOString()
            });
        }
    }
}

module.exports = ContextManager;
