# WhatsApp Chauffeur Bot - Web Management Platform

A comprehensive web-based management platform for the WhatsApp AI-powered chauffeur booking bot.

## 🌟 Features

### 1. **WhatsApp Instance Management**
- ✅ Add multiple WhatsApp numbers
- ✅ Generate QR codes for WhatsApp linking
- ✅ Real-time connection status monitoring
- ✅ Instance management (start/stop/restart)

### 2. **Booking Management**
- ✅ View all bookings in a comprehensive table
- ✅ Filter bookings by status (ongoing, completed, paid, cancelled)
- ✅ Date range filtering
- ✅ Mark bookings as paid
- ✅ View detailed booking information
- ✅ Real-time booking updates

### 3. **Payment Gateway Integration**
- ✅ Stripe configuration
- ✅ PayPal setup
- ✅ Razorpay integration
- ✅ Secure credential management

### 4. **AI Prompt Management**
- ✅ Customize GPT prompts for booking extraction
- ✅ Response generation prompts
- ✅ Voice transcription prompts
- ✅ Real-time prompt updates

### 5. **WhatsApp Flow Editor**
- ✅ Visual flow creation
- ✅ Step-by-step conversation design
- ✅ Custom message templates
- ✅ Flow testing and validation

### 6. **Real-time Updates**
- ✅ Socket.IO integration
- ✅ Live booking notifications
- ✅ Configuration sync across devices
- ✅ Connection status monitoring

## 🚀 Quick Start

### Prerequisites
- Node.js v14 or higher
- WhatsApp account for bot
- OpenAI API key

### Installation

1. **Clone and Setup**
```bash
git clone <your-repo-url>
cd whatsapp-chauffeur-bot
npm install
```

2. **Environment Configuration**
```bash
# Required environment variables
export OPENAI_API_KEY="your-openai-api-key"
export WEB_PORT=3000
export SESSION_SECRET="your-session-secret"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="your-secure-password"
```

3. **Start the Services**

**Option A: Run Both Services**
```bash
# Terminal 1: Start the bot
npm start

# Terminal 2: Start the web platform
npm run web
```

**Option B: Development Mode**
```bash
# Terminal 1: Bot development
npm run dev

# Terminal 2: Web platform development
npm run dev:web
```

### Access the Platform

1. **Web Dashboard**: http://localhost:4000/dashboard
2. **Login Credentials**: 
   - Username: `admin` (or your configured username)
   - Password: `chauffeur2024` (or your configured password)

## 📖 User Guide

### 1. **Dashboard Overview**
- View key statistics (total bookings, ongoing, paid, active WhatsApp instances)
- Recent bookings widget
- Real-time connection status

### 2. **WhatsApp Management**
1. Click "Add Instance" button
2. Enter phone number (with country code)
3. Scan QR code with WhatsApp
4. Instance will show as "Connected" when successful

### 3. **Booking Management**
- **View Bookings**: All bookings are displayed in a sortable table
- **Filter Options**: 
  - Status: All, Ongoing, Completed, Paid, Cancelled
  - Date Range: From/To date selection
- **Actions**:
  - 👁️ View detailed booking information
  - 💰 Mark booking as paid

### 4. **Payment Configuration**

**Stripe Setup:**
1. Enable Stripe in Payment Settings
2. Add your Stripe Publishable Key
3. Add your Stripe Secret Key
4. Save configuration

**PayPal Setup:**
1. Enable PayPal in Payment Settings
2. Add PayPal Client ID
3. Add PayPal Secret Key
4. Save configuration

**Razorpay Setup:**
1. Enable Razorpay in Payment Settings
2. Add Razorpay Key ID
3. Add Razorpay Secret Key
4. Save configuration

### 5. **AI Prompt Customization**
1. Navigate to "AI Prompts" tab
2. Modify prompts for:
   - **Booking Extraction**: How AI extracts booking details from messages
   - **Response Generation**: How AI responds to customers
   - **Voice Transcription**: How AI processes voice messages
3. Click "Save Changes"

### 6. **Flow Editor**
1. Navigate to "Flow Editor" tab
2. Select existing flow or create new one
3. Design conversation steps:
   - Greeting messages
   - Information collection
   - Confirmation steps
   - Payment processing
4. Test and deploy flows

## 🔧 Configuration

### Web Server Configuration
Create a `.env` file in the root directory:

