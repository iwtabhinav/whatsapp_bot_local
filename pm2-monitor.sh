#!/bin/bash

# PM2 Service Monitor - Shell Script Version
# This script monitors the whatsapp_api service and restarts it if needed
# Designed to run as a cron job or background process

# Configuration
PROJECT_ROOT="/home/whatsapp"
PROCESS_NAME="whatsapp_api"
LOG_FILE="$PROJECT_ROOT/logs/pm2-monitor.log"
CHECK_INTERVAL=30

# Set up environment for cron
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin:$PATH"
export NODE_PATH="/usr/lib/node_modules"
export HOME="/root"

# Find PM2 path
PM2_PATH=$(which pm2 2>/dev/null || echo "/usr/local/bin/pm2")
if [ ! -f "$PM2_PATH" ]; then
    PM2_PATH="/usr/bin/pm2"
fi
if [ ! -f "$PM2_PATH" ]; then
    PM2_PATH="/usr/local/lib/node_modules/pm2/bin/pm2"
fi

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/logs"

# Logging function
log() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $message" | tee -a "$LOG_FILE"
}

# Debug function
debug_log() {
    log "🔧 Debug: PATH=$PATH"
    log "🔧 Debug: PM2_PATH=$PM2_PATH"
    log "🔧 Debug: PM2 exists: $([ -f "$PM2_PATH" ] && echo "YES" || echo "NO")"
    log "🔧 Debug: PM2 version: $("$PM2_PATH" --version 2>&1 || echo "FAILED")"
}

# Check PM2 status
check_pm2_status() {
    cd "$PROJECT_ROOT"
    "$PM2_PATH" jlist | jq -r ".[] | select(.name==\"$PROCESS_NAME\") | .pm2_env.status" 2>/dev/null
}

# Start service
start_service() {
    log "🔄 Starting $PROCESS_NAME service..."
    cd "$PROJECT_ROOT"
    
    # Try ecosystem file first
    if "$PM2_PATH" start ecosystem-whatsapp.config.js >> "$LOG_FILE" 2>&1; then
        log "✅ Service started with ecosystem file"
        return 0
    else
        log "⚠️ Ecosystem start failed, trying direct script..."
        
        # Try direct script
        if "$PM2_PATH" start start-fixed-bot.js --name "$PROCESS_NAME" >> "$LOG_FILE" 2>&1; then
            log "✅ Service started with direct script"
            return 0
        else
            log "❌ Direct script start also failed"
            return 1
        fi
    fi
}

# Stop service
stop_service() {
    log "⏹️ Stopping $PROCESS_NAME service..."
    cd "$PROJECT_ROOT"
    
    "$PM2_PATH" stop "$PROCESS_NAME" >> "$LOG_FILE" 2>&1
    sleep 3
    "$PM2_PATH" delete "$PROCESS_NAME" >> "$LOG_FILE" 2>&1
    log "✅ Service stopped and deleted"
}

# Restart service
restart_service() {
    log "🔄 Restarting $PROCESS_NAME service..."
    stop_service
    sleep 5
    start_service
}

# Monitor function
monitor() {
    log "🚀 PM2 Monitor started for $PROCESS_NAME"
    log "📁 Project root: $PROJECT_ROOT"
    log "⏰ Check interval: ${CHECK_INTERVAL}s"
    log "📝 Log file: $LOG_FILE"
    
    # Debug logging
    debug_log
    
    while true; do
        local status=$(check_pm2_status)
        
        if [ -z "$status" ]; then
            log "⚠️ Service $PROCESS_NAME not found, starting..."
            start_service
        elif [ "$status" = "stopped" ]; then
            log "⚠️ Service $PROCESS_NAME is stopped, restarting..."
            restart_service
        elif [ "$status" = "errored" ]; then
            log "⚠️ Service $PROCESS_NAME is errored, restarting..."
            restart_service
        elif [ "$status" = "online" ]; then
            log "✅ Service $PROCESS_NAME is online"
        else
            log "⚠️ Service $PROCESS_NAME has unknown status: $status"
        fi
        
        sleep "$CHECK_INTERVAL"
    done
}

# Handle signals
trap 'log "🛑 PM2 Monitor shutting down..."; exit 0' SIGINT SIGTERM

# Run monitor
monitor
