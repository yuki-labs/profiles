import http from 'http';
import { getProfile, filterProfile, toProfileId, checkRelayHealth, subscribe, getSubscriptionStats } from './profile-store.mjs';
import { renderPage, renderErrorPage } from './components.mjs';
import { getSdkSource } from './sdk.mjs';

/**
 * Standalone Embed API Server — Multi-Node Network Client
 *
 * This server acts as its own node on the Y.js network, connecting to
 * one or more relay servers to locate and serve profile data.
 *
 * Routes:
 *   GET /embed/:profileId         → HTML embed page (use ?show=name,skills to select elements)
 *   GET /api/profile/:profileId   → JSON profile data (use ?fields=name,skills for partial)
 *   GET /subscribe/:profileId     → SSE stream for live profile updates
 *   GET /embed.js                 → JavaScript SDK for <profile-embed> web component
 *   GET /health                   → Server health status + relay connectivity
 *   POST /relays                  → Add a relay URL at runtime (JSON body: { url: "..." })
 *   DELETE /relays                → Remove a relay URL at runtime (JSON body: { url: "..." })
 *   GET /relays                   → List all configured relays and their health
 */

const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

// Parse relay URLs from environment — supports comma-separated list
function parseRelayUrls() {
    const urlsEnv = process.env.RELAY_URLS || process.env.RELAY_URL || 'ws://localhost:8765';
    return urlsEnv
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);
}

// Mutable relay list — can be updated at runtime via API
let relayUrls = parseRelayUrls();

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve(null); }
        });
    });
}

/**
 * Resolve the API base URL from request headers.
 */
