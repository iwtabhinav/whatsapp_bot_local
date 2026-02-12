#!/bin/bash

# Test script for PM2 restart functionality on Linux
# This script can be used to manually test the PM2 restart process

echo "🧪 Testing PM2 restart functionality..."
echo "======================================"

# Check if PM2 is available
echo "📊 Checking PM2 availability..."
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 is available"
    pm2 --version
else
    echo "❌ PM2 not found"
    exit 1
fi

echo ""

# Check current PM2 processes
echo "📊 Current PM2 processes:"
pm2 list

echo ""

# Check for WhatsApp processes
echo "📱 Looking for WhatsApp processes..."
pm2 jlist | jq '.[] | select(.name | contains("whatsapp") or contains("bot")) | {name: .name, status: .pm2_env.status}'

echo ""

# Test restart command
echo "🔄 Testing PM2 restart..."
echo "Attempting to restart whatsapp_api..."

# Try different restart strategies
echo "Strategy 1: pm2 restart whatsapp_api"
pm2 restart whatsapp_api 2>&1

if [ $? -ne 0 ]; then
    echo "Strategy 2: pm2 start whatsapp_api"
    pm2 start whatsapp_api 2>&1
    
    if [ $? -ne 0 ]; then
        echo "Strategy 3: pm2 start ecosystem-whatsapp.config.js"
        pm2 start ecosystem-whatsapp.config.js 2>&1
        
        if [ $? -ne 0 ]; then
            echo "Strategy 4: pm2 start start-fixed-bot.js --name whatsapp_api"
            pm2 start start-fixed-bot.js --name whatsapp_api 2>&1
        fi
    fi
fi

echo ""

# Wait a moment and check status
echo "⏳ Waiting for process to start..."
sleep 5

echo "📊 Final PM2 status:"
pm2 list

echo ""

# Check if process is running
echo "📱 WhatsApp process status:"
pm2 jlist | jq '.[] | select(.name | contains("whatsapp") or contains("bot")) | {name: .name, status: .pm2_env.status, uptime: .pm2_env.uptime}'

echo ""
echo "✅ Test completed!"
echo ""
echo "💡 If the process is not running, check:"
echo "   - PM2 logs: pm2 logs whatsapp_api"
echo "   - Bot script exists: ls -la start-fixed-bot.js"
echo "   - Ecosystem file exists: ls -la ecosystem-whatsapp.config.js"
