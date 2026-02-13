# WhatsApp Booking – SpecKit Plan

**Reference:** WhatsApp Booking.md, speckit.analyze.md

---

## Phase 1: Concierge Level 2 Registration (Invite Concierge)

1. **Trigger**
   - In `UltraRobustWhatsAppBot.js`, detect phrase "Invite Concierge" (case-insensitive, from whitelisted number).
   - Resolve sender to concierge; allow only if `tier === 1` (Level 1).

2. **Flow**
   - Reply asking for new concierge’s **mobile number**.
   - Then ask **basic details**: name, email, PayPal email (reuse Concierge model fields).
   - On collect: validate phone format; check phone not already registered.

3. **Backend**
   - Call `conciergeService.createConcierge({ name, email, phone, paypalEmail, uplineId: currentConcierge._id, tier: 2 })`.
   - Optional: add `conciergeService.registerConciergeByInvite(inviterPhone, { phone, name, email, paypalEmail })` that does lookup + create + link upline.

4. **Welcome**
   - After successful registration, send **welcome message** to the **new** concierge’s phone (via WhatsApp): Terms & Conditions + basic usage instructions. Content can be in config or constant in bot.

5. **State**
   - Use a small state machine or session flag for "invite_concierge" (step: phone → details → done) so normal booking flow is not used during invite.

---

## Phase 2: Pickup Date & Time Capture and Validation

1. **Required fields**
   - Add `pickupDate` and `pickupTime` to `getRequiredFieldsForBookingType()` for both booking types (order: e.g. after pickupLocation, before or with other fields so confirmation has date/time).

2. **Step in flow**
   - Add step "pickup date & time": e.g. `askForPickupDateTime(jid, phoneNumber)`.
   - Prompt: ask for date and time (e.g. "When do you need the pickup? (Date and time, e.g. 15 Jan 2025 14:30)").
   - Parse with a small parser or library (e.g. moment): accept "tomorrow 3pm", "15/01/2025 14:30", etc.; store as `session.data.pickupDate`, `session.data.pickupTime` (or single `pickupDateTime` ISO string).

3. **Validation**
   - Reject past date/time; optionally reject too far in future (e.g. 1 year).
   - Before showing confirmation, require both pickup date and time (mandatory validation).

4. **Confirmation & DB**
   - Show pickup date/time in `formatBookingConfirmation()`.
   - When creating `Booking`, set `pickupTime: new Date(session.data.pickupDateTime)` (or combine date+time from session).

5. **Edit**
   - Add "Edit pickup date/time" to `showEditOptions()` and handle like other edit fields (ask again → validate → update → show edit options or confirmation).

6. **Fallback**
   - If missing at confirmation, don’t show confirm; ask for pickup date/time with a clear fallback question.

---

## Phase 3: Passenger & Luggage Capacity Validation

1. **Capacity matrix**
   - Define in bot or config, e.g.:
     - Sedan: passengers 4, luggage 3
     - SUV: passengers 6, luggage 4
     - Luxury: passengers 4, luggage 3
     - Van: passengers 8, luggage 6

2. **When to check**
   - After vehicle type, passenger count, and luggage are set (e.g. when moving to confirmation or after luggage step).
   - If `passengerCount > capacity.passengers` OR luggage count > `capacity.luggage`: do not proceed to confirmation.

3. **Message**
   - Send clear message: "The selected vehicle (e.g. Sedan) cannot accommodate X passengers and Y luggage."

4. **Options**
   - Offer two choices (e.g. list or buttons):
     - "Add an additional vehicle"
     - "Change the vehicle to one that can accommodate passengers and luggage"
   - "Add vehicle" → duplicate or multi-vehicle logic (can be simplified to "we’ll note you need another vehicle" and continue, or start a second booking).
   - "Change vehicle" → go back to vehicle selection and re-collect passengers/luggage if needed, then re-check capacity.

5. **Luggage count**
   - Derive number from `session.data.luggageInfo` (e.g. "3 pieces" → 3); handle "5+ pieces" as 5 for validation.

---

## Phase 4: Voice Booking Improvements

1. **Pipeline**
   - On voice message: transcribe via `openaiService.transcribeAudio()` → get text → call `extractBookingInfo(text, context)` with rich context (vehicle options, required fields).
   - Map extracted fields into session (pickupLocation, dropLocation, pickupTime, pickupDate, numberOfPassengers, luggageDetails, etc.).

2. **NLP prompt**
   - In `openaiService.js`, strengthen extraction prompt for voice: explicit instructions for date/time (pickup date, pickup time), passenger count, luggage count; examples for natural speech.

3. **Mandatory follow-up**
   - After applying extracted data, run same "missing fields" logic as text flow (`getMissingFieldsForSession`); if anything missing (including pickup date/time, passengers, luggage), ask with clear fallback questions (e.g. "You didn’t mention pickup date and time. When do you need the pickup?").

4. **Consistency**
   - Use same required fields and validation as text flow (including Phase 2 and Phase 3) so voice and text end up with same data quality.

---

## Phase 5: Booking Modification (Change Data) – No-Change Return

1. **Current**
   - User selects "Edit Details" (Change Data) → `showEditOptions()` with list including "✅ Move to Confirmation". Selecting "Move to Confirmation" clears edit state and shows confirmation. Good.

2. **Improvements**
   - When in "edit options" context (e.g. we just showed edit list and next message is text):
     - If user sends text like "no change", "no", "back", "cancel edit", "keep as is", "done": treat as "no change" → clear editing state and call `showBookingConfirmation()`.
   - Optionally: add an explicit list row "No changes / Back to confirmation" with id `move_to_confirmation` (already have "Move to Confirmation"; ensure list title/description makes it clear this is "no change" path).
   - Ensure after any edit completion we only show edit options or confirmation, never leave flow stuck.

3. **State**
   - Track that we are in "edit menu" state so the next text message can be interpreted as "no change" when appropriate; avoid treating random text as booking field.

---

## Phase 6: General Robustness

- **Mandatory validation:** All required fields (including pickup date, time, passenger count, luggage) must be present and valid before confirmation; otherwise ask with fallback question.
- **State handling:** On "no change" or "back" from edit, always clear `isEditing` / `editingField` and return to confirmation (or main menu if that’s the product requirement).
- **Copy:** Use clear, consistent messages for missing data and capacity overflow.

---

## Implementation Order (recommended)

1. **Phase 5** (no-change return) – quick win, reduces broken flows.
2. **Phase 2** (pickup date/time) – unblocks proper confirmation and DB.
3. **Phase 3** (capacity) – depends on having passengers/luggage (and optionally date/time).
4. **Phase 1** (Invite Concierge) – independent feature.
5. **Phase 4** (voice) – improves existing voice path using same required fields and validation as 2 and 3.
6. **Phase 6** – ongoing (fallback messages, state checks) while doing 2–4.

This order addresses the spec issues one by one and keeps dependencies manageable.
