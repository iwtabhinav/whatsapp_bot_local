const mongoose = require('mongoose');

const bookingSessionSchema = new mongoose.Schema(
    {
        bookingId: { type: String, required: true, index: true, unique: true },
        phoneNumber: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ['in_progress', 'awaiting_confirmation', 'confirmed', 'awaiting_payment', 'cancelled'],
            default: 'in_progress'
        },
        data: { type: Object, default: {} },
        processedMessages: { type: [String], default: [] },
        additionalPreferencesAsked: { type: Boolean, default: false },
        confirmationId: { type: String, default: null }
    },
    { timestamps: true }
);

module.exports = mongoose.model('BookingSession', bookingSessionSchema);

