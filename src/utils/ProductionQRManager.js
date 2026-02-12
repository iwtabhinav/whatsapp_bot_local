/**
 * Production QR Manager - Handles QR code generation and scanning issues automatically
 * This ensures QR codes work reliably in production without manual intervention
 */

const fs = require('fs');
const path = require('path');

class ProductionQRManager {
    constructor(authDir, dataDir) {
        this.authDir = authDir;
        this.dataDir = dataDir;
        this.qrFile = path.join(dataDir, 'whatsapp-qr.json');
        this.stateFile = path.join(dataDir, 'whatsapp-connection-state.json');
        
        // QR code configuration - Optimized for 1st attempt connection
        this.maxQRAttempts = 10; // Increased to 10 for maximum reliability
        this.qrExpiryTime = 180000; // 3 minutes (increased from 2 minutes)
        this.qrRegenerationDelay = 60000; // 60 seconds between QR generations (proper timing for scanning)
        this.lastQRGeneration = 0;
        this.manualQRRequested = false; // Track manual QR requests
        
        // Session health monitoring - Optimized for stability
        this.sessionHealthCheckInterval = 60000; // 60 seconds (increased from 30 seconds)
        this.maxSessionAge = 48 * 60 * 60 * 1000; // 48 hours (increased from 24 hours)
        this.startHealthMonitoring();
    }

    /**
     * Start session health monitoring
     */
    startHealthMonitoring() {
        setInterval(async () => {
            await this.checkSessionHealth();
        }, this.sessionHealthCheckInterval);
    }

    /**
     * Check session health and auto-cleanup if needed
     */
    async checkSessionHealth() {
        try {
            const state = this.getConnectionState();
            const now = Date.now();
            const sessionAge = now - new Date(state.lastUpdate).getTime();
            
            // Check if bot is actively connected and working
            const isActivelyConnected = this.isBotActivelyConnected();
            
            // Only auto-clear session if:
            // 1. Bot is NOT actively connected (disconnected/connecting/initializing/stale)
            // 2. AND session is too old (48 hours) - NOT based on QR attempts
            if (!isActivelyConnected && sessionAge > this.maxSessionAge) {
                console.log('🔄 Auto-clearing stale session (48+ hours old)');
                console.log(`🔍 Reason: ActivelyConnected=${isActivelyConnected}, Age=${Math.round(sessionAge / (60 * 60 * 1000))}h`);
                await this.clearSession(true, true); // Preserve QR attempts
            } else if (isActivelyConnected) {
                console.log('✅ Session is healthy and actively connected - no cleanup needed');
                console.log(`📱 Connected as: ${state.connectedNumber}, Last heartbeat: ${Math.round((now - new Date(state.lastHeartbeat).getTime()) / 1000)}s ago`);
            } else {
                console.log(`🔍 Session health check: ActivelyConnected=${isActivelyConnected}, Age=${Math.round(sessionAge / (60 * 60 * 1000))}h, QRAttempts=${state.qrAttempts}`);
            }
        } catch (error) {
            console.error('Error in session health check:', error);
        }
    }

