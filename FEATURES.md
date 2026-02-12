# WhatsApp Bot Features

This repository contains a comprehensive WhatsApp bot implementation with ALL possible WhatsApp features.

## 🚀 Files Overview

### Core Files
- **`bot.js`** - Basic bot implementation with all features
- **`advanced-bot.js`** - Advanced bot class with event system, middleware, and command system
- **`start.js`** - Main startup script with all commands pre-configured
- **`example.js`** - Complete example showing how to use the advanced bot
- **`features-demo.js`** - Feature demonstration bot with detailed logging

### Utility Files
- **`install.js`** - Installation script for dependencies
- **`package.json`** - Project configuration and dependencies
- **`README.md`** - Basic documentation
- **`FEATURES.md`** - This file with detailed feature list

## 🎯 All Supported Features

### 📝 Basic Messages
- ✅ **Text Messages** - Send simple text messages
- ✅ **Quote Messages** - Reply to specific messages
- ✅ **Mention Users** - Mention specific users in messages
- ✅ **Status Mentions** - Mention users in status updates
- ✅ **Link Preview Messages** - Messages with automatic link previews

### 🎛️ Interactive Messages
- ✅ **Buttons Message** - Send messages with clickable buttons
- ✅ **Buttons Flow** - Interactive button flows
- ✅ **Interactive Message** - Rich interactive messages
- ✅ **List Message** - Send selectable list messages
- ✅ **Carousel Message** - Carousel-style list messages
- ✅ **Interactive Response** - Handle interactive responses

### 📊 Polls & Media
- ✅ **Poll Messages** - Create polls with multiple options
- ✅ **Image Messages** - Send images with captions
- ✅ **Video Messages** - Send videos with captions
- ✅ **Audio Messages** - Send audio files (voice notes)
- ✅ **GIF Messages** - Send animated GIFs
- ✅ **Sticker Messages** - Send stickers
- ✅ **Document Messages** - Send files and documents
- ✅ **View Once Messages** - Send messages that disappear after viewing
- ✅ **Album Messages** - Send multiple media as an album

### 📍 Location & Contact
- ✅ **Location Messages** - Send location with coordinates
- ✅ **Contact Messages** - Send contact cards (vCard)

### ⚡ Message Actions
- ✅ **Reaction Messages** - React to messages with emojis
- ✅ **Pin Messages** - Pin important messages
- ✅ **Forward Messages** - Forward messages to other chats
- ✅ **Edit Messages** - Edit sent messages
- ✅ **Delete Messages** - Delete messages (for everyone)
- ✅ **Mark as Read** - Mark messages as read
- ✅ **Update Presence** - Update typing/online status

### 🔧 Group Management
- ✅ **Get Group Info** - Retrieve group metadata
- ✅ **Add Participants** - Add users to groups
- ✅ **Remove Participants** - Remove users from groups
- ✅ **Promote Admins** - Promote users to group admins
- ✅ **Demote Admins** - Remove admin privileges
- ✅ **Change Group Subject** - Update group name
- ✅ **Change Group Description** - Update group description
- ✅ **Update Group Settings** - Modify group settings

### 🎯 Advanced Features
- ✅ **Status Mentions** - Mention users in status updates
- ✅ **Payment Requests** - Request payments (demo)
- ✅ **Event Messages** - Send event/calendar messages
- ✅ **Media Download** - Download media from messages
- ✅ **Media Re-upload** - Re-upload media to WhatsApp
- ✅ **Profile Management** - Update bot profile
- ✅ **Call Rejection** - Automatically reject incoming calls
- ✅ **Event System** - Custom event handling
- ✅ **Middleware Support** - Message processing middleware
- ✅ **Command System** - Custom command handling

## 🚀 Quick Start

### 1. Installation
```bash
# Install dependencies
npm run install-deps

# Or manually
npm install
npm install jimp link-preview-js qrcode-terminal sharp
```

### 2. Run the Bot
```bash
# Main bot with all features
npm start

# Feature demonstration bot
npm run demo

# Basic bot
npm run bot

# Advanced bot class
npm run advanced

# Complete example
npm run example
```

