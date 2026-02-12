# WhatsApp Bot Crash Fix (Without PM2)

## Problem
Bot connects successfully but crashes after some time, causing dashboard to show "Initializing" again. PM2 is not available on the server.

## Symptoms
- ✅ Bot connects: "WhatsApp Bot is ready and connected!"
- ❌ Bot crashes: "AI Bot process exited with code 0"
- ❌ System shuts down: "System is shutting down, not restarting"
- 🔄 Dashboard shows "Initializing" again

## Solutions (Without PM2)

### **Solution 1: Auto-Restart Script** 🔄

Use the auto-restart script that keeps the bot running:

```bash
# Make executable
chmod +x fix-bot-crash-no-pm2.sh

# Run the fix
./fix-bot-crash-no-pm2.sh
```

**What it does:**
- Clears session data
- Sets memory limit (512MB)
- Creates auto-restart script
- Keeps bot running with auto-restart

### **Solution 2: Manual Restart with Monitoring** 📊

Use the monitoring script to track and restart the bot:

```bash
# Make executable
chmod +x monitor-bot-simple.sh

# Run monitor
./monitor-bot-simple.sh
```

**Features:**
- Check bot status
- Restart bot manually
- View logs
- Start/stop bot
- Memory monitoring

### **Solution 3: Background Process with nohup** 🚀

Run bot in background with logging:

```bash
# Stop current bot
pkill -f "node.*start-ai-bot"

# Start in background with logging
nohup node start-ai-bot.js > logs/bot.log 2>&1 &

# Check if running
ps aux | grep "node.*start-ai-bot"
```

### **Solution 4: Screen Session** 🖥️

Use screen to keep bot running in background:

```bash
# Install screen if not available
apt-get install screen -y

# Start screen session
screen -S whatsapp-bot

# Run bot in screen
node start-ai-bot.js

# Detach from screen (Ctrl+A, then D)
# Reattach later: screen -r whatsapp-bot
```

## **Quick Fix Commands** ⚡

### **Immediate Fix:**
```bash
# 1. Stop current bot
pkill -f "node.*start-ai-bot"

# 2. Clear session data
rm -rf data/whatsapp-session
mkdir -p data/whatsapp-session

# 3. Start with memory limit
NODE_OPTIONS="--max-old-space-size=512" node start-ai-bot.js
```

### **Background Process:**
```bash
# Start in background with logging
nohup NODE_OPTIONS="--max-old-space-size=512" node start-ai-bot.js > logs/bot.log 2>&1 &

# Check status
ps aux | grep "node.*start-ai-bot"

# View logs
tail -f logs/bot.log
```

## **Root Causes of Crashes** 🔍

### 1. **Memory Issues** 💾
- Bot runs out of memory
- Node.js heap overflow
- Memory leaks

### 2. **Session Timeout** ⏰
- WhatsApp session expires
- Connection drops
- Server-side cleanup

### 3. **Unhandled Errors** 🐛
- Database connection issues
- API rate limiting
- Network problems

### 4. **Process Management** 🔄
- No auto-restart mechanism
- Process dies without recovery

## **Prevention Strategies** 🛡️

### 1. **Memory Management**
```bash
# Set memory limit
export NODE_OPTIONS="--max-old-space-size=512"

# Monitor memory usage
watch -n 5 'ps aux | grep "node.*start-ai-bot"'
```

### 2. **Error Handling**
Add to your bot code:
```javascript
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit, try to recover
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    // Don't exit, try to recover
});
```

### 3. **Regular Restarts**
```bash
# Restart every 6 hours
crontab -e
# Add: 0 */6 * * * /path/to/restart-bot.sh
```

### 4. **Health Checks**
```bash
# Check bot health every 5 minutes
*/5 * * * * /path/to/health-check.sh
```

## **Monitoring Commands** 📊

### **Check Bot Status:**
```bash
# Check if running
ps aux | grep "node.*start-ai-bot"

# Check memory usage
ps -p $(pgrep -f "node.*start-ai-bot") -o rss=

# Check logs
tail -f logs/bot.log
```

### **Restart Bot:**
```bash
# Stop bot
pkill -f "node.*start-ai-bot"

# Start bot
nohup NODE_OPTIONS="--max-old-space-size=512" node start-ai-bot.js > logs/bot.log 2>&1 &
```

## **Expected Results** ✅

After implementing these solutions:
- ✅ Bot stays connected
- ✅ Dashboard shows "CONNECTED" consistently
- ✅ Auto-restart on crashes
- ✅ Memory management
- ✅ Better logging and monitoring

## **Summary**

Since PM2 is not available, use:
1. **Auto-restart script** for continuous operation
2. **Background process** with nohup
3. **Memory limits** to prevent crashes
4. **Monitoring script** for management
5. **Regular restarts** for stability

**This will fix the "Initializing" issue by keeping your bot running!** 🚀
