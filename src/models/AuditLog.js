const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Primary identifier
  logId: {
    type: String,
    default: () => `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    required: true
  },

  // Action details
  action: {
    type: String,
    required: true,
    enum: [
      'create', 'read', 'update', 'delete',
      'login', 'logout', 'password_change',
      'payment_initiated', 'payment_completed', 'payment_failed',
      'payout_initiated', 'payout_completed', 'payout_failed',
      'booking_created', 'booking_updated', 'booking_cancelled',
      'commission_earned', 'commission_paid',
      'config_changed', 'system_error'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: ['booking', 'customer', 'concierge', 'payment', 'payout', 'commission', 'admin', 'config', 'system']
  },
  entityId: {
    type: String,
    default: null
  },

  // User context
  userId: {
    type: String,
    default: null
  },
  userType: {
    type: String,
    enum: ['admin', 'customer', 'concierge', 'system'],
    default: 'system'
  },
  userAgent: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  },

  // Change details
  oldValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  newValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  description: {
    type: String,
    default: ''
  },

  // Context
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  // System fields
  timestamp: {
    type: Date,
    default: Date.now
  },
  source: {
    type: String,
    default: 'api'
  }
}, {
  timestamps: false // Using custom timestamp field
});

// Indexes
auditLogSchema.index({ logId: 1 }, { });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ entityType: 1 });
auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ severity: 1 });

// Static methods
auditLogSchema.statics.log = function (logData) {
  return this.create({
    action: logData.action,
    entityType: logData.entityType,
    entityId: logData.entityId,
    userId: logData.userId,
    userType: logData.userType,
    oldValues: logData.oldValues,
    newValues: logData.newValues,
    description: logData.description,
    metadata: logData.metadata,
    severity: logData.severity || 'medium',
    userAgent: logData.userAgent,
    ipAddress: logData.ipAddress,
    source: logData.source || 'api'
  });
};

auditLogSchema.statics.findByEntity = function (entityType, entityId) {
  return this.find({ entityType, entityId }).sort({ timestamp: -1 });
};

auditLogSchema.statics.findByUser = function (userId) {
  return this.find({ userId }).sort({ timestamp: -1 });
};

auditLogSchema.statics.findByAction = function (action) {
  return this.find({ action }).sort({ timestamp: -1 });
};

auditLogSchema.statics.getRecentLogs = function (limit = 100) {
  return this.find().sort({ timestamp: -1 }).limit(limit);
};

module.exports = mongoose.model('AuditLog', auditLogSchema); 