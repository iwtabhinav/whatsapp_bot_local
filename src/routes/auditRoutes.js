const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { models } = require('../models');

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Validation middleware
const validateAuditInput = [
  body('action').isString().trim().isLength({ min: 1 }).withMessage('Action is required'),
  body('entityType').isIn(['booking', 'customer', 'concierge', 'payment', 'payout', 'commission', 'admin', 'config', 'system']).withMessage('Invalid entity type'),
  body('entityId').optional().isString().withMessage('Entity ID must be a string'),
  body('userId').optional().isString().withMessage('User ID must be a string'),
  body('userType').optional().isIn(['admin', 'customer', 'concierge', 'system']).withMessage('Invalid user type'),
  body('description').optional().isString().withMessage('Description must be a string'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level')
];

// GET /api/audit-logs - Get all audit logs with pagination and filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      entityType,
      severity,
      dateFrom,
      dateTo,
      search,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    let query = {};

    // Apply action filter
    if (action && action !== 'all') {
      query.action = action;
    }

    // Apply entity type filter
    if (entityType && entityType !== 'all') {
      query.entityType = entityType;
    }

    // Apply severity filter
    if (severity && severity !== 'all') {
      query.severity = severity;
    }

    // Apply date filters
    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
      if (dateTo) query.timestamp.$lte = new Date(dateTo);
    }

    // Apply search filter
    if (search) {
      query.$or = [
        { logId: { $regex: search, $options: 'i' } },
        { entityId: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ipAddress: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const auditLogs = await models.AuditLog.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.AuditLog.countDocuments(query);

    // Calculate statistics
    const stats = await models.AuditLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalLogs: { $sum: 1 },
          criticalLogs: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
          highLogs: { $sum: { $cond: [{ $eq: ['$severity', 'high'] }, 1, 0] } },
          mediumLogs: { $sum: { $cond: [{ $eq: ['$severity', 'medium'] }, 1, 0] } },
          lowLogs: { $sum: { $cond: [{ $eq: ['$severity', 'low'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: auditLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: stats[0] || {
        totalLogs: 0,
        criticalLogs: 0,
        highLogs: 0,
        mediumLogs: 0,
        lowLogs: 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit logs'
    });
  }
});

// GET /api/audit-logs/:id - Get specific audit log
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const auditLog = await models.AuditLog.findById(req.params.id).lean();

    if (!auditLog) {
      return res.status(404).json({
        success: false,
        error: 'Audit log not found'
      });
    }

    res.json({
      success: true,
      data: auditLog
    });
  } catch (error) {
    console.error('❌ Error fetching audit log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit log'
    });
  }
});

// POST /api/audit-logs - Create new audit log
router.post('/', requireAuth, validateAuditInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      action,
      entityType,
      entityId,
      userId,
      userType = 'system',
      userAgent,
      ipAddress,
      oldValues,
      newValues,
      description = '',
      metadata = {},
      severity = 'medium',
      source = 'api'
    } = req.body;

    const auditLog = await models.AuditLog.create({
      action,
      entityType,
      entityId,
      userId,
      userType,
      userAgent,
      ipAddress,
      oldValues,
      newValues,
      description,
      metadata,
      severity,
      source,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      data: auditLog,
      message: 'Audit log created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating audit log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create audit log'
    });
  }
});

// PUT /api/audit-logs/:id - Update audit log (limited fields)
router.put('/:id', requireAuth, [
  body('description').optional().isString().withMessage('Description must be a string'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level'),
  body('metadata').optional().isObject().withMessage('Metadata must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const auditLog = await models.AuditLog.findById(req.params.id);
    if (!auditLog) {
      return res.status(404).json({
        success: false,
        error: 'Audit log not found'
      });
    }

    // Only allow updating certain fields
    const allowedUpdates = ['description', 'severity', 'metadata'];
    const updateData = {};

    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const updatedAuditLog = await models.AuditLog.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: updatedAuditLog,
      message: 'Audit log updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating audit log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update audit log'
    });
  }
});

// DELETE /api/audit-logs/:id - Delete audit log
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const auditLog = await models.AuditLog.findById(req.params.id);
    if (!auditLog) {
      return res.status(404).json({
        success: false,
        error: 'Audit log not found'
      });
    }

    await models.AuditLog.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Audit log deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting audit log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete audit log'
    });
  }
});

// GET /api/audit-logs/entity/:entityType/:entityId - Get audit logs for specific entity
router.get('/entity/:entityType/:entityId', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { page = 1, limit = 20, action, severity } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { entityType, entityId };

    // Apply additional filters
    if (action && action !== 'all') {
      query.action = action;
    }

    if (severity && severity !== 'all') {
      query.severity = severity;
    }

    const auditLogs = await models.AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.AuditLog.countDocuments(query);

    res.json({
      success: true,
      data: auditLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching entity audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch entity audit logs'
    });
  }
});

// GET /api/audit-logs/user/:userId - Get audit logs for specific user
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, action, entityType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { userId };

    // Apply additional filters
    if (action && action !== 'all') {
      query.action = action;
    }

    if (entityType && entityType !== 'all') {
      query.entityType = entityType;
    }

    const auditLogs = await models.AuditLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.AuditLog.countDocuments(query);

    res.json({
      success: true,
      data: auditLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user audit logs'
    });
  }
});

// GET /api/audit-logs/stats/overview - Get audit log statistics
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let matchStage = {};

    if (dateFrom || dateTo) {
      matchStage.timestamp = {};
      if (dateFrom) matchStage.timestamp.$gte = new Date(dateFrom);
      if (dateTo) matchStage.timestamp.$lte = new Date(dateTo);
    }

    const stats = await models.AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalLogs: { $sum: 1 },
          criticalLogs: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
          highLogs: { $sum: { $cond: [{ $eq: ['$severity', 'high'] }, 1, 0] } },
          mediumLogs: { $sum: { $cond: [{ $eq: ['$severity', 'medium'] }, 1, 0] } },
          lowLogs: { $sum: { $cond: [{ $eq: ['$severity', 'low'] }, 1, 0] } }
        }
      }
    ]);

    const actionStats = await models.AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          criticalCount: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const entityTypeStats = await models.AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$entityType',
          count: { $sum: 1 },
          criticalCount: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const dailyStats = await models.AuditLog.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          criticalCount: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 30 }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          totalLogs: 0,
          criticalLogs: 0,
          highLogs: 0,
          mediumLogs: 0,
          lowLogs: 0
        },
        actionStats,
        entityTypeStats,
        dailyStats
      }
    });
  } catch (error) {
    console.error('❌ Error fetching audit stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch audit statistics'
    });
  }
});

// POST /api/audit-logs/cleanup - Clean up old audit logs
router.post('/cleanup', requireAuth, [
  body('daysToKeep').isInt({ min: 1, max: 365 }).withMessage('Days to keep must be between 1 and 365'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { daysToKeep, severity } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let query = { timestamp: { $lt: cutoffDate } };

    if (severity) {
      query.severity = severity;
    }

    const result = await models.AuditLog.deleteMany(query);

    res.json({
      success: true,
      message: `Cleaned up ${result.deletedCount} audit logs`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('❌ Error cleaning up audit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clean up audit logs'
    });
  }
});

// Helper function to create audit log entry
const createAuditLog = async (data) => {
  try {
    return await models.AuditLog.create({
      ...data,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('❌ Error creating audit log:', error);
  }
};

module.exports = router; 