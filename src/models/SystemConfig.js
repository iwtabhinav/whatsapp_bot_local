const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
    key: { type: String, required: true, },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    description: { type: String }
}, { timestamps: true });

// Add explicit index
systemConfigSchema.index({ key: 1 }, { });

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);
module.exports = SystemConfig;