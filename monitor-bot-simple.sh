#!/bin/bash

echo "========================================"
echo "    WhatsApp Bot Monitor"
echo "    (Simple Monitoring without PM2)"
echo "========================================"
echo ""

# Function to check if bot is running
check_bot_status() {
    if pgrep -f "node.*start-ai-bot" > /dev/null; then
        echo "✅ Bot is RUNNING"
        return 0
    else
        echo "❌ Bot is NOT running"
        return 1
    fi
}

# Function to show bot info
show_bot_info() {
    echo "📊 Bot Status Information:"
    echo "=========================="
    
    # Check if running
    if check_bot_status; then
        # Get process info
        PID=$(pgrep -f "node.*start-ai-bot")
        echo "🆔 Process ID: $PID"
        
        # Get memory usage
        if [ ! -z "$PID" ]; then
            MEMORY=$(ps -p $PID -o rss= | awk '{print $1/1024 " MB"}')
            echo "💾 Memory Usage: $MEMORY"
        fi
        
        # Get uptime
        START_TIME=$(ps -p $PID -o lstart= 2>/dev/null)
        if [ ! -z "$START_TIME" ]; then
            echo "⏰ Started: $START_TIME"
        fi
    fi
    
    echo ""
}

# Function to show recent logs
show_recent_logs() {
    echo "📝 Recent Logs (last 10 lines):"
    echo "==============================="
    
    # Check if there are any log files
    if [ -f "logs/whatsapp-bot.log" ]; then
        tail -10 logs/whatsapp-bot.log
    elif [ -f "logs/bot.log" ]; then
        tail -10 logs/bot.log
    else
        echo "No log files found"
    fi
    
    echo ""
}

# Function to restart bot
restart_bot() {
    echo "🔄 Restarting bot..."
    pkill -f "node.*start-ai-bot" 2>/dev/null
    sleep 3
    echo "✅ Bot stopped"
    echo "📱 Starting bot..."
    nohup node start-ai-bot.js > logs/bot.log 2>&1 &
    echo "✅ Bot started in background"
}

# Main menu
while true; do
    echo "========================================"
    echo "    WhatsApp Bot Monitor Menu"
    echo "========================================"
    echo ""
    
    show_bot_info
    show_recent_logs
    
    echo "🔧 Available Actions:"
    echo "1. Check bot status"
    echo "2. Restart bot"
    echo "3. View full logs"
    echo "4. Start bot (if not running)"
    echo "5. Stop bot"
    echo "6. Exit"
    echo ""
    
    read -p "Choose an option (1-6): " choice
    
    case $choice in
        1)
            check_bot_status
            ;;
        2)
            restart_bot
            ;;
        3)
            echo "📝 Full Logs:"
            echo "============="
            if [ -f "logs/whatsapp-bot.log" ]; then
                cat logs/whatsapp-bot.log
            elif [ -f "logs/bot.log" ]; then
                cat logs/bot.log
            else
                echo "No log files found"
            fi
            ;;
        4)
            if check_bot_status; then
                echo "Bot is already running"
            else
                echo "Starting bot..."
                nohup node start-ai-bot.js > logs/bot.log 2>&1 &
                echo "✅ Bot started in background"
            fi
            ;;
        5)
            if check_bot_status; then
                pkill -f "node.*start-ai-bot"
                echo "✅ Bot stopped"
            else
                echo "Bot is not running"
            fi
            ;;
        6)
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid option. Please choose 1-6."
            ;;
    esac
    
    echo ""
    read -p "Press Enter to continue..."
    clear
done
