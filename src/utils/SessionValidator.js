/**
 * SessionValidator - Handles WhatsApp session validation and QR code management
 */

const fs = require('fs');
const path = require('path');

class SessionValidator {
    constructor(authDir) {
        this.authDir = authDir;
        this.sessionFiles = [
            'creds.json',
            'baileys_store.json',
            'session.json'
        ];
    }

    /**
     * Check if a valid session exists
     * @returns {Object} Session validation result
     */
    validateSession() {
        try {
            // Check if auth directory exists
            if (!fs.existsSync(this.authDir)) {
                return {
                    isValid: false,
                    reason: 'Auth directory does not exist',
                    needsQR: true
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
                    needsQR: true
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
                        needsQR: true
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
                            needsQR: true
                        };
                    }

                    // Check if credentials are not empty or corrupted
                    if (!credsContent.me.id || credsContent.me.id.length < 10) {
                        return {
                            isValid: false,
                            reason: 'Invalid or empty credentials',
                            needsQR: true
                        };
                    }
                } catch (error) {
                    return {
                        isValid: false,
                        reason: 'Corrupted credentials file',
                        needsQR: true
                    };
                }

                if (ageInDays > 14) { // Increased from 7 to 14 days
                    return {
                        isValid: true,
                        reason: 'Session exists but may be stale',
                        needsQR: false,
                        warning: 'Session is older than 14 days'
                    };
                }
            }

            return {
                isValid: true,
                reason: 'Valid session found',
                needsQR: false
            };

        } catch (error) {
            return {
                isValid: false,
                reason: `Session validation error: ${error.message}`,
                needsQR: true
            };
        }
    }

    /**
     * Get current session status
     */
    getSessionStatus() {
        return this.validateSession();
    }

    /**
     * Clear invalid session files
     */
    clearInvalidSession() {
        try {
            if (fs.existsSync(this.authDir)) {
                // Remove all session files
                this.sessionFiles.forEach(file => {
                    const filePath = path.join(this.authDir, file);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Removed invalid session file: ${file}`);
                    }
                });

                // Remove any other files in auth directory
                const files = fs.readdirSync(this.authDir);
                files.forEach(file => {
                    const filePath = path.join(this.authDir, file);
                    if (fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Removed file: ${file}`);
                    }
                });

                console.log('✅ Invalid session cleared');
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Error clearing session:', error);
            return false;
        }
    }

    /**
     * Force QR code generation by clearing session
     */
    forceQRGeneration() {
        console.log('🔄 Forcing QR code generation...');
        return this.clearInvalidSession();
    }

    /**
     * Get session status for debugging
     */
    getSessionStatus() {
        const validation = this.validateSession();
        const authDirExists = fs.existsSync(this.authDir);
        const files = authDirExists ? fs.readdirSync(this.authDir) : [];

        return {
            ...validation,
            authDir: this.authDir,
            authDirExists,
            filesInAuthDir: files,
            sessionFilesFound: this.sessionFiles.filter(file =>
                files.includes(file)
            )
        };
    }
}

module.exports = SessionValidator;
