const SystemConfig = require('../models/SystemConfig');
const EventEmitter = require('events');

class ConfigManagementService extends EventEmitter {
  constructor() {
    super();
    this.configCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.lastCacheUpdate = 0;
    this.isInitialized = false;
  }

  // Initialize the service
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Ensure database connection is established
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        const { connectDB } = require('../models');
        await connectDB();
      }

      // Load all configurations into cache
      await this.refreshCache();
      this.isInitialized = true;
      console.log('✅ Config Management Service initialized');
    } catch (error) {
      console.error('❌ Error initializing Config Management Service:', error);
    }
  }

  // Refresh cache from database
  async refreshCache() {
    try {
      // Ensure database connection is established
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        const { connectDB } = require('../models');
        await connectDB();
      }

      const configs = await SystemConfig.find({});
      this.configCache.clear();

      configs.forEach(config => {
        this.configCache.set(config.key, {
          value: config.value,
          description: config.description,
          timestamp: Date.now()
        });
      });

      this.lastCacheUpdate = Date.now();
      console.log(`✅ Cache refreshed with ${configs.length} configurations`);
    } catch (error) {
      console.error('❌ Error refreshing cache:', error);
    }
  }

  // Get configuration with caching
  async getConfig(key, defaultValue = null) {
    try {
      // Ensure database connection is established
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        const { connectDB } = require('../models');
        await connectDB();
      }

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
          description: config.description,
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

  // Get all configurations
  async getAllConfigs() {
    try {
      // Ensure database connection is established
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        const { connectDB } = require('../models');
        await connectDB();
      }

      const configs = await SystemConfig.find({}).sort({ key: 1 });
      return configs.map(config => ({
        key: config.key,
        value: config.value,
        description: config.description,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      }));
    } catch (error) {
      console.error('❌ Error loading all configs:', error);
      return [];
    }
  }

  // Create or update configuration
  async setConfig(key, value, description = null) {
    try {
      // Ensure database connection is established
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        const { connectDB } = require('../models');
        await connectDB();
      }

      const updateData = { value };
      if (description) {
        updateData.description = description;
      }

      const config = await SystemConfig.findOneAndUpdate(
        { key },
        updateData,
        { upsert: true, new: true }
      );

      // Update cache
      this.configCache.set(key, {
        value: config.value,
        description: config.description,
        timestamp: Date.now()
      });

      // Emit change event
      this.emit('configChanged', { key, value: config.value, action: 'updated' });

      console.log(`✅ Config updated: ${key}`);
      return config;
    } catch (error) {
      console.error(`❌ Error updating config ${key}:`, error);
      throw error;
    }
  }

  // Delete configuration
  async deleteConfig(key) {
    try {
      const config = await SystemConfig.findOneAndDelete({ key });

      if (config) {
        // Remove from cache
        this.configCache.delete(key);

        // Emit change event
        this.emit('configChanged', { key, action: 'deleted' });

        console.log(`✅ Config deleted: ${key}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Error deleting config ${key}:`, error);
      throw error;
    }
  }

  // Get configuration by category
  async getConfigsByCategory(category) {
    try {
      const configs = await SystemConfig.find({
        key: new RegExp(`^${category}_`, 'i')
      }).sort({ key: 1 });

      return configs.map(config => ({
        key: config.key,
        value: config.value,
        description: config.description
      }));
    } catch (error) {
      console.error(`❌ Error loading configs for category ${category}:`, error);
      return [];
    }
  }

  // Update multiple configurations at once
  async updateMultipleConfigs(configs) {
    const results = [];

    for (const config of configs) {
      try {
        const result = await this.setConfig(config.key, config.value, config.description);
        results.push({ key: config.key, success: true, result });
      } catch (error) {
        results.push({ key: config.key, success: false, error: error.message });
      }
    }

    return results;
  }

  // Validate configuration value
  validateConfigValue(key, value) {
    const validators = {
      'vehicle_rates': (value) => {
        if (!value || typeof value !== 'object') return false;
        const requiredVehicles = ['Sedan', 'SUV', 'Luxury', 'Van'];
        return requiredVehicles.every(vehicle => value[vehicle] && typeof value[vehicle] === 'object');
      },
      'whitelisted_numbers': (value) => {
        return Array.isArray(value) && value.every(num => typeof num === 'string' && num.length > 0);
      },
      'ai_prompts': (value) => {
        return value && typeof value === 'object';
      },
      'paypal_config': (value) => {
        return value && typeof value === 'object' && value.clientId && value.clientSecret;
      }
    };

    const validator = validators[key];
    return validator ? validator(value) : true;
  }

  // Get configuration metadata
  async getConfigMetadata() {
    try {
      const configs = await SystemConfig.find({});
      return {
        totalConfigs: configs.length,
        categories: [...new Set(configs.map(c => c.key.split('_')[0]))],
        lastUpdated: configs.reduce((latest, config) =>
          config.updatedAt > latest ? config.updatedAt : latest, new Date(0)
        ),
        cacheStatus: {
          cachedItems: this.configCache.size,
          lastCacheUpdate: this.lastCacheUpdate,
          cacheExpiry: this.cacheExpiry
        }
      };
    } catch (error) {
      console.error('❌ Error getting config metadata:', error);
      return null;
    }
  }

  // Export configurations
  async exportConfigs(format = 'json') {
    try {
      const configs = await this.getAllConfigs();

      switch (format.toLowerCase()) {
        case 'json':
          return JSON.stringify(configs, null, 2);
        case 'env':
          return this.convertToEnvFormat(configs);
        default:
          return configs;
      }
    } catch (error) {
      console.error('❌ Error exporting configs:', error);
      throw error;
    }
  }

  // Convert configs to .env format
  convertToEnvFormat(configs) {
    let envContent = '# Configuration exported from database\n\n';

    configs.forEach(config => {
      if (typeof config.value === 'string') {
        envContent += `${config.key.toUpperCase()}=${config.value}\n`;
      } else {
        envContent += `${config.key.toUpperCase()}=${JSON.stringify(config.value)}\n`;
      }
    });

    return envContent;
  }

  // Import configurations
  async importConfigs(configs, overwrite = false) {
    const results = [];

    for (const config of configs) {
      try {
        if (overwrite || !(await SystemConfig.findOne({ key: config.key }))) {
          await this.setConfig(config.key, config.value, config.description);
          results.push({ key: config.key, success: true, action: 'imported' });
        } else {
          results.push({ key: config.key, success: false, action: 'skipped', reason: 'already exists' });
        }
      } catch (error) {
        results.push({ key: config.key, success: false, action: 'failed', error: error.message });
      }
    }

    return results;
  }

  // Clear cache
  clearCache() {
    this.configCache.clear();
    this.lastCacheUpdate = 0;
    console.log('✅ Config cache cleared');
  }

  // Get cache status
  getCacheStatus() {
    return {
      size: this.configCache.size,
      lastUpdate: this.lastCacheUpdate,
      expiry: this.cacheExpiry,
      isExpired: Date.now() - this.lastCacheUpdate > this.cacheExpiry
    };
  }
}

module.exports = new ConfigManagementService(); 