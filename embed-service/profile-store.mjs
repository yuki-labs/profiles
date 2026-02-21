import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PROFILE_KEY = 'profileData';
const ROOM_PREFIX = 'profile-';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SUBSCRIPTION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds — polling fallback

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Active subscriptions ──
// roomId → { doc, provider, profile, listeners, idleTimer, relayUrl, pollTimer }
const activeSubscriptions = new Map();

/**
 * Convert a profile ID to a Y.js room name.
 */
export function toRoomId(profileId) {
    if (profileId.startsWith(ROOM_PREFIX)) {
        return profileId;
    }
    return ROOM_PREFIX + profileId;
}

/**
 * Extract the bare profile ID from a room name or profile ID input.
 */
export function toProfileId(input) {
    if (input.startsWith(ROOM_PREFIX)) {
        return input.slice(ROOM_PREFIX.length);
    }
    return input;
}

/**
 * Convert HTTP(S) URL to WebSocket URL.
 */
function toWsUrl(url) {
    return url
        .replace(/\/+$/, '')
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://');
}

/**
 * Convert a WebSocket URL to HTTP for health checks.
 */
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
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
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

/**
 * Notify all listeners that the profile has changed.
 */
function notifyListeners(roomId, profile) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;
    for (const callback of sub.listeners) {
        try {
            callback(profile);
        } catch (e) {
            console.error(`[Sub] Listener error for ${roomId}:`, e.message);
        }
    }
}

/**
 * Reset the idle timer. If no listeners remain after timeout, clean up.
 */
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

/**
 * Destroy a subscription and free all resources.
 */
function destroySubscription(roomId) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;

    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    if (sub.pollTimer) clearInterval(sub.pollTimer);
    try { sub.provider.disconnect(); } catch { }
    try { sub.provider.destroy(); } catch { }
    try { sub.doc.destroy(); } catch { }
    activeSubscriptions.delete(roomId);
    console.log(`[Sub] Destroyed subscription for ${roomId}`);
}

/**
 * Extract profile data from a Y.Doc.
 */
function extractProfile(doc) {
    const profileMap = doc.getMap('profile');
    const rawData = profileMap.get(PROFILE_KEY);
    if (rawData && typeof rawData === 'string') {
        try {
            return JSON.parse(rawData);
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * One-shot fetch: creates a temporary Y.Doc, connects to the relay,
 * reads the profile data, then disconnects. Used for polling fallback.
 */
function fetchFresh(roomId, relayUrl, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const doc = new Y.Doc();
        const wsUrl = toWsUrl(relayUrl);
        let resolved = false;

        const provider = new WebsocketProvider(wsUrl, roomId, doc, {
            connect: true,
            maxBackoffTime: 5000,
        });

        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
            }
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timeoutId);
            try { provider.disconnect(); } catch { }
            try { provider.destroy(); } catch { }
            try { doc.destroy(); } catch { }
        };

        const tryExtract = () => {
            if (resolved) return;
            const profileMap = doc.getMap('profile');
            const rawData = profileMap.get(PROFILE_KEY);
            if (rawData && typeof rawData === 'string') {
                try {
                    const profile = JSON.parse(rawData);
                    resolved = true;
                    cleanup();
                    resolve(profile);
                } catch { }
            }
        };

        provider.on('sync', (synced) => {
            if (synced) tryExtract();
        });

        provider.on('connection-error', () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(null);
            }
        });

        doc.getMap('profile').observe(tryExtract);
    });
}

/**
 * Start the polling fallback for a subscription.
 * Periodically creates a fresh one-shot connection to detect changes
 * that the persistent observer may miss (e.g. CRDT conflict resolution).
 */