function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    return `${proto}://${host}`;
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
        const healthChecks = await Promise.all(
            relayUrls.map(async (url) => ({
                url,
                online: await checkRelayHealth(url)
            }))
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            relays: healthChecks,
            totalRelays: relayUrls.length,
            onlineRelays: healthChecks.filter(r => r.online).length,
            subscriptions: getSubscriptionStats(),
            uptime: process.uptime(),
            timestamp: Date.now()
        }, null, 2));
        return;
    }

    // ── Relay management: list ──
    if (path === '/relays' && req.method === 'GET') {
        const healthChecks = await Promise.all(
            relayUrls.map(async (url) => ({
                url,
                online: await checkRelayHealth(url)
            }))
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ relays: healthChecks }, null, 2));
        return;
    }

    // ── Relay management: add ──
    if (path === '/relays' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body?.url) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing "url" in request body' }));
            return;
        }

        const url = body.url.trim();
        if (!relayUrls.includes(url)) {
            relayUrls.push(url);
            console.log(`[Relays] Added: ${url} (total: ${relayUrls.length})`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ relays: relayUrls }));
        return;
    }

    // ── Relay management: remove ──
    if (path === '/relays' && req.method === 'DELETE') {
        const body = await readBody(req);
        if (!body?.url) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing "url" in request body' }));
            return;
        }

        const url = body.url.trim();
        relayUrls = relayUrls.filter(u => u !== url);
        console.log(`[Relays] Removed: ${url} (total: ${relayUrls.length})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ relays: relayUrls }));
        return;
    }

    // ── SDK script ──
    if (path === '/embed.js') {
        const baseUrl = getBaseUrl(req);
        res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Cache-Control': 'public, max-age=3600'
        });
        res.end(getSdkSource(baseUrl));
        return;
    }

    // ── SSE: Live profile updates ──
    const sseMatch = path.match(/^\/subscribe\/([^\/]+)$/);
    if (sseMatch && req.method === 'GET') {
        const profileId = decodeURIComponent(sseMatch[1]);

        if (relayUrls.length === 0) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No relay nodes configured' }));
            return;
        }

        // Set SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        });

        // Send initial comment to establish connection
        res.write(':ok\n\n');

        // Subscribe to live updates
        const onUpdate = (profile) => {
            if (!res.writableEnded) {
                res.write(`event: update\ndata: ${JSON.stringify(profile)}\n\n`);
            }
        };

        const { unsubscribe, ready } = subscribe(profileId, relayUrls, onUpdate);

        // Send the current profile as the initial event
        try {
            const profile = await ready;
            if (profile && !res.writableEnded) {
                res.write(`event: update\ndata: ${JSON.stringify(profile)}\n\n`);
            }
        } catch (e) {
            console.error(`[SSE] Initial fetch error for ${profileId}:`, e.message);
        }

        // Send keepalive pings every 30s to prevent connection timeout
        const keepalive = setInterval(() => {
            if (!res.writableEnded) {
                res.write(':ping\n\n');
            }
        }, 30000);

        // Clean up on disconnect
        req.on('close', () => {
            clearInterval(keepalive);
            unsubscribe();
            console.log(`[SSE] Client disconnected from ${profileId}`);
        });

        return;
    }

    // ── HTML embed ──
    const embedMatch = path.match(/^\/embed\/([^\/]+)$/);
    if (embedMatch) {
        const profileId = decodeURIComponent(embedMatch[1]);
        const showElements = parseElements(params.get('show'));
        const baseUrl = getBaseUrl(req);

        if (relayUrls.length === 0) {
            res.writeHead(503, { 'Content-Type': 'text/html' });
            res.end(renderErrorPage('No relay nodes configured'));
            return;
        }

        try {
            const profile = await getProfile(profileId, relayUrls);
            if (!profile) {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(renderErrorPage('Profile not found on any relay node'));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache'
            });
            res.end(renderPage(profile, showElements, { profileId, baseUrl }));
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

        if (relayUrls.length === 0) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No relay nodes configured' }));
            return;
        }

        try {
            const profile = await getProfile(profileId, relayUrls);
            if (!profile) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Profile not found on any relay node' }));
                return;
            }

            const data = filterProfile(profile, fields);
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
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
<html><head><meta charset="UTF-8"><title>Profii Embed API</title>
<style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; max-width: 700px; margin: auto; }
    h1 { color: #818cf8; } h2 { color: #6366f1; margin-top: 2em; }
    code { background: #1e293b; padding: 3px 8px; border-radius: 4px; font-size: 14px; }
    pre { background: #1e293b; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
    a { color: #818cf8; }
    .endpoint { margin: 12px 0; }
    .note { color: #94a3b8; font-size: 13px; margin-top: 8px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 6px; }
    .badge-new { background: #22c55e22; color: #4ade80; }
</style></head><body>
    <h1>📦 Profii Embed API</h1>
    <p>Multi-node network client for embedding live profiles.</p>
    <p class="note">Connected to <strong>${relayUrls.length}</strong> relay node(s).</p>

    <h2>Profile Endpoints</h2>
    <div class="endpoint"><code>GET /embed/:profileId</code> — HTML embed page (auto-updates via SSE)</div>
    <div class="endpoint"><code>GET /embed/:profileId?show=name,skills</code> — Select elements</div>
    <div class="endpoint"><code>GET /api/profile/:profileId</code> — Raw JSON</div>
    <div class="endpoint"><code>GET /api/profile/:profileId?fields=name,skills</code> — Partial JSON</div>
    <p class="note">Searches all configured relay nodes in parallel to locate the profile.</p>

    <h2>Live Updates <span class="badge badge-new">NEW</span></h2>
    <div class="endpoint"><code>GET /subscribe/:profileId</code> — SSE event stream for real-time profile updates</div>
    <p class="note">Embeds automatically subscribe to live updates. Profile changes propagate in real-time.</p>

    <h2>Network Management</h2>
    <div class="endpoint"><code>GET /relays</code> — List relay nodes + health</div>
    <div class="endpoint"><code>POST /relays</code> — Add a relay <code>{ "url": "ws://..." }</code></div>
    <div class="endpoint"><code>DELETE /relays</code> — Remove a relay <code>{ "url": "ws://..." }</code></div>
    <div class="endpoint"><code>GET /health</code> — Server + relay health + active subscriptions</div>

    <h2>SDK</h2>
    <div class="endpoint"><code>GET /embed.js</code> — JavaScript SDK</div>

    <h2>Elements</h2>
    <p><code>avatar</code> <code>name</code> <code>title</code> <code>bio</code> <code>skills</code> <code>socials</code> <code>contact</code></p>

    <h2>Quick Start</h2>
    <pre>&lt;iframe src="/embed/YOUR_PROFILE_ID?show=avatar,name,skills"
    width="440" height="300" frameborder="0"&gt;&lt;/iframe&gt;</pre>
    <p>Or with the SDK:</p>
    <pre>&lt;script src="/embed.js"&gt;&lt;/script&gt;
&lt;profile-embed profile-id="YOUR_PROFILE_ID" show="name,title,skills"&gt;&lt;/profile-embed&gt;</pre>

    <h2>Configuration</h2>
    <p class="note">Set <code>RELAY_URLS</code> as a comma-separated list of relay URLs:<br>
    <code>RELAY_URLS=ws://localhost:8765,wss://relay.example.com</code></p>
</body></html>`);
});

server.listen(PORT, HOST, () => {
    console.log(`\n📦 Embed API listening on http://${HOST}:${PORT}`);
    console.log(`   Relay nodes: ${relayUrls.length}`);
    relayUrls.forEach((url, i) => console.log(`     ${i + 1}. ${url}`));
    console.log(`   Live updates: SSE on /subscribe/:profileId`);
    console.log(`   Docs: http://localhost:${PORT}/`);
    console.log('');
});
