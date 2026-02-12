const { models } = require('../models');

class ConciergeService {
  constructor() {
    this.models = models;
  }

  /**
   * Create a new concierge profile
   */
  async createConcierge(conciergeData) {
    try {
      const concierge = await this.models.Concierge.create({
        name: conciergeData.name,
        email: conciergeData.email,
        phone: conciergeData.phone,
        paypalEmail: conciergeData.paypalEmail,
        commissionRate: conciergeData.commissionRate || 10,
        uplineId: conciergeData.uplineId || null,
        tier: conciergeData.uplineId ? 2 : 1
      });

      // If this concierge has an upline, update upline's direct referrals
      if (conciergeData.uplineId) {
        await this.models.Concierge.findByIdAndUpdate(
          conciergeData.uplineId,
          { $push: { directReferrals: concierge._id } }
        );
      }

      console.log(`✅ Concierge created: ${concierge.conciergeId}`);
      return concierge;
    } catch (error) {
      console.error('❌ Error creating concierge:', error);
      throw error;
    }
  }

  /**
   * Get concierge by ID or phone
   */
  async getConcierge(identifier) {
    try {
      let concierge;
      if (identifier.includes('@')) {
        // ObjectId
        concierge = await this.models.Concierge.findById(identifier);
      } else {
        // Phone number
        concierge = await this.models.Concierge.findOne({ phone: identifier });
      }
      return concierge;
    } catch (error) {
      console.error('❌ Error getting concierge:', error);
      return null;
    }
  }

  /**
   * Calculate commission for a booking
   */
  async calculateCommission(bookingId, conciergeId) {
    try {
      const booking = await this.models.Booking.findOne({ bookingId });
      if (!booking) {
        console.warn('⚠️ Booking not found for commission calculation:', bookingId);
        return null;
      }

      const concierge = await this.models.Concierge.findById(conciergeId);
      if (!concierge) {
        console.warn('⚠️ Concierge not found for commission calculation:', conciergeId);
        return null;
      }

      const baseAmount = booking.bookingAmount || 0;
      const commissionRate = concierge.commissionRate || 10;
      const commissionAmount = (baseAmount * commissionRate) / 100;

      // Calculate upline commission if applicable
      let uplineCommission = 0;
      if (concierge.uplineId && concierge.uplineCommissionRate) {
        uplineCommission = (baseAmount * concierge.uplineCommissionRate) / 100;
      }

      return {
        conciergeId: concierge._id,
        bookingId: booking._id,
        baseAmount,
        commissionRate,
        commissionAmount,
        uplineId: concierge.uplineId,
        uplineCommissionRate: concierge.uplineCommissionRate,
        uplineCommission,
        totalCommission: commissionAmount + uplineCommission
      };
    } catch (error) {
      console.error('❌ Error calculating commission:', error);
      return null;
    }
  }

  /**
   * Create commission record after payment
   */
  async createCommissionRecord(commissionData) {
    try {
      const commission = await this.models.Commission.create({
        conciergeId: commissionData.conciergeId,
        bookingId: commissionData.bookingId,
        baseAmount: commissionData.baseAmount,
        commissionRate: commissionData.commissionRate,
        commissionAmount: commissionData.commissionAmount,
        uplineId: commissionData.uplineId,
        uplineCommissionRate: commissionData.uplineCommissionRate,
        uplineCommission: commissionData.uplineCommission,
        totalCommission: commissionData.totalCommission,
        status: 'pending',
        paymentStatus: 'pending'
      });

      // Update concierge's pending payouts
      await this.models.Concierge.findByIdAndUpdate(
        commissionData.conciergeId,
        {
          $inc: {
            totalEarned: commissionData.commissionAmount,
            pendingPayouts: commissionData.commissionAmount
          }
        }
      );

      // Update upline's pending payouts if applicable
      if (commissionData.uplineId && commissionData.uplineCommission > 0) {
        await this.models.Concierge.findByIdAndUpdate(
          commissionData.uplineId,
          {
            $inc: {
              totalEarned: commissionData.uplineCommission,
              pendingPayouts: commissionData.uplineCommission
            }
          }
        );
      }

      console.log(`✅ Commission record created: ${commission._id}`);
      return commission;
    } catch (error) {
      console.error('❌ Error creating commission record:', error);
      throw error;
    }
  }

  /**
   * Process payout to concierge
   */
  async processPayout(conciergeId, amount) {
    try {
      const concierge = await this.models.Concierge.findById(conciergeId);
      if (!concierge) {
        throw new Error('Concierge not found');
      }

      if (concierge.pendingPayouts < amount) {
        throw new Error('Insufficient pending balance');
      }

      // Create payout record
      const payout = await this.models.Payout.create({
        conciergeId: concierge._id,
        amount,
        paypalEmail: concierge.paypalEmail,
        status: 'pending',
        paymentMethod: 'paypal'
      });

      // Update concierge balance
      await this.models.Concierge.findByIdAndUpdate(
        conciergeId,
        {
          $inc: {
            pendingPayouts: -amount,
            totalWithdrawn: amount
          }
        }
      );

      // Update commission records to paid
      await this.models.Commission.updateMany(
        {
          conciergeId: concierge._id,
          status: 'pending',
          paymentStatus: 'pending'
        },
        {
          $set: {
            status: 'paid',
            paymentStatus: 'paid',
            payoutId: payout._id
          }
        }
      );

      console.log(`✅ Payout processed: ${payout._id} for ${amount}`);
      return payout;
    } catch (error) {
      console.error('❌ Error processing payout:', error);
      throw error;
    }
  }

  /**
   * Get concierge dashboard data
   */
  async getConciergeDashboard(conciergeId) {
    try {
      const concierge = await this.models.Concierge.findById(conciergeId);
      if (!concierge) return null;

      const stats = await this.models.Commission.aggregate([
        { $match: { conciergeId: concierge._id } },
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

      const recentBookings = await this.models.Booking.find({ referrerId: concierge._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('customerId', 'name phone');

      const recentCommissions = await this.models.Commission.find({ conciergeId: concierge._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('bookingId', 'bookingId customerName');

      return {
        concierge,
        stats: stats[0] || { totalEarned: 0, totalPaid: 0, pendingAmount: 0, totalBookings: 0 },
        recentBookings,
        recentCommissions
      };
    } catch (error) {
      console.error('❌ Error getting concierge dashboard:', error);
      return null;
    }
  }

  /**
   * Link booking to concierge
   */
  async linkBookingToConcierge(bookingId, conciergeId) {
    try {
      const booking = await this.models.Booking.findOneAndUpdate(
        { bookingId },
        { referrerId: conciergeId },
        { new: true }
      );

      if (booking) {
        console.log(`✅ Booking ${bookingId} linked to concierge ${conciergeId}`);
        return booking;
      }
      return null;
    } catch (error) {
      console.error('❌ Error linking booking to concierge:', error);
      return null;
    }
  }
}

module.exports = new ConciergeService();

