const mongoose = require('mongoose');
const { config } = require('../config/database');

// Import all models
const Booking = require('./Booking');
const Concierge = require('./Concierge');
const Customer = require('./Customer');
const Payout = require('./Payout');
const Commission = require('./Commission');
const Payment = require('./Payment');
const Admin = require('./Admin');
const SystemConfig = require('./SystemConfig');
const AuditLog = require('./AuditLog');
const ChatLog = require('./ChatLog');
const PricingConfig = require('./PricingConfig');

// Database connection
const connectDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB already connected');
      return;
    }

    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(config.mongoURI, config.options);
    console.log('✅ MongoDB connected successfully');

    // Set up connection event handlers
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    console.log('🔄 Retrying connection in 5 seconds...');

    // Retry connection after 5 seconds
    setTimeout(async () => {
      try {
        await mongoose.connect(config.mongoURI, config.options);
        console.log('✅ MongoDB connected on retry');
      } catch (retryError) {
        console.error('❌ MongoDB retry failed:', retryError);
        console.log('⚠️ Continuing with fallback pricing...');
      }
    }, 5000);
  }
};

// Database disconnect
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected successfully');
  } catch (error) {
    console.error('❌ MongoDB disconnect error:', error);
  }
};

// Export models and connection functions
module.exports = {
  connectDB,
  disconnectDB,
  models: {
    Booking,
    Concierge,
    Customer,
    Payout,
    Commission,
    Payment,
    Admin,
    SystemConfig,
    AuditLog,
    ChatLog,
    PricingConfig
  }
}; 