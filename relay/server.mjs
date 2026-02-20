import http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from '@y/websocket-server/utils';

/**
 * Y.js WebSocket Relay Server
 * Bridges Y.js documents between clients via WebSocket rooms.
 */

const port = process.env.PORT || 8765;
const host = process.env.HOST || '0.0.0.0';

// Track connected clients per room for stats
const rooms = new Map(); // roomName -> Set<ws>

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
            uptime: process.uptime(),
            timestamp: Date.now()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profile Maker Y.js Relay is active.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
    // Extract room name from URL path
    const roomName = req.url ? req.url.slice(1).split('?')[0] : 'default';

    // Track the connection in our room map
    if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
    }
    rooms.get(roomName).add(conn);

    conn.on('close', () => {
        const roomClients = rooms.get(roomName);
        if (roomClients) {
            roomClients.delete(conn);
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
});

server.listen(port, host, () => {
    console.log(`Y.js Relay listening on http://${host}:${port}`);
    console.log('Waiting for connections...');
});

// Stats logging
setInterval(() => {
    let totalClients = 0;
    rooms.forEach(clients => { totalClients += clients.size; });
    console.log(`[${new Date().toLocaleTimeString()}] Rooms: ${rooms.size} | Clients: ${totalClients}`);
}, 15000);

export { server, wss, rooms };
