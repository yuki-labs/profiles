import http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection, docs } from '@y/websocket-server/utils';

/**
 * Y.js WebSocket Relay Server — Embed-Aware
 *
 * Bridges Y.js documents between clients via WebSocket rooms.
 * Detects embed service connections (?role=embed) and actively pushes
 * profile updates to them via a custom JSON message channel.
 */

const port = process.env.PORT || 8765;
const host = process.env.HOST || '0.0.0.0';

const PROFILE_KEY = 'profileData';
const MESSAGE_TYPE_PROFILE_PUSH = 3; // Custom message type for embed pushes

// Track connected clients per room, including their role
// roomName → Map<ws, { role: 'app'|'embed' }>
const rooms = new Map();

// Track which rooms have active profile observers to avoid duplicates
const observedRooms = new Set();

/**
 * Parse query parameters from a WebSocket URL.
 */
function parseQuery(url) {
    const qIdx = url?.indexOf('?') ?? -1;
    if (qIdx === -1) return {};
    const params = new URLSearchParams(url.slice(qIdx));
    return Object.fromEntries(params.entries());
}

/**
 * Send a custom JSON message to a single WebSocket connection.
 * Uses a text frame (not binary) so it's easily distinguishable
 * from Y.js protocol messages (which are binary).
 */
function sendJsonMessage(conn, data) {
    if (conn.readyState === 1) { // OPEN
        try {
            conn.send(JSON.stringify(data));
        } catch (e) {
            console.error('[Relay] Failed to send JSON message:', e.message);
        }
    }
}

/**
 * Push a profile update to all embed clients in a room.
 */
function pushToEmbedClients(roomName, profile) {
    const roomClients = rooms.get(roomName);
    if (!roomClients) return;

    let pushCount = 0;
    for (const [conn, meta] of roomClients) {
        if (meta.role === 'embed') {
            sendJsonMessage(conn, {
                type: 'profileUpdate',
                room: roomName,
                profile,
                timestamp: Date.now()
            });
            pushCount++;
        }
    }

    if (pushCount > 0) {
        console.log(`[Relay] Pushed profile update to ${pushCount} embed client(s) in ${roomName}`);
    }
}

/**
 * Set up a Y.Doc observer for a room to detect profile changes.
 * When the profile map's profileData changes, push to embed clients.
 */
function observeRoom(roomName) {
    if (observedRooms.has(roomName)) return;

    const doc = docs.get(roomName);
    if (!doc) return;

    const profileMap = doc.getMap('profile');

    // Track last known value to detect actual changes
    let lastProfileJson = null;
    const rawData = profileMap.get(PROFILE_KEY);
    if (rawData && typeof rawData === 'string') {
        lastProfileJson = rawData;
    }

    profileMap.observe(() => {
        const newRaw = profileMap.get(PROFILE_KEY);
        if (!newRaw || typeof newRaw !== 'string') return;

        if (newRaw !== lastProfileJson) {
            lastProfileJson = newRaw;
            try {
                const profile = JSON.parse(newRaw);
                console.log(`[Relay] Profile change detected in ${roomName}`);
                pushToEmbedClients(roomName, profile);
            } catch (e) {
                console.error(`[Relay] Failed to parse profile in ${roomName}:`, e.message);
            }
        }
    });

    observedRooms.add(roomName);
    console.log(`[Relay] Observing profile changes in ${roomName}`);
}

/**
 * Count embed clients across all rooms.
 */
function countEmbedClients() {
    let count = 0;
    for (const [, clients] of rooms) {
        for (const [, meta] of clients) {
            if (meta.role === 'embed') count++;
        }
    }
    return count;
}

// HTTP server with CORS and health endpoint
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/health') {
        let totalClients = 0;
        rooms.forEach(clients => { totalClients += clients.size; });
        const healthData = {
            status: 'ok',
            activeRooms: rooms.size,
            totalClients,
            embedClients: countEmbedClients(),
            observedRooms: observedRooms.size,
            uptime: process.uptime(),
            timestamp: Date.now()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profii Y.js Relay is active.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
    // Extract room name and query params
    const urlPath = req.url || '/default';
    const roomName = urlPath.slice(1).split('?')[0];
    const query = parseQuery(req.url);
    const role = query.role === 'embed' ? 'embed' : 'app';

    // Track the connection with its role
    if (!rooms.has(roomName)) {
        rooms.set(roomName, new Map());
    }
    rooms.get(roomName).set(conn, { role });

    if (role === 'embed') {
        console.log(`[Relay] Embed client connected to ${roomName}`);
    }

    conn.on('close', () => {
        const roomClients = rooms.get(roomName);
        if (roomClients) {
            const meta = roomClients.get(conn);
            roomClients.delete(conn);
            if (meta?.role === 'embed') {
                console.log(`[Relay] Embed client disconnected from ${roomName}`);
            }
            if (roomClients.size === 0) {
                rooms.delete(roomName);
            }
        }
    });

    // Hand off to y-websocket for Y.js protocol handling
    setupWSConnection(conn, req, {
        docName: roomName,
        gc: true
    });

    // After Y.js setup, observe this room for profile changes
    // (setupWSConnection creates the doc if it doesn't exist)
    observeRoom(roomName);

    // If this is an embed client connecting, send current profile immediately
    if (role === 'embed') {
        const doc = docs.get(roomName);
        if (doc) {
            const profileMap = doc.getMap('profile');
            const rawData = profileMap.get(PROFILE_KEY);
            if (rawData && typeof rawData === 'string') {
                try {
                    const profile = JSON.parse(rawData);
                    sendJsonMessage(conn, {
                        type: 'profileUpdate',
                        room: roomName,
                        profile,
                        timestamp: Date.now()
                    });
                } catch { }
            }
        }
    }
});

server.listen(port, host, () => {
    console.log(`Y.js Relay listening on http://${host}:${port}`);
    console.log('Embed-aware broadcasting enabled');
    console.log('Waiting for connections...');
});

// Stats logging
setInterval(() => {
    let totalClients = 0;
    let embedCount = 0;
    rooms.forEach(clients => {
        totalClients += clients.size;
        for (const [, meta] of clients) {
            if (meta.role === 'embed') embedCount++;
        }
    });
    console.log(`[${new Date().toLocaleTimeString()}] Rooms: ${rooms.size} | Clients: ${totalClients} | Embeds: ${embedCount}`);
}, 15000);

export { server, wss, rooms };
