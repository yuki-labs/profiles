const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

/**
 * Desktop Y.js Relay Hosting Node — Embed-Aware
 *
 * Self-contained relay that implements the Y.js sync protocol
 * with embed client detection and profile update broadcasting.
 */

const port = 8765;
const host = '0.0.0.0';
const PROFILE_KEY = 'profileData';

// Track connected clients per room, including their role
// roomName → Map<ws, { role: 'app'|'embed' }>
const rooms = new Map();

// Track which rooms have active profile observers
const observedRooms = new Set();

// Reference to the docs map from @y/websocket-server (set after import)
let serverDocs = null;

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
 */
function sendJsonMessage(conn, data) {
    if (conn.readyState === 1) {
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
 */
function observeRoom(roomName) {
    if (observedRooms.has(roomName) || !serverDocs) return;

    const doc = serverDocs.get(roomName);
    if (!doc) return;

    const profileMap = doc.getMap('profile');
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

// HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/health') {
        let totalClients = 0;
        rooms.forEach(clients => { totalClients += clients.size; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            activeRooms: rooms.size,
            totalClients,
            embedClients: countEmbedClients(),
            uptime: process.uptime()
        }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profii Y.js Desktop Relay is active.');
});

// Start the relay with dynamic ESM import
async function startRelay() {
    const utils = await import('@y/websocket-server/utils');
    const { setupWSConnection } = utils;
    serverDocs = utils.docs;

    const wss = new WebSocket.Server({ server });

    wss.on('connection', (conn, req) => {
        const urlPath = req.url || '/default';
        const roomName = urlPath.slice(1).split('?')[0];
        const query = parseQuery(req.url);
        const role = query.role === 'embed' ? 'embed' : 'app';

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

        setupWSConnection(conn, req, {
            docName: roomName,
            gc: true
        });

        // Observe room for profile changes
        observeRoom(roomName);

        // Send current profile to embed client immediately
        if (role === 'embed' && serverDocs) {
            const doc = serverDocs.get(roomName);
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
        console.log(`Y.js Desktop Relay listening on http://${host}:${port}`);
        console.log('Embed-aware broadcasting enabled');
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
}

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 500,
        title: 'Profii - Hosting Node',
        backgroundColor: '#0f172a',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Y.js Relay Node</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 2px solid #6366f1; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h1 { color: #818cf8; margin-bottom: 0.5rem; }
            .status { font-weight: bold; color: #10b981; margin-bottom: 2rem; }
            .stats { display: flex; flex-direction: column; gap: 0.5rem; color: #94a3b8; }
            .embed-stat { color: #818cf8; }
            .pulse { width: 12px; height: 12px; background: #10b981; border-radius: 50%; display: inline-block; margin-right: 8px; box-shadow: 0 0 10px #10b981; animation: pulse 2s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Y.js Relay Node</h1>
            <div class="status"><div class="pulse"></div> ACTIVE & RELAYING</div>
            <div class="stats">
                <div id="rooms">Active Rooms: 0</div>
                <div id="clients">Connected Clients: 0</div>
                <div id="embeds" class="embed-stat">Embed Clients: 0</div>
            </div>
        </div>
        <script>
            const { ipcRenderer } = require('electron');
            setInterval(() => {
                ipcRenderer.send('get-stats');
            }, 2000);
            ipcRenderer.on('stats', (event, data) => {
                document.getElementById('rooms').innerText = 'Active Rooms: ' + data.rooms;
                document.getElementById('clients').innerText = 'Connected Clients: ' + data.clients;
                document.getElementById('embeds').innerText = 'Embed Clients: ' + data.embeds;
            });
        </script>
    </body>
    </html>
    `;

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

ipcMain.on('get-stats', (event) => {
    let totalClients = 0;
    rooms.forEach(clients => { totalClients += clients.size; });
    event.reply('stats', {
        rooms: rooms.size,
        clients: totalClients,
        embeds: countEmbedClients()
    });
});

app.whenReady().then(async () => {
    await startRelay();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
