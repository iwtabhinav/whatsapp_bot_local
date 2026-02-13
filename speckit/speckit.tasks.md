# WhatsApp Booking – SpecKit Tasks

**Source:** speckit.plan.md  
**Implementation order:** 5 → 2 → 3 → 1 → 4 → 6

---

## Task 1: Change Data / No-Change Return to Confirmation (Phase 5)

- [ ] **1.1** In `UltraRobustWhatsAppBot.js`, when the last sent message was the edit-options list (e.g. store a flag like `session.data.lastSentEditOptions = true` when sending edit options).
- [ ] **1.2** In text message handler, if `session.data.lastSentEditOptions` is true and message text matches "no change" / "no" / "back" / "cancel edit" / "keep as is" / "done" (case-insensitive), clear editing state and `lastSentEditOptions`, then call `showBookingConfirmation(jid, phoneNumber)`.
- [ ] **1.3** Clear `lastSentEditOptions` when sending confirmation, or when starting a new edit of a specific field, so only the immediate reply to edit menu is treated as "no change".
- [ ] **1.4** Optionally rename or add list row so "Change Data" / "No changes" is obvious (e.g. keep "✅ Move to Confirmation" and add description "No changes – return to confirmation").

**Files:** `src/UltraRobustWhatsAppBot.js`

---

## Task 2: Pickup Date & Time – Mandatory Capture and Validation (Phase 2)

- [ ] **2.1** Add `pickupDate` and `pickupTime` (or single `pickupDateTime`) to `getRequiredFieldsForBookingType()` for both Hourly and Transfer (e.g. after `pickupLocation`).
- [ ] **2.2** Add `askForPickupDateTime(jid, phoneNumber)` and a step that sends a single prompt for "When do you need the pickup? (e.g. 15 Jan 2025 14:30 or tomorrow 3pm)".
- [ ] **2.3** Add validation for date/time: parse with moment or similar; reject past; optionally cap future (e.g. 1 year); store in `session.data.pickupDate` / `session.data.pickupTime` or `session.data.pickupDateTime`.
- [ ] **2.4** Add `getFieldStep('pickupDateTime')` (or pickupDate/pickupTime) and handle in `askForMissingField` and `validateInput` (new step for date/time).
- [ ] **2.5** Show pickup date and time in `formatBookingConfirmation()`.
- [ ] **2.6** When creating/saving booking to DB, set `pickupTime` from session (combined date+time).
- [ ] **2.7** Add "Edit pickup date/time" to `showEditOptions()` and handle listId `edit_pickup_datetime`: set editing field, call `askForPickupDateTime`, then on valid input update session and show edit options or confirmation.
- [ ] **2.8** Before showing confirmation, if pickup date/time is missing, ask with a clear fallback message instead of confirming.

**Files:** `src/UltraRobustWhatsAppBot.js`

---

## Task 3: Passenger & Luggage Capacity Validation (Phase 3)

- [ ] **3.1** Define vehicle capacity map in bot (e.g. `VEHICLE_CAPACITY = { Sedan: { passengers: 4, luggage: 3 }, SUV: { passengers: 6, luggage: 4 }, Luxury: { passengers: 4, luggage: 3 }, Van: { passengers: 8, luggage: 6 } }`).
- [ ] **3.2** Add helper to parse luggage count from `session.data.luggageInfo` (e.g. "3 pieces" → 3, "5+ pieces" → 5).
- [ ] **3.3** Before showing confirmation (or after collecting passengers and luggage), check: `passengerCount <= capacity.passengers && luggageCount <= capacity.luggage`. If not, do not show confirmation.
- [ ] **3.4** When over capacity, send message: "The selected vehicle (X) cannot accommodate [N] passengers and [M] luggage."
- [ ] **3.5** Offer two options (list or buttons): "Add an additional vehicle" and "Change the vehicle". "Change the vehicle" → show vehicle type menu again and re-validate after selection. "Add an additional vehicle" → document or simple flow (e.g. "Noted; we'll arrange an extra vehicle" and then show confirmation, or trigger second booking – per product decision).
- [ ] **3.6** After changing vehicle, re-run capacity check before confirmation.

