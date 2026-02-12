#!/usr/bin/env node

const AdvancedWhatsAppBot = require('./advanced-bot');

console.log('🚀 Starting Advanced WhatsApp Bot...');
console.log('📱 This bot supports all WhatsApp features including:');
console.log('   • Text, Buttons, List, Poll Messages');
console.log('   • Media Messages (Image, Video, Audio, GIF, Sticker)');
console.log('   • View Once, Album, Location, Contact Messages');
console.log('   • Reaction, Pin, Forward, Edit, Delete Messages');
console.log('   • Group Management (Add/Remove, Promote/Demote)');
console.log('   • Status Mentions, Payment Requests, Event Messages');
console.log('   • And much more...');
console.log('');

// Create bot instance
const bot = new AdvancedWhatsAppBot({
    authDir: './auth_info_baileys',
    printQRInTerminal: true,
    generateHighQualityLinkPreview: true
});

// Setup event handlers
bot.on('ready', () => {
    console.log('✅ Bot is ready and listening for messages!');
    console.log('💬 Send !help to any chat to see available commands.');
});

bot.on('message', (msg) => {
    const messageText = msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

    if (messageText && messageText.startsWith('!')) {
        console.log(`🎯 Command received: ${messageText}`);
    }
});

// Setup basic commands
bot.command('!help', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const helpText = `🤖 *Advanced WhatsApp Bot Commands*

📝 *Basic Messages:*
• !text <message> - Send a text message
• !quote <message> - Send a quoted message
• !mention <@user> <message> - Mention a user
• !reaction <emoji> - React to a message

🎛️ *Interactive Messages:*
• !buttons <text> - Send buttons message
• !list <text> - Send list message
• !poll <question> <option1,option2,...> - Create a poll
• !carousel - Send carousel message
• !interactive - Send interactive message

📊 *Media Messages:*
• !image <path/url> <caption> - Send image
• !video <path/url> <caption> - Send video
• !audio <path/url> - Send audio
• !sticker <path/url> - Send sticker
• !document <path/url> <filename> - Send document
• !viewonce <path/url> <type> - Send view once message
• !album <path1,path2,...> - Send album

📍 *Location & Contact:*
• !location <lat> <lng> <name> - Send location
• !contact <name> <phone> <email> - Send contact

⚡ *Actions:*
• !forward - Forward a message
• !edit <new_text> - Edit a message
• !delete - Delete a message
• !pin - Pin a message
• !read - Mark as read
• !presence <type> - Update presence

🔧 *Group Management:*
• !groupinfo - Get group info
• !add <@user> - Add user to group
• !remove <@user> - Remove user from group
• !promote <@user> - Promote user to admin
• !demote <@user> - Demote user from admin
• !subject <new_subject> - Change group subject
• !description <new_desc> - Change group description

🎯 *Advanced Features:*
• !statusmention <message> - Send status mention
• !payment <amount> <currency> - Request payment
• !event <title> <date> - Send event message

Type any command to try it out!`;

    await sock.sendMessage(jid, { text: helpText });
});

bot.command('!text', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const text = args.join(' ') || 'Hello! This is a text message from the advanced bot.';
    await sock.sendMessage(jid, { text });
});

bot.command('!buttons', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const text = args.join(' ') || 'Choose an option:';
    await bot.sendButtonsMessage(jid, text, [
        { id: 'btn1', text: 'Option 1' },
        { id: 'btn2', text: 'Option 2' },
        { id: 'btn3', text: 'Option 3' }
    ]);
});

bot.command('!list', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const text = args.join(' ') || 'Choose from the list:';
    await bot.sendListMessage(jid, text, [{
        title: 'Main Menu',
        rows: [
            { id: 'row1', title: 'Option 1', description: 'Description for option 1' },
            { id: 'row2', title: 'Option 2', description: 'Description for option 2' },
            { id: 'row3', title: 'Option 3', description: 'Description for option 3' }
        ]
    }]);
});

bot.command('!poll', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (args.length < 2) {
        await sock.sendMessage(jid, { text: 'Usage: !poll <question> <option1,option2,...>' });
        return;
    }

    const question = args[0];
    const options = args[1].split(',');
    await bot.sendPollMessage(jid, question, options);
});

