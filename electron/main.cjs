const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

// Force single instance for deep linking
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow;

if (!gotTheLock) {
    app.quit();
} else {
    // Handle protocol registration
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('profii', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('profii');
    }

    app.on('second-instance', (event, commandLine) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            // Find the deep link URL in the arguments
            const url = commandLine.find(arg => arg.startsWith('profii://'));
            if (url) {
                handleDeepLink(url);
            }
        }
    });

    app.whenReady().then(() => {
        createWindow();

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
        },
        title: 'Profii',
        backgroundColor: '#0f172a',
        show: false,
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();

        // Check if app was opened via deep link on startup
        const url = process.argv.find(arg => arg.startsWith('profii://'));
        if (url) {
            handleDeepLink(url);
        }
    });

    // Handle deep links on macOS
    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url) {
    if (!mainWindow) return;
    // Format: profii://p2p-abc123xyz
    const viewId = url.replace('profii://', '').split('?')[0].replace(/\/+$/, '');
    if (viewId) {
        console.log('Sending open-profile to renderer:', viewId);
        mainWindow.webContents.send('open-profile', viewId);
    }
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
