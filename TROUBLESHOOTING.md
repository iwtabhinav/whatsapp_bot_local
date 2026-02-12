# Troubleshooting Guide

## Common Issues and Solutions

### 1. Connection Issues

#### Error: "Stream Errored (conflict)"
**Cause:** Multiple WhatsApp Web sessions or connection conflicts
**Solution:**
- Close all WhatsApp Web sessions in browsers
- Wait 5-10 minutes before reconnecting
- Delete the `auth_info_baileys` folder and reconnect
- Use the robust bot: `npm run robust`

#### Error: "Stream Errored (restart required)"
**Cause:** Connection timeout or server issues
**Solution:**
- Check your internet connection
- Restart the bot
- Use the test connection script: `npm run test-connection`

#### Error: "Connection was lost"
**Cause:** Network instability or server disconnection
**Solution:**
- Check your internet connection
- The bot will automatically reconnect
- Use the robust bot for better reconnection handling

### 2. Authentication Issues

#### QR Code not appearing
**Cause:** Display issues or terminal problems
**Solution:**
- Make sure your terminal supports QR code display
- Try running: `npm run test-connection`
- Check if `qrcode-terminal` is installed

#### Authentication fails repeatedly
**Cause:** Corrupted authentication data
**Solution:**
```bash
# Delete authentication data
rm -rf auth_info_baileys

# Reconnect
npm start
```

### 3. Module Not Found Errors

#### Error: "Cannot find module 'protobufjs/minimal'"
**Solution:**
```bash
npm install protobufjs
```

#### Error: "Cannot find module 'libsignal'"
**Solution:**
```bash
npm install libsignal
```

### 4. Media Upload Issues

#### Images/Videos not uploading
**Cause:** Invalid file paths or unsupported formats
**Solution:**
- Use valid URLs or file paths
- Check file permissions
- Ensure file formats are supported

#### Audio messages not working
**Cause:** Missing audio processing libraries
**Solution:**
```bash
npm install audio-decode music-metadata
```

### 5. Group Management Issues

#### Cannot add/remove users
**Cause:** Insufficient permissions
**Solution:**
- Ensure the bot is an admin in the group
- Check if the user exists and is not already in the group
- Verify the user's phone number format

#### Group commands not working
**Cause:** Commands being used in private chats
**Solution:**
- Group management commands only work in groups
- Make sure you're in a group chat

### 6. Performance Issues

#### Bot responding slowly
**Cause:** High message volume or resource constraints
**Solution:**
- Use the robust bot: `npm run robust`
- Add delays between commands
- Monitor system resources

#### Memory usage high
**Cause:** Message caching or media processing
**Solution:**
- Restart the bot periodically
- Clear message cache
- Optimize media processing

## Quick Fixes

### Reset Everything
```bash
# Stop the bot (Ctrl+C)
# Delete authentication data
rm -rf auth_info_baileys

# Reinstall dependencies
npm install

# Test connection
npm run test-connection

# Start robust bot
npm run robust
```

### Check Dependencies
```bash
# Install all dependencies
npm run install-deps

# Check for missing packages
npm list
```

### Test Individual Components
```bash
# Test connection only
npm run test-connection

# Test basic bot
npm run bot

# Test advanced features
npm run demo
```

## Bot Variants

### 1. Basic Bot (`npm run bot`)
- Simple implementation
- Good for basic testing
- Minimal error handling

### 2. Robust Bot (`npm run robust`)
- Enhanced error handling
- Auto-reconnection
- Better stability
- **Recommended for production**

### 3. Demo Bot (`npm run demo`)
- Feature demonstration
- Detailed logging
- Good for testing features

### 4. Test Connection (`npm run test-connection`)
- Connection testing only
- No message handling
- Good for troubleshooting

## Environment Requirements

### Node.js
- Version: 16.0.0 or higher
- Check: `node --version`

### Dependencies
- All required packages installed
- Check: `npm list`

### System
- Stable internet connection
- Sufficient memory (512MB+)
- Terminal with QR code support

## Getting Help

### 1. Check Logs
Look for error messages in the console output

### 2. Test Connection
```bash
npm run test-connection
```

### 3. Use Robust Bot
```bash
npm run robust
```

### 4. Check Dependencies
```bash
npm run install-deps
```

### 5. Reset Authentication
```bash
rm -rf auth_info_baileys
npm start
```

## Best Practices

1. **Use the robust bot** for production
2. **Test connection** before running the main bot
3. **Keep dependencies updated**
4. **Monitor system resources**
5. **Use proper error handling** in custom commands
6. **Avoid running multiple instances** simultaneously
7. **Keep authentication data secure**

## Support

If you continue to experience issues:

1. Check this troubleshooting guide
2. Verify all dependencies are installed
3. Test with the connection test script
4. Try the robust bot variant
5. Check the console output for specific error messages
6. Ensure your WhatsApp account is not restricted
