const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { server, gun } = require('../server.cjs');

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 500,
        title: 'Profile Maker - Hosting Node',
        backgroundColor: '#0f172a',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Simple status UI
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>P2P Relay Node</title>
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
            <h1>Hosting Node</h1>
            <div class="status"><div class="pulse"></div> ACTIVE & RELAYING</div>
            <div class="stats">
                <div id="peers">Connected Peers: 0</div>
                <div id="uptime">Status: Secure</div>
            </div>
        </div>
        <script>
            const { ipcRenderer } = require('electron');
            setInterval(() => {
                ipcRenderer.send('get-stats');
            }, 2000);
            ipcRenderer.on('stats', (event, count) => {
                document.getElementById('peers').innerText = 'Connected Peers: ' + count;
            });
        </script>
    </body>
    </html>
    `;

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

ipcMain.on('get-stats', (event) => {
    const peers = gun.back('opt.peers');
    const count = Object.keys(peers || {}).length;
    event.reply('stats', count);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
