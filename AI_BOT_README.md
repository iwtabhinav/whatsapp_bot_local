# 🤖 AI-Powered WhatsApp Taxi Booking Bot

A comprehensive WhatsApp bot system with AI integration for automated taxi/chauffeur booking services. This system combines ultra-robust WhatsApp connectivity with OpenAI's advanced AI capabilities for natural language processing, voice transcription, and image analysis.

## ✨ Features

### 🧠 AI-Powered Features
- **Natural Language Processing**: Understands booking requests in natural language
- **Voice Transcription**: Converts voice messages to text using OpenAI Whisper
- **Image Analysis**: Extracts booking details from images using GPT-4 Vision
- **Multilingual Support**: Supports English, Hindi, Arabic, Chinese, Russian, and Urdu
- **Smart Conversation Flow**: AI-driven conversation management for booking collection

### 🚗 Booking System
- **Automated Booking Collection**: AI extracts guest name, locations, time, vehicle type
- **Session Management**: Tracks booking progress across multiple messages
- **Pricing Calculation**: Automatic fare calculation based on vehicle type and distance
- **Booking Confirmation**: AI-generated booking summaries with confirmation flow
- **Excel Export**: Automatic booking data export to Excel files

### 📱 WhatsApp Integration
- **Ultra-Robust Connection**: Advanced reconnection logic with exponential backoff
- **Media Support**: Handles text, voice, images, and video messages
- **Interactive Messages**: Buttons, lists, and location sharing
- **Real-time Status**: Live connection status and bot health monitoring

### 🗄️ Database Integration
- **MongoDB**: Complete database integration with Mongoose
- **Booking Models**: Structured data models for bookings, customers, and sessions
- **Audit Logging**: Comprehensive logging of all bot activities
- **Data Persistence**: Reliable data storage and retrieval

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- MongoDB (local or cloud)
- OpenAI API key
- WhatsApp account

### Installation

1. **Clone and Install Dependencies**
```bash
git clone <repository-url>
cd baileys-pro
npm install
```

2. **Environment Setup**
```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

3. **Required Environment Variables**
```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/concierge_taxi_booking
MONGODB_DB_NAME=concierge_taxi_booking

# Bot Configuration
BOT_PORT=3000
NODE_ENV=development

# Media Configuration
MEDIA_DIR=./media-files
AUDIO_CONVERSION_ENABLED=true
IMAGE_ANALYSIS_ENABLED=true
```

4. **Start the AI Bot**
```bash
# Start the complete AI-powered system
npm run ai-bot

# Or start just the bot
npm run ultra-bot
```

## 📋 Usage

### Starting a Booking
Send any of these messages to start a booking:
- "book chauffeur"
- "book taxi" 
- "I need a ride"
- "schedule a pickup"

### AI Features
- **Voice Messages**: Send voice notes with booking details - AI will transcribe and process
- **Images**: Send images with booking information - AI will analyze and extract details
- **Natural Language**: Just describe what you need in natural language

### Example Conversation
```
User: "Hi, I need to book a chauffeur for tomorrow at 2pm"
Bot: "🚗 Welcome to VIP Chauffeur Services! I'll help you book your chauffeur service. Let's start with the guest name - who will be riding?"

User: "John Smith"
Bot: "Great! What's your name (concierge)?"

User: "Sarah Johnson"
Bot: "Where should we pick up John Smith?"

User: "Dubai Mall"
Bot: "Where should we drop off John Smith?"

User: "Dubai Airport"
Bot: "What type of vehicle? (Sedan, SUV, Luxury, Van)"

User: "SUV"
Bot: "📋 Booking Summary (BK000001)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Service: VIP Chauffeur Service

👤 Guest Name: John Smith
🏨 Concierge Name: Sarah Johnson
📍 Pickup Location: Dubai Mall
🎯 Drop Location: Dubai Airport
🕐 Pickup Time: 2024-01-15 14:00
🚗 Vehicle Type: SUV

💰 Pricing:
• Base Rate: AED 180
• Per KM: AED 4
• Est. Distance: 25 km
• Est. Total: AED 280

Is this correct? Please reply with 'confirm' to proceed or 'cancel' to start over."
```

## 🛠️ Configuration

### Whitelisted Numbers
The bot only responds to whitelisted phone numbers. Update the numbers in `src/UltraRobustWhatsAppBot.js`:

```javascript
const whitelistedNumbers = [
    '971543033535',
    '919928366889',
    '919694035681',
    // Add your numbers here
];
```

### Vehicle Pricing
Update pricing in the BookingManager class:

```javascript
pricing: {
    Sedan: { base: 120, perKm: 3 },
    SUV: { base: 180, perKm: 4 },
    Luxury: { base: 350, perKm: 8 },
    Van: { base: 220, perKm: 5 }
}
```

### AI Models
Configure AI models in the bot:

```javascript
// For text processing
model: "gpt-4"

// For voice transcription  
model: "whisper-1"

// For image analysis
model: "gpt-4o"
```

## 📊 Database Schema

### Booking Model
```javascript
{
  bookingId: String,
  phoneNumber: String,
  guestName: String,
  conciergeName: String,
  pickupLocation: String,
  dropLocation: String,
  pickupTime: Date,
  vehicleType: String,
  pricing: {
    base: Number,
    perKm: Number,
    total: Number
  },
  status: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Customer Model
```javascript
{
  phoneNumber: String,
  name: String,
  registrationDate: Date,
  totalBookings: Number,
  lastBooking: Date,
  referralSource: String
}
```

## 🔧 API Endpoints

### Bot Status
- `GET /api/whatsapp/state` - Get bot connection status
- `POST /api/whatsapp/qr/generate` - Force new QR code generation

### Booking Management
- `GET /api/bookings` - List all bookings
- `POST /api/bookings` - Create new booking
- `GET /api/bookings/:id` - Get specific booking
- `PUT /api/bookings/:id` - Update booking
- `DELETE /api/bookings/:id` - Cancel booking

## 🚨 Troubleshooting

### Common Issues

1. **OpenAI API Key Error**
   ```
   ❌ Please set your OPENAI_API_KEY environment variable
   ```
   **Solution**: Add your OpenAI API key to the `.env` file

2. **MongoDB Connection Error**
   ```
   ❌ MongoDB connection error
   ```
   **Solution**: Ensure MongoDB is running and the connection string is correct

3. **WhatsApp Connection Issues**
   ```
   ❌ Ultra-Robust Connection failed
   ```
   **Solution**: 
   - Close all WhatsApp Web sessions
   - Wait 10-15 minutes before retrying
   - Delete the `auth_info_baileys` folder and reconnect

4. **Media Processing Not Working**
   ```
   ❌ Media processing is limited to authorized numbers
   ```
   **Solution**: Add your phone number to the whitelisted numbers list

### Debug Mode
Enable debug logging by setting:
```env
LOG_LEVEL=debug
NODE_ENV=development
```

## 📈 Monitoring

### Health Checks
- Bot connection status
- Database connectivity
- OpenAI API status
- Active booking sessions
- Memory usage and performance

### Logs
- All bot activities are logged
- Booking confirmations
- Error tracking
- Performance metrics

## 🔒 Security

- Phone number whitelisting
- Media processing authorization
- Environment variable protection
- Database connection security
- API rate limiting

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the logs for error details

---

**Built with ❤️ using Node.js, Baileys, OpenAI, and MongoDB**
