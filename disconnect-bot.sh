#!/bin/bash

echo "========================================"
echo "    WhatsApp Bot Disconnect Script"
echo "========================================"
echo ""

# Step 1: Stop the bot process
echo "[1/4] Stopping bot process..."
pkill -f "node.*start-ai-bot" 2>/dev/null || true
pkill -f "node.*UltraRobustWhatsAppBot" 2>/dev/null || true
sleep 3
echo "✓ Bot processes stopped"
echo ""

# Step 2: Clear session data
echo "[2/4] Clearing session data..."
rm -rf data/whatsapp-session
echo "✓ Session data cleared"
echo ""

# Step 3: Update connection state
echo "[3/4] Updating connection state..."
cat > data/whatsapp-connection-state.json << 'EOF'
{
  "connectionState": "disconnected",
  "isReady": false,
  "isAuthenticated": false,
  "connectedNumber": null,
  "lastUpdate": "2025-09-26T12:00:00.000Z",
  "lastHeartbeat": "2025-09-26T12:00:00.000Z"
}
EOF
echo "✓ Connection state updated to disconnected"
echo ""

# Step 4: Clear QR data
echo "[4/4] Clearing QR data..."
rm -f data/whatsapp-qr.json
rm -f data/whatsapp-qr.png
echo "✓ QR data cleared"
echo ""

echo "========================================"
echo "    Bot Disconnected Successfully!"
echo "========================================"
echo ""
echo "📱 Bot is now disconnected"
echo "📱 Dashboard should show 'INITIALIZING'"
echo "📱 You can start the bot again with: node start-ai-bot.js"
echo ""
