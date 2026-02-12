const mongoose = require('mongoose');

const chatLogSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    required: true,
    unique: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'audio', 'video', 'document', 'location', 'contact', 'system'],
    default: 'text'
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true
  },
  fromNumber: {
    type: String,
    required: true
  },
  fromName: {
    type: String,
    default: ''
  },
  toNumber: {
    type: String,
    required: true
  },
  messageBody: {
    type: String,
    default: ''
  },
  mediaUrl: {
    type: String,
    default: ''
  },
  mediaType: {
    type: String,
    default: ''
  },
  mediaFilename: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isForwarded: {
    type: Boolean,
    default: false
  },
  quotedMessageId: {
    type: String,
    default: ''
  },
  location: {
    latitude: Number,
    longitude: Number,
    address: String
  },
  contact: {
    name: String,
    phone: String,
    email: String
  },
  bookingRelated: {
    type: Boolean,
    default: false
  },
  bookingId: {
    type: String,
    default: ''
  },
  aiProcessed: {
    type: Boolean,
    default: false
  },
  aiResponse: {
    type: String,
    default: ''
  },
  sessionId: {
    type: String
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
chatLogSchema.index({ chatId: 1, timestamp: -1 });
chatLogSchema.index({ fromNumber: 1, timestamp: -1 });
chatLogSchema.index({ bookingId: 1, timestamp: -1 });
chatLogSchema.index({ direction: 1, timestamp: -1 });
chatLogSchema.index({ messageType: 1, timestamp: -1 });
chatLogSchema.index({ chatId: 1 });
chatLogSchema.index({ fromNumber: 1 });
chatLogSchema.index({ timestamp: 1 });
chatLogSchema.index({ bookingId: 1 });
chatLogSchema.index({ sessionId: 1 });

// Static methods
chatLogSchema.statics.getChatHistory = function (chatId, limit = 50, offset = 0) {
  return this.find({ chatId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(offset)
    .lean();
};

chatLogSchema.statics.getConversationsByNumber = function (phoneNumber, limit = 100) {
  return this.find({
    $or: [
      { fromNumber: phoneNumber },
      { toNumber: phoneNumber }
    ]
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

chatLogSchema.statics.getBookingConversation = function (bookingId) {
  return this.find({ bookingId })
    .sort({ timestamp: 1 })
    .lean();
};

chatLogSchema.statics.getRecentChats = function (hours = 24, limit = 100) {
  const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
  return this.find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

chatLogSchema.statics.getChatStats = function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        timestamp: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }
    },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        incomingMessages: {
          $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] }
        },
        outgoingMessages: {
          $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, 1, 0] }
        },
        uniqueUsers: { $addToSet: '$fromNumber' },
        bookingRelatedMessages: {
          $sum: { $cond: ['$bookingRelated', 1, 0] }
        },
        aiProcessedMessages: {
          $sum: { $cond: ['$aiProcessed', 1, 0] }
        }
      }
    },
    {
      $project: {
        totalMessages: 1,
        incomingMessages: 1,
        outgoingMessages: 1,
        uniqueUsersCount: { $size: '$uniqueUsers' },
        bookingRelatedMessages: 1,
        aiProcessedMessages: 1
      }
    }
  ]);
};

// Instance methods
chatLogSchema.methods.markAsRead = function () {
  this.isRead = true;
  return this.save();
};

chatLogSchema.methods.linkToBooking = function (bookingId) {
  this.bookingRelated = true;
  this.bookingId = bookingId;
  return this.save();
};

chatLogSchema.methods.setAIResponse = function (response) {
  this.aiProcessed = true;
  this.aiResponse = response;
  return this.save();
};

module.exports = mongoose.model('ChatLog', chatLogSchema); 