const Gun = require('gun');
const http = require('http');

/**
 * Robust P2P Hosting Node (GunDB Relay)
 */

const port = process.env.PORT || 8765;
const host = process.env.HOST || '0.0.0.0';

// More robust public URL detection
const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
// Ensure we don't double up on https:// if the env var already has it
const cleanDomain = domain ? domain.replace(/^https?:\/\//, '') : null;
const publicUrl = cleanDomain
    ? `https://${cleanDomain}/gun`
    : `http://localhost:${port}/gun`;

// Simple HTTP server with CORS headers for Gun
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profile Maker P2P Relay Node is active.');
});

const gun = Gun({
    web: server,
    file: 'relay-data',
    peers: [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://gun-us.herokuapp.com/gun',
        'https://relay.peer.ooo/gun'
    ]
});

server.listen(port, host, () => {
    console.log(`Relay node listening on http://${host}:${port}/gun`);

    // Announce availability
    const announce = () => {
        console.log(`[P2P Discovery] Announcing: ${publicUrl}`);
        gun.get('profile-maker-discovery').get('relays').get(publicUrl).put({
            url: publicUrl,
            type: 'dedicated-node',
            lastSeen: Date.now()
        }, (ack) => {
            if (ack.err) console.error('[P2P Discovery] Announce Error:', ack.err);
            else console.log('[P2P Discovery] Announce Successful');
        });
    };

    // Announce frequently at first, then slow down
    announce();
    setTimeout(announce, 5000);
    setTimeout(announce, 15000);
    setInterval(announce, 60000);
});

// Historical tracking to ensure "Total Seen" is monotonic
const historicalPeers = new Set([
    'https://gun-manhattan.herokuapp.com/gun',
    'https://gun-us.herokuapp.com/gun',
    'https://relay.peer.ooo/gun'
]);

// Minimal stats logging
setInterval(() => {
    const peers = gun.back('opt.peers');
    const currentPeerLinks = Object.keys(peers || {});

    // Add any newly discovered peers to our historical set
    currentPeerLinks.forEach(url => historicalPeers.add(url));

    const activeCount = currentPeerLinks.filter(url => peers[url].enabled).length;

    console.log(`[${new Date().toLocaleTimeString()}] Active Connections: ${activeCount} / Total Seen: ${historicalPeers.size}`);
}, 15000);

module.exports = { gun, server };
