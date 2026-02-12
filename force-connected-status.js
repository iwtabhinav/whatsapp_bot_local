/**
 * Force update connection status to connected
 * Use this script if the bot is working but dashboard shows wrong status
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Force updating connection status to CONNECTED...');

const stateFilePath = path.join(__dirname, 'data/whatsapp-connection-state.json');

const connectionState = {
    connectionState: 'connected',  // For backward compatibility
    state: 'connected',           // For new dashboard compatibility
    isReady: true,
    isAuthenticated: true,
    connectedNumber: 'manual-update', // Will be updated when bot processes next message
    lastHeartbeat: new Date().toISOString(),
    lastUpdate: new Date().toISOString()
};

try {
    fs.writeFileSync(stateFilePath, JSON.stringify(connectionState, null, 2));
    console.log('✅ Connection status updated to CONNECTED');
    console.log('📊 Dashboard should now show:');
    console.log('   - Status: Connected');
    console.log('   - Active WhatsApp: 1');
    console.log('');
    console.log('🔄 Refresh your dashboard to see the changes');
} catch (error) {
    console.error('❌ Error updating connection status:', error);
}
