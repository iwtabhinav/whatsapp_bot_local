const SystemConfig = require('../models/SystemConfig');

class ConfigService {
  constructor() {
    this.configCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.lastCacheUpdate = 0;
  }

  // Get configuration from database with caching
  async getConfig(key, defaultValue = null) {
    try {
      // Check cache first
      if (this.configCache.has(key)) {
        const cached = this.configCache.get(key);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.value;
        }
      }

      // Load from database
      const config = await SystemConfig.findOne({ key });

      if (config) {
        // Update cache
        this.configCache.set(key, {
          value: config.value,
          timestamp: Date.now()
        });
        return config.value;
      }

      return defaultValue;
    } catch (error) {
      console.error(`❌ Error loading config ${key}:`, error);
      return defaultValue;
    }
  }

  // Get vehicle rates from database
  async getVehicleRates() {
    const rates = await this.getConfig('VEHICLE_RATES', {
      'Sedan': { base: 120, perKm: 3 },
      'SUV': { base: 180, perKm: 4 },
      'Luxury': { base: 350, perKm: 8 },
      'Van': { base: 220, perKm: 5 }
    });
    return rates;
  }

  // Get AI prompts from database
  async getAIPrompts() {
    const prompts = await this.getConfig('AI_PROMPTS', {
      bookingExtraction: {
        system: 'Extract booking information from user message',
        user: 'Extract booking information from: {message}',
        temperature: 0.1,
        model: 'gpt-3.5-turbo'
      }
    });
    return prompts;
  }

  // Get whitelisted numbers from database
  async getWhitelistedNumbers() {
    const numbers = await this.getConfig('DEFAULT_WHITELISTED_NUMBERS', [
      '971543033535',
      '918871678917',
      '919928366889',
      '919694035681',
      '971561880302',
      '971563905407',
      '971509935854',
      '971501476598',
      '971509940544'
    ]);
    return numbers;
  }

  // Get booking prompts from database
  async getBookingPrompts() {
    const prompts = await this.getConfig('BOOKING_PROMPTS', {
      en: {
        welcome: "Welcome to Preimo Chauffeur Services!",
        vehicle_options: "Available vehicles:\n- Sedan: AED 120 base + AED 3/km\n- SUV: AED 180 base + AED 4/km\n- Luxury: AED 350 base + AED 8/km\n- Van: AED 220 base + AED 5/km"
      }
    });
    return prompts;
  }

  // Get puppeteer options from database
  async getPuppeteerOptions() {
    const options = await this.getConfig('PUPPETEER_OPTIONS', {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ],
      timeout: 60000,
      protocolTimeout: 60000,
      ignoreHTTPSErrors: true
    });
    return options;
  }

  // Get language patterns from database
  async getLanguagePatterns() {
    const patterns = await this.getConfig('LANGUAGE_PATTERNS', {
      hindi: /[\u0900-\u097F]/,
      arabic: /[\u0600-\u06FF]/,
      chinese: /[\u4E00-\u9FFF]/,
      russian: /[\u0400-\u04FF]/,
      urdu: /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/
    });
    return patterns;
  }

  // Get system settings from database
  async getSystemSettings() {
    const settings = await this.getConfig('SYSTEM_SETTINGS', {
      currency: 'AED',
      timezone: 'Asia/Dubai',
      language: 'en',
      autoConfirmBookings: false,
      sendEmailNotifications: true
    });
    return settings;
  }

  // Get payment settings from database
  async getPaymentSettings() {
    const settings = await this.getConfig('PAYMENT_SETTINGS', {
      defaultGateway: 'paypal',
      paypalEnabled: true,
      stripeEnabled: false,
      cashEnabled: true,
      currency: 'AED'
    });
    return settings;
  }

  // Get WhatsApp settings from database
  async getWhatsAppSettings() {
    const settings = await this.getConfig('WHATSAPP_SETTINGS', {
      maxInstances: 5,
      sessionTimeout: 3600,
      qrTimeout: 300,
      autoReconnect: true
    });
    return settings;
  }

  // Get booking settings from database
  async getBookingSettings() {
    const settings = await this.getConfig('BOOKING_SETTINGS', {
      maxAdvanceBooking: 30,
      minAdvanceBooking: 1,
      maxBookingDuration: 24,
      allowModifications: true,
      confirmationRequired: true
    });
    return settings;
  }

  // Get pricing configuration from database
  async getPricingConfig() {
    const pricing = await this.getConfig('PRICING_CONFIG', {
      rates: {
        economy: { enabled: true, baseRate: 130, kmRate: 3.5, minFare: 50, waitRate: 2 },
        luxury: { enabled: true, baseRate: 200, kmRate: 5.5, minFare: 100, waitRate: 3 },
        suv: { enabled: true, baseRate: 180, kmRate: 4.5, minFare: 80, waitRate: 2.5 },
        van: { enabled: true, baseRate: 250, kmRate: 6, minFare: 120, waitRate: 3.5 }
      },
      currency: 'AED'
    });
    return pricing;
  }

  // Get media auth configuration from database
  async getMediaAuthConfig() {
    const config = await this.getConfig('MEDIA_AUTH_CONFIG', {
      mediaAuthorizedNumbers: [],
      whitelistedNumbers: []
    });
    return config;
  }

  // Update configuration in database
  async updateConfig(key, value, description = null) {
    try {
      const updateData = { value };
      if (description) {
        updateData.description = description;
      }

      await SystemConfig.findOneAndUpdate(
        { key },
        updateData,
        { upsert: true, new: true }
      );

      // Clear cache for this key
      this.configCache.delete(key);

      console.log(`✅ Updated config: ${key}`);
      return true;
    } catch (error) {
      console.error(`❌ Error updating config ${key}:`, error);
      return false;
    }
  }

  // Clear cache
  clearCache() {
    this.configCache.clear();
    this.lastCacheUpdate = 0;
  }

  // Get all configurations
  async getAllConfigs() {
    try {
      const configs = await SystemConfig.find({});
      return configs.reduce((acc, config) => {
        acc[config.key] = config.value;
        return acc;
      }, {});
    } catch (error) {
      console.error('❌ Error loading all configs:', error);
      return {};
    }
  }

  // Get configurations by category
  async getConfigsByCategory(category) {
    try {
      const configs = await SystemConfig.find({ category });
      return configs;
    } catch (error) {
      console.error(`❌ Error loading configs for category ${category}:`, error);
      return [];
    }
  }

  // Initialize default configurations if they don't exist
  async initializeDefaultConfigs() {
    const defaultConfigs = [
      {
        key: 'VEHICLE_RATES',
        value: {
          'Sedan': { base: 120, perKm: 3 },
          'SUV': { base: 180, perKm: 4 },
          'Luxury': { base: 350, perKm: 8 },
          'Van': { base: 220, perKm: 5 }
        },
        description: 'Vehicle pricing configuration'
      },
      {
        key: 'DEFAULT_WHITELISTED_NUMBERS',
        value: [
          '971543033535',
          '918871678917',
          '919928366889',
          '919694035681',
          '971561880302',
          '971563905407',
          '971509935854',
          '971501476598'
        ],
        description: 'Whitelisted phone numbers'
      }
    ];

    for (const config of defaultConfigs) {
      await this.updateConfig(config.key, config.value, config.description);
    }
  }
}

module.exports = new ConfigService(); 