bot.command('!location', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (args.length < 2) {
        await sock.sendMessage(jid, { text: 'Usage: !location <latitude> <longitude> [name]' });
        return;
    }

    const lat = parseFloat(args[0]);
    const lng = parseFloat(args[1]);
    const name = args[2] || 'Location';

    await bot.sendLocationMessage(jid, lat, lng, name);
});

bot.command('!contact', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (args.length < 2) {
        await sock.sendMessage(jid, { text: 'Usage: !contact <name> <phone> [email]' });
        return;
    }

    const name = args[0];
    const phone = args[1];
    const email = args[2] || '';

    await bot.sendContactMessage(jid, name, phone, email);
});

bot.command('!image', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://via.placeholder.com/300x200/0000FF/FFFFFF?text=Sample+Image';
    const caption = args.slice(1).join(' ') || 'This is an image message!';

    try {
        await bot.sendImageMessage(jid, path, caption);
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending image: ' + error.message });
    }
});

bot.command('!video', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';
    const caption = args.slice(1).join(' ') || 'This is a video message!';

    try {
        await bot.sendVideoMessage(jid, path, caption);
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending video: ' + error.message });
    }
});

bot.command('!audio', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav';

    try {
        await bot.sendAudioMessage(jid, path, { ptt: true });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending audio: ' + error.message });
    }
});

bot.command('!sticker', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVy/giphy.gif';

    try {
        await bot.sendStickerMessage(jid, path);
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending sticker: ' + error.message });
    }
});

bot.command('!document', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    const filename = args[1] || 'document.pdf';

    try {
        await bot.sendDocumentMessage(jid, path, filename, 'This is a document message!');
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending document: ' + error.message });
    }
});

bot.command('!viewonce', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const path = args[0] || 'https://via.placeholder.com/300x200/FF0000/FFFFFF?text=View+Once';
    const type = args[1] || 'image';

    try {
        await bot.sendViewOnceMessage(jid, path, type, 'This is a view once message!');
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending view once message: ' + error.message });
    }
});

bot.command('!album', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const paths = args.length > 0 ? args : [
        'https://via.placeholder.com/300x200/FF0000/FFFFFF?text=Image+1',
        'https://via.placeholder.com/300x200/00FF00/FFFFFF?text=Image+2',
        'https://via.placeholder.com/300x200/0000FF/FFFFFF?text=Image+3'
    ];

    const medias = paths.map((path, index) => ({
        image: path,
        caption: `Album image ${index + 1}`
    }));

    try {
        await bot.sendAlbumMessage(jid, medias);
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending album: ' + error.message });
    }
});

bot.command('!forward', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.forwardMessage(jid, msg);
});

bot.command('!edit', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const newText = args.join(' ') || 'This message has been edited!';
    await bot.editMessage(jid, msg.key, newText);
});

bot.command('!delete', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.deleteMessage(jid, msg.key);
});

bot.command('!pin', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.pinMessage(jid, msg.key);
});

bot.command('!read', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.markAsRead(jid, [msg.key]);
});

bot.command('!presence', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const presence = args[0] || 'composing';
    await bot.updatePresence(jid, presence);
});

bot.command('!groupinfo', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    try {
        const metadata = await bot.getGroupMetadata(jid);
        const info = `*Group Information:*
📝 *Name:* ${metadata.subject}
👥 *Participants:* ${metadata.participants.length}
📅 *Created:* ${new Date(metadata.creation * 1000).toLocaleDateString()}
🔒 *Restricted:* ${metadata.restrict ? 'Yes' : 'No'}
📱 *Announcement:* ${metadata.announce ? 'Yes' : 'No'}`;

        await sock.sendMessage(jid, { text: info });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error getting group info: ' + error.message });
    }
});

bot.command('!add', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !add <@user>' });
        return;
    }

    const userJid = args[0].replace('@', '') + '@s.whatsapp.net';

    try {
        await bot.addGroupParticipants(jid, [userJid]);
        await sock.sendMessage(jid, { text: `Added ${args[0]} to the group.` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error adding user: ' + error.message });
    }
});

