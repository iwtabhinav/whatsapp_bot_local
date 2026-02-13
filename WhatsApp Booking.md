WhatsApp Booking – Additional Requirements & Issues
1. Additional Requirement – Concierge Registration (Level 2)
    • A Level 1 concierge should be able to register a Level 2 concierge via WhatsApp.
    • Trigger phrase: “Invite Concierge”.
    • The WhatsApp bot will respond by requesting the mobile number and basic details of the new concierge.
    • Once details are provided, the bot registers the number in the backend system.
    • After successful registration, the bot sends a welcome message to the newly registered concierge.
    • The welcome message must include Terms & Conditions and basic usage instructions.
2. WhatsApp Bot – Booking Issues Identified
    • Pickup date and pickup time are not being captured in some bookings.
    • Voice bookings do not capture the full spoken message accurately.
    • Voice bookings fail to reliably capture: pickup/drop-off timings, number of passengers, number of luggage items.
3. Passenger & Luggage Capacity Validation
    • When the number of passengers or luggage exceeds the selected vehicle’s capacity, the bot must intervene.
    • The bot should clearly inform the concierge that the selected vehicle cannot accommodate all passengers or luggage.
    • The bot must ask whether the concierge would like to:
    • • Add an additional vehicle, or
    • • Change the vehicle to one that can accommodate the passenger and luggage count.
4. Booking Modification Flow Issue
    • When a concierge edits an existing booking and selects ‘Change Data’.
    • If the concierge then chooses not to modify any fields, the bot does not return to the correct conversational flow.
    • The bot should correctly detect ‘no change’ actions and resume the appropriate booking confirmation or next-step flow.
5. Expected Improvements
    • Improved NLP handling for voice bookings to extract complete booking details.
    • Mandatory validation for pickup date, time, passenger count, and luggage count before confirmation.
    • Clear fallback questions when mandatory data is missing.
    • Robust state handling to prevent broken or incorrect conversation flows.

---

## How It Works & Testing from the Panel

**Important:** Passenger/luggage capacity validation and the booking “no change” flow run **only in the WhatsApp conversation** with the concierge. The dashboard **Booking Management** panel is for viewing bookings, chat logs, and payments—not for triggering these flows. You test the behaviour on WhatsApp, then use the panel to verify outcomes (e.g. booking details, chat history).

### 3. Passenger & Luggage Capacity Validation – How It Works

- **When:** Right before the bot shows the **Booking Confirmation** screen (Confirm & Pay / Edit / Cancel).
- **Logic:** The bot compares the session’s vehicle type, passenger count, and luggage count against a fixed capacity map:
  - Sedan / Luxury: 4 passengers, 3 luggage
  - SUV: 6 passengers, 4 luggage
  - Van: 8 passengers, 6 luggage
- **If over capacity:** The bot does **not** show the confirmation screen. It sends a list with:
  - **Add an additional vehicle** – keeps current vehicle and proceeds to confirmation (extra vehicle noted).
  - **Change vehicle** – opens the vehicle-type menu so the concierge can pick a larger vehicle.
- **If within capacity:** The confirmation screen is shown as usual.

**How to test (WhatsApp + Panel)**

1. **On WhatsApp:** Start a new booking. Choose a vehicle (e.g. Sedan), then enter **more than 4 passengers** or **more than 3 luggage** (e.g. “6 passengers”, “5 pieces of luggage”).
2. When you reach the step before confirmation, the bot should show the capacity message and the two options (Add vehicle / Change vehicle).
3. **In the panel:** Open **Bookings** → find the booking (or the latest one) → click the **eye icon** or the row to **View details**. Check that vehicle, passengers, and luggage match what you sent. Click **View Chat Logs** to confirm the bot sent the capacity message and the list.

### 4. Booking Modification “No Change” Flow – How It Works

- **When:** The concierge is on the **Booking Confirmation** screen and chooses **Edit Details** (or “Change Data”). The bot then shows a list of fields they can change (e.g. pickup, destination, date/time, vehicle, passengers, luggage, special requests) plus **Move to Confirmation**.
- **“No change” detection:** If the concierge **does not** choose a field and instead:
  - Selects **Move to Confirmation** from the list, or
  - Replies with text such as *no change*, *back*, *done*, *cancel edit*, *keep as is*, *that’s all*, *nothing*, *skip*, *return*, *go back*,
  then the bot clears the “waiting for edit choice” state and **shows the Booking Confirmation screen again** (same details, no changes).
- If they **do** choose a field (e.g. “Change vehicle”), the bot asks for the new value for that field and continues the edit flow.

**How to test (WhatsApp + Panel)**

1. **On WhatsApp:** Create a booking until you see the **Booking Confirmation** screen (Confirm & Pay / Edit / Cancel).
2. Choose **Edit Details** (or “Change Data”). When the list appears, **do not** select any field. Either:
   - Select **Move to Confirmation**, or  
   - Send a text message: e.g. *no change*, *back*, or *done*.
3. The bot should respond by showing the **same Booking Confirmation** screen again (no field change).
4. **In the panel:** Go to **Bookings** → open that booking (eye icon / row click) → **View Chat Logs**. Confirm the sequence: confirmation → edit list → your “no change” action → confirmation shown again.

**Panel actions (for reference)**

- **Bookings** tab: Filter by status/date, see list with Booking ID, Customer, Pickup, Destination, Date/Time, Vehicle, Status, Payment, Actions.
- **Eye icon / row click:** View booking details (customer, trip, vehicle, passengers, etc.) and actions: View Chat Logs, Mark as Paid, Send Payment Link.
- **View Chat Logs:** Opens the conversation for that booking so you can verify the bot’s capacity message or the “no change” → confirmation flow.
- **Pencil (Edit):** Opens the dashboard’s own **Edit Booking** form (API update). This is separate from the WhatsApp “Change Data” flow; the “no change” behaviour applies only to the WhatsApp edit menu.

