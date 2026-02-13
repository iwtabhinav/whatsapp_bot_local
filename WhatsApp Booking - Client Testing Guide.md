## WhatsApp Booking – Flow of Changes -



## 1. Summary of Changes Made

| # | Change | What it does |
|---|--------|----------------|
| **A** | **Pickup date & time** | Bot now captures pickup date and time in all bookings (text and voice). You can also edit it from the confirmation screen. |
| **B** | **Voice booking** | Voice messages are transcribed and parsed for booking details (name, pickup, destination, date/time, passengers, luggage, vehicle). If something is missing, the bot asks for it step by step. |
| **C** | **Passenger & luggage capacity** | Before confirmation, if the selected vehicle cannot fit the passengers or luggage (e.g. Sedan with 6 passengers), the bot clearly says so and offers: **Add an additional vehicle** or **Change vehicle** to a larger one. |
| **D** | **Booking edit – “no change”** | When the concierge chooses “Edit Details” but then decides not to change anything (e.g. taps “Move to Confirmation” or types *no change*, *back*, *done*), the bot correctly returns to the **Booking Confirmation** screen instead of getting stuck. |
| **E** | **Invite Concierge (Level 2)** | A Level 1 concierge can type **Invite Concierge** in WhatsApp; the bot then asks for the new concierge’s number, name, email, and PayPal, registers them as Level 2, and sends a welcome message with T&C to the new number. |
| **F** | **Mandatory fields & fallbacks** | Before showing confirmation, the bot ensures pickup date/time, passengers, and luggage are captured. If any are missing (e.g. after voice), it asks for them one by one. |

---


### Test A – Pickup date & time

**Goal:** Confirm the bot captures and shows pickup date and time.

1. Start a new booking (e.g. type **book** or choose **Book Now**).
2. Go through: booking type → vehicle → customer name → pickup location → destination (if transfer) → when asked for **date/time**, send e.g. **tomorrow 3pm** or **15 Feb 2026 10:30**.
3. Continue until you reach **Booking Confirmation**.
4. **Expected:** The confirmation message includes a line like **Pickup Date & Time: [date], [time]** (e.g. 15 Feb 2026, 15:00).

---

### Test B – Voice booking

**Goal:** Confirm voice is transcribed and missing fields are asked for.

1. Start a new booking (e.g. **book** or **Book Now**).
2. When the bot expects booking details, **send a voice message** saying something like:  
   *“Airport transfer for John, pickup Business Bay, drop Dubai Airport, tomorrow 2pm, 3 passengers, 2 bags, Sedan.”*
3. **Expected:**  
   - Bot replies that it processed the voice and may ask for any missing details.  
   - It then asks only for what was not understood (e.g. if date was unclear, it asks for date/time).  
   - After that, it shows the **Booking Confirmation** with the details filled (name, pickup, drop, date/time, passengers, luggage, vehicle).

---

### Test C – Passenger & luggage capacity

**Goal:** When vehicle is too small, bot offers “Add vehicle” or “Change vehicle”.

1. Start a new booking.
2. Choose **Sedan** (max 4 passengers, 3 luggage).
3. When asked for passengers, send **6** (or more than 4).  
   When asked for luggage, send e.g. **2** (or send more than 3 to test luggage limit).
4. Complete any other steps until the bot is about to show confirmation.
5. **Expected:**  
   - Bot does **not** show the normal confirmation.  
   - It shows a message like: *“The selected vehicle (Sedan) cannot accommodate 6 passengers and X luggage…”*  
   - It shows two options: **Add an additional vehicle** and **Change vehicle**.  
   - Choosing **Add an additional vehicle** → bot confirms and then shows the normal Booking Confirmation.  
   - Choosing **Change vehicle** → bot shows the vehicle list again so you can pick e.g. Van.

**Capacity reference:** Sedan/Luxury: 4 passengers, 3 luggage. SUV: 6 passengers, 4 luggage. Van: 8 passengers, 6 luggage.

---

### Test D – Edit booking, then “no change”

**Goal:** After choosing “Edit Details”, choosing “no change” returns to confirmation.

1. Start a booking and go until you see the **Booking Confirmation** screen (with **Confirm & Pay**, **Edit Details**, **Cancel Booking**).
2. Tap **Edit Details** (or “Change Data”).
3. When the bot shows the list of what you can change (pickup, destination, date/time, vehicle, etc.) **do not** select any field. Instead do **one** of:
   - Tap **Move to Confirmation**, or  
   - Type: **no change** or **back** or **done**.
4. **Expected:**  
   - Bot shows the **same Booking Confirmation** screen again (no details changed).  
   - The conversation does not get stuck; you can then choose Confirm & Pay or Edit again.

---

### Test E – Invite Concierge (Level 2)

**Prerequisite:** Use a number that is registered in the **panel** as a **Level 1** concierge (and that number must be whitelisted so the bot accepts messages).

1. In the WhatsApp chat with the bot, type: **Invite Concierge**.
2. **Expected:**  
   - Bot replies with something like: *“Please send the mobile number of the new concierge (with country code, e.g. 971501234567).”*
3. Send the **new** concierge’s number (a number **not** already registered).
4. Bot asks for **full name** → send it.
5. Bot asks for **email** → send it.
6. Bot asks for **PayPal email** → send it.
7. **Expected:**  
   - Bot confirms that the concierge was registered and that a welcome message was sent.  
   - The **new** number receives a WhatsApp message from the bot with: welcome, Level 2 registration, Terms & Conditions, basic usage, and their Concierge ID.

**Check in panel (optional):** In **Concierges**, the new person should appear as Level 2 with the inviter set as upline.

**If you use a Level 2 number:** Bot should reply that only Level 1 concierges can invite.

---

### Test F – Mandatory fields (fallback questions)

**Goal:** If something important is missing, the bot asks for it.

1. Start a booking and at some point give **incomplete** info (e.g. skip date/time or passengers, or send a very short voice message with only “pickup at hotel”).
2. **Expected:**  
   - Bot does not show confirmation until required fields are present.  
   - It asks specifically for what’s missing (e.g. “Please provide pickup date and time”, “How many passengers?”).  
   - After you answer, it continues and eventually shows the Booking Confirmation.

---

## 3. Quick reference – where things happen

| Action | Where | Notes |
|--------|--------|--------|
| Start booking, edit booking, capacity, “no change”, Invite Concierge | **WhatsApp** | Concierge uses the bot chat; no dashboard login. |
| Add Level 1 concierge, view bookings, view chat logs, mark paid | **Dashboard (panel)** | Admin uses the panel; concierge’s phone is auto-whitelisted when added. |
| “Invite Concierge” trigger | **WhatsApp only** | Concierge **types** “Invite Concierge” in the bot chat; there is no button on the panel. |

---

## 4. What to report back

When testing, it helps to note:

- **Test name** (A–F) and **step** where something didn’t match the expected behaviour.
- **What you sent** (exact text or “voice message saying …”).
- **What the bot replied** (or that it didn’t reply).
- **Phone number / role** used (e.g. Level 1 concierge, whitelisted).

Example: *“Test C – after sending 6 passengers for Sedan, the bot went straight to confirmation instead of showing Add vehicle / Change vehicle.”*

---
