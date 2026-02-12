const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { PATHS, AI_PROMPTS } = require('../config/config');
const configService = require('./configService');

class OpenAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && String(apiKey).trim().length > 0) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.client = null;
      console.warn('⚠️ OPENAI_API_KEY is not set. OpenAI features will be disabled for this process.');
    }
  }

  async extractBookingInfo(text, context) {
    try {
      if (!this.client) {
        return {};
      }
      if (!context || !context.requiredFields || !context.requiredFields.vehicleType) {
        console.log('⚠️ Invalid context provided:', context);
        return {};
      }

      const vehicleOptions = context.requiredFields.vehicleType.options || ['Sedan', 'SUV', 'Luxury', 'Van'];

      // Use DB-backed AI prompts with fallback
      const dbPrompts = await configService.getAIPrompts().catch(() => ({}));
      const promptConfig = (dbPrompts && dbPrompts.bookingExtraction) || AI_PROMPTS.bookingExtraction;

      // Enhanced extraction prompt supporting bookingType and hours
      const systemPrompt = `You extract structured booking info for a chauffeur service.

Return ONLY JSON. Never include commentary. If the user says "cancel", return {"control":"cancel"}.

Fields:
- bookingType: "hourly" or "transfer" (infer from words: hourly, per hour, hours -> hourly; airport transfer, to <dest>, drop -> transfer). If unclear, omit.
- name
- pickupLocation
- dropLocation (only for transfer)
- pickupTime (24h acceptable or AM/PM)
- vehicleType (Sedan, SUV, Luxury, Van)
- numberOfPassengers
- luggageDetails
- specialRequests
- hours (only for hourly; integer)

Rules:
1) If a field is not mentioned, omit it.
2) Never invent data.
3) Normalize vehicleType capitalization (Sedan/SUV/Luxury/Van).
4) Name should be just the person's name.
5) If both bookingType and hours are missing but text mentions "hour", prefer bookingType: "hourly".
`;
      const userPrompt = `Message: ${text}`;

      const completion = await this.client.chat.completions.create({
        model: promptConfig.model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: promptConfig.temperature
      });

      let extractedInfo;
      try {
        const content = completion.choices[0].message.content.trim();
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}') + 1;
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonStr = content.slice(jsonStart, jsonEnd);
          extractedInfo = JSON.parse(jsonStr);
        } else {
          console.log('❌ No valid JSON found in response:', content);
          return {};
        }
      } catch (parseError) {
        console.error('❌ Error parsing OpenAI response:', parseError);
        return {};
      }

      const validated = this.validateExtractedInfo(extractedInfo, context);
      // Normalize common alternative keys and add simple regex fallbacks
      const mapped = {};
      for (const [k, v] of Object.entries(validated)) {
        const key = ({
          dropoffLocation: 'dropLocation',
          customerName: 'name',
          time: 'pickupTime',
          date: 'pickupDate',
          numberOfPassengers: 'numberOfPassengers',
          luggage: 'luggageDetails',
          duration: 'hours',
          hrs: 'hours'
        })[k] || k;
        mapped[key] = v;
      }

      // Regex fallbacks if AI missed some obvious items
      const lower = text.toLowerCase();
      if (!mapped.bookingType) {
        if (/(hour|per hour|hrs?)/i.test(text)) mapped.bookingType = 'hourly';
        else if (/(transfer|drop|to\s+\S+)/i.test(text)) mapped.bookingType = 'transfer';
      }
      if (!mapped.hours && /(?:for|book)\s*(\d{1,2})\s*hour/i.test(text)) {
        mapped.hours = RegExp.$1;
      }
      if (!mapped.name) {
        const m = text.match(/(?:name is|my name is|i am|booking for)\s+([A-Za-z][A-Za-z\s]{1,60})/i);
        if (m) mapped.name = m[1].trim();
      }
      if (!mapped.vehicleType) {
        const vm = lower.match(/\b(sedan|suv|luxury|van)\b/);
        if (vm) mapped.vehicleType = vm[1].charAt(0).toUpperCase() + vm[1].slice(1);
      }
      if (!mapped.pickupTime) {
        const tm = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (tm) mapped.pickupTime = tm[0].trim();
      }
      if (!mapped.numberOfPassengers) {
        const pm = text.match(/(\d+)\s*(passengers|people|persons|pax)/i);
        if (pm) mapped.numberOfPassengers = pm[1];
      }

      return mapped;

    } catch (error) {
      console.error('❌ Error extracting booking info:', error);
      return {};
    }
  }

  validateExtractedInfo(info, context) {
    if (!info || typeof info !== 'object') return {};

    const validated = {};

    // Only include fields that are defined in the context
    for (const [field, value] of Object.entries(info)) {
      if (
        (context.requiredFields && context.requiredFields[field]) ||
        (context.optionalFields && context.optionalFields[field])
      ) {
        validated[field] = value;
      }
    }

    return validated;
  }

  async transcribeAudio(media) {
    try {
      console.log('🎤 Transcribing audio with Whisper...');

      // Ensure media data exists and is in the correct format
      if (!media || !media.data) {
        throw new Error('Invalid media data received');
      }

      // Create temp directory if it doesn't exist
      if (!fs.existsSync(PATHS.MEDIA_DIR)) {
        fs.mkdirSync(PATHS.MEDIA_DIR, { recursive: true });
      }

      const timestamp = Date.now();
      let inputPath;
      let convertedPath;

      try {
        // Determine input file extension based on mimetype
        const ext = media.mimetype.split('/')[1] || 'ogg';
        inputPath = path.join(PATHS.MEDIA_DIR, `audio_${timestamp}.${ext}`);
        convertedPath = path.join(PATHS.MEDIA_DIR, `audio_${timestamp}.mp3`);

        // Write the audio data
        fs.writeFileSync(inputPath, Buffer.from(media.data, 'base64'));

        // Convert to MP3 if needed
        if (ext !== 'mp3') {
          console.log('🔄 Converting audio to MP3...');
          await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
              .toFormat('mp3')
              .on('end', () => {
                console.log('✅ Audio conversion successful');
                resolve();
              })
              .on('error', (err) => {
                console.error('❌ FFmpeg error:', err);
                reject(err);
              })
              .save(convertedPath);
          });
        } else {
          // If already MP3, just copy the file
          fs.copyFileSync(inputPath, convertedPath);
        }

        // Check if conversion was successful
        if (!fs.existsSync(convertedPath)) {
          throw new Error('Audio conversion failed');
        }

        // Create read stream for the converted file
        const audioFile = fs.createReadStream(convertedPath);

        // Send to OpenAI for transcription
        const transcription = await this.client.audio.transcriptions.create({
          file: audioFile,
          model: "whisper-1",
          language: "en",
          response_format: "text"
        });

        console.log('✅ Audio transcribed successfully');
        console.log(`📝 Transcription: "${transcription}"`);

        return transcription;

      } finally {
        // Cleanup temporary files
        try {
          if (inputPath && fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
          }
          if (convertedPath && fs.existsSync(convertedPath)) {
            fs.unlinkSync(convertedPath);
          }
        } catch (cleanupError) {
          console.warn('⚠️ Warning: Could not cleanup audio files:', cleanupError);
        }
      }

    } catch (error) {
      console.error('❌ Error transcribing audio:', error);
      throw error;
    }
  }

  async analyzeImage(media) {
    try {
      console.log('👁️ Analyzing image with Vision API...');

      if (!this.client) return null;
      const base64Image = `data:${media.mimetype};base64,${media.data}`;

      const response = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all relevant booking details including: guest name, pickup location, drop-off location, date/time, vehicle preference, and any other relevant information."
              },
              {
                type: "image_url",
                image_url: {
                  url: base64Image,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 500
      });

      const analysis = response.choices[0].message.content;
      console.log('✅ Image analyzed successfully');
      return analysis;

    } catch (error) {
      console.error('❌ Error analyzing image:', error);
      return await this.fallbackImageAnalysis(media);
    }
  }

  async fallbackImageAnalysis(media) {
    try {
      console.log('🔄 Trying fallback image analysis...');
      if (!this.client) return null;
      const base64Image = `data:${media.mimetype};base64,${media.data}`;

      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe what you see in this image. Extract any text or booking-related information."
              },
              {
                type: "image_url",
                image_url: {
                  url: base64Image,
                  detail: "low"
                }
              }
            ]
          }
        ],
        max_tokens: 200
      });

      console.log('✅ Fallback image analysis successful');
      return response.choices[0].message.content;

    } catch (error) {
      console.error('❌ All image analysis attempts failed:', error);
      return null;
    }
  }

  async validateLocation(location, country = 'UAE') {
    try {
      if (!this.client) return null;
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a location validation expert for ${country}. Given a location, validate if it exists and return structured data. Focus on tourist spots, landmarks, hotels, malls, and residential areas.`
          },
          {
            role: "user",
            content: `Validate this location: "${location}"`
          }
        ],
        functions: [
          {
            name: "validate_location",
            description: "Validate and structure location information",
            parameters: {
              type: "object",
              properties: {
                isValid: {
                  type: "boolean",
                  description: "Whether the location exists"
                },
                formattedName: {
                  type: "string",
                  description: "Properly formatted location name"
                },
                type: {
                  type: "string",
                  description: "Type of location (mall, hotel, airport, etc.)"
                },
                area: {
                  type: "string",
                  description: "Area or district name"
                },
                city: {
                  type: "string",
                  description: "City name"
                },
                alternatives: {
                  type: "array",
                  items: { type: "string" },
                  description: "Similar location names if ambiguous"
                }
              },
              required: ["isValid", "formattedName"]
            }
          }
        ],
        function_call: { name: "validate_location" }
      });

      return JSON.parse(response.choices[0].message.function_call.arguments);
    } catch (error) {
      console.error('Error validating location:', error);
      return null;
    }
  }

  async calculateDistance(origin, destination) {
    try {
      if (!this.client) return null;
      const response = await this.client.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a UAE distance calculation expert. Calculate the approximate driving distance between two locations in UAE. Use your knowledge of UAE roads and traffic patterns."
          },
          {
            role: "user",
            content: `Calculate driving distance from "${origin}" to "${destination}"`
          }
        ],
        functions: [
          {
            name: "calculate_distance",
            description: "Calculate approximate driving distance between locations",
            parameters: {
              type: "object",
              properties: {
                distanceKm: {
                  type: "number",
                  description: "Approximate distance in kilometers"
                },
                estimatedTime: {
                  type: "string",
                  description: "Estimated driving time"
                },
                route: {
                  type: "string",
                  description: "Main route description"
                },
                confidence: {
                  type: "string",
                  enum: ["high", "medium", "low"],
                  description: "Confidence level in the calculation"
                }
              },
              required: ["distanceKm", "estimatedTime", "confidence"]
            }
          }
        ],
        function_call: { name: "calculate_distance" }
      });

      return JSON.parse(response.choices[0].message.function_call.arguments);
    } catch (error) {
      console.error('Error calculating distance:', error);
      return null;
    }
  }

  async processMessage(text, context = null) {
    try {
      console.log('🤖 Processing message with OpenAI...');

      // Use DB-backed configuration for customer support
      const dbPrompts = await configService.getAIPrompts().catch(() => ({}));
      const promptConfig = (dbPrompts && dbPrompts.customerSupport) || AI_PROMPTS.customerSupport;

      const systemPrompt = promptConfig.system;
      const userPrompt = promptConfig.user.replace('{inquiry}', text);

      if (!this.client) return "I'm unable to process this right now.";
      const response = await this.client.chat.completions.create({
        model: promptConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: promptConfig.temperature
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('❌ Error processing message:', error);
      return "I apologize, but I'm having trouble processing your request right now. Please try again or contact support.";
    }
  }

  async analyzeMessage(prompt) {
    try {
      console.log('🤖 Analyzing message with OpenAI:', prompt.substring(0, 100) + '...');

      const systemPrompt = `You are a professional chauffeur booking assistant. Your task is to extract booking information from customer messages with high accuracy.

IMPORTANT RULES:
1. If the user says "cancel", "restart", or "start over", immediately output {"control":"cancel"} and no booking fields
2. Extract ONLY the specific information requested
2. Do NOT combine multiple pieces of information in one field
3. Be precise and accurate with locations, times, and numbers
4. Return a JSON object with the exact structure shown below

EXTRACTION GUIDELINES:
- Name: Extract only the customer's name (e.g., "Sohan Soni")
- Pickup Location: Extract only the pickup address/location (e.g., "Burj Khalifa")
- Drop Location: Extract only the destination address/location (e.g., "Emirates Tower")
- Pickup Time: Extract only the time (e.g., "3 p.m.", "3:00 PM")
- Vehicle Type: Extract only the vehicle type (e.g., "sedan", "suv", "luxury")
- Number of Passengers: Extract only the number (e.g., "4", "2")
- Luggage Details: Extract only luggage information (e.g., "2 suitcases", "1 bag")
- Special Requests: Extract only special requirements or "None" if none mentioned

EXAMPLES:
Input: "Please book a sedan car for Sohan Soni. The pickup will be from Burj Khalifa, drop will be at Emirates Tower. Pickup time will be 3 p.m. There are four passengers and two suitcases."

Output: {
  "bookingInfo": {
    "name": "Sohan Soni",
    "pickupLocation": "Burj Khalifa",
    "dropLocation": "Emirates Tower", 
    "pickupTime": "3 p.m.",
    "vehicleType": "sedan",
    "numberOfPassengers": "4",
    "luggageDetails": "two suitcases",
    "specialRequests": "None"
  }
}

Input: "I need a luxury car for John Smith from Dubai Mall to Airport Terminal 3 at 2:30 PM for 2 people with 1 suitcase"

Output: {
  "bookingInfo": {
    "name": "John Smith",
    "pickupLocation": "Dubai Mall",
    "dropLocation": "Airport Terminal 3",
    "pickupTime": "2:30 PM", 
    "vehicleType": "luxury",
    "numberOfPassengers": "2",
    "luggageDetails": "1 suitcase",
    "specialRequests": "None"
  }
}

If the user says "cancel" at any time, return: {"control":"cancel"}

Now analyze this message and extract booking information accurately:`;

      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      const result = response.choices[0]?.message?.content;
      console.log('🤖 OpenAI analysis completed');
      return result;

    } catch (error) {
      console.error('❌ OpenAI analysis failed:', error);
      return null;
    }
  }

  async generateBookingConfirmation(bookingDetails) {
    try {
      console.log('📋 Generating booking confirmation with OpenAI...');

      // Use DB-backed configuration for booking confirmation
      const dbPrompts = await configService.getAIPrompts().catch(() => ({}));
      const promptConfig = (dbPrompts && dbPrompts.bookingConfirmation) || AI_PROMPTS.bookingConfirmation;

      const systemPrompt = promptConfig.system;
      const userPrompt = promptConfig.user.replace('{bookingDetails}', JSON.stringify(bookingDetails));

      if (!this.client) return 'Thank you for your booking! Please check your details and confirm.';
      const completion = await this.client.chat.completions.create({
        model: promptConfig.model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: promptConfig.temperature
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('❌ Error generating booking confirmation with OpenAI:', error);
      return "Thank you for your booking! Please check your details and confirm.";
    }
  }

  async analyzeImageWithAI(imageDescription) {
    try {
      console.log('🖼️ Analyzing image with OpenAI...');

      // Use DB-backed configuration for image analysis
      const dbPrompts = await configService.getAIPrompts().catch(() => ({}));
      const promptConfig = (dbPrompts && dbPrompts.imageAnalysis) || AI_PROMPTS.imageAnalysis;

      const systemPrompt = promptConfig.system;
      const userPrompt = promptConfig.user.replace('{imageDescription}', imageDescription);

      if (!this.client) return "I'm unable to analyze this image at the moment. Please try again or provide the information in text format.";
      const completion = await this.client.chat.completions.create({
        model: promptConfig.model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: promptConfig.temperature
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('❌ Error analyzing image with OpenAI:', error);
      return "I'm unable to analyze this image at the moment. Please try again or provide the information in text format.";
    }
  }

  async processVoiceTranscription(transcription) {
    try {
      console.log('🎤 Processing voice transcription with OpenAI...');

      // Use DB-backed configuration for voice transcription
      const dbPrompts = await configService.getAIPrompts().catch(() => ({}));
      const promptConfig = (dbPrompts && dbPrompts.voiceTranscription) || AI_PROMPTS.voiceTranscription;

      const systemPrompt = promptConfig.system;
      const userPrompt = promptConfig.user.replace('{audioTranscription}', transcription);

      if (!this.client) return "I'm unable to process this voice message at the moment. Please try typing your request instead.";
      const completion = await this.client.chat.completions.create({
        model: promptConfig.model,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: promptConfig.temperature
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('❌ Error processing voice transcription with OpenAI:', error);
      return "I'm unable to process this voice message at the moment. Please try typing your request instead.";
    }
  }
}

module.exports = new OpenAIService(); 