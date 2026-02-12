const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const customerSchema = new mongoose.Schema({
  // Primary identifier
  customerId: {
    type: String,
    default: () => `CUST-${uuidv4().slice(0, 8).toUpperCase()}`,
    required: true
  },

  // Personal information
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true,
    default: null
  },

  // Customer preferences
  preferredVehicleType: {
    type: String,
    enum: ['sedan', 'suv', 'van'],
    default: null
  },
  preferredLanguage: {
    type: String,
    default: 'en'
  },

  // Location information
  frequentLocations: [{
    name: String,
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    usageCount: { type: Number, default: 1 }
  }],

  // Booking statistics
  totalBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  completedBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  cancelledBookings: {
    type: Number,
    default: 0,
    min: 0
  },
  totalSpent: {
    type: Number,
    default: 0,
    min: 0
  },

  // Customer tier and loyalty
  customerTier: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: 'bronze'
  },
  loyaltyPoints: {
    type: Number,
    default: 0,
    min: 0
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  isVIP: {
    type: Boolean,
    default: false
  },

  // WhatsApp information
  whatsappNumber: {
    type: String,
    default: null
  },
  lastWhatsappActivity: {
    type: Date,
    default: null
  },

  // Activity tracking
  firstBookingAt: {
    type: Date,
    default: null
  },
  lastBookingAt: {
    type: Date,
    default: null
  },
  lastActivityAt: {
    type: Date,
    default: Date.now
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
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
customerSchema.index({ customerId: 1 }, { });
customerSchema.index({ phone: 1 }, { });
customerSchema.index({ email: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ customerTier: 1 });
customerSchema.index({ createdAt: -1 });

// Virtual for completion rate
customerSchema.virtual('completionRate').get(function () {
  if (this.totalBookings === 0) return 0;
  return Math.round((this.completedBookings / this.totalBookings) * 100);
});

// Virtual for average booking value
customerSchema.virtual('avgBookingValue').get(function () {
  if (this.completedBookings === 0) return 0;
  return Math.round((this.totalSpent / this.completedBookings) * 100) / 100;
});

// Pre-save middleware
customerSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  this.lastActivityAt = new Date();

  // Update customer tier based on total spent
  if (this.totalSpent >= 5000) {
    this.customerTier = 'platinum';
    this.isVIP = true;
  } else if (this.totalSpent >= 2000) {
    this.customerTier = 'gold';
  } else if (this.totalSpent >= 500) {
    this.customerTier = 'silver';
  } else {
    this.customerTier = 'bronze';
  }

  next();
});

// Instance methods
customerSchema.methods.addBooking = function (bookingAmount, completed = true) {
  this.totalBookings += 1;

  if (completed) {
    this.completedBookings += 1;
    this.totalSpent += bookingAmount;
    this.loyaltyPoints += Math.floor(bookingAmount / 10); // 1 point per $10
    this.lastBookingAt = new Date();

    if (!this.firstBookingAt) {
      this.firstBookingAt = new Date();
    }
  } else {
    this.cancelledBookings += 1;
  }

  this.lastActivityAt = new Date();
  return this.save();
};

customerSchema.methods.addFrequentLocation = function (name, address, coordinates) {
  const existingLocation = this.frequentLocations.find(loc =>
    loc.address.toLowerCase() === address.toLowerCase()
  );

  if (existingLocation) {
    existingLocation.usageCount += 1;
  } else {
    this.frequentLocations.push({
      name,
      address,
      coordinates,
      usageCount: 1
    });
  }

  // Keep only top 10 frequent locations
  this.frequentLocations.sort((a, b) => b.usageCount - a.usageCount);
  this.frequentLocations = this.frequentLocations.slice(0, 10);

  return this.save();
};

customerSchema.methods.updateWhatsappActivity = function (phoneNumber) {
  this.whatsappNumber = phoneNumber;
  this.lastWhatsappActivity = new Date();
  this.lastActivityAt = new Date();

  return this.save();
};

// Static methods
customerSchema.statics.findByCustomerId = function (customerId) {
  return this.findOne({ customerId });
};

customerSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone });
};

customerSchema.statics.getVIPCustomers = function () {
  return this.find({ isVIP: true, status: 'active' })
    .sort({ totalSpent: -1 });
};

customerSchema.statics.getTopCustomers = function (limit = 10) {
  return this.find({ status: 'active' })
    .sort({ totalSpent: -1, completedBookings: -1 })
    .limit(limit);
};

customerSchema.statics.getCustomerStats = function () {
  return this.aggregate([
    {
      $match: { status: 'active' }
    },
    {
      $group: {
        _id: '$customerTier',
        count: { $sum: 1 },
        totalSpent: { $sum: '$totalSpent' },
        avgBookings: { $avg: '$totalBookings' },
        avgSpent: { $avg: '$totalSpent' }
      }
    }
  ]);
};

module.exports = mongoose.model('Customer', customerSchema); 