const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  // Primary identifier
  adminId: {
    type: String,
    default: () => `ADM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    required: true
  },

  // Authentication
  username: {
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
  passwordHash: {
    type: String,
    required: true
  },

  // Profile
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },

  // Permissions
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'manager', 'support'],
    default: 'admin'
  },
  permissions: [{
    module: String,
    actions: [String]
  }],

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
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
adminSchema.index({ adminId: 1 }, { });
adminSchema.index({ username: 1 }, { });
adminSchema.index({ email: 1 }, { });

// Virtual for full name
adminSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Methods
adminSchema.methods.validatePassword = async function (password) {
  return await bcrypt.compare(password, this.passwordHash);
};

adminSchema.methods.updateLastLogin = function () {
  this.lastLoginAt = new Date();
  this.lastActivityAt = new Date();
  return this.save();
};

// Static methods
adminSchema.statics.findByUsername = function (username) {
  return this.findOne({ username });
};

adminSchema.statics.createAdmin = async function (adminData) {
  const { username, email, password, firstName, lastName, role } = adminData;

  const passwordHash = await bcrypt.hash(password, 12);

  return this.create({
    username,
    email,
    passwordHash,
    firstName,
    lastName,
    role
  });
};

module.exports = mongoose.model('Admin', adminSchema); 