# ✨ Profii

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A decentralized, **Peer-to-Peer** profile creation and hosting platform. Create beautiful, shareable profile cards that live on a distributed mesh network rather than a centralized server.

## 🚀 Key Features

- **P2P Sync**: Powered by [Y.js](https://yjs.dev/) + WebSocket, profiles sync in real-time across a relay network.
- **Dedicated Hosting Nodes**: Run a standalone relay node on your desktop or in the cloud (Railway) to keep profiles available.
- **WYSIWYG Editor**: Direct-on-card editing with live preview.
- **Portable Desktop App**: Built with Electron for a native, distraction-free experience.
- **One-Click Sharing**: Generate P2P links that anyone can view using the built-in Viewer Mode.
- **Profile Embeds**: The reacts site provides REST and SSE endpoints for embedding profile data — no separate service needed.

## 📦 Profile Embed API

The reacts site connects directly to the Y.js relay and serves profile data for both its own UI and third-party developers. No separate embed service is required.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/profile-embed/:roomId` | Profile as JSON (avatar, name, title, bio) |
| `GET /api/profile-embed/:roomId/subscribe` | SSE stream — pushes live updates |

### How It Works

```
Profii Desktop ──▶ Y.js Relay (RELAY_URL) ──▶ Reacts Server (profile-store.js)
                                                     │
                                         ┌───────────┴───────────┐
                                    REST (JSON)           SSE (live stream)
                                         │                       │
                                    Third parties           Any client
                                    & reacts UI             (EventSource)
```

1. `profile-store.js` maintains a persistent Y.js connection to the relay, keeping a live Y.Doc per room.
2. `profile-embed.js` exposes both REST (one-shot) and SSE (live) endpoints.
3. On the frontend, the `useProfileSSE(roomId)` hook subscribes any React component to live updates.

### Integration: REST/JSON

```bash
# Fetch profile data
curl https://your-reacts-site.com/api/profile-embed/profile-abc123
```

```json
{
  "avatar": "data:image/...",
  "name": "Jane Doe",
  "title": "Full Stack Developer",
  "bio": "Building cool things."
}
```

### Integration: SSE (Live Updates)

```javascript
const source = new EventSource(
  'https://your-reacts-site.com/api/profile-embed/profile-abc123/subscribe'
);

source.addEventListener('update', (event) => {
  const profile = JSON.parse(event.data);
  console.log('Profile updated:', profile.name);
});
```

### Configuration

Only one environment variable is needed on the reacts server:

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_URL` | WebSocket URL of your Y.js relay | `ws://localhost:8765` |


## 🌐 Relay Hosting Node

To ensure profiles are always accessible, run a dedicated relay node.

### Desktop Node
```bash
npm run hosting:desktop
```

### Cloud Node (Railway)
1. Fork/Clone this repo to GitHub.
2. Connect the repo to [Railway](https://railway.app/).
3. Go to **Settings > Networking** and click **Generate Domain**.
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
