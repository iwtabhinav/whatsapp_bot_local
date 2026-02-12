/**
 * Enhanced Session Manager - Handles WhatsApp session validation, QR code management, and connection state
 * Fixes the issue where QR codes fail after multiple attempts due to session conflicts
 */

const fs = require('fs');
const path = require('path');

class EnhancedSessionManager {
    constructor(authDir, dataDir) {
        this.authDir = authDir;
        this.dataDir = dataDir;
        this.sessionFiles = [
            'creds.json',
            'baileys_store.json',
            'session.json'
        ];
        this.stateFile = path.join(dataDir, 'whatsapp-connection-state.json');
        this.qrFile = path.join(dataDir, 'whatsapp-qr.json');
        
        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    /**
     * Get current connection state
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
            maxQRAttempts: 10, // Increased to 10 for maximum reliability
            lastQRTime: null,
            sessionCleared: false
        };
    }

    /**
     * Save connection state
     */
    saveConnectionState(state) {
        try {
            const currentState = this.getConnectionState();
            const updatedState = {
                ...currentState,
                ...state,
                lastUpdate: new Date().toISOString()
            };
            
            fs.writeFileSync(this.stateFile, JSON.stringify(updatedState, null, 2));
            console.log(`💾 Connection state saved: ${updatedState.connectionState}`);
            return updatedState;
        } catch (error) {
            console.error('Error saving connection state:', error);
            return null;
        }
    }

    /**
     * Check if session should be cleared based on attempts
     */
    shouldClearSession() {
        const state = this.getConnectionState();
        
        // Clear session if QR attempts exceed limit (now 2 instead of 5)
        if (state.qrAttempts >= state.maxQRAttempts) {
            console.log(`🔄 QR attempts (${state.qrAttempts}) exceeded limit (${state.maxQRAttempts}), clearing session`);
            return true;
        }
        
        // Clear session if connection attempts are very high
        if (state.connectionAttempts >= 15) {
            console.log(`🔄 Connection attempts (${state.connectionAttempts}) very high, clearing session`);
            return true;
        }
        
        return false;
    }

    /**
     * Validate session with enhanced logic
     */
    validateSession() {
        try {
            const state = this.getConnectionState();
            
            // If we should clear session based on attempts, force QR generation
            if (this.shouldClearSession()) {
                return {
                    isValid: false,
                    reason: 'Session cleared due to excessive attempts',
                    needsQR: true,
                    shouldClear: true
                };
            }

            // Check if auth directory exists
            if (!fs.existsSync(this.authDir)) {
                return {
                    isValid: false,
                    reason: 'Auth directory does not exist',
                    needsQR: true,
                    shouldClear: false
                };
            }

            // Check for session files
            const existingFiles = this.sessionFiles.filter(file =>
                fs.existsSync(path.join(this.authDir, file))
            );

            if (existingFiles.length === 0) {
                return {
                    isValid: false,
                    reason: 'No session files found',
                    needsQR: true,
                    shouldClear: false
                };
            }

            // Check if session files are valid JSON
            for (const file of existingFiles) {
                try {
                    const filePath = path.join(this.authDir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    JSON.parse(content);
                } catch (error) {
                    return {
                        isValid: false,
                        reason: `Invalid session file: ${file}`,
                        needsQR: true,
                        shouldClear: true
                    };
                }
            }

            // Check session age and content validity
            const credsPath = path.join(this.authDir, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const stats = fs.statSync(credsPath);
                const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

                // Check if creds.json has valid content
                try {
                    const credsContent = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    if (!credsContent.me || !credsContent.me.id) {
                        return {
                            isValid: false,
                            reason: 'Invalid credentials structure',
                            needsQR: true,
                            shouldClear: true
                        };
                    }

                    // Check if credentials are not empty or corrupted
                    if (!credsContent.me.id || credsContent.me.id.length < 10) {
                        return {
                            isValid: false,
                            reason: 'Invalid or empty credentials',
                            needsQR: true,
                            shouldClear: true
                        };
                    }
                } catch (error) {
                    return {
                        isValid: false,
                        reason: 'Corrupted credentials file',
                        needsQR: true,
                        shouldClear: true
                    };
                }

                if (ageInDays > 14) {
                    return {
                        isValid: true,
                        reason: 'Session exists but may be stale',
                        needsQR: false,
                        shouldClear: false,
                        warning: 'Session is older than 14 days'
                    };
                }
            }

            return {
                isValid: true,
                reason: 'Valid session found',
                needsQR: false,
                shouldClear: false
            };

        } catch (error) {
            return {
                isValid: false,
                reason: `Session validation error: ${error.message}`,
                needsQR: true,
                shouldClear: true
            };
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
     * Clear session completely with enhanced cleanup
     */
    async clearSession(force = false) {
        try {
            console.log('🧹 Starting comprehensive session cleanup...');
            
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
                qrAttempts: 0,
                maxConnectionAttempts: 10,
                maxQRAttempts: 10, // Increased to 10 for maximum reliability
                lastQRTime: null,
                sessionCleared: true,
                sessionClearedAt: new Date().toISOString()
            };

            this.saveConnectionState(freshState);
            console.log('✅ Session state reset');
            
            return true;
        } catch (error) {
            console.error('❌ Error clearing session:', error);
            return false;
        }
    }

    /**
     * Increment QR attempts and check if session should be cleared
     */
    incrementQRAttempts() {
        const state = this.getConnectionState();
        const newQRAttempts = state.qrAttempts + 1;
        
        console.log(`📱 QR attempt ${newQRAttempts}/${state.maxQRAttempts}`);
        
        const updatedState = {
            ...state,
            qrAttempts: newQRAttempts,
            lastQRTime: new Date().toISOString()
        };
        
        this.saveConnectionState(updatedState);
        
        // If QR attempts exceed limit, clear session
        if (newQRAttempts >= state.maxQRAttempts) {
            console.log('🔄 Maximum QR attempts reached, clearing session for fresh start');
            this.clearSession(true);
            return { shouldClear: true, qrAttempts: 0 };
        }
        
        return { shouldClear: false, qrAttempts: newQRAttempts };
    }

    /**
     * Increment connection attempts
     */
    incrementConnectionAttempts() {
        const state = this.getConnectionState();
        const newConnectionAttempts = state.connectionAttempts + 1;
        
        console.log(`🔄 Connection attempt ${newConnectionAttempts}/${state.maxConnectionAttempts}`);
        
        const updatedState = {
            ...state,
            connectionAttempts: newConnectionAttempts
        };
        
        this.saveConnectionState(updatedState);
        return newConnectionAttempts;
    }

    /**
     * Reset all attempts when successfully connected
     */
    resetAttempts() {
        const state = this.getConnectionState();
        const updatedState = {
            ...state,
            connectionAttempts: 0,
            qrAttempts: 0,
            connectionState: 'connected',
            isReady: true,
            isAuthenticated: true,
            sessionCleared: false
        };
        
        this.saveConnectionState(updatedState);
        console.log('✅ Connection attempts reset - successfully connected');
    }

    /**
     * Force QR generation by clearing session
     */
    forceQRGeneration() {
        console.log('🔄 Forcing QR code generation...');
        return this.clearSession(true);
    }

    /**
     * Get comprehensive session status
     */
    getSessionStatus() {
        const validation = this.validateSession();
        const state = this.getConnectionState();
        const authDirExists = fs.existsSync(this.authDir);
        const files = authDirExists ? fs.readdirSync(this.authDir) : [];

        return {
            ...validation,
            ...state,
            authDir: this.authDir,
            authDirExists,
            filesInAuthDir: files,
            sessionFilesFound: this.sessionFiles.filter(file =>
                files.includes(file)
            ),
            shouldClearSession: this.shouldClearSession()
        };
    }
}

module.exports = EnhancedSessionManager;
