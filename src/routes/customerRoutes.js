const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { models, connectDB } = require('../models');

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Validation middleware
const validateCustomerInput = [
  body('name').isString().trim().isLength({ min: 1 }).withMessage('Customer name is required'),
  body('phone').isString().trim().isLength({ min: 10 }).withMessage('Valid phone number is required'),
  body('email').optional().isEmail().withMessage('Valid email address required'),
  body('preferredVehicleType').optional().isIn(['sedan', 'suv', 'van']).withMessage('Invalid vehicle type'),
  body('preferredLanguage').optional().isString().withMessage('Language must be a string'),
  body('status').optional().isIn(['active', 'inactive', 'blocked']).withMessage('Invalid status')
];

// GET /api/customers - Get all customers with pagination and filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    // Ensure database connection
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    const {
      page = 1,
      limit = 50,
      status,
      search,
      vehicleType,
      customerTier,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let query = {};

    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Apply vehicle type filter
    if (vehicleType && vehicleType !== 'all') {
      query.preferredVehicleType = vehicleType;
    }

    // Apply customer tier filter
    if (customerTier && customerTier !== 'all') {
      query.customerTier = customerTier;
    }

    // Apply search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { customerId: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const customers = await models.Customer.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.Customer.countDocuments(query);

    // Calculate statistics
    const stats = await models.Customer.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          totalSpent: { $sum: '$totalSpent' },
          totalBookings: { $sum: '$totalBookings' },
          avgBookingsPerCustomer: { $avg: '$totalBookings' }
        }
      }
    ]);

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: stats[0] || {
        totalCustomers: 0,
        totalSpent: 0,
        totalBookings: 0,
        avgBookingsPerCustomer: 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customers'
    });
  }
});

// GET /api/customers/:id - Get specific customer
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const customer = await models.Customer.findById(req.params.id)
      .populate('bookings', 'bookingId pickupLocation dropLocation status bookingAmount createdAt')
      .lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Get customer's booking history
    const bookings = await models.Booking.find({ customerId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Get customer's payment history
    const payments = await models.Payment.find({ customerId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: {
        ...customer,
        recentBookings: bookings,
        recentPayments: payments
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer'
    });
  }
});

// POST /api/customers - Create new customer
router.post('/', requireAuth, validateCustomerInput, async (req, res) => {
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
      name,
      phone,
      email,
      preferredVehicleType,
      preferredLanguage = 'en',
      isVIP = false
    } = req.body;

    // Check if customer already exists
    const existingCustomer = await models.Customer.findOne({
      $or: [{ phone }, { email: email || '' }]
    });

    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        error: 'Customer with this phone number or email already exists'
      });
    }

    const customer = await models.Customer.create({
      name,
      phone,
      email,
      preferredVehicleType,
      preferredLanguage,
      isVIP,
      status: 'active'
    });

    res.status(201).json({
      success: true,
      data: customer,
      message: 'Customer created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create customer'
    });
  }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', requireAuth, validateCustomerInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const customer = await models.Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check for duplicate phone/email if changed
    if (req.body.phone && req.body.phone !== customer.phone) {
      const existingCustomer = await models.Customer.findOne({ phone: req.body.phone });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          error: 'Phone number already exists'
        });
      }
    }

    if (req.body.email && req.body.email !== customer.email) {
      const existingCustomer = await models.Customer.findOne({ email: req.body.email });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          error: 'Email already exists'
        });
      }
    }

    const updatedCustomer = await models.Customer.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: updatedCustomer,
      message: 'Customer updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer'
    });
  }
});

// DELETE /api/customers/:id - Delete customer (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const customer = await models.Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if customer has active bookings
    const activeBookings = await models.Booking.countDocuments({
      customerId: req.params.id,
      status: { $in: ['pending', 'confirmed', 'in_progress'] }
    });

    if (activeBookings > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete customer with active bookings'
      });
    }

    // Soft delete - change status to blocked
    await models.Customer.findByIdAndUpdate(req.params.id, {
      status: 'blocked',
      updatedAt: Date.now()
    });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting customer:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete customer'
    });
  }
});

// GET /api/customers/:id/bookings - Get customer's booking history
router.get('/:id/bookings', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { customerId: req.params.id };
    if (status && status !== 'all') {
      query.status = status;
    }

    const bookings = await models.Booking.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.Booking.countDocuments(query);

    res.json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer bookings'
    });
  }
});

// GET /api/customers/:id/payments - Get customer's payment history
router.get('/:id/payments', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = { customerId: req.params.id };
    if (status && status !== 'all') {
      query.status = status;
    }

    const payments = await models.Payment.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.Payment.countDocuments(query);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer payments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer payments'
    });
  }
});

// POST /api/customers/:id/update-tier - Update customer tier
router.post('/:id/update-tier', requireAuth, [
  body('customerTier').isIn(['bronze', 'silver', 'gold', 'platinum']).withMessage('Invalid customer tier')
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

    const customer = await models.Customer.findByIdAndUpdate(
      req.params.id,
      {
        customerTier: req.body.customerTier,
        updatedAt: Date.now()
      },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    res.json({
      success: true,
      data: customer,
      message: 'Customer tier updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating customer tier:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer tier'
    });
  }
});

// GET /api/customers/stats/overview - Get customer statistics
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const stats = await models.Customer.aggregate([
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          activeCustomers: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          vipCustomers: { $sum: { $cond: ['$isVIP', 1, 0] } },
          totalSpent: { $sum: '$totalSpent' },
          totalBookings: { $sum: '$totalBookings' },
          avgBookingsPerCustomer: { $avg: '$totalBookings' },
          avgSpentPerCustomer: { $avg: '$totalSpent' }
        }
      }
    ]);

    const tierStats = await models.Customer.aggregate([
      {
        $group: {
          _id: '$customerTier',
          count: { $sum: 1 },
          totalSpent: { $sum: '$totalSpent' }
        }
      }
    ]);

    const vehicleTypeStats = await models.Customer.aggregate([
      {
        $match: { preferredVehicleType: { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: '$preferredVehicleType',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          totalCustomers: 0,
          activeCustomers: 0,
          vipCustomers: 0,
          totalSpent: 0,
          totalBookings: 0,
          avgBookingsPerCustomer: 0,
          avgSpentPerCustomer: 0
        },
        tierStats,
        vehicleTypeStats
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer statistics'
    });
  }
});

module.exports = router; 