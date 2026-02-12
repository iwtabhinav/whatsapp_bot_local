const mongoose = require('mongoose');

const pricingConfigSchema = new mongoose.Schema({
    vehicleType: {
        type: String,
        required: true,
        enum: ['Sedan', 'SUV', 'Luxury', 'Van'],
        unique: true
    },
    baseRate: {
        type: Number,
        required: true,
        min: 0
    },
    perKmRate: {
        type: Number,
        required: true,
        min: 0
    },
    perHourRate: {
        type: Number,
        required: true,
        min: 0
    },
    minimumCharge: {
        type: Number,
        required: true,
        min: 0
    },
    currency: {
        type: String,
        default: 'AED',
        enum: ['AED', 'USD', 'EUR']
    },
    isActive: {
        type: Boolean,
        default: true
    },
    validFrom: {
        type: Date,
        default: Date.now
    },
    validTo: {
        type: Date,
        default: null
    },
    surgeMultiplier: {
        type: Number,
        default: 1.0,
        min: 1.0
    },
    peakHours: {
        start: { type: String, default: '07:00' },
        end: { type: String, default: '09:00' },
        multiplier: { type: Number, default: 1.2 }
    },
    weekendMultiplier: {
        type: Number,
        default: 1.1,
        min: 1.0
    },
    holidayMultiplier: {
        type: Number,
        default: 1.3,
        min: 1.0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient queries
pricingConfigSchema.index({ vehicleType: 1, isActive: 1 });
pricingConfigSchema.index({ validFrom: 1, validTo: 1 });

// Update the updatedAt field before saving
pricingConfigSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Static method to get active pricing for a vehicle type
pricingConfigSchema.statics.getActivePricing = function (vehicleType) {
    const now = new Date();
    return this.findOne({
        vehicleType: vehicleType,
        isActive: true,
        validFrom: { $lte: now },
        $or: [
            { validTo: null },
            { validTo: { $gte: now } }
        ]
    });
};

// Static method to get all active pricing configurations
pricingConfigSchema.statics.getAllActivePricing = function () {
    const now = new Date();
    return this.find({
        isActive: true,
        validFrom: { $lte: now },
        $or: [
            { validTo: null },
            { validTo: { $gte: now } }
        ]
    });
};

// Instance method to calculate distance-based pricing
pricingConfigSchema.methods.calculateDistancePricing = function (distanceKm) {
    const basePrice = this.baseRate;
    const distancePrice = distanceKm * this.perKmRate;
    const totalPrice = basePrice + distancePrice;

    return {
        baseRate: this.baseRate,
        perKmRate: this.perKmRate,
        distance: distanceKm,
        distancePrice: distancePrice,
        subtotal: totalPrice,
        minimumCharge: this.minimumCharge,
        finalPrice: Math.max(totalPrice, this.minimumCharge),
        currency: this.currency
    };
};

// Instance method to calculate hourly pricing
pricingConfigSchema.methods.calculateHourlyPricing = function (hours) {
    const basePrice = this.baseRate;
    const hourlyPrice = hours * this.perHourRate;
    const totalPrice = basePrice + hourlyPrice;

    return {
        baseRate: this.baseRate,
        perHourRate: this.perHourRate,
        hours: hours,
        hourlyPrice: hourlyPrice,
        subtotal: totalPrice,
        minimumCharge: this.minimumCharge,
        finalPrice: Math.max(totalPrice, this.minimumCharge),
        currency: this.currency
    };
};

// Instance method to apply surge pricing
pricingConfigSchema.methods.applySurgePricing = function (basePrice, isPeakHour = false, isWeekend = false, isHoliday = false) {
    let multiplier = this.surgeMultiplier;

    if (isPeakHour) {
        multiplier *= this.peakHours.multiplier;
    }

    if (isWeekend) {
        multiplier *= this.weekendMultiplier;
    }

    if (isHoliday) {
        multiplier *= this.holidayMultiplier;
    }

    return {
        basePrice: basePrice,
        surgeMultiplier: multiplier,
        finalPrice: Math.round(basePrice * multiplier * 100) / 100,
        currency: this.currency,
        appliedFactors: {
            peakHour: isPeakHour,
            weekend: isWeekend,
            holiday: isHoliday
        }
    };
};

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);