    /**
     * Generate QR code with production-ready error handling
     */
    async generateQRCode(qrData, isManualRequest = false) {
        try {
            const now = Date.now();
            
            // Check if bot is already connected - don't generate new QR if connected
            const state = this.getConnectionState();
            if (this.isBotActivelyConnected() && !isManualRequest) {
                console.log('✅ Bot is already connected, skipping QR generation');
                return null;
            }
            
            // Define isFirstQR at the top level for use throughout the function
            const isFirstQR = !this.lastQRGeneration;
            
            // For manual requests, allow immediate generation
            if (isManualRequest) {
                console.log('🔄 Manual QR generation requested');
                this.manualQRRequested = true;
                this.lastQRGeneration = now;
            } else {
                // Add extra delay for first QR generation to allow session stabilization
                const baseDelay = isFirstQR ? 5000 : this.qrRegenerationDelay; // 5 seconds for first QR
                
                // Prevent too frequent QR generation for automatic requests
                if (now - this.lastQRGeneration < baseDelay) {
                    const timeLeft = Math.ceil((baseDelay - (now - this.lastQRGeneration)) / 1000);
                    console.log(`⏰ QR generation too frequent, waiting ${timeLeft} more seconds...`);
                    return null;
                }
                this.lastQRGeneration = now;
            }
            
            // Only clear session if we've exhausted all attempts
            if (state.qrAttempts >= this.maxQRAttempts) {
                console.log('🔄 Max QR attempts reached, clearing session for fresh start');
                await this.clearSession(true, false); // Don't preserve QR attempts - start fresh
                // Reset QR attempts after clearing session
                this.updateConnectionState({
                    qrAttempts: 0
                });
            }
            
            // Generate QR code data
            const qrCodeData = {
                qrCode: qrData.qrCode,
                qrData: qrData.qrData,
                timestamp: new Date().toISOString(),
                attempt: state.qrAttempts + 1,
                maxRetries: this.maxQRAttempts,
                age: 'fresh',
                expiresAt: new Date(now + this.qrExpiryTime).toISOString(),
                generatedAt: now,
                sessionId: this.generateSessionId()
            };
            
            // Save QR data
            fs.writeFileSync(this.qrFile, JSON.stringify(qrCodeData, null, 2));
            
            // Add stabilization delay for first QR to prevent Stream Errored
            if (isFirstQR && !isManualRequest) {
                console.log('⏳ Adding stabilization delay for first QR...');
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            }
            
            // Update connection state
            this.updateConnectionState({
                connectionState: 'initializing',
                qrAttempts: state.qrAttempts + 1,
                lastQRTime: new Date().toISOString()
            });
            
            console.log(`✅ QR code generated (attempt ${qrCodeData.attempt}/${this.maxQRAttempts})`);
            console.log(`⏰ QR expires at: ${qrCodeData.expiresAt}`);
            
            return qrCodeData;
            
        } catch (error) {
            console.error('❌ Error generating QR code:', error);
            return null;
        }
    }

    /**
     * Force generate new QR code (for manual requests)
     */
    async forceGenerateQR(qrData) {
        console.log('🔄 Force generating new QR code...');
        return await this.generateQRCode(qrData, true);
    }

    /**
     * Handle QR code scanning result
     */
    async handleQRScanResult(success, error = null) {
        try {
            const state = this.getConnectionState();
            
            if (success) {
                console.log('✅ QR code scanned successfully');
                // Reset QR attempts on successful scan
                this.updateConnectionState({
                    qrAttempts: 0,
                    connectionState: 'connecting'
                });
            } else {
                console.log('❌ QR code scan failed:', error?.message || 'Unknown error');
                
                // Increment failed attempts
                const newAttempts = state.qrAttempts + 1;
                this.updateConnectionState({
                    qrAttempts: newAttempts
                });
                
                // If too many failures, clear session
                if (newAttempts >= this.maxQRAttempts) {
                    console.log('🔄 Too many QR scan failures, clearing session');
                    await this.clearSession(true, false); // Don't preserve QR attempts - start fresh
                }
            }
        } catch (error) {
            console.error('Error handling QR scan result:', error);
        }
    }

    /**
     * Check if QR code is still valid
     */
    isQRCodeValid() {
        try {
            if (!fs.existsSync(this.qrFile)) {
                return false;
            }
            
            const qrData = JSON.parse(fs.readFileSync(this.qrFile, 'utf8'));
            const now = Date.now();
            const expiresAt = new Date(qrData.expiresAt).getTime();
            
            return now < expiresAt;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get current QR code data
     */
    getQRCodeData() {
        try {
            if (!fs.existsSync(this.qrFile)) {
                return null;
            }
            
            const qrData = JSON.parse(fs.readFileSync(this.qrFile, 'utf8'));
            
            // Check if QR is still valid
            if (!this.isQRCodeValid()) {
                console.log('⏰ QR code expired, removing');
                fs.unlinkSync(this.qrFile);
                return null;
            }
            
            return qrData;
        } catch (error) {
            console.error('Error reading QR code data:', error);
            return null;
        }
    }

    /**
     * Cross-platform directory deletion with retry logic
     */
    async deleteDirectoryWithRetry(dirPath, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                fs.rmSync(dirPath, { recursive: true, force: true });
                return;
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                console.log(`⚠️ Deletion attempt ${attempt} failed, retrying... (${error.message})`);
                const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                try {
                    if (global.gc) {
                        global.gc();
                    }
                } catch (gcError) {}
            }
        }
    }