function startPolling(roomId, relayUrl) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub || sub.pollTimer) return;

    sub.pollTimer = setInterval(async () => {
        const current = activeSubscriptions.get(roomId);
        if (!current || current.listeners.size === 0) return;

        try {
            const freshProfile = await fetchFresh(roomId, relayUrl);
            if (!freshProfile) return;

            const oldJson = JSON.stringify(current.profile);
            const newJson = JSON.stringify(freshProfile);

            if (oldJson !== newJson) {
                console.log(`[Poll] Detected change for ${roomId}`);
                current.profile = freshProfile;
                writeCache(roomId, freshProfile, relayUrl);
                notifyListeners(roomId, freshProfile);
            }
        } catch (e) {
            console.error(`[Poll] Error for ${roomId}:`, e.message);
        }
    }, POLL_INTERVAL_MS);
}

/**
 * Create or retrieve a persistent Y.js subscription.
 * Also starts a polling fallback for resilience.
 */
function ensureSubscription(roomId, relayUrl) {
    if (activeSubscriptions.has(roomId)) {
        const sub = activeSubscriptions.get(roomId);
        resetIdleTimer(roomId);
        return { profile: sub.profile, ready: Promise.resolve(sub.profile) };
    }

    const doc = new Y.Doc();
    const wsUrl = toWsUrl(relayUrl);

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
        pollTimer: null,
        relayUrl,
    };

    activeSubscriptions.set(roomId, sub);

    // Observe Y.Map for changes (fires on local + remote updates)
    const profileMap = doc.getMap('profile');
    profileMap.observe(() => {
        const newProfile = extractProfile(doc);
        if (!newProfile) return;

        const oldJson = JSON.stringify(sub.profile);
        const newJson = JSON.stringify(newProfile);
        if (oldJson !== newJson) {
            sub.profile = newProfile;
            writeCache(roomId, newProfile, relayUrl);
            console.log(`[Sub] Profile updated for ${roomId}`);
            notifyListeners(roomId, newProfile);
        }
    });

    // Promise that resolves when initial data is available
    const ready = new Promise((resolve) => {
        const timeoutId = setTimeout(() => resolve(sub.profile), 10000);

        const onSync = (synced) => {
            if (synced) {
                const profile = extractProfile(doc);
                if (profile) {
                    sub.profile = profile;
                    writeCache(roomId, profile, relayUrl);
                    clearTimeout(timeoutId);
                    resolve(profile);
                }
            }
        };

        provider.on('sync', onSync);

        // Also check via observe in case data arrives before sync event
        const earlyCheck = () => {
            const profile = extractProfile(doc);
            if (profile && !sub.profile) {
                sub.profile = profile;
                writeCache(roomId, profile, relayUrl);
                clearTimeout(timeoutId);
                resolve(profile);
            }
        };
        profileMap.observe(earlyCheck);
    });

    provider.on('connection-error', () => {
        console.error(`[Sub] Connection error for ${roomId} on ${relayUrl}`);
    });

    // Start polling fallback for resilience
    startPolling(roomId, relayUrl);
    resetIdleTimer(roomId);

    return { profile: null, ready };
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
    if (sub) {
        sub.listeners.add(callback);
    }

    const unsubscribe = () => {
        const current = activeSubscriptions.get(roomId);
        if (current) {
            current.listeners.delete(callback);
            if (current.listeners.size === 0) {
                resetIdleTimer(roomId);
            }
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

    // 4. Stale cache fallback
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
        id: ['id'],
        avatar: ['avatar'],
        name: ['name'],
        title: ['title'],
        bio: ['bio'],
        skills: ['skills'],
        socials: ['socials'],
        contact: ['email', 'location', 'website'],
        theme: ['theme'],
    };

    for (const field of fields) {
        const keys = fieldMap[field];
        if (keys) {
            for (const key of keys) {
                if (profile[key] !== undefined) {
                    filtered[key] = profile[key];
                }
            }
        }
    }

    if (profile.theme) filtered.theme = profile.theme;
    return filtered;
}

/**
 * Get info about active subscriptions (for debugging/health).
 */
export function getSubscriptionStats() {
    const stats = [];
    for (const [roomId, sub] of activeSubscriptions) {
        stats.push({
            roomId,
            hasProfile: !!sub.profile,
            listenerCount: sub.listeners.size,
            relayUrl: sub.relayUrl,
            hasPolling: !!sub.pollTimer,
        });
    }
    return stats;
}
