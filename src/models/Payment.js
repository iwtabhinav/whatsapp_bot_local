const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Primary identifier
  paymentId: {
    type: String,
    default: () => `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    required: true
  },

  // Related entities
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  // Human-readable booking code to simplify lookups without joining
  bookingCode: {
    type: String,
    index: true,
    default: null
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },

  // Payment details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  paymentMethod: {
    type: String,
    enum: ['paypal', 'stripe', 'cash', 'bank_transfer'],
    default: 'paypal'
  },

  // PayPal specific fields
  paypalOrderId: {
    type: String,
    default: null
  },
  paypalTransactionId: {
    type: String,
    default: null
  },
  paypalPayerEmail: {
    type: String,
    default: null
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },

  // Dates
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  },
  failedAt: {
    type: Date,
    default: null
  },

  // Error handling
  errorCode: {
    type: String,
    default: null
  },
  errorMessage: {
    type: String,
    default: null
  },

  // Additional details
  description: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },

  // System fields
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ paymentId: 1 }, {});
paymentSchema.index({ bookingId: 1 });
// bookingCode has index:true on field; avoid duplicating schema.index to silence warnings
paymentSchema.index({ customerId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ paypalOrderId: 1 });
paymentSchema.index({ createdAt: -1 });

// Instance methods
paymentSchema.methods.markAsCompleted = function (transactionId, payerEmail) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.paypalTransactionId = transactionId;
  this.paypalPayerEmail = payerEmail;
  return this.save();
};

paymentSchema.methods.markAsFailed = function (errorCode, errorMessage) {
  this.status = 'failed';
  this.failedAt = new Date();
  this.errorCode = errorCode;
  this.errorMessage = errorMessage;
  return this.save();
};

// Static methods
paymentSchema.statics.findByPaymentId = function (paymentId) {
  return this.findOne({ paymentId });
};

paymentSchema.statics.findByBooking = function (bookingId) {
  return this.find({ bookingId }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Payment', paymentSchema); 