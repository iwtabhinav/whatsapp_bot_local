const { loadJsonFile, saveJsonFile } = require('../utils/fileUtils');
const { PATHS, DEFAULT_WHITELISTED_NUMBERS } = require('../config/config');
const configManagementService = require('./configManagementService');

class UserManager {
  constructor() {
    this.registeredUsers = new Map();
    this.whitelistedNumbers = new Set();
    this.mediaAuthorizedNumbers = new Set();

    this.loadRegisteredUsers();
    this.loadAuthorizedNumbers().catch(error => {
      console.error('❌ Error loading authorized numbers:', error);
    });
  }

  loadRegisteredUsers() {
    try {
      const users = loadJsonFile(PATHS.REGISTERED_USERS_FILE, {});
      this.registeredUsers = new Map(Object.entries(users));
      console.log(`👥 Loaded ${this.registeredUsers.size} registered users`);
    } catch (error) {
      console.error('❌ Error loading registered users:', error);
      this.saveRegisteredUsers();
    }
  }

  saveRegisteredUsers() {
    try {
      const usersObj = Object.fromEntries(this.registeredUsers);
      return saveJsonFile(PATHS.REGISTERED_USERS_FILE, usersObj);
    } catch (error) {
      console.error('❌ Error saving registered users:', error);
      return false;
    }
  }

  async loadAuthorizedNumbers() {
    try {
      console.log('📱 Loading authorized numbers from database...');

      // Wait for database connection to be ready
      await this.waitForDatabaseConnection();

      // Load from database
      const config = await configManagementService.getConfig('MEDIA_AUTH_CONFIG', {
        mediaAuthorizedNumbers: [],
        whitelistedNumbers: []
      });

      // Initialize sets
      this.mediaAuthorizedNumbers = new Set();
      this.whitelistedNumbers = new Set();

      // Load authorized numbers
      if (Array.isArray(config.mediaAuthorizedNumbers)) {
        config.mediaAuthorizedNumbers.forEach(number => {
          const cleanNumber = this.cleanPhoneNumber(number);
          this.mediaAuthorizedNumbers.add(cleanNumber);
        });
      }

      // Load whitelisted numbers
      if (Array.isArray(config.whitelistedNumbers)) {
        config.whitelistedNumbers.forEach(number => {
          const cleanNumber = this.cleanPhoneNumber(number);
          this.whitelistedNumbers.add(cleanNumber);
        });
      }

      // Fallback to defaults if DB has no numbers
      if (this.whitelistedNumbers.size === 0 && Array.isArray(DEFAULT_WHITELISTED_NUMBERS)) {
        console.log('📱 No numbers in database, using default whitelisted numbers...');
        DEFAULT_WHITELISTED_NUMBERS.forEach(number => {
          const cleanNumber = this.cleanPhoneNumber(number);
          this.whitelistedNumbers.add(cleanNumber);
        });
      }

      console.log(`📱 Loaded ${this.mediaAuthorizedNumbers.size} authorized numbers`);
      console.log(`📱 Loaded ${this.whitelistedNumbers.size} whitelisted numbers`);

    } catch (error) {
      console.error('❌ Error loading media authorization config:', error);
      this.initializeDefaultNumbers();
    }
  }

