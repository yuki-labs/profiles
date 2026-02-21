const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

/**
 * Desktop Y.js Relay Hosting Node
 * Self-contained relay that implements the Y.js sync protocol
 * using dynamic ESM import for @y/websocket-server.
 */

const port = 8765;
const host = '0.0.0.0';

// Track connected clients per room
const rooms = new Map();

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
            uptime: process.uptime()
        }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Profii Y.js Desktop Relay is active.');
});

// Start the relay with dynamic ESM import
async function startRelay() {
    const { setupWSConnection } = await import('@y/websocket-server/utils');

    const wss = new WebSocket.Server({ server });

    wss.on('connection', (conn, req) => {
        const roomName = req.url ? req.url.slice(1).split('?')[0] : 'default';

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

        setupWSConnection(conn, req, {
            docName: roomName,
            gc: true
        });
    });

    server.listen(port, host, () => {
        console.log(`Y.js Desktop Relay listening on http://${host}:${port}`);
    });

    // Stats logging
    setInterval(() => {
        let totalClients = 0;
        rooms.forEach(clients => { totalClients += clients.size; });
        console.log(`[${new Date().toLocaleTimeString()}] Rooms: ${rooms.size} | Clients: ${totalClients}`);
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
        clients: totalClients
    });
});

app.whenReady().then(async () => {
    await startRelay();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
