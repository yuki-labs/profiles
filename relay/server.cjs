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

// Support for manual initial peers via environment variables
const envPeers = process.env.INITIAL_PEERS
    ? process.env.INITIAL_PEERS.split(',').map(p => p.trim()).filter(p => p.length > 0)
    : [];

const bootstrapPeers = envPeers;

if (bootstrapPeers.length === 0) {
    console.warn('\n[!] WARNING: No P2P bootstrap peers configured.');
    console.warn('[!] This relay is currently isolated and cannot reach the global mesh.');
    console.warn('[!] Please add some initial peers using the INITIAL_PEERS environment variable.\n');
}

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

    // Health check endpoint for diagnosing connectivity
    if (req.url === '/health') {
        const peers = gun ? gun.back('opt.peers') : {};
        const peerUrls = Object.keys(peers || {});
        const activeCount = peerUrls.filter(url => peers[url] && peers[url].enabled).length;
        const healthData = {
            status: 'ok',
            publicUrl,
            activePeers: activeCount,
            totalPeersSeen: peerUrls.length,
            uptime: process.uptime(),
            timestamp: Date.now()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profile Maker P2P Relay Node is active.');
});

const gun = Gun({
    web: server,
    file: 'relay-data',
    peers: bootstrapPeers
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

    // Dynamic Discovery: Find other relays and connect to them
    gun.get('profile-maker-discovery').get('relays').map().on((node, urlKey) => {
        if (bootstrapPeers.length === 0) return; // Stay isolated if no initial peers

        const url = (node && typeof node === 'object' && node.url) ? node.url : urlKey;
        const lastSeen = (node && typeof node === 'object' && node.lastSeen) ? node.lastSeen : (typeof node === 'number' ? node : 0);

        // Don't connect to ourselves
        if (url === publicUrl) return;

        if (url && (url.startsWith('http') || url.startsWith('ws'))) {
            const peers = gun.back('opt.peers');
            if (peers && !peers[url]) {
                // Seen in last 30 mins
                const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
                if (lastSeen > thirtyMinutesAgo) {
                    console.log(`[P2P Discovery] Auto-connecting to discovered node: ${url}`);
                    gun.opt({ peers: [url] });
                }
            }
        }
    });
});

// Historical tracking to ensure "Total Seen" is monotonic
const historicalPeers = new Set(bootstrapPeers);

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
