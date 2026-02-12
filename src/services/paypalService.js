require('dotenv').config();
const httpClient = require('../utils/httpClient');
const axios = require('axios');

class PayPalService {
  constructor() {
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    // Normalize currency to 3-letter uppercase (default AED)
    const rawCurrency = (process.env.PAYPAL_CURRENCY || 'AED').toUpperCase();
    this.currency = rawCurrency && rawCurrency.length === 3 ? rawCurrency : 'AED';
    this.platformFeePercentage = parseFloat(process.env.PAYPAL_PLATFORM_FEE_PERCENTAGE) || 5;

    // Set API URLs based on environment
    if (process.env.PAYPAL_MODE === 'live') {
      this.apiUrl = 'https://api-m.paypal.com';
    } else {
      this.apiUrl = 'https://api-m.sandbox.paypal.com';
    }

    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      if (!this.clientId || !this.clientSecret) {
        throw new Error('Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
      }
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await httpClient.post(`${this.apiUrl}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Accept-Language': 'en_US',
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to get access token');
      }

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Refresh 1 min early

      return this.accessToken;
    } catch (error) {
      console.error('PayPal access token error:', error);
      throw new Error('Failed to get PayPal access token');
    }
  }

  // ============================================================================
  // PAYMENT LINK GENERATION FOR CUSTOMERS
  // ============================================================================

  async createPaymentLink(bookingData) {
    try {
      const accessToken = await this.getAccessToken();

      // Use PayPal v2 Orders API for link creation (recommended)
      const orderPayload = {
        intent: 'CAPTURE',
        application_context: {
          brand_name: 'Preimo Chauffeur Services',
          user_action: 'PAY_NOW',
          return_url: `${process.env.BASE_URL || 'http://localhost:4001'}/payment/success?booking_id=${bookingData.bookingId}`,
          cancel_url: `${process.env.BASE_URL || 'http://localhost:4001'}/payment/cancel?booking_id=${bookingData.bookingId}`
        },
        purchase_units: [
          {
            reference_id: bookingData.bookingId,
            description: `Chauffeur Service - ${bookingData.vehicleType || ''}`.trim(),
            amount: {
              currency_code: this.currency,
              value: Number(bookingData.amount || 0).toFixed(2)
            }
          }
        ]
      };

      const response = await axios.post(`${this.apiUrl}/v2/checkout/orders`, orderPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const approvalUrl = response.data.links?.find(l => l.rel === 'approve')?.href;
      return {
        success: true,
        paymentId: response.data.id,
        paymentUrl: approvalUrl,
        approvalUrl,
        payment: response.data
      };
    } catch (error) {
      const details = error.response?.data || error.message;
      console.error('PayPal payment link creation error:', details);
      return { success: false, error: typeof details === 'string' ? details : (details?.message || 'Failed to create payment link') };
    }
  }

  async executePayment(paymentId, payerId) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await httpClient.post(
        `${this.apiUrl}/v1/payments/payment/${paymentId}/execute`,
        { payer_id: payerId },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to execute payment');
      }

      return {
        success: true,
        payment: response.data,
        transactionId: response.data.transactions[0]?.related_resources[0]?.sale?.id
      };

    } catch (error) {
      console.error('PayPal payment execution error:', error.response?.data || error);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to execute payment'
      };
    }
  }

  async getPaymentDetails(paymentId) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get(`${this.apiUrl}/v1/payments/payment/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        payment: response.data
      };

    } catch (error) {
      console.error('PayPal payment details error:', error.response?.data || error);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to get payment details'
      };
    }
  }

  // ============================================================================
  // CUSTOMER PAYMENTS (PAY-IN)
  // ============================================================================

  async createPayment(bookingData) {
    try {
      const { bookingId, amount, customerName, customerEmail, description } = bookingData;
      const accessToken = await this.getAccessToken();

      const orderData = {
        intent: 'CAPTURE',
        application_context: {
          brand_name: 'Preimo Chauffeur Services',
          landing_page: 'BILLING',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${process.env.PAYPAL_SUCCESS_URL}?booking_id=${bookingId}`,
          cancel_url: `${process.env.PAYPAL_CANCEL_URL}?booking_id=${bookingId}`
        },
        purchase_units: [{
          reference_id: bookingId,
          description: description || `Taxi Booking - ${bookingId}`,
          amount: {
            currency_code: this.currency,
            value: amount.toFixed(2)
          }
        }],
        payer: {
          name: {
            given_name: customerName?.split(' ')[0] || 'Customer',
            surname: customerName?.split(' ').slice(1).join(' ') || 'User'
          },
          email_address: customerEmail
        }
      };

      const response = await axios.post(`${this.apiUrl}/v2/checkout/orders`, orderData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Prefer': 'return=representation'
        }
      });

      if (response.status === 201) {
        const approvalUrl = response.data.links.find(link => link.rel === 'approve')?.href;

        return {
          success: true,
          orderId: response.data.id,
          approvalUrl: approvalUrl,
          amount: amount,
          currency: this.currency,
          status: response.data.status
        };
      } else {
        throw new Error(`PayPal order creation failed with status: ${response.status}`);
      }
    } catch (error) {
      console.error('PayPal payment creation error:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  async capturePayment(orderId) {
    try {
      const request = new paypal.orders.OrdersCaptureRequest(orderId);
      request.requestBody({});

      const response = await this.client.execute(request);

      if (response.statusCode === 201) {
        const capture = response.result.purchase_units[0].payments.captures[0];

        return {
          success: true,
          transactionId: capture.id,
          amount: parseFloat(capture.amount.value),
          currency: capture.amount.currency_code,
          status: capture.status,
          referenceId: response.result.purchase_units[0].reference_id,
          payerEmail: response.result.payer.email_address,
          captureTime: capture.create_time
        };
      } else {
        throw new Error(`PayPal capture failed with status: ${response.statusCode}`);
      }
    } catch (error) {
      console.error('PayPal payment capture error:', error);
      return {
        success: false,
        error: error.message,
        details: error.details || null
      };
    }
  }

  async getPaymentDetails(orderId) {
    try {
      const request = new paypal.orders.OrdersGetRequest(orderId);
      const response = await this.client.execute(request);

      return {
        success: true,
        order: response.result
      };
    } catch (error) {
      console.error('PayPal get payment details error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // CONCIERGE PAYOUTS (PAY-OUT)
  // ============================================================================

  async createPayout(payoutData) {
    try {
      const {
        conciergeId,
        paypalEmail,
        amount,
        payoutId,
        note = 'Commission payout from Preimo Chauffeur Services'
      } = payoutData;

      // Calculate platform fee
      const platformFee = (amount * this.platformFeePercentage) / 100;
      const netAmount = amount - platformFee;

      if (netAmount <= 0) {
        throw new Error('Net payout amount must be greater than 0 after platform fee');
      }

      const senderBatchId = `batch_${payoutId}_${Date.now()}`;

      const request = new payoutSDK.payouts.PayoutsPostRequest();
      request.requestBody({
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: 'You have a payout from Preimo Chauffeur Services',
          email_message: `Your commission payout of ${this.currency} ${netAmount.toFixed(2)} has been processed.`
        },
        items: [{
          recipient_type: 'EMAIL',
          amount: {
            value: netAmount.toFixed(2),
            currency: this.currency
          },
          receiver: paypalEmail,
          note: note,
          sender_item_id: payoutId,
          recipient_wallet: 'PAYPAL'
        }]
      });

      const response = await this.payoutClient.execute(request);

      if (response.statusCode === 201) {
        const batchHeader = response.result.batch_header;
        const payoutItem = response.result.links?.find(link => link.rel === 'item')?.href;

        return {
          success: true,
          batchId: batchHeader.payout_batch_id,
          batchStatus: batchHeader.batch_status,
          senderBatchId: senderBatchId,
          timeCreated: batchHeader.time_created,
          amount: netAmount,
          platformFee: platformFee,
          originalAmount: amount,
          currency: this.currency,
          payoutItemUrl: payoutItem
        };
      } else {
        throw new Error(`PayPal payout creation failed with status: ${response.statusCode}`);
      }
    } catch (error) {
      console.error('PayPal payout creation error:', error);
      return {
        success: false,
        error: error.message,
        details: error.details || null
      };
    }
  }

  async getPayoutStatus(batchId) {
    try {
      const request = new payoutSDK.payouts.PayoutsGetRequest(batchId);
      const response = await this.payoutClient.execute(request);

      return {
        success: true,
        batchHeader: response.result.batch_header,
        items: response.result.items || []
      };
    } catch (error) {
      console.error('PayPal get payout status error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getPayoutItem(payoutItemId) {
    try {
      const request = new payoutSDK.payouts.PayoutsItemGetRequest(payoutItemId);
      const response = await this.payoutClient.execute(request);

      return {
        success: true,
        item: response.result
      };
    } catch (error) {
      console.error('PayPal get payout item error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async cancelPayoutItem(payoutItemId) {
    try {
      const request = new payoutSDK.payouts.PayoutsItemCancelRequest(payoutItemId);
      const response = await this.payoutClient.execute(request);

      return {
        success: true,
        item: response.result
      };
    } catch (error) {
      console.error('PayPal cancel payout item error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // BATCH PAYOUTS (FOR MULTIPLE CONCIERGES)
  // ============================================================================

  async createBatchPayout(payouts) {
    try {
      if (!Array.isArray(payouts) || payouts.length === 0) {
        throw new Error('Invalid payouts array');
      }

      const senderBatchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const totalAmount = payouts.reduce((sum, payout) => sum + payout.amount, 0);

      const payoutItems = payouts.map(payout => {
        const platformFee = (payout.amount * this.platformFeePercentage) / 100;
        const netAmount = payout.amount - platformFee;

        return {
          recipient_type: 'EMAIL',
          amount: {
            value: netAmount.toFixed(2),
            currency: this.currency
          },
          receiver: payout.paypalEmail,
          note: payout.note || 'Commission payout from Preimo Chauffeur Services',
          sender_item_id: payout.payoutId,
          recipient_wallet: 'PAYPAL'
        };
      });

      const request = new payoutSDK.payouts.PayoutsPostRequest();
      request.requestBody({
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: 'Batch payout from Preimo Chauffeur Services',
          email_message: `Your commission payout has been processed in batch ${senderBatchId}.`
        },
        items: payoutItems
      });

      const response = await this.payoutClient.execute(request);

      if (response.statusCode === 201) {
        return {
          success: true,
          batchId: response.result.batch_header.payout_batch_id,
          batchStatus: response.result.batch_header.batch_status,
          totalItems: payouts.length,
          totalAmount: totalAmount,
          timeCreated: response.result.batch_header.time_created,
          items: response.result.links || []
        };
      } else {
        throw new Error(`PayPal batch payout creation failed with status: ${response.statusCode}`);
      }
    } catch (error) {
      console.error('PayPal batch payout creation error:', error);
      return {
        success: false,
        error: error.message,
        details: error.details || null
      };
    }
  }

  // ============================================================================
  // WEBHOOK VALIDATION AND PROCESSING
  // ============================================================================

  async verifyWebhookSignature(headers, body, webhookId) {
    try {
      const webhookEvent = JSON.parse(body);

      // Get PayPal's certificate
      const certUrl = headers['paypal-cert-url'];
      if (!certUrl) {
        throw new Error('Missing PayPal certificate URL');
      }

      // In production, implement proper webhook signature verification
      // For now, basic validation
      if (!webhookEvent.id || !webhookEvent.event_type) {
        throw new Error('Invalid webhook payload');
      }

      return {
        success: true,
        event: webhookEvent
      };
    } catch (error) {
      console.error('PayPal webhook verification error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processWebhookEvent(event) {
    try {
      const eventType = event.event_type;
      const resource = event.resource;

      console.log(`Processing PayPal webhook event: ${eventType}`);

      switch (eventType) {
        case 'PAYMENT.CAPTURE.COMPLETED':
          return await this.handlePaymentCompleted(resource);

        case 'PAYMENT.CAPTURE.DENIED':
        case 'PAYMENT.CAPTURE.DECLINED':
          return await this.handlePaymentFailed(resource);

        case 'PAYOUTS.PAYOUT-ITEM.SUCCEEDED':
          return await this.handlePayoutSucceeded(resource);

        case 'PAYOUTS.PAYOUT-ITEM.FAILED':
          return await this.handlePayoutFailed(resource);

        case 'PAYOUTS.PAYOUT-ITEM.CANCELED':
          return await this.handlePayoutCancelled(resource);

        default:
          console.log(`Unhandled PayPal webhook event type: ${eventType}`);
          return { success: true, message: 'Event logged but not processed' };
      }
    } catch (error) {
      console.error('PayPal webhook processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handlePaymentCompleted(resource) {
    try {
      // Extract booking reference from invoice or custom fields if present
      const transactionId = resource.id;
      const amount = parseFloat(resource.amount?.value || '0');
      const currency = resource.amount?.currency_code || this.currency;
      const invoiceNumber = resource.supplementary_data?.related_ids?.order_id || resource.invoice_id || null;

      // Update BookingSession to paid if we can find it by order/invoice id
      const { models } = require('../models');
      const BookingSession = require('../models/BookingSession');

      // Try match by invoice (bookingId)
      let session = null;
      if (invoiceNumber) {
        session = await BookingSession.findOne({ bookingId: invoiceNumber });
      }

      if (session) {
        session.status = 'paid';
        await session.save();

        // Update Payment record if it exists
        try {
          const payment = await models.Payment.findOne({ 
            $or: [
              { bookingCode: session.bookingId },
              { paypalOrderId: invoiceNumber }
            ]
          });
          
          if (payment) {
            payment.status = 'completed';
            payment.completedAt = new Date();
            payment.paypalTransactionId = transactionId;
            payment.paypalPayerEmail = resource.payer?.email_address || null;
            await payment.save();
            console.log(`✅ Payment record updated for booking ${session.bookingId}`);
          } else {
            // Create new Payment record if not found
            const bookingDoc = await models.Booking.findOne({ bookingId: session.bookingId });
            if (bookingDoc) {
              await models.Payment.create({
                bookingId: bookingDoc._id,
                bookingCode: session.bookingId,
                customerId: bookingDoc.customerId,
                amount: amount,
                currency: currency,
                paymentMethod: 'paypal',
                paypalOrderId: invoiceNumber,
                paypalTransactionId: transactionId,
                paypalPayerEmail: resource.payer?.email_address || null,
                status: 'completed',
                completedAt: new Date(),
                description: `Payment for booking ${session.bookingId}`
              });
              console.log(`✅ New Payment record created for booking ${session.bookingId}`);
            }
          }
        } catch (paymentError) {
          console.warn('⚠️ Payment record update failed in webhook:', paymentError.message);
        }

        // Create a finalized Booking record (minimal)
        try {
          const booking = await models.Booking.create({
            bookingId: session.bookingId,
            customerPhone: session.phoneNumber,
            customerName: session.data?.name || 'Customer',
            pickupLocation: session.data?.pickupLocation || '',
            dropLocation: session.data?.dropLocation || '',
            pickupTime: new Date(),
            vehicleType: (session.data?.vehicleType || 'sedan').toLowerCase(),
            numberOfPassengers: parseInt(session.data?.numberOfPassengers || '1', 10),
            baseFare: amount,
            subtotal: amount,
            bookingAmount: amount,
            isPaid: true,
            paymentStatus: 'paid',
            paymentMethod: 'paypal',
            paypalTxnId: transactionId,
            referrerId: session.data?.referrerId || null
          });

          // Handle concierge referral and commission if applicable
          if (session.data?.referrerId || session.data?.conciergePhone) {
            try {
              const conciergeService = require('./conciergeService');
              let conciergeId = session.data.referrerId;

              // If we have concierge phone but no ID, try to find the concierge
              if (!conciergeId && session.data.conciergePhone) {
                const concierge = await conciergeService.getConcierge(session.data.conciergePhone);
                if (concierge) {
                  conciergeId = concierge._id;
                  // Link the booking to this concierge
                  await conciergeService.linkBookingToConcierge(session.bookingId, conciergeId);
                }
              }

              // Calculate and create commission record
              if (conciergeId) {
                const commissionData = await conciergeService.calculateCommission(session.bookingId, conciergeId);
                if (commissionData) {
                  await conciergeService.createCommissionRecord(commissionData);
                  console.log(`✅ Commission record created for concierge ${conciergeId} via webhook`);
                }
              }
            } catch (commissionError) {
              console.warn('⚠️ Commission creation failed in webhook:', commissionError.message);
            }
          }
        } catch (e) {
          // Non-fatal
          console.warn('⚠️ Booking creation failed in webhook:', e.message);
        }

        return { success: true, action: 'payment_completed', transactionId, bookingId: session.bookingId };
      }

      // If we cannot find session, still return success to acknowledge
      return { success: true, action: 'payment_completed', transactionId };
    } catch (error) {
      console.error('PayPal webhook completion handler error:', error);
      return { success: false, error: error.message };
    }
  }

  async handlePaymentFailed(resource) {
    try {
      const transactionId = resource.id;
      const invoiceNumber = resource.supplementary_data?.related_ids?.order_id || resource.invoice_id || null;
      const BookingSession = require('../models/BookingSession');
      const { models } = require('../models');
      
      if (invoiceNumber) {
        // Update BookingSession
        await BookingSession.updateOne({ bookingId: invoiceNumber }, { $set: { status: 'cancelled' } });
        
        // Update Payment record if it exists
        try {
          const payment = await models.Payment.findOne({ 
            $or: [
              { bookingCode: invoiceNumber },
              { paypalOrderId: invoiceNumber }
            ]
          });
          
          if (payment) {
            payment.status = 'failed';
            payment.failedAt = new Date();
            payment.errorCode = resource.reason_code || 'PAYMENT_FAILED';
            payment.errorMessage = resource.reason || 'Payment was declined or failed';
            await payment.save();
            console.log(`❌ Payment record marked as failed for booking ${invoiceNumber}`);
          }
        } catch (paymentError) {
          console.warn('⚠️ Payment record update failed in webhook failure handler:', paymentError.message);
        }
      }
      return { success: true, action: 'payment_failed', transactionId };
    } catch (error) {
      console.error('PayPal webhook failure handler error:', error);
      return { success: false, error: error.message };
    }
  }

  async handlePayoutSucceeded(resource) {
    // Implementation would update payout status in database
    console.log('Payout succeeded:', resource.payout_item_id);
    return { success: true, action: 'payout_succeeded', payoutItemId: resource.payout_item_id };
  }

  async handlePayoutFailed(resource) {
    // Implementation would update payout status in database
    console.log('Payout failed:', resource.payout_item_id);
    return { success: true, action: 'payout_failed', payoutItemId: resource.payout_item_id };
  }

  async handlePayoutCancelled(resource) {
    // Implementation would update payout status in database
    console.log('Payout cancelled:', resource.payout_item_id);
    return { success: true, action: 'payout_cancelled', payoutItemId: resource.payout_item_id };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  calculatePlatformFee(amount) {
    return (amount * this.platformFeePercentage) / 100;
  }

  calculateNetAmount(amount) {
    return amount - this.calculatePlatformFee(amount);
  }

  formatAmount(amount) {
    return parseFloat(amount).toFixed(2);
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

module.exports = new PayPalService(); 