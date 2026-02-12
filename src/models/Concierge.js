const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const conciergeSchema = new mongoose.Schema({
  // Primary identifier
  conciergeId: {
    type: String,
    default: () => `CON-${uuidv4().slice(0, 8).toUpperCase()}`,
    required: true
  },

  // Personal information
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },

  // PayPal information for payouts
  paypalEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  paypalAccountVerified: {
    type: Boolean,
    default: false
  },

  // Financial information
  totalEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  availableBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalWithdrawn: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingPayouts: {
    type: Number,
    default: 0,
    min: 0
  },

  // Commission settings
  commissionRate: {
    type: Number,
    default: 10, // percentage
    min: 0,
    max: 100
  },
  bonusEarnings: {
    type: Number,
    default: 0,
    min: 0
  },

  // 2-Tier referral system
  uplineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge',
    default: null
  },
  uplineCommissionRate: {
    type: Number,
    default: 2, // percentage for upline
    min: 0,
    max: 20
  },
  tier: {
    type: Number,
    enum: [1, 2],
    default: 1 // Tier 1 = direct referral, Tier 2 = referred by another concierge
  },
  directReferrals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge'
  }],
  uplineEarnings: {
    type: Number,
    default: 0,
    min: 0
  },

  // Performance metrics
  totalBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  successfulBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  cancelledBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  conversionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Status and verification
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending_verification'],
    default: 'pending_verification'
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verificationDocuments: [{
    documentType: {
      type: String,
      enum: ['id_card', 'driver_license', 'business_license', 'bank_statement']
    },
    documentUrl: String,
    uploadedAt: { type: Date, default: Date.now },
    verifiedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    }
  }],

  // Contact and location
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  preferredLanguage: {
    type: String,
    default: 'en'
  },

  // Payout preferences
  payoutFrequency: {
    type: String,
    enum: ['weekly', 'bi-weekly', 'monthly', 'on-demand'],
    default: 'weekly'
  },
  minimumPayoutAmount: {
    type: Number,
    default: 50,
    min: 10
  },
  autoPayoutEnabled: {
    type: Boolean,
    default: true
  },

  // Referral tracking
  referralCode: {
    type: String,
    unique: true,
    default: () => `REF-${uuidv4().slice(0, 6).toUpperCase()}`
  },
  whatsappQRCode: {
    type: String,
    default: null
  },
  customReferralLink: {
    type: String,
    default: null
  },

  // Activity tracking
  lastLoginAt: {
    type: Date,
    default: null
  },
  lastActivityAt: {
    type: Date,
    default: Date.now
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },

  // Notifications preferences
  notifications: {
    email: {
      bookingAlerts: { type: Boolean, default: true },
      payoutAlerts: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false }
    },
    whatsapp: {
      bookingAlerts: { type: Boolean, default: true },
      payoutAlerts: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false }
    }
  },

  // System fields
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: 'admin'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
conciergeSchema.index({ conciergeId: 1 }, { unique: true });
conciergeSchema.index({ email: 1 }, { unique: true });
conciergeSchema.index({ phone: 1 }, { unique: true });
conciergeSchema.index({ status: 1 });
conciergeSchema.index({ verificationStatus: 1 });
conciergeSchema.index({ createdAt: -1 });

// Virtual for success rate
conciergeSchema.virtual('successRate').get(function () {
  if (this.totalBookings === 0) return 0;
  return Math.round((this.successfulBookings / this.totalBookings) * 100);
});

// Virtual for average earnings per booking
conciergeSchema.virtual('avgEarningsPerBooking').get(function () {
  if (this.successfulBookings === 0) return 0;
  return Math.round((this.totalEarned / this.successfulBookings) * 100) / 100;
});

// Pre-save middleware
conciergeSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  this.lastActivityAt = new Date();

  // Calculate conversion rate
  if (this.totalBookings > 0) {
    this.conversionRate = Math.round((this.successfulBookings / this.totalBookings) * 100);
  }

  next();
});

// Instance methods
conciergeSchema.methods.addEarnings = function (amount, bookingId) {
  this.totalEarned += amount;
  this.availableBalance += amount;
  this.lastActivityAt = new Date();

  return this.save();
};

conciergeSchema.methods.addUplineEarnings = function (amount) {
  this.uplineEarnings += amount;
  this.totalEarned += amount;
  this.availableBalance += amount;
  this.lastActivityAt = new Date();

  return this.save();
};

conciergeSchema.methods.addDirectReferral = function (referralId) {
  if (!this.directReferrals.includes(referralId)) {
    this.directReferrals.push(referralId);
  }
  return this.save();
};

conciergeSchema.methods.setUpline = function (uplineId, uplineCommissionRate = 2) {
  this.uplineId = uplineId;
  this.uplineCommissionRate = uplineCommissionRate;
  this.tier = 2;
  return this.save();
};

conciergeSchema.methods.processBooking = function (successful = true) {
  this.totalBookings += 1;
  if (successful) {
    this.successfulBookings += 1;
  } else {
    this.cancelledBookings += 1;
  }
  this.lastActivityAt = new Date();

  return this.save();
};

conciergeSchema.methods.canRequestPayout = function () {
  return this.availableBalance >= this.minimumPayoutAmount &&
    this.status === 'active' &&
    this.verificationStatus === 'verified' &&
    this.paypalAccountVerified;
};

conciergeSchema.methods.requestPayout = function (amount) {
  if (!this.canRequestPayout()) {
    throw new Error('Payout requirements not met');
  }

  if (amount > this.availableBalance) {
    throw new Error('Insufficient balance');
  }

  this.availableBalance -= amount;
  this.pendingPayouts += amount;

  return this.save();
};

conciergeSchema.methods.completePayout = function (amount, payoutId) {
  this.pendingPayouts -= amount;
  this.totalWithdrawn += amount;
  this.lastActivityAt = new Date();

  return this.save();
};

conciergeSchema.methods.generateReferralLink = function (baseUrl) {
  if (!this.customReferralLink) {
    this.customReferralLink = `${baseUrl}/ref/${this.referralCode}`;
  }
  return this.customReferralLink;
};

// Static methods
conciergeSchema.statics.findByConciergeId = function (conciergeId) {
  return this.findOne({ conciergeId });
};

conciergeSchema.statics.findByReferralCode = function (referralCode) {
  return this.findOne({ referralCode });
};

conciergeSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone });
};

conciergeSchema.statics.getTopPerformers = function (limit = 10) {
  return this.find({ status: 'active' })
    .sort({ totalEarned: -1, successRate: -1 })
    .limit(limit);
};

conciergeSchema.statics.getPendingPayouts = function () {
  return this.find({
    pendingPayouts: { $gt: 0 },
    status: 'active',
    verificationStatus: 'verified'
  });
};

conciergeSchema.statics.getEligibleForPayout = function () {
  return this.find({
    $expr: { $gte: ['$availableBalance', '$minimumPayoutAmount'] },
    status: 'active',
    verificationStatus: 'verified',
    paypalAccountVerified: true,
    autoPayoutEnabled: true
  });
};

module.exports = mongoose.model('Concierge', conciergeSchema); 