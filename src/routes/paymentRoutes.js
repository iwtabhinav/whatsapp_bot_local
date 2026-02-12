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
const validatePaymentInput = [
  body('bookingId').isMongoId().withMessage('Valid booking ID is required'),
  body('customerId').isMongoId().withMessage('Valid customer ID is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount is required'),
  body('currency').optional().isString().withMessage('Currency must be a string'),
  body('paymentMethod').isIn(['paypal', 'stripe', 'cash', 'bank_transfer']).withMessage('Invalid payment method'),
  body('status').optional().isIn(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded']).withMessage('Invalid status')
];

// GET /api/payments - Get all payments with pagination and filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      paymentMethod,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let query = {};

    // Apply status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Apply payment method filter
    if (paymentMethod && paymentMethod !== 'all') {
      query.paymentMethod = paymentMethod;
    }

    // Apply date filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Apply search filter
    if (search) {
      query.$or = [
        { paymentId: { $regex: search, $options: 'i' } },
        { paypalOrderId: { $regex: search, $options: 'i' } },
        { paypalTransactionId: { $regex: search, $options: 'i' } },
        { paypalPayerEmail: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const payments = await models.Payment.find(query)
      .populate('bookingId', 'bookingId customerName pickupLocation dropLocation')
      .populate('customerId', 'name phone email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await models.Payment.countDocuments(query);

    // Calculate statistics
    const stats = await models.Payment.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          completedPayments: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          failedPayments: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pendingPayments: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      stats: stats[0] || {
        totalPayments: 0,
        totalAmount: 0,
        completedPayments: 0,
        failedPayments: 0,
        pendingPayments: 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payments'
    });
  }
});

// GET /api/payments/:id - Get specific payment
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const payment = await models.Payment.findById(req.params.id)
      .populate('bookingId', 'bookingId customerName pickupLocation dropLocation status bookingAmount')
      .populate('customerId', 'name phone email')
      .lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('❌ Error fetching payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment'
    });
  }
});

// POST /api/payments - Create new payment
router.post('/', requireAuth, validatePaymentInput, async (req, res) => {
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
      bookingId,
      customerId,
      amount,
      currency = 'USD',
      paymentMethod,
      description = '',
      notes = ''
    } = req.body;

    // Check if booking exists
    const booking = await models.Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    // Check if customer exists
    const customer = await models.Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }

    // Check if payment already exists for this booking
    const existingPayment = await models.Payment.findOne({ bookingId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        error: 'Payment already exists for this booking'
      });
    }

    const payment = await models.Payment.create({
      bookingId,
      customerId,
      amount,
      currency,
      paymentMethod,
      description,
      notes,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      data: payment,
      message: 'Payment created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment'
    });
  }
});

// PUT /api/payments/:id - Update payment
router.put('/:id', requireAuth, validatePaymentInput, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const payment = await models.Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    // Don't allow updating completed payments
    if (payment.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot update completed payment'
      });
    }

    const updatedPayment = await models.Payment.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: updatedPayment,
      message: 'Payment updated successfully'
    });
  } catch (error) {
    console.error('❌ Error updating payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update payment'
    });
  }
});

// DELETE /api/payments/:id - Delete payment
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const payment = await models.Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    // Don't allow deleting completed payments
    if (payment.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete completed payment'
      });
    }

    await models.Payment.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete payment'
    });
  }
});

// POST /api/payments/:id/process - Process payment
router.post('/:id/process', requireAuth, async (req, res) => {
  try {
    const payment = await models.Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Payment is not in pending status'
      });
    }

    // Simulate payment processing
    const processingResult = await processPayment(payment);

    if (processingResult.success) {
      payment.status = 'completed';
      payment.completedAt = new Date();
      payment.paypalTransactionId = processingResult.transactionId;
      await payment.save();

      // Update booking payment status
      await models.Booking.findByIdAndUpdate(payment.bookingId, {
        paymentStatus: 'paid',
        isPaid: true,
        updatedAt: Date.now()
      });

      res.json({
        success: true,
        data: payment,
        message: 'Payment processed successfully'
      });
    } else {
      payment.status = 'failed';
      payment.failedAt = new Date();
      payment.errorCode = processingResult.errorCode;
      payment.errorMessage = processingResult.errorMessage;
      await payment.save();

      res.status(400).json({
        success: false,
        error: 'Payment processing failed',
        details: processingResult.errorMessage
      });
    }
  } catch (error) {
    console.error('❌ Error processing payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process payment'
    });
  }
});

// POST /api/payments/:id/refund - Refund payment
router.post('/:id/refund', requireAuth, async (req, res) => {
  try {
    const payment = await models.Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Only completed payments can be refunded'
      });
    }

    // Simulate refund processing
    const refundResult = await processRefund(payment);

    if (refundResult.success) {
      payment.status = 'refunded';
      payment.updatedAt = Date.now();
      await payment.save();

      res.json({
        success: true,
        data: payment,
        message: 'Payment refunded successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Refund processing failed',
        details: refundResult.errorMessage
      });
    }
  } catch (error) {
    console.error('❌ Error refunding payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refund payment'
    });
  }
});

// GET /api/payments/stats/overview - Get payment statistics
router.get('/stats/overview', requireAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let matchStage = {};

    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) matchStage.createdAt.$gte = new Date(dateFrom);
      if (dateTo) matchStage.createdAt.$lte = new Date(dateTo);
    }

    const stats = await models.Payment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          completedPayments: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          completedAmount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
          failedPayments: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pendingPayments: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          refundedPayments: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
          refundedAmount: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0] } }
        }
      }
    ]);

    const methodStats = await models.Payment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
        }
      }
    ]);

    const dailyStats = await models.Payment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 30 }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          totalPayments: 0,
          totalAmount: 0,
          completedPayments: 0,
          completedAmount: 0,
          failedPayments: 0,
          pendingPayments: 0,
          refundedPayments: 0,
          refundedAmount: 0
        },
        methodStats,
        dailyStats
      }
    });
  } catch (error) {
    console.error('❌ Error fetching payment stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment statistics'
    });
  }
});

// Helper function to simulate payment processing
async function processPayment(payment) {
  // Simulate payment processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Simulate 90% success rate
  const isSuccess = Math.random() > 0.1;

  if (isSuccess) {
    return {
      success: true,
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`
    };
  } else {
    return {
      success: false,
      errorCode: 'PAYMENT_FAILED',
      errorMessage: 'Payment processing failed due to insufficient funds'
    };
  }
}

// Helper function to simulate refund processing
async function processRefund(payment) {
  // Simulate refund processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Simulate 95% success rate for refunds
  const isSuccess = Math.random() > 0.05;

  if (isSuccess) {
    return {
      success: true,
      refundId: `REF-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`
    };
  } else {
    return {
      success: false,
      errorCode: 'REFUND_FAILED',
      errorMessage: 'Refund processing failed'
    };
  }
}

module.exports = router; 