const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  // Concierge who earned the commission
  conciergeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge',
    required: true,
    index: true
  },

  // Booking that generated the commission
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
    index: true
  },

  // Financial details
  baseAmount: {
    type: Number,
    required: true,
    min: 0
  },
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  commissionAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Upline commission (if applicable)
  uplineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge',
    default: null
  },
  uplineCommissionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 20
  },
  uplineCommission: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCommission: {
    type: Number,
    required: true,
    min: 0
  },

  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'paid', 'cancelled'],
    default: 'pending',
    index: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
    index: true
  },

  // Payout reference
  payoutId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payout',
    default: null
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
  },
  paidAt: {
    type: Date,
    default: null
  }
});

// Update timestamp on save
commissionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for performance
commissionSchema.index({ conciergeId: 1, status: 1 });
commissionSchema.index({ bookingId: 1 });
commissionSchema.index({ createdAt: -1 });
commissionSchema.index({ status: 1, paymentStatus: 1 });

module.exports = mongoose.model('Commission', commissionSchema); 