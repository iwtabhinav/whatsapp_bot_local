#!/bin/bash

echo "========================================"
echo "    WhatsApp Bot Crash Fix"
echo "    (Without PM2 - Direct Node.js)"
echo "========================================"
echo ""

# Step 1: Stop any running processes
echo "[1/6] Stopping any running bot processes..."
pkill -f "node.*start-ai-bot" 2>/dev/null || true
pkill -f "node.*UltraRobustWhatsAppBot" 2>/dev/null || true
sleep 3
echo "✓ Bot processes stopped"
echo ""

# Step 2: Clear session data
echo "[2/6] Clearing session data for fresh start..."
rm -rf data/whatsapp-session
rm -f data/whatsapp-connection-state.json
rm -f data/whatsapp-qr.json
rm -f data/whatsapp-qr.png
mkdir -p data/whatsapp-session
echo "✓ Session data cleared"
echo ""

# Step 3: Create logs directory
echo "[3/6] Setting up logging..."
mkdir -p logs
echo "✓ Logs directory ready"
echo ""

# Step 4: Set Node.js memory options
echo "[4/6] Setting Node.js memory options..."
export NODE_OPTIONS="--max-old-space-size=512"
echo "✓ Memory limit set to 512MB"
echo ""

# Step 5: Create restart script
echo "[5/6] Creating auto-restart script..."
cat > restart-bot.sh << 'EOF'
#!/bin/bash
echo "🔄 WhatsApp Bot Auto-Restart Script"
echo "====================================="

while true; do
    echo "📱 Starting WhatsApp Bot..."
    echo "⏰ $(date): Bot starting..."
    
    # Start bot with memory limit
    NODE_OPTIONS="--max-old-space-size=512" node start-ai-bot.js
    
    # Check exit code
    exit_code=$?
    echo "❌ Bot crashed with exit code: $exit_code"
    echo "⏰ $(date): Bot crashed, restarting in 10 seconds..."
    
    # Wait before restart
    sleep 10
    
    # Clear session if needed
    if [ $exit_code -eq 1 ]; then
        echo "🧹 Clearing session data..."
        rm -rf data/whatsapp-session
        mkdir -p data/whatsapp-session
    fi
    
    echo "🔄 Restarting bot..."
done
EOF

chmod +x restart-bot.sh
echo "✓ Auto-restart script created"
echo ""

# Step 6: Start bot with auto-restart
echo "[6/6] Starting bot with auto-restart..."
echo "========================================"
echo "    Starting WhatsApp Bot with Auto-Restart"
echo "========================================"
echo ""
echo "📱 Bot will auto-restart if it crashes"
echo "📱 Memory limit: 512MB"
echo "📱 Restart delay: 10 seconds"
echo ""
echo "Press Ctrl+C to stop the auto-restart script"
echo ""

# Start the auto-restart script
./restart-bot.sh