  async waitForDatabaseConnection() {
    let attempts = 0;
    const maxAttempts = 30; // Wait up to 30 seconds

    while (attempts < maxAttempts) {
      try {
        // Try to access the database to see if it's connected
        const config = await configManagementService.getConfig('MEDIA_AUTH_CONFIG', {
          mediaAuthorizedNumbers: [],
          whitelistedNumbers: []
        });

        if (config) {
          console.log('✅ Database connection confirmed');
          return;
        }
      } catch (error) {
        if (error.message.includes('MongoNetworkError') ||
          error.message.includes('MongooseServerSelectionError') ||
          error.message.includes('ECONNREFUSED')) {
          console.log(`⏳ Waiting for database connection... (attempt ${attempts + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
        } else {
          // If it's not a connection error, the database might be working
          console.log('✅ Database appears to be accessible');
          return;
        }
      }
    }

    console.log('⚠️ Database connection timeout, proceeding with defaults');
  }

  initializeDefaultNumbers() {
    this.mediaAuthorizedNumbers = new Set();
    this.whitelistedNumbers = new Set();
    this.saveAuthorizedNumbers();
  }

  async saveAuthorizedNumbers() {
    try {
      const config = {
        mediaAuthorizedNumbers: Array.from(this.mediaAuthorizedNumbers),
        whitelistedNumbers: Array.from(this.whitelistedNumbers)
      };

      // Save to database
      await configManagementService.setConfig('MEDIA_AUTH_CONFIG', config, 'Media authorization configuration');

      // Notify that whitelist has been updated for seamless integration
      this.notifyWhitelistUpdate();

      return true;
    } catch (error) {
      console.error('❌ Error saving authorized numbers:', error);
      return false;
    }
  }

  notifyWhitelistUpdate() {
    // Emit event for real-time updates
    try {
      global.webPlatformIO && global.webPlatformIO.emit('whitelistUpdated', {
        count: this.whitelistedNumbers.size,
        numbers: Array.from(this.whitelistedNumbers),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      // Silent fail if web platform not available
    }
  }

  setAuthorizedNumbers(numbers) {
    if (!Array.isArray(numbers)) {
      console.error('❌ Invalid numbers array provided');
      return false;
    }

    // Clear existing numbers
    this.mediaAuthorizedNumbers.clear();
    this.whitelistedNumbers.clear();

    // Add new numbers
    numbers.forEach(number => {
      const cleanNumber = this.cleanPhoneNumber(number);
      this.mediaAuthorizedNumbers.add(cleanNumber);
      this.whitelistedNumbers.add(cleanNumber);
    });

    console.log(`📱 Media processing authorized for ${this.mediaAuthorizedNumbers.size} numbers:`);
    this.mediaAuthorizedNumbers.forEach(number => {
      console.log(`   • ${number}`);
    });

    return this.saveAuthorizedNumbers();
  }

  isWhitelisted(phoneNumber) {
    try {
      if (!phoneNumber) {
        console.log('❌ No phone number provided for whitelist check');
        return false;
      }

      const cleanNumber = this.cleanPhoneNumber(phoneNumber);
      const isWhitelisted = this.whitelistedNumbers.has(cleanNumber);

      if (!isWhitelisted) {
        console.log(`❌ Number ${cleanNumber} is not whitelisted`);
      }

      return isWhitelisted;
    } catch (error) {
      console.error('❌ Error checking whitelist:', error);
      return false;
    }
  }

  isMediaAuthorized(phoneNumber) {
    try {
      if (!phoneNumber) {
        console.log('❌ No phone number provided for media authorization check');
        return false;
      }

      const cleanNumber = this.cleanPhoneNumber(phoneNumber);
      const isAuthorized = this.mediaAuthorizedNumbers.has(cleanNumber);

      if (!isAuthorized) {
        console.log(`❌ Number ${cleanNumber} is not authorized for media processing`);
      }

      return isAuthorized;
    } catch (error) {
      console.error('❌ Error checking media authorization:', error);
      return false;
    }
  }

  registerUser(phoneNumber, userData) {
    const cleanNumber = this.cleanPhoneNumber(phoneNumber);
    this.registeredUsers.set(cleanNumber, {
      ...userData,
      registrationDate: new Date().toISOString()
    });
    return this.saveRegisteredUsers();
  }

  getUser(phoneNumber) {
    const cleanNumber = this.cleanPhoneNumber(phoneNumber);
    return this.registeredUsers.get(cleanNumber) || null;
  }

  isRegistered(phoneNumber) {
    const cleanNumber = this.cleanPhoneNumber(phoneNumber);
    return this.registeredUsers.has(cleanNumber);
  }

  addToWhitelist(phoneNumber) {
    try {
      const cleanNumber = this.cleanPhoneNumber(phoneNumber);
      this.whitelistedNumbers.add(cleanNumber);
      this.mediaAuthorizedNumbers.add(cleanNumber); // Also add to media authorized
      console.log(`📱 Added ${cleanNumber} to whitelist (seamlessly integrated)`);
      return this.saveAuthorizedNumbers();
    } catch (error) {
      console.error('❌ Error adding to whitelist:', error);
      return false;
    }
  }

  removeFromWhitelist(phoneNumber) {
    try {
      const cleanNumber = this.cleanPhoneNumber(phoneNumber);
      this.whitelistedNumbers.delete(cleanNumber);
      this.mediaAuthorizedNumbers.delete(cleanNumber); // Also remove from media authorized
      console.log(`📱 Removed ${cleanNumber} from whitelist (seamlessly integrated)`);
      return this.saveAuthorizedNumbers();
    } catch (error) {
      console.error('❌ Error removing from whitelist:', error);
      return false;
    }
  }

  getWhitelistedNumbers() {
    return Array.from(this.whitelistedNumbers);
  }

  getMediaAuthorizedNumbers() {
    return Array.from(this.mediaAuthorizedNumbers);
  }

  bulkUpdateWhitelist(numbers) {
    try {
      if (!Array.isArray(numbers)) {
        console.error('❌ Invalid numbers array provided');
        return false;
      }

      // Clear existing whitelist
      this.whitelistedNumbers.clear();

      // Add new numbers
      numbers.forEach(number => {
        const cleanNumber = this.cleanPhoneNumber(number);
        if (cleanNumber) {
          this.whitelistedNumbers.add(cleanNumber);
        }
      });

      console.log(`📱 Updated whitelist with ${this.whitelistedNumbers.size} numbers`);
      return this.saveAuthorizedNumbers();
    } catch (error) {
      console.error('❌ Error updating whitelist:', error);
      return false;
    }
  }

  cleanPhoneNumber(phoneNumber) {
    return phoneNumber.replace(/[\+\s\-@c.us]/g, '');
  }

  isReady() {
    return this.whitelistedNumbers.size > 0;
  }

  async waitUntilReady() {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts && !this.isReady()) {
      console.log(`⏳ Waiting for user manager to be ready... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (this.isReady()) {
      console.log(`✅ User manager ready with ${this.whitelistedNumbers.size} whitelisted numbers`);
      return true;
    } else {
      console.log('⚠️ User manager not ready after timeout');
      return false;
    }
  }
}

module.exports = new UserManager(); 