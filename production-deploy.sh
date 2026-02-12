#!/bin/bash

# WhatsApp AI Bot Production Deployment Script
# For WHM/cPanel with PM2

echo "🚀 Starting WhatsApp AI Bot Production Deployment..."
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PRODUCTION_IP="localhost"
PRODUCTION_PORT="4001"
MONGODB_URI="mongodb://root:redhat-bc-12323@127.0.0.1:27017/db01?directConnection=true&serverSelectionTimeoutMS=2000&authSource=db01"
MONGODB_DB_NAME="db01"

echo -e "${BLUE}📋 Production Configuration:${NC}"
echo "   IP: $PRODUCTION_IP"
echo "   Port: $PRODUCTION_PORT"
echo "   MongoDB: $MONGODB_DB_NAME"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed. Installing PM2...${NC}"
    npm install -g pm2
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install PM2. Please install manually.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ PM2 installed successfully${NC}"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}❌ Node.js version 16 or higher is required. Current version: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"

# Create necessary directories
echo -e "${BLUE}📁 Creating necessary directories...${NC}"
mkdir -p data/whatsapp-session
mkdir -p logs
mkdir -p media-files

# Set proper permissions
chmod 755 data
chmod 755 logs
chmod 755 media-files

echo -e "${GREEN}✅ Directories created${NC}"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install --production
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"

# Stop existing PM2 processes
echo -e "${BLUE}🛑 Stopping existing processes...${NC}"
pm2 stop whatsapp-ai-bot 2>/dev/null || true
pm2 delete whatsapp-ai-bot 2>/dev/null || true

# Update ecosystem.config.js with current directory
CURRENT_DIR=$(pwd)
sed -i "s|/path/to/your/bot/directory|$CURRENT_DIR|g" ecosystem.config.js

# Start the application with PM2
echo -e "${BLUE}🚀 Starting WhatsApp AI Bot with PM2...${NC}"
pm2 start ecosystem.config.js

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ WhatsApp AI Bot started successfully!${NC}"
    echo ""
    echo -e "${YELLOW}📱 Next Steps:${NC}"
    echo "1. Check the QR code: pm2 logs whatsapp-ai-bot"
    echo "2. Scan QR code with your WhatsApp to connect"
    echo "3. Monitor status: pm2 status"
    echo "4. View logs: pm2 logs whatsapp-ai-bot"
    echo "5. Web dashboard: http://$PRODUCTION_IP:$PRODUCTION_PORT"
    echo ""
    echo -e "${BLUE}🔧 Useful PM2 Commands:${NC}"
    echo "   pm2 status                    - Check process status"
    echo "   pm2 logs whatsapp-ai-bot     - View logs"
    echo "   pm2 restart whatsapp-ai-bot  - Restart bot"
    echo "   pm2 stop whatsapp-ai-bot     - Stop bot"
    echo "   pm2 delete whatsapp-ai-bot   - Remove from PM2"
    echo "   pm2 monit                    - Monitor resources"
    echo ""
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
else
    echo -e "${RED}❌ Failed to start WhatsApp AI Bot${NC}"
    echo "Check the logs: pm2 logs whatsapp-ai-bot"
    exit 1
fi
