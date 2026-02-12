const crypto = require('crypto');
const paypalService = require('./paypalService');
const { models } = require('../models');

class PaymentService {
  constructor() {
    this.paypalService = paypalService;
  }

  async generatePaymentLink(bookingData) {
    try {
      console.log('💰 Generating PayPal payment link for booking:', bookingData.bookingId);

      // Generate payment link using PayPal
      const paymentResult = await this.paypalService.createPaymentLink(bookingData);

      if (!paymentResult.success) {
        throw new Error(paymentResult.error || 'Failed to generate payment link');
      }

      // Store payment details in database (link to Booking/Customer if present; otherwise skip strict linkage)
      try {
        const bookingDoc = await models.Booking.findOne({ bookingId: bookingData.bookingId });
        const customerId = bookingDoc ? bookingDoc.customerId : undefined;
        await models.Payment.create({
          paymentId: paymentResult.paymentId,
          bookingId: bookingDoc ? bookingDoc._id : undefined,
          bookingCode: bookingData.bookingId,
          customerId,
          amount: bookingData.amount,
          currency: process.env.PAYPAL_CURRENCY || 'USD',
          status: 'pending',
          paymentMethod: 'paypal',
          paypalOrderId: paymentResult.paymentId
        });
      } catch (e) {
        console.error('⚠️ Could not link payment to Booking/Customer yet:', e.message);
      }

      return {
        success: true,
        paymentLink: paymentResult.paymentUrl || paymentResult.approvalUrl,
        approvalUrl: paymentResult.paymentUrl || paymentResult.approvalUrl,
        paymentId: paymentResult.paymentId
      };

    } catch (error) {
      console.error('❌ Payment link generation failed:', error);
      return {
        success: false,
        error: error.message,
        fallbackMessage: 'Please contact support for payment assistance.'
      };
    }
  }

  async checkPaymentStatus(bookingId) {
    try {
      // Resolve by bookingCode first for flexibility
      let payment = await models.Payment.findOne({ bookingCode: bookingId }).sort({ createdAt: -1 });
      if (!payment) {
        const bookingDoc = await models.Booking.findOne({ bookingId });
        if (bookingDoc) {
          payment = await models.Payment.findOne({ bookingId: bookingDoc._id }).sort({ createdAt: -1 });
        }
      }

      if (!payment) {
        return 'pending';
      }

      // If payment is still pending, check with PayPal
      if (payment.status === 'pending' && payment.paypalOrderId) {
        const paypalStatus = await this.paypalService.getPaymentDetails(payment.paypalOrderId);

        if (paypalStatus.success && paypalStatus.status !== 'pending') {
          // Update payment status in database
          payment.status = paypalStatus.status;
          payment.completedAt = new Date();
          await payment.save();
        }
      }

      return payment.status;

    } catch (error) {
      console.error('❌ Payment status check failed:', error);
      return 'pending';
    }
  }

  async executePayment(paymentId, payerId) {
    try {
      console.log('💳 Executing PayPal payment:', paymentId);

      const result = await this.paypalService.executePayment(paymentId, payerId);

      if (result.success) {
        // Update payment in database
        const payment = await models.Payment.findOne({ paypalOrderId: paymentId });
        if (payment) {
          payment.status = 'completed';
          payment.paypalTransactionId = result.transactionId;
          payment.completedAt = new Date();
          await payment.save();
        }

        // Update booking status
        let booking = null;
        if (payment && payment.bookingId) {
          booking = await models.Booking.findById(payment.bookingId);
        }
        if (booking) {
          booking.isPaid = true;
          booking.paymentStatus = 'paid';
          booking.paypalTxnId = result.transactionId;
          booking.paymentDate = new Date();
          await booking.save();
        }
      }

      return result;

    } catch (error) {
      console.error('❌ Payment execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async storePaymentDetails(details) {
    try {
      await models.Payment.create(details);
      console.log('✅ Payment details stored in database');
    } catch (error) {
      console.error('❌ Failed to store payment details:', error);
    }
  }

  async getPaymentDetails(bookingId) {
    try {
      const payment = await models.Payment.findOne({ bookingId }).sort({ createdAt: -1 });
      return payment || null;
    } catch (error) {
      console.error('❌ Failed to get payment details:', error);
      return null;
    }
  }

  async createPayout(payoutData) {
    try {
      console.log('💰 Creating PayPal payout for concierge:', payoutData.conciergeId);

      const result = await this.paypalService.createPayout(payoutData);

      if (result.success) {
        // Store payout in database
        await models.Payout.create({
          conciergeId: payoutData.conciergeId,
          conciergeEmail: payoutData.conciergeEmail,
          paypalEmail: payoutData.paypalEmail,
          amount: payoutData.amount,
          currency: payoutData.currency,
          platformFee: payoutData.platformFee,
          netAmount: payoutData.netAmount,
          paypalBatchId: result.batchId,
          paypalPayoutItemId: result.payoutItemId,
          status: 'initiated',
          requestedAt: new Date()
        });

        console.log('✅ Payout created successfully');
      }

      return result;

    } catch (error) {
      console.error('❌ Payout creation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getPayoutStatus(batchId) {
    try {
      const result = await this.paypalService.getPayoutStatus(batchId);
      return result;
    } catch (error) {
      console.error('❌ Payout status check failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new PaymentService(); 