const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  // Concierge receiving the payout
  conciergeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge',
    required: true,
    index: true
  },

  // Financial details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },

  // Payment method
  paymentMethod: {
    type: String,
    enum: ['paypal', 'bank_transfer', 'crypto'],
    default: 'paypal'
  },

  // PayPal specific fields
  paypalEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  paypalPayoutId: {
    type: String,
    default: null
  },

  // Bank transfer fields
  bankAccount: {
    accountNumber: String,
    routingNumber: String,
    accountType: String
  },

  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },

  // Processing details
  processingStartedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  failedAt: {
    type: Date,
    default: null
  },

  // Error tracking
  errorMessage: {
    type: String,
    default: null
  },
  retryCount: {
    type: Number,
    default: 0,
    max: 3
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
payoutSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for performance
payoutSchema.index({ conciergeId: 1, status: 1 });
payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ paypalEmail: 1 });
payoutSchema.index({ paypalPayoutId: 1 });

module.exports = mongoose.model('Payout', payoutSchema); 