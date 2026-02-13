# WhatsApp Booking – SpecKit Analysis

**Source:** WhatsApp Booking.md (Additional Requirements & Issues)  
**Date:** 2025-02-12

## 1. Current Codebase Overview

### 1.1 Entry Points & Bot Flow
- **Main bot:** `src/UltraRobustWhatsAppBot.js` (loaded by `src/web-server.js` via `require('./UltraRobustWhatsAppBot')`).
- **Startup:** `start-ai-bot.js` starts the system; WhatsApp handling lives in `UltraRobustWhatsAppBot.js`.
- **Session/state:** `src/services/bookingManager.js` (sessions), `src/services/sessionManager.js`.
- **Concierge:** `src/models/Concierge.js` (has `tier: [1, 2]`, `uplineId`, `directReferrals`), `src/services/conciergeService.js` (createConcierge, getConcierge by phone/id).

### 1.2 Booking Flow (UltraRobustWhatsAppBot.js)
- **Required fields (current):** `getRequiredFieldsForBookingType()` returns:
  - Base: `bookingType`, `vehicleType`, `customerName`, `pickupLocation`
  - Transfer: + `dropLocation`, `luggageInfo`
  - Hourly: + `numberOfHours`, `luggageInfo`
- **Missing from required:** `pickupDate` and `pickupTime` are **not** in required fields; they appear in AI context and in `formatBookingConfirmation` / DB mapping but are not collected in the step-by-step flow. Session defaults: `pickupTime: session.data.pickupTime || new Date()` when saving.
- **Edit flow:** "Edit Details" → `showEditOptions()` → list of fields to edit. Option "✅ Move to Confirmation" (`move_to_confirmation`) exists and is handled: clears editing state and calls `showBookingConfirmation()`. So "no change" is already supported **if** the user selects "Move to Confirmation". The spec’s "Change Data" likely refers to this edit list; possible gaps: (1) user doesn’t select any list item and sends a text reply, or (2) list title says "Edit" but spec says "Change Data" (wording). Need to ensure any "no change" path (e.g. text like "no change" / "back") also returns to confirmation.

### 1.3 Voice & NLP
- **Voice:** `src/services/openaiService.js`: `transcribeAudio()`, `extractBookingInfo(text, context)`.
- **Extraction:** OpenAI used for JSON extraction; prompt includes pickupTime, pickupDate, numberOfPassengers, luggageDetails. Voice flow: user sends voice → must be transcribed → then extraction; if transcription is poor or extraction skips fields, voice bookings will miss data.
- **Whisper:** Used for transcription (openaiService); no project-specific tuning for booking phrases.

### 1.4 Vehicle Capacity
- **Current:** No vehicle capacity checks found. `Booking` model has `numberOfPassengers`; vehicle type is Sedan/SUV/Luxury/Van. No validation that passengers/luggage ≤ vehicle capacity before confirmation.

### 1.5 Concierge Registration
- **Current:** Concierge created via `conciergeService.createConcierge()` with `uplineId` and `tier: 2` when upline present. No WhatsApp trigger "Invite Concierge" or flow that collects mobile + details and sends welcome (T&C, usage) to new concierge.

---

## 2. Issues Mapped to Code

| # | Spec issue | Where it appears / cause |
|---|------------|---------------------------|
| 1 | Concierge L2 registration via WhatsApp | Not implemented. Need trigger "Invite Concierge", collect phone + details, call backend, send welcome + T&C. |
| 2 | Pickup date/time not captured in some bookings | `pickupDate`/`pickupTime` not in `getRequiredFieldsForBookingType()`; not asked in linear flow; only from AI extraction or default `new Date()`. |
| 3 | Voice bookings don’t capture full message / timings, pax, luggage | Depends on transcription + extraction; no mandatory follow-up for missing fields; extraction prompt could be tuned for voice. |
| 4 | Passenger & luggage capacity validation | Absent. Need vehicle capacity matrix and check before confirmation; offer "add vehicle" or "change vehicle". |
| 5 | Change Data → no change → bot doesn’t return to flow | "Move to Confirmation" exists. Need to handle text like "no change"/"back"/"cancel" from edit menu and return to confirmation. |
| 6 | Mandatory validation & fallback questions | pickupDate, pickupTime, passenger count, luggage not enforced before confirmation; no clear fallback when missing. |
| 7 | Robust state handling | Edit state cleared on "Move to Confirmation"; ensure all "no change" exits clear editing and show confirmation. |

---

## 3. Files to Touch

| Area | Files |
|------|--------|
| Concierge L2 invite | `UltraRobustWhatsAppBot.js` (trigger + flow), `conciergeService.js` (optional: registerByPhone + welcome content), `conciergeRoutes.js` if API needed |
| Pickup date/time | `UltraRobustWhatsAppBot.js` (required fields, step, ask, validate, show in confirmation) |
| Voice / NLP | `openaiService.js` (extraction prompt, optional voice-specific prompt), `UltraRobustWhatsAppBot.js` (voice handler: transcribe → extract → fill session → ask missing) |
| Capacity | `UltraRobustWhatsAppBot.js` (capacity map, validation after vehicle/pax/luggage, message + add vehicle / change vehicle) |
| Edit / no-change | `UltraRobustWhatsAppBot.js` (handle "no change"/"back" in edit context → showBookingConfirmation) |
| Config / copy | `web-server.js` or config for welcome/T&C text for new concierge |

---

## 4. Dependencies & Order

1. **Concierge L2** – standalone (trigger, flow, backend, welcome).
2. **Pickup date/time** – add to required fields and flow; then confirmation and DB have real values.
3. **Capacity** – add after pickup date/time (validation before confirmation).
4. **Voice** – improve extraction and mandatory follow-up for missing fields (uses same required fields as text flow).
5. **Edit no-change** – small behavioral fix in edit menu handling.

Implementing in this order keeps dependencies clear and allows testing step by step.