    /**
     * Clear session with production-safe cleanup
     */
    async clearSession(force = false, preserveQRAttempts = false) {
        try {
            console.log('🧹 Clearing session for fresh QR generation...');
            
            // Get current state to preserve QR attempts if needed
            const currentState = this.getConnectionState();
            
            // Clear auth directory with retry logic
            if (fs.existsSync(this.authDir)) {
                await this.deleteDirectoryWithRetry(this.authDir);
                console.log('✅ Auth directory cleared');
            }
            
            // Clear QR file
            if (fs.existsSync(this.qrFile)) {
                fs.unlinkSync(this.qrFile);
                console.log('✅ QR file cleared');
            }
            
            // Reset connection state
            const freshState = {
                connectionState: 'disconnected',
                isReady: false,
                isAuthenticated: false,
                connectedNumber: null,
                lastHeartbeat: new Date().toISOString(),
                lastUpdate: new Date().toISOString(),
                connectionAttempts: 0,
                qrAttempts: preserveQRAttempts ? (currentState.qrAttempts || 0) : 0,
                maxConnectionAttempts: 10,
                maxQRAttempts: this.maxQRAttempts,
                lastQRTime: null,
                sessionCleared: true,
                sessionClearedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(this.stateFile, JSON.stringify(freshState, null, 2));
            console.log('✅ Session state reset');
            
            return true;
        } catch (error) {
            console.error('Error clearing session:', error);
            return false;
        }
    }

    /**
     * Get connection state
     */
    getConnectionState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading connection state:', error);
        }
        
        return {
            connectionState: 'disconnected',
            isReady: false,
            isAuthenticated: false,
            connectedNumber: null,
            lastHeartbeat: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            connectionAttempts: 0,
            qrAttempts: 0,
            maxConnectionAttempts: 10,
            maxQRAttempts: this.maxQRAttempts,
            lastQRTime: null,
            sessionCleared: false
        };
    }

    /**
     * Update connection state
     */
    updateConnectionState(updates) {
        try {
            const currentState = this.getConnectionState();
            const updatedState = {
                ...currentState,
                ...updates,
                lastUpdate: new Date().toISOString()
            };
            
            fs.writeFileSync(this.stateFile, JSON.stringify(updatedState, null, 2));
            return updatedState;
        } catch (error) {
            console.error('Error updating connection state:', error);
            return null;
        }
    }

    /**
     * Check if bot is actively connected and working
     */
    isBotActivelyConnected() {
        try {
            const state = this.getConnectionState();
            const now = Date.now();
            const lastHeartbeat = new Date(state.lastHeartbeat).getTime();
            const heartbeatAge = now - lastHeartbeat;
            
            // Bot is considered actively connected if:
            // 1. Connection state is 'connected'
            // 2. Is authenticated
            // 3. Has a connected number
            // 4. Last heartbeat is within 10 minutes (600000ms) - more lenient
            const isConnected = state.connectionState === 'connected' && 
                               state.isAuthenticated && 
                               state.connectedNumber && 
                               heartbeatAge < 600000; // 10 minutes (more lenient)
            
            return isConnected;
        } catch (error) {
            console.error('Error checking bot connection status:', error);
            return false;
        }
    }

    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get QR generation statistics
     */
    getQRStats() {
        const state = this.getConnectionState();
        const qrData = this.getQRCodeData();
        const isActivelyConnected = this.isBotActivelyConnected();
        
        return {
            currentAttempt: state.qrAttempts,
            maxAttempts: this.maxQRAttempts,
            hasValidQR: qrData !== null,
            qrExpiresAt: qrData?.expiresAt || null,
            sessionCleared: state.sessionCleared,
            lastQRTime: state.lastQRTime,
            isActivelyConnected: isActivelyConnected,
            connectedNumber: state.connectedNumber,
            connectionState: state.connectionState,
            lastHeartbeat: state.lastHeartbeat
        };
    }
}

module.exports = ProductionQRManager;
