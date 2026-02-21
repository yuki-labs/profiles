import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PROFILE_KEY = 'profileData';
const ROOM_PREFIX = 'profile-';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SUBSCRIPTION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Unique ID for this embed service instance
const EMBED_CLIENT_ID = `embed-${crypto.randomBytes(4).toString('hex')}`;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Active subscriptions ──
// roomId → { doc, provider, profile, listeners, idleTimer, relayUrl }
const activeSubscriptions = new Map();

/**
 * Convert a profile ID to a Y.js room name.
 */
export function toRoomId(profileId) {
    if (profileId.startsWith(ROOM_PREFIX)) return profileId;
    return ROOM_PREFIX + profileId;
}

/**
 * Extract the bare profile ID from a room name.
 */
export function toProfileId(input) {
    if (input.startsWith(ROOM_PREFIX)) return input.slice(ROOM_PREFIX.length);
    return input;
}

/**
 * Convert HTTP(S) URL to WebSocket URL.
 * Appends ?role=embed to identify this service to the relay.
 */
function toWsUrl(url, asEmbed = false) {
    let wsUrl = url
        .replace(/\/+$/, '')
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://');
    if (asEmbed) {
        wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'role=embed';
    }
    return wsUrl;
}

function toHttpUrl(url) {
    return url
        .replace(/\/+$/, '')
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://');
}

// ── Disk cache ──

function readCache(roomId) {
    const filePath = path.join(DATA_DIR, `${roomId}.json`);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[Cache] Failed to read ${roomId}:`, e.message);
    }
    return null;
}

function writeCache(roomId, profile, sourceRelay) {
    const filePath = path.join(DATA_DIR, `${roomId}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify({
            profile,
            cachedAt: Date.now(),
            sourceRelay: sourceRelay || null
        }, null, 2));
        console.log(`[Cache] Saved ${roomId} (from ${sourceRelay || 'unknown'})`);
    } catch (e) {
        console.error(`[Cache] Failed to write ${roomId}:`, e.message);
    }
}

// ── Subscription helpers ──

function notifyListeners(roomId, profile) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;
    for (const callback of sub.listeners) {
        try { callback(profile); }
        catch (e) { console.error(`[Sub] Listener error for ${roomId}:`, e.message); }
    }
}

function resetIdleTimer(roomId) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;
    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    sub.idleTimer = setTimeout(() => {
        const current = activeSubscriptions.get(roomId);
        if (current && current.listeners.size === 0) {
            console.log(`[Sub] Idle timeout — closing subscription for ${roomId}`);
            destroySubscription(roomId);
        }
    }, SUBSCRIPTION_IDLE_TIMEOUT_MS);
}

function destroySubscription(roomId) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;
    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    // Deregister from embedClients map before disconnecting
    try {
        const embedMap = sub.doc.getMap('embedClients');
        embedMap.delete(EMBED_CLIENT_ID);
    } catch { }
    try { sub.provider.disconnect(); } catch { }
    try { sub.provider.destroy(); } catch { }
    try { sub.doc.destroy(); } catch { }
    activeSubscriptions.delete(roomId);
    console.log(`[Sub] Destroyed subscription for ${roomId}`);
}

function extractProfile(doc) {
    const profileMap = doc.getMap('profile');
    const rawData = profileMap.get(PROFILE_KEY);
    if (rawData && typeof rawData === 'string') {
        try { return JSON.parse(rawData); }
        catch { return null; }
    }
    return null;
}

/**
 * Handle a profile push message from the relay server.
 * The relay sends JSON text frames with { type: 'profileUpdate', profile }
 * when it detects a profile change in the room.
 */
function handleRelayPush(roomId, data) {
    try {
        const msg = JSON.parse(data);
        if (msg.type !== 'profileUpdate' || !msg.profile) return false;

        const sub = activeSubscriptions.get(roomId);
        if (!sub) return false;

        const oldJson = JSON.stringify(sub.profile);
        const newJson = JSON.stringify(msg.profile);

        if (oldJson !== newJson) {
            sub.profile = msg.profile;
            writeCache(roomId, msg.profile, sub.relayUrl);
            console.log(`[Push] Relay pushed update for ${roomId}`);
            notifyListeners(roomId, msg.profile);
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Create or retrieve a persistent subscription for a room.
 * Connects as an embed client (?role=embed) so the relay pushes profile
 * updates directly to us via custom JSON messages.
 */
function ensureSubscription(roomId, relayUrl) {
    if (activeSubscriptions.has(roomId)) {
        const sub = activeSubscriptions.get(roomId);
        resetIdleTimer(roomId);
        return { profile: sub.profile, ready: Promise.resolve(sub.profile) };
    }

    const doc = new Y.Doc();
    const wsUrl = toWsUrl(relayUrl, true); // Connect as embed client

    const provider = new WebsocketProvider(wsUrl, roomId, doc, {
        connect: true,
        maxBackoffTime: 10000,
    });

    const sub = {
        doc,
        provider,
        profile: null,
        listeners: new Set(),
        idleTimer: null,
        relayUrl,
    };

    activeSubscriptions.set(roomId, sub);

    // Listen for custom JSON push messages from the relay
    // The relay sends text frames alongside the binary Y.js protocol
    if (provider.ws) {
        setupPushListener(roomId, provider);
    }
    provider.on('status', ({ status }) => {
        if (status === 'connected') {
            setupPushListener(roomId, provider);
        }
    });

    // Also observe Y.Map as a fallback for standard Y.js sync
    const profileMap = doc.getMap('profile');
    profileMap.observe(() => {
        const newProfile = extractProfile(doc);
        if (!newProfile) return;

        const oldJson = JSON.stringify(sub.profile);
        const newJson = JSON.stringify(newProfile);
        if (oldJson !== newJson) {
            sub.profile = newProfile;
            writeCache(roomId, newProfile, relayUrl);
            console.log(`[Sub] Profile updated for ${roomId} (Y.js observe)`);
            notifyListeners(roomId, newProfile);
        }
    });

    // Promise that resolves when initial data is available
    const ready = new Promise((resolve) => {
        const timeoutId = setTimeout(() => resolve(sub.profile), 10000);

        provider.on('sync', (synced) => {
            if (synced) {
                // Register this embed service in the Y.Doc
                const embedMap = doc.getMap('embedClients');
                embedMap.set(EMBED_CLIENT_ID, JSON.stringify({
                    connectedAt: Date.now(),
                    serviceId: EMBED_CLIENT_ID,
                }));
                console.log(`[Sub] Registered as embed client ${EMBED_CLIENT_ID} in ${roomId}`);

                const profile = extractProfile(doc);
                if (profile) {
                    sub.profile = profile;
                    writeCache(roomId, profile, relayUrl);
                    clearTimeout(timeoutId);
                    resolve(profile);
                }
            }
        });
    });

    provider.on('connection-error', () => {
        console.error(`[Sub] Connection error for ${roomId} on ${relayUrl}`);
    });

    resetIdleTimer(roomId);
    return { profile: null, ready };
}

/**
 * Attach a message listener to the WebSocket to receive relay push messages.
 * The y-websocket provider's WebSocket receives both binary Y.js messages
 * and our custom text-based JSON push messages.
 */
function setupPushListener(roomId, provider) {
    const ws = provider.ws;
    if (!ws || ws._embedPushListener) return;

    const listener = (event) => {
        // Only handle text (string) messages — Y.js protocol uses binary
        const data = typeof event === 'string' ? event : event?.data;
        if (typeof data === 'string') {
            handleRelayPush(roomId, data);
        }
    };

    // WebSocket in Node.js (ws library) emits 'message' with (data, isBinary)
    ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
            handleRelayPush(roomId, event.data);
        }
    });

    ws._embedPushListener = true;
}

