# WhatsApp AI Bot - Production Deployment Guide

## 🚀 Production Deployment for WHM/cPanel with PM2

This guide will help you deploy your WhatsApp AI Bot to production on WHM/cPanel with PM2 process management.

### 📋 Prerequisites

- **Server**: WHM/cPanel with root access
- **Node.js**: Version 16 or higher
- **PM2**: Process manager (will be installed automatically)
- **MongoDB**: Running on the server
- **OpenAI API Key**: For AI functionality

### 🔧 Server Configuration

**Production Server Details:**
- **IP**: localhost
- **Port**: 4001
- **MongoDB**: mongodb://root:redhat-bc-12323@127.0.0.1:27017/db01

### 📁 Files to EXCLUDE from Production

The following files/folders should **NOT** be uploaded to production as they will be regenerated fresh:

#### ❌ Session Data (Will be regenerated)
```
data/whatsapp-session/          # 341 JSON files
data/whatsapp-connection-state.json
data/whatsapp-qr.json
data/whatsapp-qr.png
```

#### ❌ Logs (Will be created fresh)
```
logs/
*.log
```

#### ❌ Development Files
```
node_modules/                   # Will be installed fresh
bot-latest-new.zip             # 344MB backup file
test-*.js                      # Test files
*-demo.js                      # Demo files
simple-bot.js
advanced-bot.js
robust-bot.js
fixed-bot.js
ultra-robust-bot.js
example.js
features-demo.js
openai-chauffeur-bot-enhanced.js
```

#### ❌ Temporary Files
```
media-files/                   # If contains temporary files
*.backup
*.backup2
```

### 🚀 Deployment Steps

#### Step 1: Prepare Production Package

1. **Create a clean production folder:**
   ```bash
   mkdir whatsapp-bot-production
   cd whatsapp-bot-production
   ```

2. **Copy only necessary files:**
   ```bash
   # Core application files
   cp start-ai-bot.js ./
   cp package.json ./
   cp README.md ./
   
   # Source directory
   cp -r src/ ./
   
   # Configuration files
   cp ecosystem.config.js ./
   cp env.production ./
   cp .gitignore ./
   
   # Public directory (if needed)
   cp -r public/ ./
   
   # Knowledge base
   cp -r knowledge_base/ ./
   
   # Library files
   cp -r lib/ ./
   cp -r WAProto/ ./
   cp -r WASignalGroup/ ./
   
   # Documentation
   cp *.md ./
   ```

#### Step 2: Upload to Server

1. **Compress the production package:**
   ```bash
   tar -czf whatsapp-bot-production.tar.gz whatsapp-bot-production/
   ```

2. **Upload to your server via cPanel File Manager or SCP:**
   ```bash
   scp whatsapp-bot-production.tar.gz user@localhost:/home/user/
   ```

3. **Extract on server:**
   ```bash
   ssh user@localhost
   cd /home/user/
   tar -xzf whatsapp-bot-production.tar.gz
   cd whatsapp-bot-production
   ```

#### Step 3: Configure Environment

1. **Update environment variables:**
   ```bash
   cp env.production .env
   ```

2. **Edit .env file with your actual values:**
   ```bash
   nano .env
   ```
   
   Update these values:
   ```env
   OPENAI_API_KEY=your-actual-openai-api-key
   AUTHENTICATION_API_KEY=your-secure-api-key
   ```

#### Step 4: Deploy with PM2

**Option A: Using the deployment script (Recommended)**
```bash
# For Linux/Unix
chmod +x production-deploy.sh
./production-deploy.sh

# For Windows
production-deploy.bat
```

**Option B: Manual deployment**
```bash
# Install PM2 globally
npm install -g pm2

# Install dependencies
npm install --production

# Create necessary directories
mkdir -p data/whatsapp-session
mkdir -p logs
mkdir -p media-files

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
pm2 startup
```

### 🔍 Post-Deployment Verification

1. **Check PM2 status:**
   ```bash
   pm2 status
   ```

2. **View logs:**
   ```bash
   pm2 logs whatsapp-ai-bot
   ```

3. **Check QR code:**
   ```bash
   pm2 logs whatsapp-ai-bot | grep -i qr
   ```

4. **Test web dashboard:**
   - Open: http://localhost:4001
   - Should show the bot dashboard

### 🛠️ Useful PM2 Commands

```bash
# Process management
pm2 status                    # Check all processes
pm2 restart whatsapp-ai-bot  # Restart the bot
pm2 stop whatsapp-ai-bot     # Stop the bot
pm2 delete whatsapp-ai-bot   # Remove from PM2

# Monitoring
pm2 logs whatsapp-ai-bot     # View logs
pm2 logs whatsapp-ai-bot --lines 100  # Last 100 lines
pm2 monit                    # Real-time monitoring

# Configuration
pm2 save                     # Save current process list
pm2 startup                  # Generate startup script
pm2 unstartup               # Remove startup script
```

### 🔧 Troubleshooting

#### Bot won't start
```bash
# Check logs for errors
pm2 logs whatsapp-ai-bot --err

# Check if ports are available
netstat -tulpn | grep :4001

# Check MongoDB connection
mongo "mongodb://root:redhat-bc-12323@127.0.0.1:27017/db01"
```

#### QR Code not showing
```bash
# Check if session data exists
ls -la data/whatsapp-session/

# Clear session data and restart
rm -rf data/whatsapp-session/*
pm2 restart whatsapp-ai-bot
```

#### Memory issues
```bash
# Monitor memory usage
pm2 monit

# Restart if memory usage is high
pm2 restart whatsapp-ai-bot
```

### 📊 Monitoring & Maintenance

1. **Set up log rotation:**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

2. **Monitor resource usage:**
   ```bash
   pm2 monit
   ```

3. **Set up alerts for crashes:**
   ```bash
   pm2 install pm2-server-monit
   ```

### 🔒 Security Considerations

1. **Firewall configuration:**
   - Only open port 4001 if needed externally
   - Restrict MongoDB access to localhost only

2. **Environment variables:**
   - Never commit .env files to version control
   - Use strong API keys and passwords

3. **File permissions:**
   ```bash
   chmod 600 .env
   chmod 755 data/
   chmod 755 logs/
   ```

### 📈 Performance Optimization

1. **PM2 cluster mode** (if needed):
   ```javascript
   // In ecosystem.config.js
   instances: 'max',  // Use all CPU cores
   exec_mode: 'cluster'
   ```

2. **Memory limits:**
   ```javascript
   // In ecosystem.config.js
   max_memory_restart: '1G'
   ```

3. **Restart policies:**
   ```javascript
   // In ecosystem.config.js
   max_restarts: 10,
   min_uptime: '10s'
   ```

### 🎉 Success!

Once deployed successfully, your WhatsApp AI Bot will be running on:
- **Web Dashboard**: http://localhost:4001
- **PM2 Process**: whatsapp-ai-bot
- **MongoDB**: db01 database

The bot will start fresh without any session data, so you'll need to scan the QR code with your WhatsApp to connect.

### 📞 Support

If you encounter any issues:
1. Check the logs: `pm2 logs whatsapp-ai-bot`
2. Verify environment variables are correct
3. Ensure MongoDB is running and accessible
4. Check firewall settings for port 4001
