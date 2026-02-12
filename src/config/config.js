const path = require('path');

const LANGUAGE_PATTERNS = {
  hindi: /[\u0900-\u097F]/,  // Hindi Unicode range
  arabic: /[\u0600-\u06FF]/, // Arabic Unicode range
  chinese: /[\u4E00-\u9FFF]/, // Chinese Unicode range
  russian: /[\u0400-\u04FF]/, // Cyrillic Unicode range
  urdu: /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/ // Urdu Unicode range
};

const BOOKING_PROMPTS = {
  en: {
    welcome: "Welcome to Preimo Chauffeur Services!",
    vehicle_options: `Available vehicles:
- Sedan: AED 120 base + AED 3/km
- SUV: AED 180 base + AED 4/km
- Luxury (Maybach): AED 350 base + AED 8/km
- Van (6+ seats): AED 220 base + AED 5/km`
  },
  hi: {
    welcome: "वीआईपी शोफर सेवाओं में आपका स्वागत है!",
    vehicle_options: `उपलब्ध वाहन:
- सेडान: AED 120 बेस + AED 3/किमी
- एसयूवी: AED 180 बेस + AED 4/किमी
- लग्जरी (मेबैक): AED 350 बेस + AED 8/किमी
- वैन (6+ सीटें): AED 220 बेस + AED 5/किमी`
  },
  ar: {
    welcome: "مرحباً بكم في خدمات VIP للسائقين!",
    vehicle_options: `السيارات المتوفرة:
- سيدان: 120 درهم أساسي + 3 درهم/كم
- دفع رباعي: 180 درهم أساسي + 4 درهم/كم
- فاخرة (مايباخ): 350 درهم أساسي + 8 درهم/كم
- فان (6+ مقاعد): 220 درهم أساسي + 5 درهم/كم`
  }
};

const AI_PROMPTS = {
  bookingExtraction: {
    system: `You are a booking information extractor for Preimo Chauffeur Services. Extract booking information and return it in JSON format.

Required fields to extract:
- customerName: Customer's full name
- vehicleType: Type of vehicle (Sedan, SUV, Luxury, Van)
- pickupLocation: Pickup location/address
- dropoffLocation: Destination/address
- date: Date in DD/MM/YYYY format
- time: Time in 24-hour format (HH:MM)
- numberOfPassengers: Number of passengers (1-8)
- luggageDetails: Luggage information
- specialRequests: Any special requests

Rules:
1. If a field is not mentioned, set its value to "Not provided"
2. If the user says "none" or "no special request", set the value to "None"
3. Always return all required fields in the JSON, even if some are "Not provided" or "None"
4. Format times in 24-hour format (HH:mm)
5. For locations, include the full location name as mentioned
6. If multiple pieces of information are found, include all of them
7. If information is ambiguous, include a note in the response
8. Return a single JSON object with all fields
9. Validate vehicle types against: Sedan, SUV, Luxury, Van
10. For locations in UAE, include city/district if mentioned`,

    user: `Extract booking information from the following message: {message}`,

    temperature: 0.1,
    model: "gpt-3.5-turbo"
  },

  bookingConfirmation: {
    system: `You are a booking confirmation assistant for Preimo Chauffeur Services. Help customers confirm their bookings with clear, professional responses.

Your role:
- Confirm booking details clearly
- Explain pricing and payment options
- Provide next steps for payment
- Answer questions about the service
- Handle booking modifications professionally

Guidelines:
- Always be polite and professional
- Include booking ID and confirmation details
- Explain PayPal payment process clearly
- Provide contact information for support
- Use emojis appropriately for better engagement
- Keep responses concise but informative`,

    user: `Generate a booking confirmation response for: {bookingDetails}`,

    temperature: 0.7,
    model: "gpt-3.5-turbo"
  },

  customerSupport: {
    system: `You are a customer support assistant for Preimo Chauffeur Services. Help customers with their inquiries professionally and accurately.

Your role:
- Answer questions about services and pricing
- Help with booking modifications
- Provide information about payment options
- Handle complaints professionally
- Guide customers through the booking process

Guidelines:
- Be helpful and professional
- Provide accurate information about services
- Direct customers to appropriate channels for complex issues
- Use a friendly but professional tone
- Include relevant service details when helpful`,

    user: `Respond to this customer inquiry: {inquiry}`,

    temperature: 0.8,
    model: "gpt-3.5-turbo"
  },

  imageAnalysis: {
    system: `You are an image analysis assistant for Preimo Chauffeur Services. Analyze images to extract booking-related information.

Your role:
- Identify locations, landmarks, or addresses
- Extract text from images (receipts, documents)
- Recognize vehicle types or preferences
- Identify special requirements or requests
- Provide context for booking information

Guidelines:
- Focus on information relevant to chauffeur services
- Identify locations in UAE when possible
- Extract any text or numbers that might be relevant
- Note any special requirements visible in the image
- Provide clear, actionable information`,

    user: `Analyze this image for booking-related information: {imageDescription}`,

    temperature: 0.3,
    model: "gpt-4-vision-preview"
  },

  voiceTranscription: {
    system: `You are a voice transcription assistant for Preimo Chauffeur Services. Process voice messages to extract booking information.

Your role:
- Transcribe voice messages accurately
- Extract booking-related information
- Identify customer requests and preferences
- Handle multiple languages (English, Arabic, Hindi)
- Provide context for booking details

Guidelines:
- Focus on accuracy in transcription
- Identify key booking information
- Note any special requests or preferences
- Handle different accents and dialects
- Provide clear, structured output`,

    user: `Process this voice message for booking information: {audioTranscription}`,

    temperature: 0.1,
    model: "gpt-3.5-turbo"
  }
};

