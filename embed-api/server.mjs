import http from 'http';
import { getProfile, filterProfile, toProfileId } from './profile-store.mjs';
import { renderPage, renderErrorPage } from './components.mjs';
import { getSdkSource } from './sdk.mjs';

/**
 * Standalone Embed API Server
 *
 * Routes:
 *   GET /embed/:profileId         → HTML embed page (use ?show=name,skills to select elements)
 *   GET /api/profile/:profileId   → JSON profile data (use ?fields=name,skills for partial)
 *   GET /embed.js                 → JavaScript SDK for <profile-embed> web component
 *   GET /health                   → Server health status
 *
 * The :profileId parameter accepts either a bare profile ID (e.g. "abc123")
 * or a full room name (e.g. "profile-abc123"). Both resolve correctly.
 */

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';
const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:8765';

const VALID_ELEMENTS = ['avatar', 'name', 'title', 'bio', 'skills', 'socials', 'contact'];

function parseUrl(url) {
    const [pathPart, queryPart] = url.split('?');
    const params = new URLSearchParams(queryPart || '');
    return { path: pathPart, params };
}

function parseElements(paramValue) {
    if (!paramValue) return [];
    return paramValue.split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => VALID_ELEMENTS.includes(e));
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const { path, params } = parseUrl(req.url);

    // ── Health ──
    if (path === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            relayUrl: RELAY_URL,
            uptime: process.uptime(),
            timestamp: Date.now()
        }));
        return;
    }

    // ── SDK script ──
    if (path === '/embed.js') {
        const proto = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
        const baseUrl = `${proto}://${host}`;

        res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=3600'
        });
        res.end(getSdkSource(baseUrl));
        return;
    }

    // ── HTML embed ──
    const embedMatch = path.match(/^\/embed\/([^\/]+)$/);
    if (embedMatch) {
        const profileId = decodeURIComponent(embedMatch[1]);
        const showElements = parseElements(params.get('show'));

        try {
            const profile = await getProfile(profileId, RELAY_URL);
            if (!profile) {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(renderErrorPage('Profile not found'));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=60'
            });
            res.end(renderPage(profile, showElements));
        } catch (e) {
            console.error('[Server] Embed error:', e);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(renderErrorPage('Failed to load profile'));
        }
        return;
    }

    // ── JSON API ──
    const apiMatch = path.match(/^\/api\/profile\/([^\/]+)$/);
    if (apiMatch) {
        const profileId = decodeURIComponent(apiMatch[1]);
        const fields = parseElements(params.get('fields'));

        try {
            const profile = await getProfile(profileId, RELAY_URL);
            if (!profile) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Profile not found' }));
                return;
            }

            const data = filterProfile(profile, fields);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=60'
            });
            res.end(JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[Server] API error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to load profile' }));
        }
        return;
    }

    // ── Default: API docs ──
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Profile Embed API</title>
<style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; max-width: 700px; margin: auto; }
    h1 { color: #818cf8; } h2 { color: #6366f1; margin-top: 2em; }
    code { background: #1e293b; padding: 3px 8px; border-radius: 4px; font-size: 14px; }
    pre { background: #1e293b; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
    a { color: #818cf8; }
    .endpoint { margin: 12px 0; }
    .note { color: #94a3b8; font-size: 13px; margin-top: 8px; }
</style></head><body>
    <h1>📦 Profile Embed API</h1>
    <p>Embed live profiles from the Profile Maker network.</p>

    <h2>Endpoints</h2>
    <div class="endpoint"><code>GET /embed/:profileId</code> — HTML embed page</div>
    <div class="endpoint"><code>GET /embed/:profileId?show=name,skills</code> — Select elements</div>
    <div class="endpoint"><code>GET /api/profile/:profileId</code> — Raw JSON</div>
    <div class="endpoint"><code>GET /api/profile/:profileId?fields=name,skills</code> — Partial JSON</div>
    <div class="endpoint"><code>GET /embed.js</code> — JavaScript SDK</div>
    <div class="endpoint"><code>GET /health</code> — Health check</div>
    <p class="note">The <code>:profileId</code> is the unique ID shown in each profile's card footer.</p>

    <h2>Elements</h2>
    <p><code>avatar</code> <code>name</code> <code>title</code> <code>bio</code> <code>skills</code> <code>socials</code> <code>contact</code></p>

    <h2>Quick Start</h2>
    <pre>&lt;iframe src="/embed/YOUR_PROFILE_ID?show=avatar,name,skills"
    width="440" height="300" frameborder="0"&gt;&lt;/iframe&gt;</pre>
    <p>Or with the SDK:</p>
    <pre>&lt;script src="/embed.js"&gt;&lt;/script&gt;
&lt;profile-embed profile-id="YOUR_PROFILE_ID" show="name,title,skills"&gt;&lt;/profile-embed&gt;</pre>
</body></html>`);
});

server.listen(PORT, HOST, () => {
    console.log(`\n📦 Embed API listening on http://${HOST}:${PORT}`);
    console.log(`   Relay: ${RELAY_URL}`);
    console.log(`   Docs:  http://localhost:${PORT}/`);
    console.log('');
});