**Files:** `src/UltraRobustWhatsAppBot.js`

---

## Task 4: Concierge Level 2 Registration – Invite Concierge (Phase 1)

- [ ] **4.1** In message handler, detect trigger phrase "Invite Concierge" (case-insensitive). Resolve sender by phone to Concierge; if not found or `tier !== 1`, reply that only Level 1 concierges can invite.
- [ ] **4.2** Start invite flow: set session or state `inviteConcierge: { step: 'phone' }`. Reply asking for new concierge’s mobile number.
- [ ] **4.3** On reply in step `phone`: validate phone format; check `Concierge.findByPhone(normalized)`; if exists, say already registered; else store phone, set step to `details`, ask for name, then email, then PayPal email (or one message: "Please send: Name, Email, PayPal email" and parse).
- [ ] **4.4** Call `conciergeService.createConcierge({ name, email, phone, paypalEmail, uplineId: currentConcierge._id, tier: 2 })`. On success, send confirmation to inviter.
- [ ] **4.5** Send welcome message to new concierge’s number: Terms & Conditions + basic usage instructions (content from config or constant). Then clear invite state.
- [ ] **4.6** Ensure normal booking flow is not used while `inviteConcierge` state is set (check at top of booking flow).

**Files:** `src/UltraRobustWhatsAppBot.js`, `src/services/conciergeService.js` (optional helper), config or constants for T&C and usage text.

---

## Task 5: Voice Booking – NLP and Mandatory Follow-up (Phase 4)

- [ ] **5.1** In voice message handler: get audio → `openaiService.transcribeAudio()` → text. Call `openaiService.extractBookingInfo(text, context)` with full context (required fields, vehicle options).
- [ ] **5.2** Map extracted fields into session (pickupLocation, dropLocation, pickupTime, pickupDate, numberOfPassengers, luggageInfo from luggageDetails, etc.). Create or update session as needed.
- [ ] **5.3** In `openaiService.js`, update extraction prompt for voice: emphasize pickup date, pickup time, number of passengers, number of luggage items; add examples for spoken phrases.
- [ ] **5.4** After applying voice extraction, call same missing-fields logic: `getMissingFieldsForSession(session)`. If any missing (including pickup date/time, passengers, luggage), send fallback questions (e.g. "When do you need the pickup?" or "How many passengers?") and continue linear flow until complete.
- [ ] **5.5** Run capacity validation (Task 3) before confirmation for voice-originated bookings as well.

**Files:** `src/UltraRobustWhatsAppBot.js`, `src/services/openaiService.js`

---

## Task 6: Robustness and Fallbacks (Phase 6)

- [ ] **6.1** Ensure every required field has a clear fallback question when missing (pickup date/time, passenger count, luggage, etc.).
- [ ] **6.2** Consistently clear `isEditing` and `editingField` when returning to confirmation (no-change path and "Move to Confirmation").
- [ ] **6.3** Review state transitions so that after edit completion we never leave user without a next step (always show edit options or confirmation).

**Files:** `src/UltraRobustWhatsAppBot.js`

---

## Summary Checklist

| # | Task | Status |
|---|------|--------|
| 1 | Change Data / no-change return | Pending |
| 2 | Pickup date/time capture & validation | Pending |
| 3 | Passenger & luggage capacity | Pending |
| 4 | Invite Concierge (L2 registration) | Pending |
| 5 | Voice NLP & mandatory follow-up | Pending |
| 6 | Robustness & fallbacks | Pending |

Complete in order: 1 → 2 → 3 → 4 → 5 → 6 (or 1 → 2 → 3 → 4 in any order, then 5 and 6).
