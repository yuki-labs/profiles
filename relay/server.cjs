const Gun = require('gun');
const http = require('http');

/**
 * Robust P2P Hosting Node (GunDB Relay)
 */

const port = process.env.PORT || 8765;
const host = process.env.HOST || '0.0.0.0';

// Determine the announcement URL (Railway URL or local)
const publicUrl = process.env.RAILWAY_STATIC_URL
    ? `https://${process.env.RAILWAY_STATIC_URL}/gun`
    : `http://localhost:${port}/gun`;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profile Maker P2P Relay Node is active.');
});

const gun = Gun({
    web: server,
    file: 'relay-data',
    peers: ['https://gun-manhattan.herokuapp.com/gun'] // Bootstrap to the main mesh
});

server.listen(port, host, () => {
    console.log(`Relay node listening on http://${host}:${port}/gun`);

    // Self-register in the discovery bucket
    console.log(`Announcing node availability: ${publicUrl}`);
    gun.get('profile-maker-discovery').get('relays').get(publicUrl).put({
        url: publicUrl,
        type: 'dedicated-node',
        lastSeen: Date.now()
    });
});

// Update "last seen" timestamp periodically
setInterval(() => {
    gun.get('profile-maker-discovery').get('relays').get(publicUrl).put({
        lastSeen: Date.now()
    });
}, 60000);

// Minimal stats logging
setInterval(() => {
    const peers = gun.back('opt.peers');
    const peerCount = Object.keys(peers || {}).length;
    console.log(`[${new Date().toLocaleTimeString()}] Connected Peers: ${peerCount}`);
}, 15000);

module.exports = { gun, server };
