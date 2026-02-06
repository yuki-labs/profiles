# ✨ Profile Maker P2P

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A decentralized, **Peer-to-Peer** profile creation and hosting platform. Create beautiful, shareable profile cards that live on a distributed mesh network rather than a centralized server.

## 🚀 Key Features

- **P2P Decentralization**: Powered by [GunDB](https://gun.eco/), profiles are gossiped across a decentralized mesh.
- **Dedicated Hosting Nodes**: Run a standalone relay node on your desktop or in the cloud (Railway) to ensure your data stays online.
- **Intelligent Auto-Discovery**: The app automatically "seeks out" and connects to dedicated hosting nodes in the network.
- **WYSIWYG Editor**: Direct-on-card editing with live preview.
- **Portable Desktop App**: Built with Electron for a native, distraction-free experience.
- **One-Click Sharing**: Generate P2P links that anyone can view using the built-in Viewer Mode.

## 🧠 P2P API & Data Mesh

Because this app is decentralized, there is no traditional REST API. Instead, you interact with a **Distributed Graph API**. Any application can join the mesh to read or search for profiles.

### Connecting to the Mesh
To interact with the data programmatically, use the `gun` library:

```javascript
import Gun from 'gun';

// Connect to the public bootstrap relay
const gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);

// Access the Profile Maker namespace
const profiles = gun.get('profile-maker-p2p-v1');
```

### Reading a Profile
If you have a P2P ID (e.g., from a share link), you can fetch the data directly:

```javascript
const profileId = 'p2p-abc123xyz';
profiles.get(profileId).once((data) => {
  console.log("Retrieved Profile:", data);
});
```

### Discovery API
You can listen for new dedicated hosting nodes (relays) that join the network:

```javascript
gun.get('profile-maker-discovery').get('relays').map().on((node) => {
  if (node && node.url) {
    console.log("Discovered Relay Node:", node.url);
  }
});
```

## 🌐 P2P Hosting Node (Relay)

To ensure your profiles are always accessible, you can run a dedicated hosting node.

### Desktop Node
Run a dedicated node with a status UI:
```bash
npm run hosting:desktop
```

### Cloud Node (Railway)
1. Fork/Clone this repo to GitHub.
2. Connect the repo to [Railway](https://railway.app/).
3. **CRITICAL**: Go to **Settings > Networking** in Railway and click **Generate Domain**. The app needs this public URL to announce itself to the P2P mesh.
4. Set the start command to:
   ```bash
   npm run hosting:railway
   ```

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)

### Installation & Dev
```bash
npm install
npm run electron:dev
```

### Building for Production
```bash
npm run electron:build
```
Executables will be generated in `dist-electron/`.

---

Built with ❤️ for the decentralized web.
