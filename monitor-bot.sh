#!/bin/bash

# WhatsApp Bot Monitor Script
# This script checks if the bot is running and restarts it if needed

BOT_DIR="/home/whatsapp"
BOT_SCRIPT="start-ai-bot.js"
LOG_FILE="/home/whatsapp/logs/monitor.log"
PID_FILE="/home/whatsapp/bot.pid"

# Function to log messages
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# Function to check if bot is running
is_bot_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0  # Bot is running
        else
            rm -f "$PID_FILE"  # Remove stale PID file
            return 1  # Bot is not running
        fi
    else
        return 1  # No PID file, bot not running
    fi
}

# Function to start the bot
start_bot() {
    log_message "Starting WhatsApp bot..."
    cd "$BOT_DIR"
    
    # Start the bot in background and save PID
    nohup node "$BOT_SCRIPT" > /dev/null 2>&1 &
    local bot_pid=$!
    echo "$bot_pid" > "$PID_FILE"
    
    # Wait a moment and check if it's still running
    sleep 5
    if ps -p "$bot_pid" > /dev/null 2>&1; then
        log_message "Bot started successfully with PID: $bot_pid"
        return 0
    else
        log_message "Failed to start bot"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to stop the bot
stop_bot() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log_message "Stopping bot with PID: $pid"
            kill "$pid"
            sleep 3
            if ps -p "$pid" > /dev/null 2>&1; then
                log_message "Force killing bot with PID: $pid"
                kill -9 "$pid"
            fi
        fi
        rm -f "$PID_FILE"
    fi
}

# Main monitoring logic
log_message "Bot monitor started"

if is_bot_running; then
    log_message "Bot is already running"
else
    log_message "Bot is not running, starting it..."
    start_bot
fi

# If we reach here, the bot should be running
if is_bot_running; then
    log_message "Bot monitoring complete - bot is running"
else
    log_message "Bot monitoring complete - bot failed to start"
fi