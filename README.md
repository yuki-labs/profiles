# ✨ Profii

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A decentralized, **Peer-to-Peer** profile creation and hosting platform. Create beautiful, shareable profile cards that live on a distributed mesh network rather than a centralized server.

## 🚀 Key Features

- **P2P Sync**: Powered by [Y.js](https://yjs.dev/) + WebSocket, profiles sync in real-time across a relay network.
- **Dedicated Hosting Nodes**: Run a standalone relay node on your desktop or in the cloud (Railway) to keep profiles available.
- **WYSIWYG Editor**: Direct-on-card editing with live preview.
- **Portable Desktop App**: Built with Electron for a native, distraction-free experience.
- **One-Click Sharing**: Generate P2P links that anyone can view using the built-in Viewer Mode.
- **Embed API**: Standalone service that lets third-party developers embed profile components on any website.

## 📦 Embed API

The Embed API is a standalone Node.js service that joins the relay network, caches profiles locally, and serves embeddable profile components to developers.

### Running the Embed API

```bash
# Start the relay
npm run hosting:railway

# Start the embed API (separate terminal)
RELAY_URL=ws://localhost:8765 npm run embed
```

The API runs on port `3002` by default. Visit `http://localhost:3002/` for interactive docs.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /embed/:roomId` | HTML embed page (full profile card) |
| `GET /embed/:roomId?show=name,skills` | HTML with selected elements only |
| `GET /api/profile/:roomId` | Full profile as JSON |
| `GET /api/profile/:roomId?fields=name,skills` | Partial JSON |
| `GET /embed.js` | JavaScript SDK script |
| `GET /health` | Health check |

### Available Elements

Use these with the `show` (HTML) or `fields` (JSON) parameter — comma-separated, any combination:

`avatar` · `name` · `title` · `bio` · `skills` · `socials` · `contact`

Omit the parameter to include everything.

### Integration: iframe

```html
<!-- Full profile card -->
<iframe src="https://your-embed-api.com/embed/profile-abc123"
        width="440" height="600" frameborder="0"></iframe>

<!-- Only avatar, name, and skills -->
<iframe src="https://your-embed-api.com/embed/profile-abc123?show=avatar,name,skills"
        width="440" height="300" frameborder="0"></iframe>
```

### Integration: JavaScript SDK

```html
<script src="https://your-embed-api.com/embed.js"></script>

<!-- Full card -->
<profile-embed room="profile-abc123"></profile-embed>

<!-- Selective elements -->
<profile-embed room="profile-abc123" show="name,title,skills"></profile-embed>
```

### Integration: REST/JSON

```bash
# Full profile
curl https://your-embed-api.com/api/profile/profile-abc123

# Partial (only name and skills)
curl https://your-embed-api.com/api/profile/profile-abc123?fields=name,skills
```

### Deploying

Deploy the embed API as a separate service (e.g., a second Railway app). Set these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_URL` | WebSocket URL of your relay | `ws://localhost:8765` |
| `PORT` | HTTP port | `3002` |

Start command: `npm run embed`

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
