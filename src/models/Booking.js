const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const bookingSchema = new mongoose.Schema({
  // Primary identifier
  bookingId: {
    type: String,
    default: () => `BK-${uuidv4().slice(0, 8).toUpperCase()}`,
    required: true
  },

  // Customer information
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerPhone: {
    type: String,
    required: true,
    trim: true
  },

  // Trip details
  pickupLocation: {
    type: String,
    required: true,
    trim: true
  },
  pickupCoordinates: {
    latitude: Number,
    longitude: Number
  },
  dropLocation: {
    type: String,
    required: true,
    trim: true
  },
  dropCoordinates: {
    latitude: Number,
    longitude: Number
  },
  pickupTime: {
    type: Date,
    required: true
  },
  estimatedDuration: {
    type: Number, // in minutes
    default: 0
  },
  estimatedDistance: {
    type: Number, // in kilometers
    default: 0
  },

  // Vehicle and pricing
  vehicleType: {
    type: String,
    enum: ['sedan', 'suv', 'van', 'luxury'],
    required: true
  },
  numberOfPassengers: {
    type: Number,
    min: 1,
    max: 8,
    default: 1
  },

  // Pricing breakdown
  baseFare: {
    type: Number,
    required: true,
    min: 0
  },
  distanceFare: {
    type: Number,
    default: 0,
    min: 0
  },
  timeFare: {
    type: Number,
    default: 0,
    min: 0
  },
  surcharges: {
    nightSurcharge: { type: Number, default: 0 },
    weekendSurcharge: { type: Number, default: 0 },
    airportSurcharge: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  taxes: {
    type: Number,
    default: 0,
    min: 0
  },
  bookingAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Referral and commission
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Concierge',
    default: null
  },
  referrerCommissionRate: {
    type: Number,
    default: 10, // percentage
    min: 0,
    max: 100
  },
  referrerCommissionAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Payment information
  isPaid: {
    type: Boolean,
    default: false
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'processing', 'paid', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['paypal', 'cash', 'card', 'bank_transfer'],
    default: 'paypal'
  },
  paypalTxnId: {
    type: String,
    default: null
  },
  paymentDate: {
    type: Date,
    default: null
  },
  paymentAmount: {
    type: Number,
    default: 0
  },

  // Booking status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled', 'no_show'],
    default: 'pending'
  },

  // Driver assignment
  driverId: {
    type: String,
    default: null
  },
  driverName: {
    type: String,
    default: null
  },
  driverPhone: {
    type: String,
    default: null
  },
  vehicleNumber: {
    type: String,
    default: null
  },

  // Trip tracking
  actualPickupTime: {
    type: Date,
    default: null
  },
  actualDropTime: {
    type: Date,
    default: null
  },
  actualDistance: {
    type: Number,
    default: 0
  },
  actualDuration: {
    type: Number, // in minutes
    default: 0
  },

  // Additional information
  specialRequests: {
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
  },
  createdBy: {
    type: String,
    default: 'whatsapp_bot'
  },

  // WhatsApp conversation context
  conversationId: {
    type: String,
    default: null
  },
  messageHistory: [{
    timestamp: Date,
    sender: String,
    message: String,
    messageType: {
      type: String,
      enum: ['text', 'audio', 'image', 'location']
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
bookingSchema.index({ bookingId: 1 }, { unique: true });
bookingSchema.index({ customerId: 1 });
bookingSchema.index({ referrerId: 1 });
bookingSchema.index({ customerPhone: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ paymentStatus: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ pickupTime: 1 });

// Virtual for total commission
bookingSchema.virtual('totalCommission').get(function () {
  return this.referrerCommissionAmount;
});

// Pre-save middleware to update timestamps
bookingSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Methods
bookingSchema.methods.calculateCommission = function () {
  if (this.referrerId && this.isPaid) {
    this.referrerCommissionAmount = (this.bookingAmount * this.referrerCommissionRate) / 100;
  }
  return this.referrerCommissionAmount;
};

bookingSchema.methods.markAsPaid = function (paypalTxnId, paymentAmount) {
  this.isPaid = true;
  this.paymentStatus = 'paid';
  this.paypalTxnId = paypalTxnId;
  this.paymentDate = new Date();
  this.paymentAmount = paymentAmount || this.bookingAmount;
  this.calculateCommission();
};

bookingSchema.methods.updateStatus = function (newStatus, notes = '') {
  this.status = newStatus;
  if (notes) {
    this.notes += `\n[${new Date().toISOString()}] Status changed to ${newStatus}: ${notes}`;
  }
};

// Static methods
bookingSchema.statics.findByBookingId = function (bookingId) {
  return this.findOne({ bookingId });
};

bookingSchema.statics.findByCustomerPhone = function (phone) {
  return this.find({ customerPhone: phone }).sort({ createdAt: -1 });
};

bookingSchema.statics.findByReferrer = function (referrerId) {
  return this.find({ referrerId }).sort({ createdAt: -1 });
};

bookingSchema.statics.getRevenueStats = function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        isPaid: true,
        paymentDate: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$bookingAmount' },
        totalBookings: { $sum: 1 },
        totalCommissions: { $sum: '$referrerCommissionAmount' },
        avgBookingValue: { $avg: '$bookingAmount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Booking', bookingSchema); 