```env
# Web Server
WEB_PORT=3000
SESSION_SECRET=your-super-secret-session-key

# Authentication
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# OpenAI (required)
OPENAI_API_KEY=your-openai-api-key

# Optional: Database
DATABASE_URL=your-database-url
```

### Advanced Configuration
The platform creates a `data/web-config.json` file for advanced settings:

```json
{
  "whatsappFlows": [...],
  "gptPrompts": {...},
  "paymentGateways": {...},
  "settings": {
    "currency": "AED",
    "timezone": "Asia/Dubai",
    "autoConfirmBookings": false,
    "sendEmailNotifications": true
  }
}
```

## 🔒 Security Features

### Authentication
- Session-based authentication
- Configurable admin credentials
- Secure session management
- Auto-logout on inactivity

### Data Protection
- Encrypted payment gateway credentials
- Secure API endpoints
- Input validation and sanitization
- XSS protection

### Access Control
- Admin-only access to all features
- API endpoint protection
- Session validation on all requests

## 📱 API Endpoints

### Authentication
- `GET /login` - Login page
- `POST /login` - Authentication
- `POST /logout` - Logout

### Dashboard
- `GET /dashboard` - Main dashboard
- `GET /api/bookings` - Get all bookings
- `GET /api/whatsapp/instances` - Get WhatsApp instances

### WhatsApp Management
- `POST /api/whatsapp/create` - Create new instance
- `DELETE /api/whatsapp/:number` - Remove instance
- `POST /api/whatsapp/:number/restart` - Restart instance

### Configuration
- `GET /api/config` - Get configuration
- `POST /api/config` - Update configuration

## 🔄 Real-time Features

### Socket.IO Events
- `bookingsUpdate` - New/updated bookings
- `configUpdated` - Configuration changes
- `qrCodeGenerated` - New QR codes
- `instanceStatusUpdate` - WhatsApp status changes

### Live Updates
- Booking table auto-refresh
- Real-time statistics
- Instant notification system
- Configuration sync

## 🎨 Customization

### Themes
The platform uses CSS variables for easy theming:

```css
:root {
  --primary-color: #667eea;
  --secondary-color: #764ba2;
  --success-color: #27ae60;
  --warning-color: #f39c12;
  --danger-color: #e74c3c;
}
```

### Branding
Update the logo and branding in:
- `public/dashboard.html` - Main branding
- `public/assets/css/dashboard.css` - Styling
- `src/web-server.js` - Login page branding

## 🚀 Deployment

### Production Deployment

1. **Server Setup**
```bash
# Install PM2 for process management
npm install -g pm2

# Start bot
pm2 start src/index.js --name "chauffeur-bot"

# Start web platform
pm2 start src/web-server.js --name "chauffeur-web"

# Save PM2 configuration
pm2 save
pm2 startup
```

2. **Nginx Configuration** (Optional)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM node:16-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000
CMD ["node", "src/web-server.js"]
```

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  chauffeur-bot:
    build: .
    command: node src/index.js
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./data:/app/data

  chauffeur-web:
    build: .
    command: node src/web-server.js
    ports:
      - "3000:4000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - WEB_PORT=3000
    volumes:
      - ./data:/app/data
```

## 🐛 Troubleshooting

### Common Issues

**1. QR Code Not Generating**
- Check WhatsApp Web is accessible
- Verify phone number format (+country_code)
- Clear browser cache

**2. Bookings Not Updating**
- Check Socket.IO connection (green dot in header)
- Verify bot is running and connected
- Check browser console for errors

**3. Payment Gateway Issues**
- Verify API credentials are correct
- Check payment gateway documentation
- Test with sandbox/test credentials first

**4. Authentication Problems**
- Check username/password configuration
- Clear browser cookies
- Verify session secret is set

### Debug Mode
Enable debug logging:
```bash
DEBUG=* npm run web
```

## 📞 Support

### Getting Help
1. Check the troubleshooting section
2. Review browser console errors
3. Check server logs
4. Verify all environment variables are set

### Feature Requests
This platform is designed to be extensible. Common customization requests:
- Additional payment gateways
- Custom booking fields
- Email notifications
- SMS integration
- Advanced reporting

## 🔄 Updates

### Keeping Updated
```bash
# Pull latest changes
git pull origin main

# Update dependencies
npm update

# Restart services
pm2 restart all
```

### Version Management
The platform automatically handles configuration migrations and data updates.

---

**🎉 Congratulations!** Your WhatsApp Chauffeur Bot web management platform is ready for production use. 