---

## 1. NLP Handling for Voice Booking & Status of Point 5

**What is “NLP handling for voice booking”?**

It is the pipeline that turns a **voice message** into **structured booking data**:

1. **Transcription:** The user’s voice is converted to text (e.g. Whisper / OpenAI).
2. **Extraction (NLP):** The transcribed text is analysed to fill booking fields: customer name, pickup/drop locations, **pickup date & time** (e.g. “tomorrow 3pm”, “next Monday 10am”), vehicle type, **number of passengers** (“two people”, “4 passengers”), **luggage** (“two suitcases”, “3 bags”), booking type (hourly/transfer), hours, special requests.
3. **Session update:** Extracted fields are written into the booking session.
4. **Fallback:** Any **mandatory** field that is still missing is requested one-by-one (clear fallback questions).

So “improved NLP” in point 5 means: better extraction from natural, spoken phrases so that date, time, passengers, and luggage are captured reliably from voice.

**Are all changes for point 5 done?**

Yes. The following are implemented:

| Point 5 item | Status | Implementation |
|--------------|--------|-----------------|
| **Improved NLP for voice** | Done | `openaiService.extractBookingInfo()` with voice-friendly rules (date/time, passengers, luggage from natural phrases). Voice flow: transcribe → extract → map to session → ask for missing. |
| **Mandatory validation before confirmation** | Done | `pickupDateTime`, passenger count, luggage are in required fields. Capacity check runs **before** confirmation. |
| **Clear fallback when data is missing** | Done | `getMissingFieldsForSession()` + `analyzeAndRequestMissingInfo()` so the bot asks for each missing mandatory field. |
| **Robust state handling** | Done | Edit-menu “no change” detection, capacity overflow (add/change vehicle), and confirmation flow state are handled so the conversation does not get stuck. |

You can still **tune** the NLP (e.g. prompt or model) if some phrases are mis-extracted; the structure and flow are in place.

---

## 2. Concierge Registration (Level 2) – How It Works (Not from Panel)

**This flow is only on WhatsApp.** The dashboard does **not** have an “Invite Concierge” or “Register Level 2” action. The panel’s **Concierge Management** is for **admins** to add/edit concierges manually; Level 2 registration by a Level 1 concierge is done **via the bot**.

**Flow (all on WhatsApp):**

1. A **Level 1** concierge sends the trigger: **“Invite Concierge”**.
2. Bot checks: only Level 1 can invite; Level 2 gets a “Only Level 1 can invite” message.
3. Bot asks in order:
   - **Mobile number** of the new concierge (with country code).
   - **Full name.**
   - **Email.**
   - **PayPal email** (for payouts).
4. Bot registers the new concierge in the backend with `tier: 2` and `uplineId: <inviter’s ID>`.
5. Bot sends the **inviter** a success message (name, phone, Concierge ID).
6. Bot sends the **new number** a **welcome message** that includes:
   - That they are registered as Level 2 by a Level 1.
   - **Terms & Conditions** (code of conduct, pricing, commissions, keeping details up to date).
   - **Basic usage** (use WhatsApp for bookings, type *book* or Book Now, support via upline/admin).
   - Their Concierge ID.

**How to test:** Use a Level 1 concierge WhatsApp number, send *Invite Concierge*, then provide a **new** number and the required details. Check that the new concierge is created (e.g. in **Concierges** on the panel) with tier 2 and upline set, and that the new number receives the welcome + T&C.

---

## Where is “Invite Concierge”? Does the concierge log in?

**There is no “Invite Concierge” button.** The concierge does **not** log in to the panel or any app. Everything happens in **WhatsApp**.

**Step-by-step for a Level 1 concierge you registered from the panel:**

1. **You (admin)** add a concierge from the **panel** (Concierge Management → Add Concierge) with **Level 1** and their **phone number** (e.g. 971501234567).  
   - That phone number is **auto-added to the bot’s whitelist**, so the bot will accept messages from it.

2. **The concierge** uses **WhatsApp on that same phone number**.  
   - They do **not** open the dashboard or log in anywhere.  
   - They open a chat with the **Preimo WhatsApp bot** (the bot’s WhatsApp number).

3. In that WhatsApp chat, the concierge **types** (or sends as voice):  
   **`Invite Concierge`**  
   - There is no button or menu on the panel for this.  
   - The trigger is this **exact phrase** in the WhatsApp conversation.

4. The bot recognises the sender by **phone number** (from WhatsApp), looks them up in the Concierge list, and checks **tier === 1**.  
   - If they are Level 1 → bot starts the invite flow (asks for new concierge’s number, name, email, PayPal).  
   - If they are Level 2 or not registered → bot replies that only Level 1 can invite.

**Summary**

| Question | Answer |
|----------|--------|
| Where does “Invite Concierge” appear? | **Only in WhatsApp.** The concierge **types** “Invite Concierge” in the chat with the bot. There is no button on the panel. |
| Does the concierge log in? | **No.** They use WhatsApp on the phone number you registered. The bot identifies them by that number (whitelist + Concierge record). |
| Who uses the panel? | **Admins** use the panel (add Level 1 concierge, manage bookings, etc.). Concierges use **WhatsApp** for booking and for “Invite Concierge”. |# WhatsApp Booking – Flow of Changes -



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