// ── Public API ──

/**
 * Subscribe to live updates for a profile.
 */
export function subscribe(profileId, relayUrls, callback) {
    const roomId = toRoomId(profileId);
    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    const existing = activeSubscriptions.get(roomId);
    const relayUrl = existing?.relayUrl || urls[0];

    const { ready } = ensureSubscription(roomId, relayUrl);

    const sub = activeSubscriptions.get(roomId);
    if (sub) sub.listeners.add(callback);

    const unsubscribe = () => {
        const current = activeSubscriptions.get(roomId);
        if (current) {
            current.listeners.delete(callback);
            if (current.listeners.size === 0) resetIdleTimer(roomId);
        }
    };

    return { unsubscribe, ready };
}

/**
 * Get a profile by its profile ID.
 */
export async function getProfile(profileId, relayUrls) {
    const roomId = toRoomId(profileId);
    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    // 1. Active subscription with data
    const existing = activeSubscriptions.get(roomId);
    if (existing?.profile) {
        console.log(`[Store] Live subscription hit for ${roomId}`);
        return existing.profile;
    }

    // 2. Disk cache
    const cached = readCache(roomId);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
        console.log(`[Store] Cache hit for ${roomId}`);
        const relayUrl = cached.sourceRelay || urls[0];
        if (relayUrl) ensureSubscription(roomId, relayUrl);
        return cached.profile;
    }

    // 3. Fetch from network
    if (urls.length === 0) return cached?.profile || null;

    console.log(`[Store] Searching ${urls.length} relay(s) for ${roomId}...`);

    const preferredRelay = cached?.sourceRelay;
    const orderedUrls = preferredRelay && urls.includes(preferredRelay)
        ? [preferredRelay, ...urls.filter(u => u !== preferredRelay)]
        : urls;

    for (const relayUrl of orderedUrls) {
        try {
            const { ready } = ensureSubscription(roomId, relayUrl);
            const profile = await ready;
            if (profile) return profile;
            destroySubscription(roomId);
        } catch (e) {
            console.error(`[Store] Failed on relay ${relayUrl}:`, e.message);
            destroySubscription(roomId);
        }
    }

    // 4. Stale cache
    if (cached) {
        console.log(`[Store] Using stale cache for ${roomId}`);
        return cached.profile;
    }

    return null;
}

/**
 * Check if a relay is reachable via HTTP.
 */
export async function checkRelayHealth(relayUrl) {
    try {
        const httpUrl = toHttpUrl(relayUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const resp = await fetch(httpUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        return resp.ok;
    } catch {
        return false;
    }
}

/**
 * Filter profile fields.
 */
export function filterProfile(profile, fields) {
    if (!fields || fields.length === 0) return profile;

    const filtered = {};
    const fieldMap = {
        id: ['id'], avatar: ['avatar'], name: ['name'], title: ['title'],
        bio: ['bio'], skills: ['skills'], socials: ['socials'],
        contact: ['email', 'location', 'website'], theme: ['theme'],
    };

    for (const field of fields) {
        const keys = fieldMap[field];
        if (keys) {
            for (const key of keys) {
                if (profile[key] !== undefined) filtered[key] = profile[key];
            }
        }
    }

    if (profile.theme) filtered.theme = profile.theme;
    return filtered;
}

/**
 * Get info about active subscriptions.
 */
export function getSubscriptionStats() {
    const stats = [];
    for (const [roomId, sub] of activeSubscriptions) {
        stats.push({
            roomId,
            hasProfile: !!sub.profile,
            listenerCount: sub.listeners.size,
            relayUrl: sub.relayUrl,
        });
    }
    return stats;
}
