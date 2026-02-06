const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onOpenProfile: (callback) => {
        // Remove previous listeners to prevent memory leaks/duplicate calls
        ipcRenderer.removeAllListeners('open-profile');
        ipcRenderer.on('open-profile', (_event, value) => callback(value));
    }
});