bot.command('!remove', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !remove <@user>' });
        return;
    }

    const userJid = args[0].replace('@', '') + '@s.whatsapp.net';

    try {
        await bot.removeGroupParticipants(jid, [userJid]);
        await sock.sendMessage(jid, { text: `Removed ${args[0]} from the group.` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error removing user: ' + error.message });
    }
});

bot.command('!promote', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !promote <@user>' });
        return;
    }

    const userJid = args[0].replace('@', '') + '@s.whatsapp.net';

    try {
        await bot.promoteGroupParticipants(jid, [userJid]);
        await sock.sendMessage(jid, { text: `Promoted ${args[0]} to admin.` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error promoting user: ' + error.message });
    }
});

bot.command('!demote', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !demote <@user>' });
        return;
    }

    const userJid = args[0].replace('@', '') + '@s.whatsapp.net';

    try {
        await bot.demoteGroupParticipants(jid, [userJid]);
        await sock.sendMessage(jid, { text: `Demoted ${args[0]} from admin.` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error demoting user: ' + error.message });
    }
});

bot.command('!subject', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !subject <new_subject>' });
        return;
    }

    const newSubject = args.join(' ');

    try {
        await bot.updateGroupSubject(jid, newSubject);
        await sock.sendMessage(jid, { text: `Group subject changed to: ${newSubject}` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error changing subject: ' + error.message });
    }
});

bot.command('!description', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    if (!bot.isGroupJid(jid)) {
        await sock.sendMessage(jid, { text: 'This command only works in groups.' });
        return;
    }

    if (args.length === 0) {
        await sock.sendMessage(jid, { text: 'Usage: !description <new_description>' });
        return;
    }

    const newDescription = args.join(' ');

    try {
        await bot.updateGroupDescription(jid, newDescription);
        await sock.sendMessage(jid, { text: `Group description changed to: ${newDescription}` });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error changing description: ' + error.message });
    }
});

bot.command('!statusmention', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const text = args.join(' ') || 'Status mention message';

    try {
        await sock.sendStatusMentions(text, [jid]);
        await sock.sendMessage(jid, { text: 'Status mention sent!' });
    } catch (error) {
        await sock.sendMessage(jid, { text: 'Error sending status mention: ' + error.message });
    }
});

bot.command('!payment', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const amount = args[0] || '10.00';
    const currency = args[1] || 'USD';

    await sock.sendMessage(jid, {
        text: `Payment request: ${amount} ${currency}\nThis is a demo payment request.`
    });
});

bot.command('!event', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    const title = args[0] || 'Sample Event';
    const date = args[1] || new Date().toLocaleDateString();

    await sock.sendMessage(jid, {
        text: `📅 *Event:* ${title}\n📆 *Date:* ${date}\n\nThis is a demo event message.`
    });
});

bot.command('!carousel', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.sendListMessage(jid, 'Carousel Message:', [{
        title: 'Carousel Section',
        rows: [
            { id: 'carousel1', title: 'Item 1', description: 'Description 1' },
            { id: 'carousel2', title: 'Item 2', description: 'Description 2' },
            { id: 'carousel3', title: 'Item 3', description: 'Description 3' }
        ]
    }]);
});

bot.command('!interactive', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.sendButtonsMessage(jid, 'Interactive Message:', [
        { id: 'interactive1', text: 'Interactive Button 1' },
        { id: 'interactive2', text: 'Interactive Button 2' }
    ]);
});

bot.command('!buttonsflow', async (msg, args, sock) => {
    const jid = msg.key.remoteJid;
    await bot.sendButtonsMessage(jid, 'Buttons Flow Message:', [
        { id: 'flow1', text: 'Start Flow' },
        { id: 'flow2', text: 'Continue Flow' }
    ]);
});

// Initialize the bot
bot.initialize().then(() => {
    console.log('✅ Advanced WhatsApp Bot initialized successfully!');
    console.log('📱 Scan the QR code with your WhatsApp app to start using the bot.');
    console.log('💬 Send !help to any chat to see available commands.');
}).catch((error) => {
    console.error('❌ Failed to initialize bot:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot...');
    process.exit(0);
});
