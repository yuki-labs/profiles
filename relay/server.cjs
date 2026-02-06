const Gun = require('gun');
const http = require('http');

/**
 * Robust P2P Hosting Node (GunDB Relay)
 */

const port = process.env.PORT || 8765;
const host = process.env.HOST || '0.0.0.0';

// More robust public URL detection
const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
const publicUrl = domain
    ? `https://${domain}/gun`
    : `http://localhost:${port}/gun`;

// Simple HTTP server with CORS headers for Gun
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

    // Announce availability
    const announce = () => {
        console.log(`Announcing node availability: ${publicUrl}`);
        gun.get('profile-maker-discovery').get('relays').get(publicUrl).put({
            url: publicUrl,
            type: 'dedicated-node',
            lastSeen: Date.now()
        });
    };

    // Announce once at start
    announce();

    // Re-announce every 60 seconds
    setInterval(announce, 60000);
});

// Minimal stats logging
setInterval(() => {
    const peers = gun.back('opt.peers');
    const peerCount = Object.keys(peers || {}).length;
    console.log(`[${new Date().toLocaleTimeString()}] Connected Peers: ${peerCount}`);
}, 15000);

module.exports = { gun, server };