### 3. Test Features
1. Scan QR code with WhatsApp
2. Send `!help` to any chat
3. Try various commands like:
   - `!text Hello World`
   - `!buttons Choose an option`
   - `!poll "What is your favorite color?" "Red,Blue,Green"`
   - `!image https://via.placeholder.com/300x200 "Sample Image"`
   - `!location 37.7749 -122.4194 "San Francisco"`

## 📋 Available Commands

### Basic Commands
- `!help` - Show all available commands
- `!text <message>` - Send a text message
- `!quote <message>` - Send a quoted message
- `!mention <@user> <message>` - Mention a user
- `!reaction <emoji>` - React to a message

### Interactive Commands
- `!buttons <text>` - Send buttons message
- `!list <text>` - Send list message
- `!poll <question> <option1,option2,...>` - Create a poll
- `!carousel` - Send carousel message
- `!interactive` - Send interactive message
- `!buttonsflow` - Send buttons flow message

### Media Commands
- `!image <path/url> <caption>` - Send image
- `!video <path/url> <caption>` - Send video
- `!audio <path/url>` - Send audio
- `!sticker <path/url>` - Send sticker
- `!document <path/url> <filename>` - Send document
- `!viewonce <path/url> <type>` - Send view once message
- `!album <path1,path2,...>` - Send album

### Location & Contact Commands
- `!location <lat> <lng> <name>` - Send location
- `!contact <name> <phone> <email>` - Send contact

### Action Commands
- `!forward` - Forward a message
- `!edit <new_text>` - Edit a message
- `!delete` - Delete a message
- `!pin` - Pin a message
- `!read` - Mark as read
- `!presence <type>` - Update presence

### Group Management Commands
- `!groupinfo` - Get group info
- `!add <@user>` - Add user to group
- `!remove <@user>` - Remove user from group
- `!promote <@user>` - Promote user to admin
- `!demote <@user>` - Demote user from admin
- `!subject <new_subject>` - Change group subject
- `!description <new_desc>` - Change group description

### Advanced Commands
- `!statusmention <message>` - Send status mention
- `!payment <amount> <currency>` - Request payment
- `!event <title> <date>` - Send event message

## 🔧 Customization

### Adding Custom Commands
```javascript
bot.command('!custom', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const text = args.join(' ');
    
    await sock.sendMessage(jid, { 
        text: `Custom command executed with: ${text}` 
    });
});
```

### Adding Middleware
```javascript
bot.use(async (msg, sock) => {
    // Log all messages
    console.log('Message received:', msg.key.remoteJid);
    
    // Add custom logic here
    if (msg.message.conversation?.includes('spam')) {
        return false; // Stop processing
    }
});
```

### Event Handling
```javascript
bot.on('ready', () => {
    console.log('Bot is ready!');
});

bot.on('message', (msg) => {
    console.log('New message:', msg);
});

bot.on('call', (call) => {
    console.log('Incoming call:', call);
});
```

## 📁 File Structure

```
whatsapp-bot-advanced/
├── bot.js                 # Basic bot implementation
├── advanced-bot.js        # Advanced bot class
├── start.js               # Main startup script
├── example.js             # Complete example
├── features-demo.js       # Feature demonstration
├── install.js             # Installation script
├── package.json           # Dependencies
├── README.md              # Basic documentation
├── FEATURES.md            # This file
└── lib/                   # Baileys library files
    ├── index.js
    ├── Socket/
    ├── Types/
    ├── Utils/
    └── ...
```

## 🛠️ Development

### Running in Development Mode
```bash
npm run dev
```

### Testing Features
```bash
npm run demo
```

### Building
```bash
npm run build
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This bot is for educational purposes only. Please respect WhatsApp's Terms of Service and use responsibly.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the documentation
2. Search existing issues
3. Create a new issue with detailed information
4. Join our community discussions

---

**This bot demonstrates ALL possible WhatsApp features and can be used as a reference implementation for building WhatsApp bots with Baileys.**
