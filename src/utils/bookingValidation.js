/**
 * Pure booking validation helpers (used by UltraRobustWhatsAppBot and tests).
 * No WhatsApp/DB dependencies.
 */
const moment = require('moment');

function isNoChangeEditReply(messageText) {
    if (!messageText || typeof messageText !== 'string') return false;
    const t = messageText.trim().toLowerCase();
    const noChangePhrases = [
        'no change', 'no changes', 'no', 'back', 'cancel edit', 'keep as is',
        'done', "that's all", 'nothing', 'skip', 'return', 'go back'
    ];
    return noChangePhrases.some(phrase => t === phrase || t.startsWith(phrase + ' ') || t.endsWith(' ' + phrase));
}

function normalizePhoneForConcierge(phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length >= 9) return digits;
    return null;
}

function getVehicleCapacityMap() {
    return {
        'Sedan': { passengers: 4, luggage: 3 },
        'SUV': { passengers: 6, luggage: 4 },
        'Luxury': { passengers: 4, luggage: 3 },
        'Van': { passengers: 8, luggage: 6 }
    };
}

function parseLuggageCountFromSession(session) {
    const info = session.data && session.data.luggageInfo;
    if (!info) return 0;
    const str = String(info).toLowerCase();
    const match = str.match(/(\d+)\s*(?:piece|bag|suitcase|luggage)/);
    if (match) return Math.min(parseInt(match[1], 10), 10);
    const numOnly = str.match(/(\d+)/);
    return numOnly ? Math.min(parseInt(numOnly[1], 10), 10) : 0;
}

function checkVehicleCapacity(session) {
    const vt = session.data && session.data.vehicleType;
    const capMap = getVehicleCapacityMap();
    const cap = vt ? capMap[vt] : null;
    if (!cap) return { valid: true };
    const passengers = parseInt(session.data.passengerCount, 10) || 0;
    const luggage = parseLuggageCountFromSession(session);
    const valid = passengers <= cap.passengers && luggage <= cap.luggage;
    return {
        valid,
        vehicleType: vt,
        passengers,
        luggage,
        capacity: cap,
        message: valid ? null : `The selected vehicle (${vt}) cannot accommodate ${passengers} passengers and ${luggage} luggage. Max for ${vt}: ${cap.passengers} passengers, ${cap.luggage} luggage.`
    };
}

/**
 * Returns vehicle types that can accommodate the given passenger and luggage count.
 * Used to show only SUV/larger options when user chooses "Change vehicle" after capacity overflow.
 */
function getVehiclesThatFitCapacity(passengers, luggage) {
    const capMap = getVehicleCapacityMap();
    const types = ['Sedan', 'SUV', 'Luxury', 'Van'];
    return types.filter(t => {
        const cap = capMap[t];
        return cap && passengers <= cap.passengers && luggage <= cap.luggage;
    });
}

function parsePickupDateTime(text) {
    if (!text || typeof text !== 'string') return null;
    const t = text.trim();
    let m = moment(t, [
        'DD/MM/YYYY HH:mm', 'DD-MM-YYYY HH:mm', 'YYYY-MM-DD HH:mm',
        'DD/MM/YYYY h:mm a', 'DD-MM-YYYY h a', 'D MMM YYYY HH:mm',
        'D MMM YYYY h a', 'D MMM YYYY h:mm a', 'DD MMM YYYY HH:mm',
        'YYYY-MM-DD', 'DD.MM.YYYY HH:mm'
    ], true);
    if (m.isValid()) return m;
    if (/tomorrow|tmr/i.test(t)) {
        m = moment().add(1, 'day');
        const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
            let h = parseInt(timeMatch[1]);
            const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            if (timeMatch[3]) {
                if (/pm/i.test(timeMatch[3]) && h < 12) h += 12;
                if (/am/i.test(timeMatch[3]) && h === 12) h = 0;
            }
            m.hour(h).minute(min).second(0).millisecond(0);
        }
        return m.isValid() ? m : null;
    }
    if (/today/i.test(t)) {
        m = moment();
        const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
            let h = parseInt(timeMatch[1]);
            const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            if (timeMatch[3]) {
                if (/pm/i.test(timeMatch[3]) && h < 12) h += 12;
                if (/am/i.test(timeMatch[3]) && h === 12) h = 0;
            }
            m.hour(h).minute(min).second(0).millisecond(0);
        }
        return m.isValid() ? m : null;
    }
    m = moment(t, moment.ISO_8601, true);
    return m.isValid() ? m : null;
}

module.exports = {
    isNoChangeEditReply,
    normalizePhoneForConcierge,
    getVehicleCapacityMap,
    parseLuggageCountFromSession,
    checkVehicleCapacity,
    getVehiclesThatFitCapacity,
    parsePickupDateTime
};
