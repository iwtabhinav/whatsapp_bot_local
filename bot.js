const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('./lib');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');

// Logger configuration
const logger = P({ level: 'silent' });

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.isConnected = false;
        this.authDir = './auth_info_baileys';
    }

    async initialize() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

            this.sock = makeWASocket({
                version,
                logger,
                printQRInTerminal: true,
                auth: state,
                browser: ['WhatsApp Bot', 'Chrome', '4.0.0'],
                generateHighQualityLinkPreview: true,
                getMessage: async (key) => {
                    return {
                        conversation: "Hello! I'm a WhatsApp bot."
                    };
                }
            });

            this.setupEventHandlers();
            this.sock.ev.on('creds.update', saveCreds);

            return this.sock;
        } catch (error) {
            console.error('Error initializing bot:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR Code received, scan it with your WhatsApp app');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);

                if (shouldReconnect) {
                    this.initialize();
                }
            } else if (connection === 'open') {
                console.log('WhatsApp Bot is ready!');
                this.isConnected = true;
            }
        });

        this.sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            const messageText = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                '';

            if (messageText.startsWith('!')) {
                await this.handleCommand(msg);
            }
        });

        this.sock.ev.on('call', async (call) => {
            console.log('Incoming call, rejecting...');
            await this.sock.rejectCall(call[0].id, call[0].from);
        });
    }

    async handleCommand(msg) {
        const command = msg.message.conversation?.toLowerCase() ||
            msg.message.extendedTextMessage?.text?.toLowerCase() || '';
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');

        try {
            switch (command) {
                case '!help':
                    await this.sendHelpMessage(jid);
                    break;
                case '!text':
                    await this.sendTextMessage(jid);
                    break;
                case '!buttons':
                    await this.sendButtonsMessage(jid);
                    break;
                case '!buttonsflow':
                    await this.sendButtonsFlowMessage(jid);
                    break;
                case '!interactive':
                    await this.sendInteractiveMessage(jid);
                    break;
                case '!quote':
                    await this.sendQuoteMessage(jid, msg);
                    break;
                case '!mention':
                    await this.sendMentionMessage(jid, msg);
                    break;
                case '!statusmention':
                    await this.sendStatusMention(jid);
                    break;
                case '!list':
                    await this.sendListMessage(jid);
                    break;
                case '!carousel':
                    await this.sendCarouselMessage(jid);
                    break;
                case '!poll':
                    await this.sendPollMessage(jid);
                    break;
                case '!location':
                    await this.sendLocationMessage(jid);
                    break;
                case '!contact':
                    await this.sendContactMessage(jid);
                    break;
                case '!reaction':
                    await this.sendReactionMessage(jid, msg);
                    break;
                case '!pin':
                    await this.sendPinMessage(jid, msg);
                    break;
                case '!image':
                    await this.sendImageMessage(jid);
                    break;
                case '!video':
                    await this.sendVideoMessage(jid);
                    break;
                case '!audio':
                    await this.sendAudioMessage(jid);
                    break;
                case '!gif':
                    await this.sendGifMessage(jid);
                    break;
                case '!viewonce':
                    await this.sendViewOnceMessage(jid);
                    break;
                case '!album':
                    await this.sendAlbumMessage(jid);
                    break;
                case '!linkpreview':
                    await this.sendLinkPreviewMessage(jid);
                    break;
                case '!forward':
                    await this.sendForwardMessage(jid, msg);
                    break;
                case '!edit':
                    await this.sendEditMessage(jid, msg);
                    break;
                case '!delete':
                    await this.sendDeleteMessage(jid, msg);
                    break;
                case '!read':
                    await this.markAsRead(jid, msg);
                    break;
                case '!presence':
                    await this.updatePresence(jid);
                    break;
                case '!payment':
                    await this.sendPaymentRequest(jid);
                    break;
                case '!event':
                    await this.sendEventMessage(jid);
                    break;
                default:
                    await this.sock.sendMessage(jid, { text: 'Unknown command. Type !help for available commands.' });
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await this.sock.sendMessage(jid, { text: 'An error occurred while processing your request.' });
        }
    }

    async sendHelpMessage(jid) {
        const helpText = `🤖 *WhatsApp Bot Commands*

📝 *Basic Messages:*
• !text - Send a simple text message
• !quote - Send a quoted message
• !mention - Mention a user
• !statusmention - Send status mention

🎛️ *Interactive Messages:*
• !buttons - Send buttons message
• !buttonsflow - Send buttons flow message
• !interactive - Send interactive message
• !list - Send list message
• !carousel - Send carousel message

📊 *Polls & Media:*
• !poll - Create a poll
• !image - Send image message
• !video - Send video message
• !audio - Send audio message
• !gif - Send GIF message
• !viewonce - Send view once message
• !album - Send album message

📍 *Location & Contact:*
• !location - Send location
• !contact - Send contact card

⚡ *Actions:*
• !reaction - Send reaction
• !pin - Pin a message
• !forward - Forward message
• !edit - Edit message
• !delete - Delete message
• !read - Mark as read
• !presence - Update presence

🔗 *Other:*
• !linkpreview - Send message with link preview
• !payment - Request payment
• !event - Send event message

Type any command to try it out!`;

        await this.sock.sendMessage(jid, { text: helpText });
    }

    async sendTextMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Hello! This is a simple text message from the WhatsApp bot. 👋'
        });
    }

    async sendButtonsMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Choose an option:',
            buttons: [
                { buttonId: 'btn1', buttonText: { displayText: 'Option 1' }, type: 1 },
                { buttonId: 'btn2', buttonText: { displayText: 'Option 2' }, type: 1 },
                { buttonId: 'btn3', buttonText: { displayText: 'Option 3' }, type: 1 }
            ]
        });
    }

    async sendButtonsFlowMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Interactive Buttons Flow:',
            buttons: [
                { buttonId: 'flow1', buttonText: { displayText: 'Start Flow' }, type: 1 },
                { buttonId: 'flow2', buttonText: { displayText: 'Continue Flow' }, type: 1 }
            ]
        });
    }

    async sendInteractiveMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Interactive Message:',
            buttons: [
                { buttonId: 'interactive1', buttonText: { displayText: 'Interactive Button 1' }, type: 1 },
                { buttonId: 'interactive2', buttonText: { displayText: 'Interactive Button 2' }, type: 1 }
            ]
        });
    }

    async sendQuoteMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            text: 'This is a quoted message!',
            quoted: originalMsg
        });
    }

    async sendMentionMessage(jid, originalMsg) {
        const mentionedJid = originalMsg.key.participant || jid;
        await this.sock.sendMessage(jid, {
            text: `Hello @${mentionedJid.split('@')[0]}, you were mentioned!`,
            mentions: [mentionedJid]
        });
    }

    async sendStatusMention(jid) {
        // This would require specific implementation for status mentions
        await this.sock.sendMessage(jid, {
            text: 'Status mention feature - this would mention users in status updates'
        });
    }

    async sendListMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Choose from the list:',
            sections: [{
                title: 'Section 1',
                rows: [
                    { title: 'Option 1', description: 'Description 1', rowId: 'row1' },
                    { title: 'Option 2', description: 'Description 2', rowId: 'row2' },
                    { title: 'Option 3', description: 'Description 3', rowId: 'row3' }
                ]
            }]
        });
    }

    async sendCarouselMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Carousel Message:',
            sections: [{
                title: 'Carousel Section',
                rows: [
                    { title: 'Item 1', description: 'Description 1', rowId: 'carousel1' },
                    { title: 'Item 2', description: 'Description 2', rowId: 'carousel2' },
                    { title: 'Item 3', description: 'Description 3', rowId: 'carousel3' }
                ]
            }]
        });
    }

    async sendPollMessage(jid) {
        await this.sock.sendMessage(jid, {
            poll: {
                name: 'What is your favorite programming language?',
                options: ['JavaScript', 'Python', 'Java', 'C++'],
                selectableCount: 1
            }
        });
    }

    async sendLocationMessage(jid) {
        await this.sock.sendMessage(jid, {
            location: {
                degreesLatitude: 37.7749,
                degreesLongitude: -122.4194,
                name: 'San Francisco',
                address: 'San Francisco, CA, USA'
            }
        });
    }

    async sendContactMessage(jid) {
        await this.sock.sendMessage(jid, {
            contacts: {
                displayName: 'John Doe',
                contacts: [{
                    displayName: 'John Doe',
                    vcard: `BEGIN:VCARD
VERSION:3.0
FN:John Doe
ORG:Example Company
TEL:+1234567890
EMAIL:john@example.com
END:VCARD`
                }]
            }
        });
    }

    async sendReactionMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            react: {
                text: '👍',
                key: originalMsg.key
            }
        });
    }

    async sendPinMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            pin: originalMsg.key
        });
    }

    async sendImageMessage(jid) {
        // Create a simple image buffer (in real implementation, you'd load an actual image)
        const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

        await this.sock.sendMessage(jid, {
            image: imageBuffer,
            caption: 'This is an image message!'
        });
    }

    async sendVideoMessage(jid) {
        // Create a simple video buffer (in real implementation, you'd load an actual video)
        const videoBuffer = Buffer.from('sample video data');

        await this.sock.sendMessage(jid, {
            video: videoBuffer,
            caption: 'This is a video message!'
        });
    }

    async sendAudioMessage(jid) {
        // Create a simple audio buffer (in real implementation, you'd load an actual audio file)
        const audioBuffer = Buffer.from('sample audio data');

        await this.sock.sendMessage(jid, {
            audio: audioBuffer,
            ptt: true // Push to talk
        });
    }

    async sendGifMessage(jid) {
        // Create a simple GIF buffer (in real implementation, you'd load an actual GIF)
        const gifBuffer = Buffer.from('sample gif data');

        await this.sock.sendMessage(jid, {
            video: gifBuffer,
            gifPlayback: true,
            caption: 'This is a GIF message!'
        });
    }

    async sendViewOnceMessage(jid) {
        const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

        await this.sock.sendMessage(jid, {
            viewOnce: {
                message: {
                    imageMessage: {
                        url: 'data:image/png;base64,' + imageBuffer.toString('base64'),
                        mimetype: 'image/png'
                    }
                }
            }
        });
    }

    async sendAlbumMessage(jid) {
        const image1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
        const image2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

        await this.sock.sendAlbumMessage(jid, [
            { image: image1, caption: 'First image' },
            { image: image2, caption: 'Second image' }
        ]);
    }

    async sendLinkPreviewMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Check out this website: https://github.com/WhiskeySockets/Baileys'
        });
    }

    async sendForwardMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            forward: originalMsg
        });
    }

    async sendEditMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            edit: originalMsg.key,
            text: 'This message has been edited!'
        });
    }

    async sendDeleteMessage(jid, originalMsg) {
        await this.sock.sendMessage(jid, {
            delete: originalMsg.key
        });
    }

    async markAsRead(jid, msg) {
        await this.sock.readMessages([msg.key]);
    }

    async updatePresence(jid) {
        await this.sock.presenceSubscribe(jid);
        await this.sock.sendPresenceUpdate('composing', jid);

        setTimeout(async () => {
            await this.sock.sendPresenceUpdate('paused', jid);
        }, 3000);
    }

    async sendPaymentRequest(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Payment request feature - this would integrate with payment systems'
        });
    }

    async sendEventMessage(jid) {
        await this.sock.sendMessage(jid, {
            text: 'Event message - this would be used for calendar events or notifications'
        });
    }

    // Utility methods
    async downloadMediaMessage(msg) {
        const buffer = await this.sock.downloadMediaMessage(msg);
        return buffer;
    }

    async reuploadMediaMessage(msg) {
        const updated = await this.sock.updateMediaMessage(msg);
        return updated;
    }

    async getProfilePicture(jid) {
        const url = await this.sock.profilePictureUrl(jid);
        return url;
    }

    async getGroupMetadata(jid) {
        const metadata = await this.sock.groupMetadata(jid);
        return metadata;
    }

    async getChats() {
        const chats = await this.sock.getChats();
        return chats;
    }

    async getMessages(jid, limit = 25) {
        const messages = await this.sock.getMessages(jid, { limit });
        return messages;
    }
}

// Export the bot class
module.exports = WhatsAppBot;

// If this file is run directly, start the bot
if (require.main === module) {
    const bot = new WhatsAppBot();

    bot.initialize().then(() => {
        console.log('Bot initialized successfully!');
    }).catch((error) => {
        console.error('Failed to initialize bot:', error);
        process.exit(1);
    });
}
