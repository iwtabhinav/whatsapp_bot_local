const express = require('express');
const router = express.Router();
const { models } = require('../models');
const conciergeService = require('../services/conciergeService');

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Get all concierges
router.get('/', requireAuth, async (req, res) => {
  try {
    const concierges = await models.Concierge.find()
      .sort({ createdAt: -1 })
      .populate('uplineId', 'name conciergeId')
      .lean();

    res.json({ success: true, concierges });
  } catch (error) {
    console.error('Error fetching concierges:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch concierges' });
  }
});

// Get concierge by ID
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const concierge = await models.Concierge.findById(req.params.id)
      .populate('uplineId', 'name conciergeId')
      .populate('directReferrals', 'name conciergeId phone')
      .lean();

    if (!concierge) {
      return res.status(404).json({ success: false, error: 'Concierge not found' });
    }

    // Get concierge dashboard data
    const dashboardData = await conciergeService.getConciergeDashboard(req.params.id);

    res.json({ success: true, concierge, dashboardData });
  } catch (error) {
    console.error('Error fetching concierge:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch concierge' });
  }
});

// Create new concierge
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, email, phone, paypalEmail, commissionRate, uplineId } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !paypalEmail) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, phone, and PayPal email are required'
      });
    }

    // Check if concierge already exists
    const existingConcierge = await models.Concierge.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingConcierge) {
      return res.status(400).json({
        success: false,
        error: 'Concierge with this email or phone already exists'
      });
    }

    const concierge = await conciergeService.createConcierge({
      name,
      email,
      phone,
      paypalEmail,
      commissionRate: commissionRate || 10,
      uplineId
    });

    res.json({ success: true, concierge });
  } catch (error) {
    console.error('Error creating concierge:', error);
    res.status(500).json({ success: false, error: 'Failed to create concierge' });
  }
});

// Update concierge
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name, email, phone, paypalEmail, commissionRate, uplineId } = req.body;

    const concierge = await models.Concierge.findByIdAndUpdate(
      req.params.id,
      {
        name,
        email,
        phone,
        paypalEmail,
        commissionRate,
        uplineId
      },
      { new: true, runValidators: true }
    );

    if (!concierge) {
      return res.status(404).json({ success: false, error: 'Concierge not found' });
    }

    res.json({ success: true, concierge });
  } catch (error) {
    console.error('Error updating concierge:', error);
    res.status(500).json({ success: false, error: 'Failed to update concierge' });
  }
});

// Delete concierge
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const concierge = await models.Concierge.findByIdAndDelete(req.params.id);

    if (!concierge) {
      return res.status(404).json({ success: false, error: 'Concierge not found' });
    }

    res.json({ success: true, message: 'Concierge deleted successfully' });
  } catch (error) {
    console.error('Error deleting concierge:', error);
    res.status(500).json({ success: false, error: 'Failed to delete concierge' });
  }
});

// Get concierge commissions
router.get('/:id/commissions', requireAuth, async (req, res) => {
  try {
    const commissions = await models.Commission.find({ conciergeId: req.params.id })
      .populate('bookingId', 'bookingId customerName pickupLocation dropLocation')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, commissions });
  } catch (error) {
    console.error('Error fetching commissions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch commissions' });
  }
});

// Get concierge payouts
router.get('/:id/payouts', requireAuth, async (req, res) => {
  try {
    const payouts = await models.Payout.find({ conciergeId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, payouts });
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch payouts' });
  }
});

// Process payout for concierge
router.post('/:id/payout', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }

    const payout = await conciergeService.processPayout(req.params.id, amount);

    res.json({ success: true, payout });
  } catch (error) {
    console.error('Error processing payout:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get concierge statistics
router.get('/:id/stats', requireAuth, async (req, res) => {
  try {
    const stats = await models.Commission.aggregate([
      { $match: { conciergeId: models.mongoose.Types.ObjectId(req.params.id) } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: '$commissionAmount' },
          totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$commissionAmount', 0] } },
          pendingAmount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$commissionAmount', 0] } },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    res.json({ success: true, stats: stats[0] || { totalEarned: 0, totalPaid: 0, pendingAmount: 0, totalBookings: 0 } });
  } catch (error) {
    console.error('Error fetching concierge stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
