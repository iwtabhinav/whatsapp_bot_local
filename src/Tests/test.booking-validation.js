/**
 * Tests for WhatsApp Booking validation helpers (no-change reply, capacity, pickup date/time, phone).
 * Run: node src/Tests/test.booking-validation.js
 * Or: npm test
 */
const assert = require('assert');
const {
    isNoChangeEditReply,
    normalizePhoneForConcierge,
    getVehicleCapacityMap,
    parseLuggageCountFromSession,
    checkVehicleCapacity,
    parsePickupDateTime
} = require('../utils/bookingValidation');

function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

// --- isNoChangeEditReply ---
function testNoChangeEditReply() {
    ok(isNoChangeEditReply('no change'), 'no change');
    ok(isNoChangeEditReply('No Change'), 'No Change');
    ok(isNoChangeEditReply('back'), 'back');
    ok(isNoChangeEditReply('done'), 'done');
    ok(isNoChangeEditReply('  done  '), 'done trimmed');
    ok(isNoChangeEditReply("that's all"), "that's all");
    ok(!isNoChangeEditReply('yes'), 'yes is not no-change');
    ok(!isNoChangeEditReply('change my booking'), 'change my booking');
    ok(!isNoChangeEditReply(''), 'empty');
    ok(!isNoChangeEditReply(null), 'null');
    console.log('  isNoChangeEditReply: pass');
}

// --- normalizePhoneForConcierge ---
function testNormalizePhone() {
    ok(normalizePhoneForConcierge('971501234567') === '971501234567', 'digits only');
    ok(normalizePhoneForConcierge('+971 50 123 4567') === '971501234567', 'with spaces and +');
    ok(normalizePhoneForConcierge('501234567') === '501234567', '9 digits');
    ok(normalizePhoneForConcierge('123') === null, 'too short');
    ok(normalizePhoneForConcierge('abc') === null, 'no digits');
    console.log('  normalizePhoneForConcierge: pass');
}

// --- getVehicleCapacityMap ---
function testVehicleCapacityMap() {
    const map = getVehicleCapacityMap();
    ok(map.Sedan.passengers === 4 && map.Sedan.luggage === 3, 'Sedan');
    ok(map.SUV.passengers === 6 && map.SUV.luggage === 4, 'SUV');
    ok(map.Van.passengers === 8 && map.Van.luggage === 6, 'Van');
    console.log('  getVehicleCapacityMap: pass');
}

// --- parseLuggageCountFromSession ---
function testParseLuggageCount() {
    ok(parseLuggageCountFromSession({ data: { luggageInfo: '3 pieces' } }) === 3, '3 pieces');
    ok(parseLuggageCountFromSession({ data: { luggageInfo: '2 bags' } }) === 2, '2 bags');
    ok(parseLuggageCountFromSession({ data: { luggageInfo: '5' } }) === 5, '5 only');
    ok(parseLuggageCountFromSession({ data: {} }) === 0, 'no luggageInfo');
    ok(parseLuggageCountFromSession({ data: { luggageInfo: '12 pieces' } }) === 10, 'capped at 10');
    console.log('  parseLuggageCountFromSession: pass');
}

// --- checkVehicleCapacity ---
function testCheckVehicleCapacity() {
    const sessionSedanOk = { data: { vehicleType: 'Sedan', passengerCount: '3', luggageInfo: '2 pieces' } };
    const r1 = checkVehicleCapacity(sessionSedanOk);
    ok(r1.valid === true, 'Sedan 3 pax 2 luggage valid');

    const sessionSedanOver = { data: { vehicleType: 'Sedan', passengerCount: '5', luggageInfo: '2 pieces' } };
    const r2 = checkVehicleCapacity(sessionSedanOver);
    ok(r2.valid === false && r2.vehicleType === 'Sedan' && r2.passengers === 5, 'Sedan 5 pax invalid');

    const sessionVanOk = { data: { vehicleType: 'Van', passengerCount: '8', luggageInfo: '6 pieces' } };
    ok(checkVehicleCapacity(sessionVanOk).valid === true, 'Van 8 pax 6 luggage valid');

    const sessionNoVehicle = { data: { passengerCount: '2' } };
    ok(checkVehicleCapacity(sessionNoVehicle).valid === true, 'no vehicle type => valid');
    console.log('  checkVehicleCapacity: pass');
}

// --- parsePickupDateTime ---
function testParsePickupDateTime() {
    const m1 = parsePickupDateTime('2025-12-25T14:30:00.000Z');
    ok(m1 && m1.isValid(), 'ISO date valid');

    const m2 = parsePickupDateTime('25/12/2025 14:30');
    ok(m2 && m2.isValid(), 'DD/MM/YYYY HH:mm');

    const m3 = parsePickupDateTime('tomorrow 3pm');
    ok(m3 && m3.isValid(), 'tomorrow 3pm');

    const m4 = parsePickupDateTime('invalid');
    ok(m4 === null, 'invalid returns null');

    ok(parsePickupDateTime('') === null, 'empty returns null');
    ok(parsePickupDateTime(null) === null, 'null returns null');
    console.log('  parsePickupDateTime: pass');
}

// --- run all ---
function run() {
    console.log('Booking validation tests:\n');
    testNoChangeEditReply();
    testNormalizePhone();
    testVehicleCapacityMap();
    testParseLuggageCount();
    testCheckVehicleCapacity();
    testParsePickupDateTime();
    console.log('\nAll tests passed.');
}

run();