const VEHICLE_RATES = {
  'Sedan': { base: 120, perKm: 3 },
  'SUV': { base: 180, perKm: 4 },
  'Luxury': { base: 350, perKm: 8 },
  'Van': { base: 220, perKm: 5 }
};

const DEFAULT_WHITELISTED_NUMBERS = [
  '971543033535',
  '918871678917',
  '919928366889',
  '919694035681',
  '971561880302',
  '971563905407',
  '971509935854',
  '971501476598',
  '971509940544'
];

const PUPPETEER_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--disable-notifications',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    '--disable-web-security',
    '--allow-running-insecure-content',
    '--disable-features=site-per-process',
    '--disable-site-isolation-trials'
  ],
  defaultViewport: null,
  executablePath: process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined,
  timeout: 60000,
  protocolTimeout: 60000,
  ignoreHTTPSErrors: true,
  handleSIGINT: true,
  handleSIGTERM: true,
  handleSIGHUP: true
};

const PATHS = {
  ROOT_DIR: path.resolve(__dirname, '../..'),
  MEDIA_DIR: path.resolve(__dirname, '../../media-files'),
  KNOWLEDGE_BASE_DIR: path.resolve(__dirname, '../../knowledge_base'),
  DATA_DIR: path.join(path.resolve(__dirname, '../..'), 'data'),
  SESSION_PATH: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'whatsapp-session'),
  REGISTERED_USERS_FILE: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'registered-users.json'),
  MEDIA_AUTH_CONFIG: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'media-auth-config.json'),
  BOOKINGS_EXCEL: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'enhanced-ai-chauffeur-bookings.xlsx'),
  BOOKING_SESSIONS: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'booking-sessions.json'),
  BOOKING_CONTEXTS: path.join(path.join(path.resolve(__dirname, '../..'), 'data'), 'booking-contexts.json')
};

module.exports = {
  LANGUAGE_PATTERNS,
  BOOKING_PROMPTS,
  AI_PROMPTS,
  VEHICLE_RATES,
  DEFAULT_WHITELISTED_NUMBERS,
  PUPPETEER_OPTIONS,
  PATHS
}; 