#!/bin/bash

# Setup PM2 Monitor as Cron Job
# This script sets up the PM2 monitor to run automatically via cron

PROJECT_ROOT="$(pwd)"
MONITOR_SCRIPT="$PROJECT_ROOT/pm2-monitor.sh"
CRON_LOG="$PROJECT_ROOT/logs/pm2-monitor-cron.log"

echo "🔧 Setting up PM2 Monitor as cron job..."
echo "📁 Project root: $PROJECT_ROOT"

# Make monitor script executable
chmod +x "$MONITOR_SCRIPT"

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Create cron entry
CRON_ENTRY="*/1 * * * * $MONITOR_SCRIPT >> $CRON_LOG 2>&1"

echo "📝 Cron entry: $CRON_ENTRY"
echo ""

# Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "$MONITOR_SCRIPT"; then
    echo "⚠️ Cron entry already exists!"
    echo "🔍 Current cron jobs:"
    crontab -l | grep "$MONITOR_SCRIPT"
    echo ""
    echo "❓ Do you want to remove the existing entry and add a new one? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        # Remove existing entry
        crontab -l 2>/dev/null | grep -v "$MONITOR_SCRIPT" | crontab -
        echo "✅ Removed existing cron entry"
    else
        echo "ℹ️ Keeping existing cron entry"
        exit 0
    fi
fi

# Add new cron entry
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

if [ $? -eq 0 ]; then
    echo "✅ Cron job added successfully!"
    echo ""
    echo "🔍 Current cron jobs:"
    crontab -l
    echo ""
    echo "📊 To view monitor logs:"
    echo "tail -f $CRON_LOG"
    echo ""
    echo "🛑 To remove the cron job:"
    echo "crontab -l | grep -v '$MONITOR_SCRIPT' | crontab -"
    echo ""
    echo "✅ Setup complete!"
    echo "📝 The monitor will run every minute and restart the service if needed"
else
    echo "❌ Failed to add cron job"
    echo "📝 You may need to run as root or check permissions"
    exit 1
fi
