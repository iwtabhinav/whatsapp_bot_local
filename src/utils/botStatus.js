/**
 * Bot status management utility
 */
class BotStatus {
    constructor() {
        this.status = 'disconnected';
        this.data = {};
        this.listeners = [];
    }

    /**
     * Update bot status
     * @param {string} status - New status
     * @param {Object} data - Additional data
     */
    updateStatus(status, data = {}) {
        this.status = status;
        this.data = { ...this.data, ...data };
        this.notifyListeners(status, data);
    }

    /**
     * Get current status
     * @returns {Object} - Current status and data
     */
    getStatus() {
        return {
            status: this.status,
            data: this.data,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Add status change listener
     * @param {Function} callback - Callback function
     */
    onStatusChange(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove status change listener
     * @param {Function} callback - Callback function to remove
     */
    removeStatusListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Notify all listeners of status change
     * @param {string} status - New status
     * @param {Object} data - Additional data
     */
    notifyListeners(status, data) {
        this.listeners.forEach(callback => {
            try {
                callback(status, data);
            } catch (error) {
                console.error('Error in status listener:', error);
            }
        });
    }

    /**
     * Reset status to disconnected
     */
    reset() {
        this.updateStatus('disconnected', {});
    }

    /**
     * Check if bot is connected
     * @returns {boolean} - True if connected
     */
    isConnected() {
        return this.status === 'connected' || this.status === 'ready' || this.status === 'authenticated';
    }

    /**
     * Check if bot is ready
     * @returns {boolean} - True if ready
     */
    isReady() {
        return this.status === 'ready';
    }

    /**
     * Get QR code if available
     * @returns {string|null} - QR code string or null
     */
    getQRCode() {
        return this.data.qr || null;
    }

    /**
     * Get connection error if any
     * @returns {string|null} - Error message or null
     */
    getError() {
        return this.data.error || null;
    }
}

// Create singleton instance
const botStatus = new BotStatus();

module.exports = botStatus;
