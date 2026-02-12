const { models } = require('../models');
const { v4: uuidv4 } = require('uuid');
const BookingSession = require('../models/BookingSession');

class BookingService {
  constructor() { }

  async createSession(phoneNumber) {
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Create a DB-backed session document
    const bookingId = `BK-${uuidv4().slice(0, 8).toUpperCase()}`;
    await BookingSession.create({
      bookingId,
      phoneNumber,
      status: 'in_progress',
      data: {},
      processedMessages: []
    });

    return bookingId;
  }

  async getSession(bookingId) {
    return await BookingSession.findOne({ bookingId });
  }

  async getActiveSession(phoneNumber) {
    return await BookingSession.findOne({
      phoneNumber,
      status: { $in: ['in_progress', 'awaiting_confirmation', 'awaiting_payment'] }
    });
  }

  async clearSession(phoneNumber) {
    await BookingSession.deleteMany({ phoneNumber });
    return true;
  }

  async updateSession(bookingId, data) {
    return await BookingSession.updateOne({ bookingId }, { $set: data });
  }

  async confirmBooking(bookingId) {
    const session = await BookingSession.findOne({ bookingId });
    if (!session) return null;

    const confirmationId = `CNF-${uuidv4().slice(0, 8).toUpperCase()}`;
    session.status = 'awaiting_payment';
    session.confirmationId = confirmationId;
    await session.save();

    // Also persist to main Booking collection for dashboard
    try {
      const { models } = require('../models');
      const existing = await models.Booking.findOne({ bookingId });
      if (!existing) {
        // Ensure a Customer document exists (required by Booking model)
        let customer = await models.Customer.findOne({ phone: session.phoneNumber });
        if (!customer) {
          customer = await models.Customer.create({
            name: session.data?.name || 'Customer',
            phone: session.phoneNumber
          });
        }

        await models.Booking.create({
          bookingId,
          customerId: customer._id,
          customerName: session.data?.name || 'Customer',
          customerPhone: session.phoneNumber,
          pickupLocation: session.data?.pickupLocation || '',
          dropLocation: session.data?.dropLocation || '',
          pickupTime: new Date(),
          vehicleType: (session.data?.vehicleType || 'sedan').toLowerCase(),
          numberOfPassengers: parseInt(session.data?.numberOfPassengers || '1', 10),
          baseFare: 0,
          subtotal: 0,
          bookingAmount: 0,
          status: 'pending',
          paymentStatus: 'pending',
          isPaid: false,
          specialRequests: session.data?.specialRequests || ''
        });
      }
    } catch (e) { }
    return confirmationId;
  }

  calculatePrice(session) {
    const { vehicleType, distance, duration, pickupTime, isAirport } = session.data;
    const pricingConfig = configService.getConfig('PRICING_CONFIG', {});
    const vehicleRates = pricingConfig.rates[vehicleType];

    if (!vehicleRates) return null;

    let totalPrice = 0;
    const breakdown = {};

    // Time-based calculation
    const minDuration = pricingConfig.calculation.minBookingDuration || 1;
    const actualDuration = Math.max(duration || minDuration, minDuration);
    const timeCharge = actualDuration * vehicleRates.baseRate;
    breakdown.timeCharge = timeCharge;
    totalPrice += timeCharge;

    // Distance-based calculation
    if (distance > 0) {
      const distanceCharge = distance * vehicleRates.kmRate;
      breakdown.distanceCharge = distanceCharge;
      totalPrice += distanceCharge;
    }

    // Add other charges (surcharges, etc.) as needed

    return {
      total: totalPrice,
      breakdown,
    };
  }
}

module.exports = new BookingService();
