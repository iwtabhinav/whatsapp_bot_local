const PricingConfig = require('../models/PricingConfig');
const axios = require('axios');

class PricingService {
    constructor() {
        this.pricingCache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    }

    // Get pricing configuration for a vehicle type
    async getPricingConfig(vehicleType) {
        try {
            // Check cache first
            const cacheKey = `pricing_${vehicleType}`;
            const cached = this.pricingCache.get(cacheKey);

            if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
                return cached.data;
            }

            // Check if database is connected
            if (!PricingConfig || !PricingConfig.getActivePricing) {
                console.log('⚠️ PricingConfig not available, using default pricing');
                return this.getDefaultPricing(vehicleType);
            }

            // Check database connection status
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.log('⚠️ Database not connected, using default pricing');
                return this.getDefaultPricing(vehicleType);
            }

            // Fetch from database with timeout
            const pricing = await Promise.race([
                PricingConfig.getActivePricing(vehicleType),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Database timeout')), 5000)
                )
            ]);

            if (!pricing) {
                // Return default pricing if not found in database
                console.log('⚠️ No pricing found in database, using default pricing');
                return this.getDefaultPricing(vehicleType);
            }

            // Cache the result
            this.pricingCache.set(cacheKey, {
                data: pricing,
                timestamp: Date.now()
            });

            console.log(`✅ Pricing config loaded for ${vehicleType}`);
            return pricing;
        } catch (error) {
            console.error('❌ Error fetching pricing config:', error);
            console.log('🔄 Using fallback pricing for', vehicleType);
            return this.getDefaultPricing(vehicleType);
        }
    }

    // Get default pricing configuration
    getDefaultPricing(vehicleType) {
        const defaultPricing = {
            'Sedan': {
                baseRate: 120,
                perKmRate: 3,
                perHourRate: 25,
                minimumCharge: 120,
                currency: 'AED',
                surgeMultiplier: 1.0,
                peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                weekendMultiplier: 1.1,
                holidayMultiplier: 1.3
            },
            'SUV': {
                baseRate: 180,
                perKmRate: 4,
                perHourRate: 35,
                minimumCharge: 180,
                currency: 'AED',
                surgeMultiplier: 1.0,
                peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                weekendMultiplier: 1.1,
                holidayMultiplier: 1.3
            },
            'Luxury': {
                baseRate: 350,
                perKmRate: 8,
                perHourRate: 60,
                minimumCharge: 350,
                currency: 'AED',
                surgeMultiplier: 1.0,
                peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                weekendMultiplier: 1.1,
                holidayMultiplier: 1.3
            },
            'Van': {
                baseRate: 220,
                perKmRate: 5,
                perHourRate: 40,
                minimumCharge: 220,
                currency: 'AED',
                surgeMultiplier: 1.0,
                peakHours: { start: '07:00', end: '09:00', multiplier: 1.2 },
                weekendMultiplier: 1.1,
                holidayMultiplier: 1.3
            }
        };

        return defaultPricing[vehicleType] || defaultPricing['Sedan'];
    }

    // Calculate distance between two coordinates using Google Maps API
    async calculateDistance(origin, destination) {
        try {
            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            if (!apiKey) {
                console.log('⚠️ Google Maps API key not found, using estimated distance');
                return this.estimateDistance(origin, destination);
            }

            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                params: {
                    origins: `${origin.latitude},${origin.longitude}`,
                    destinations: `${destination.latitude},${destination.longitude}`,
                    units: 'metric',
                    key: apiKey
                }
            });

            if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
                const element = response.data.rows[0].elements[0];
                return {
                    distance: element.distance.value / 1000, // Convert to km
                    duration: element.duration.value / 60, // Convert to minutes
                    status: 'success'
                };
            } else {
                console.log('⚠️ Google Maps API error, using estimated distance');
                return this.estimateDistance(origin, destination);
            }
        } catch (error) {
            console.error('❌ Error calculating distance:', error);
            return this.estimateDistance(origin, destination);
        }
    }

    // Estimate distance using Haversine formula
    estimateDistance(origin, destination) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRadians(destination.latitude - origin.latitude);
        const dLon = this.toRadians(destination.longitude - origin.longitude);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRadians(origin.latitude)) * Math.cos(this.toRadians(destination.latitude)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        // Estimate duration (assuming average speed of 30 km/h in city)
        const duration = (distance / 30) * 60;

        return {
            distance: Math.round(distance * 10) / 10,
            duration: Math.round(duration),
            status: 'estimated'
        };
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Calculate pricing for transfer booking
    async calculateTransferPricing(vehicleType, pickupLocation, dropLocation) {
        try {
            const pricing = await this.getPricingConfig(vehicleType);

            // Calculate distance
            const distanceInfo = await this.calculateDistance(pickupLocation, dropLocation);

            // Calculate base pricing
            const basePricing = pricing.calculateDistancePricing ?
                pricing.calculateDistancePricing(distanceInfo.distance) :
                this.calculateDistancePricingBase(pricing, distanceInfo.distance);

            // Apply surge pricing
            const isPeakHour = this.isPeakHour();
            const isWeekend = this.isWeekend();
            const isHoliday = await this.isHoliday();

            const finalPricing = pricing.applySurgePricing ?
                pricing.applySurgePricing(basePricing.finalPrice, isPeakHour, isWeekend, isHoliday) :
                this.applySurgePricing(pricing, basePricing.finalPrice, isPeakHour, isWeekend, isHoliday);

            return {
                ...basePricing,
                ...finalPricing,
                distanceInfo: distanceInfo,
                bookingType: 'Transfer',
                calculatedAt: new Date()
            };
        } catch (error) {
            console.error('❌ Error calculating transfer pricing:', error);
            return this.getDefaultTransferPricing(vehicleType);
        }
    }

    // Calculate pricing for hourly booking
    async calculateHourlyPricing(vehicleType, hours) {
        try {
            const pricing = await this.getPricingConfig(vehicleType);

            // Calculate base pricing
            const basePricing = pricing.calculateHourlyPricing ?
                pricing.calculateHourlyPricing(hours) :
                this.calculateHourlyPricingBase(pricing, hours);

            // Apply surge pricing
            const isPeakHour = this.isPeakHour();
            const isWeekend = this.isWeekend();
            const isHoliday = await this.isHoliday();

            const finalPricing = pricing.applySurgePricing ?
                pricing.applySurgePricing(basePricing.finalPrice, isPeakHour, isWeekend, isHoliday) :
                this.applySurgePricing(pricing, basePricing.finalPrice, isPeakHour, isWeekend, isHoliday);

            return {
                ...basePricing,
                ...finalPricing,
                bookingType: 'Hourly',
                calculatedAt: new Date()
            };
        } catch (error) {
            console.error('❌ Error calculating hourly pricing:', error);
            return this.getDefaultHourlyPricing(vehicleType, hours);
        }
    }

    // Calculate distance-based pricing base
    calculateDistancePricingBase(pricing, distanceKm) {
        const basePrice = pricing.baseRate;
        const distancePrice = distanceKm * pricing.perKmRate;
        const totalPrice = basePrice + distancePrice;

        return {
            baseRate: pricing.baseRate,
            perKmRate: pricing.perKmRate,
            distance: distanceKm,
            distancePrice: distancePrice,
            subtotal: totalPrice,
            minimumCharge: pricing.minimumCharge,
            finalPrice: Math.max(totalPrice, pricing.minimumCharge),
            currency: pricing.currency
        };
    }

    // Calculate hourly pricing base
    calculateHourlyPricingBase(pricing, hours) {
        const basePrice = pricing.baseRate;
        const hourlyPrice = hours * pricing.perHourRate;
        const totalPrice = basePrice + hourlyPrice;

        return {
            baseRate: pricing.baseRate,
            perHourRate: pricing.perHourRate,
            hours: hours,
            hourlyPrice: hourlyPrice,
            subtotal: totalPrice,
            minimumCharge: pricing.minimumCharge,
            finalPrice: Math.max(totalPrice, pricing.minimumCharge),
            currency: pricing.currency
        };
    }

    // Apply surge pricing
    applySurgePricing(pricing, basePrice, isPeakHour, isWeekend, isHoliday) {
        let multiplier = pricing.surgeMultiplier || 1.0;

        if (isPeakHour) {
            multiplier *= (pricing.peakHours?.multiplier || 1.2);
        }

        if (isWeekend) {
            multiplier *= (pricing.weekendMultiplier || 1.1);
        }

        if (isHoliday) {
            multiplier *= (pricing.holidayMultiplier || 1.3);
        }

        return {
            basePrice: basePrice,
            surgeMultiplier: multiplier,
            finalPrice: Math.round(basePrice * multiplier * 100) / 100,
            currency: pricing.currency,
            appliedFactors: {
                peakHour: isPeakHour,
                weekend: isWeekend,
                holiday: isHoliday
            }
        };
    }

    // Check if current time is peak hour
    isPeakHour() {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);
        const currentDay = now.getDay();

        // Peak hours: 7:00-9:00 AM and 5:00-7:00 PM, Monday to Friday
        const isWeekday = currentDay >= 1 && currentDay <= 5;
        const isMorningPeak = currentTime >= '07:00' && currentTime <= '09:00';
        const isEveningPeak = currentTime >= '17:00' && currentTime <= '19:00';

        return isWeekday && (isMorningPeak || isEveningPeak);
    }

    // Check if current day is weekend
    isWeekend() {
        const now = new Date();
        const currentDay = now.getDay();
        return currentDay === 0 || currentDay === 6; // Sunday or Saturday
    }

    // Check if current day is holiday (simplified - in real app, use holiday API)
    async isHoliday() {
        // This is a simplified implementation
        // In a real app, you would check against a holiday API or database
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();

        // UAE National Day
        if (month === 12 && day === 2) return true;

        // New Year's Day
        if (month === 1 && day === 1) return true;

        // Eid al-Fitr and Eid al-Adha (simplified dates)
        // In real app, use Islamic calendar API

        return false;
    }

    // Get default transfer pricing
    getDefaultTransferPricing(vehicleType) {
        const defaultPricing = this.getDefaultPricing(vehicleType);
        return {
            baseRate: defaultPricing.baseRate,
            perKmRate: defaultPricing.perKmRate,
            distance: 25, // Default estimated distance
            distancePrice: 25 * defaultPricing.perKmRate,
            subtotal: defaultPricing.baseRate + (25 * defaultPricing.perKmRate),
            minimumCharge: defaultPricing.minimumCharge,
            finalPrice: Math.max(defaultPricing.baseRate + (25 * defaultPricing.perKmRate), defaultPricing.minimumCharge),
            currency: defaultPricing.currency,
            bookingType: 'Transfer',
            status: 'estimated'
        };
    }

    // Get default hourly pricing
    getDefaultHourlyPricing(vehicleType, hours) {
        const defaultPricing = this.getDefaultPricing(vehicleType);
        return {
            baseRate: defaultPricing.baseRate,
            perHourRate: defaultPricing.perHourRate,
            hours: hours,
            hourlyPrice: hours * defaultPricing.perHourRate,
            subtotal: defaultPricing.baseRate + (hours * defaultPricing.perHourRate),
            minimumCharge: defaultPricing.minimumCharge,
            finalPrice: Math.max(defaultPricing.baseRate + (hours * defaultPricing.perHourRate), defaultPricing.minimumCharge),
            currency: defaultPricing.currency,
            bookingType: 'Hourly',
            status: 'estimated'
        };
    }

    // Clear pricing cache
    clearCache() {
        this.pricingCache.clear();
    }
}

module.exports = PricingService;
