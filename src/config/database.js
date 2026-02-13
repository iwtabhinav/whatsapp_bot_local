require('dotenv').config();

const config = {
    mongoURI: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB_NAME,
    options: {
        serverSelectionTimeoutMS: 10000, // Increased timeout to 10s
        socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        connectTimeoutMS: 10000, // Connection timeout
        maxPoolSize: 10, // Maintain up to 10 socket connections
        minPoolSize: 1, // Reduced minimum connections
        maxIdleTimeMS: 30000, // Close connections after 30s of inactivity
        retryWrites: true, // Enable retryable writes
        retryReads: true // Enable retryable reads
    }
};

module.exports = { config };