const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const configManagementService = require('../services/configManagementService');
const { body, validationResult } = require('express-validator');
const { connectDB } = require('../models');

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Validation middleware
const validateConfigInput = [
  body('key').isString().trim().isLength({ min: 1 }).withMessage('Config key is required'),
  body('value').notEmpty().withMessage('Config value is required'),
  body('description').optional().isString().trim()
];

// GET /api/config - Get all configurations
router.get('/', requireAuth, async (req, res) => {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    const configs = await configManagementService.getAllConfigs();
    res.json({
      success: true,
      data: configs,
      count: configs.length
    });
  } catch (error) {
    console.error('❌ Error getting configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configurations'
    });
  }
});

// GET /api/config/metadata - Get configuration metadata
router.get('/metadata', requireAuth, async (req, res) => {
  try {
    const metadata = await configManagementService.getConfigMetadata();
    res.json({
      success: true,
      data: metadata
    });
  } catch (error) {
    console.error('❌ Error getting config metadata:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration metadata'
    });
  }
});

// GET /api/config/:key - Get specific configuration
router.get('/:key', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const config = await configManagementService.getConfig(key);

    // getConfig returns the value directly, or null if not found
    if (config === null || config === undefined) {
      return res.status(404).json({
        success: false,
        error: `Configuration '${key}' not found`
      });
    }

    res.json({
      success: true,
      data: {
        key,
        value: config
      }
    });
  } catch (error) {
    console.error('❌ Error getting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration'
    });
  }
});

// GET /api/config/category/:category - Get configurations by category
router.get('/category/:category', requireAuth, async (req, res) => {
  try {
    const { category } = req.params;
    const configs = await configManagementService.getConfigsByCategory(category);

    res.json({
      success: true,
      data: configs,
      category,
      count: configs.length
    });
  } catch (error) {
    console.error('❌ Error getting configs by category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configurations by category'
    });
  }
});

// POST /api/config - Create new configuration
router.post('/', requireAuth, validateConfigInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { key, value, description, category } = req.body;

    // Validate configuration value
    if (!configManagementService.validateConfigValue(key, value)) {
      return res.status(400).json({
        success: false,
        error: `Invalid value for configuration '${key}'`
      });
    }

    const config = await configManagementService.setConfig(key, value, description, category);

    res.json({
      success: true,
      data: config,
      message: 'Configuration created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create configuration'
    });
  }
});

// PUT /api/config/:key - Update specific configuration
router.put('/:key', requireAuth, validateConfigInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { key } = req.params;
    const { value, description, category } = req.body;

    // Validate configuration value
    if (!configManagementService.validateConfigValue(key, value)) {
      return res.status(400).json({
        success: false,
        error: `Invalid value for configuration '${key}'`
      });
    }

    const config = await configManagementService.setConfig(key, value, description, category);

    res.json({
      success: true,
      data: config,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

// DELETE /api/config/:key - Delete specific configuration
router.delete('/:key', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;

    const result = await configManagementService.deleteConfig(key);

    if (result) {
      res.json({
        success: true,
        message: `Configuration '${key}' deleted successfully`
      });
    } else {
      res.status(404).json({
        success: false,
        error: `Configuration '${key}' not found`
      });
    }
  } catch (error) {
    console.error('❌ Error deleting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete configuration'
    });
  }
});

// PUT /api/config/:key - Update specific configuration
router.put('/:key', requireAuth, [
  body('value').notEmpty().withMessage('Config value is required'),
  body('description').optional().isString().trim()
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

    const { key } = req.params;
    const { value, description } = req.body;

    // Validate configuration value
    if (!configManagementService.validateConfigValue(key, value)) {
      return res.status(400).json({
        success: false,
        error: `Invalid value for configuration '${key}'`
      });
    }

    const config = await configManagementService.setConfig(key, value, description);

    res.json({
      success: true,
      data: config,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

// POST /api/config/bulk - Update multiple configurations
router.post('/bulk', requireAuth, [
  body('configs').isArray().withMessage('Configs must be an array'),
  body('configs.*.key').isString().trim().isLength({ min: 1 }),
  body('configs.*.value').notEmpty()
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

    const { configs } = req.body;

    // Validate all configurations
    for (const config of configs) {
      if (!configManagementService.validateConfigValue(config.key, config.value)) {
        return res.status(400).json({
          success: false,
          error: `Invalid value for configuration '${config.key}'`
        });
      }
    }

    const results = await configManagementService.updateMultipleConfigs(configs);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      data: results,
      summary: {
        total: configs.length,
        successful: successCount,
        failed: failureCount
      },
      message: `Updated ${successCount} configurations successfully`
    });
  } catch (error) {
    console.error('❌ Error updating multiple configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configurations'
    });
  }
});

// DELETE /api/config/:key - Delete configuration
router.delete('/:key', requireAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const deleted = await configManagementService.deleteConfig(key);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Configuration '${key}' not found`
      });
    }

    res.json({
      success: true,
      message: `Configuration '${key}' deleted successfully`
    });
  } catch (error) {
    console.error('❌ Error deleting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete configuration'
    });
  }
});

// POST /api/config/export - Export configurations
router.post('/export', requireAuth, [
  body('format').optional().isIn(['json', 'env']).withMessage('Format must be json or env')
], async (req, res) => {
  try {
    const { format = 'json' } = req.body;
    const exported = await configManagementService.exportConfigs(format);

    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="configs.${format}"`);
    res.send(exported);
  } catch (error) {
    console.error('❌ Error exporting configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export configurations'
    });
  }
});

// POST /api/config/import - Import configurations
router.post('/import', requireAuth, [
  body('configs').isArray().withMessage('Configs must be an array'),
  body('overwrite').optional().isBoolean().withMessage('Overwrite must be boolean')
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

    const { configs, overwrite = false } = req.body;
    const results = await configManagementService.importConfigs(configs, overwrite);

    const importedCount = results.filter(r => r.success && r.action === 'imported').length;
    const skippedCount = results.filter(r => r.action === 'skipped').length;
    const failedCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      data: results,
      summary: {
        total: configs.length,
        imported: importedCount,
        skipped: skippedCount,
        failed: failedCount
      },
      message: `Imported ${importedCount} configurations successfully`
    });
  } catch (error) {
    console.error('❌ Error importing configs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import configurations'
    });
  }
});

// POST /api/config/cache/clear - Clear configuration cache
router.post('/cache/clear', requireAuth, async (req, res) => {
  try {
    configManagementService.clearCache();
    res.json({
      success: true,
      message: 'Configuration cache cleared successfully'
    });
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear configuration cache'
    });
  }
});

// GET /api/config/cache/status - Get cache status
router.get('/cache/status', requireAuth, async (req, res) => {
  try {
    const status = configManagementService.getCacheStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('❌ Error getting cache status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get cache status'
    });
  }
});

// POST /api/config/refresh - Refresh configuration cache
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    await configManagementService.refreshCache();
    res.json({
      success: true,
      message: 'Configuration cache refreshed successfully'
    });
  } catch (error) {
    console.error('❌ Error refreshing cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh configuration cache'
    });
  }
});

module.exports = router; 