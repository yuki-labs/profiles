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

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Active subscriptions ──
// roomId → { doc, provider, profile, listeners: Set<callback>, idleTimer, relayUrl }
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

// ── Subscription manager ──

/**
 * Notify all listeners registered for a room that the profile has updated.
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
 * Reset the idle timer for a subscription. If no listeners remain
 * after the timeout, the persistent connection is cleaned up.
 */
function resetIdleTimer(roomId) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;

    if (sub.idleTimer) {
        clearTimeout(sub.idleTimer);
    }

    sub.idleTimer = setTimeout(() => {
        const current = activeSubscriptions.get(roomId);
        if (current && current.listeners.size === 0) {
            console.log(`[Sub] Idle timeout — closing subscription for ${roomId}`);
            destroySubscription(roomId);
        }
    }, SUBSCRIPTION_IDLE_TIMEOUT_MS);
}

/**
 * Destroy a persistent subscription and free resources.
 */
function destroySubscription(roomId) {
    const sub = activeSubscriptions.get(roomId);
    if (!sub) return;

    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    try { sub.provider.disconnect(); } catch { }
    try { sub.provider.destroy(); } catch { }
    try { sub.doc.destroy(); } catch { }
    activeSubscriptions.delete(roomId);
    console.log(`[Sub] Destroyed subscription for ${roomId}`);
}

/**
 * Extract profile data from a Y.Doc.
 * Returns the parsed profile or null.
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
 * Create or retrieve a persistent Y.js subscription for a room.
 * Keeps the WebSocket connection alive, observes for changes,
 * and notifies listeners when profile data updates.
 *
 * @param {string} roomId - Y.js room name
 * @param {string} relayUrl - Relay URL to connect to
 * @returns {{ profile: object|null, ready: Promise<object|null> }}
 */
function ensureSubscription(roomId, relayUrl) {
    // Reuse existing subscription
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
        relayUrl,
    };

    activeSubscriptions.set(roomId, sub);

    // Observe profile map for changes — this fires on every Y.js update
    const profileMap = doc.getMap('profile');
    profileMap.observe(() => {
        const newProfile = extractProfile(doc);
        if (!newProfile) return;

        // Only notify if data actually changed
        const oldJson = JSON.stringify(sub.profile);
        const newJson = JSON.stringify(newProfile);
        if (oldJson !== newJson) {
            sub.profile = newProfile;
            writeCache(roomId, newProfile, relayUrl);
            console.log(`[Sub] Profile updated for ${roomId}`);
            notifyListeners(roomId, newProfile);
        }
    });

    // Create a promise that resolves when the initial profile is available
    const ready = new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            // If we haven't received data after 10s, resolve with whatever we have
            resolve(sub.profile);
        }, 10000);

        provider.on('sync', (synced) => {
            if (synced) {
                const profile = extractProfile(doc);
                if (profile) {
                    sub.profile = profile;
                    writeCache(roomId, profile, relayUrl);
                    clearTimeout(timeoutId);
                    resolve(profile);
                }
            }
        });

        // Also check if data arrives via observe before sync event
        const checkOnce = () => {
            const profile = extractProfile(doc);
            if (profile && !sub.profile) {
                sub.profile = profile;
                writeCache(roomId, profile, relayUrl);
                clearTimeout(timeoutId);
                resolve(profile);
            }
        };
        profileMap.observe(checkOnce);
    });

    provider.on('connection-error', () => {
        console.error(`[Sub] Connection error for ${roomId} on ${relayUrl}`);
    });

    resetIdleTimer(roomId);
    return { profile: null, ready };
}

// ── Public API ──

/**
 * Subscribe to live updates for a profile.
 * The callback will be invoked whenever the profile data changes.
 *
 * @param {string} profileId - Profile ID or full room name
 * @param {string[]} relayUrls - List of relay URLs
 * @param {function} callback - Called with (profile) on each update
 * @returns {{ unsubscribe: function, ready: Promise<object|null> }}
 */
export function subscribe(profileId, relayUrls, callback) {
    const roomId = toRoomId(profileId);
    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    // Use the first available relay (or the one from an existing subscription)
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
 * Checks cache first, then connects to relays.
 * Creates a persistent subscription for future live updates.
 *
 * @param {string} profileId - Profile ID or full room name
 * @param {string[]} relayUrls - List of relay URLs to search
 * @returns {Promise<object|null>} Profile data or null
 */
export async function getProfile(profileId, relayUrls) {
    const roomId = toRoomId(profileId);
    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    // 1. Check if we have an active subscription with data
    const existing = activeSubscriptions.get(roomId);
    if (existing?.profile) {
        console.log(`[Store] Live subscription hit for ${roomId}`);
        return existing.profile;
    }

    // 2. Check disk cache (for fast initial response)
    const cached = readCache(roomId);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
        console.log(`[Store] Cache hit for ${roomId}`);

        // Start a background subscription for future updates
        const relayUrl = cached.sourceRelay || urls[0];
        if (relayUrl) {
            ensureSubscription(roomId, relayUrl);
        }

        return cached.profile;
    }

    // 3. Fetch from network — try each relay, first success wins
    if (urls.length === 0) {
        return cached?.profile || null;
    }

    console.log(`[Store] Searching ${urls.length} relay(s) for ${roomId}...`);

    // Try preferred relay first (from stale cache)
    const preferredRelay = cached?.sourceRelay;
    const orderedUrls = preferredRelay && urls.includes(preferredRelay)
        ? [preferredRelay, ...urls.filter(u => u !== preferredRelay)]
        : urls;

    for (const relayUrl of orderedUrls) {
        try {
            const { ready } = ensureSubscription(roomId, relayUrl);
            const profile = await ready;
            if (profile) {
                return profile;
            }
            // If this relay didn't have it, destroy and try next
            destroySubscription(roomId);
        } catch (e) {
            console.error(`[Store] Failed on relay ${relayUrl}:`, e.message);
            destroySubscription(roomId);
        }
    }

    // 4. Fall back to stale cache
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
 * Filter profile fields based on a list of requested field names.
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

    // Always include theme for styling
    if (profile.theme) {
        filtered.theme = profile.theme;
    }

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
        });
    }
    return stats;
}
