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

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Convert a profile ID to a Y.js room name.
 * If the input already has the prefix, it's returned as-is.
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

/**
 * Read a cached profile from disk.
 * Returns { profile, cachedAt, sourceRelay } or null.
 */
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

/**
 * Write a profile to disk cache, including which relay it came from.
 */
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

/**
 * Fetch a profile from a single Y.js relay node.
 * Connects via WebSocket, syncs the Y.Doc, extracts profile data.
 * Resolves with the profile data or rejects on timeout/error.
 */
function fetchFromRelay(roomId, relayUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const doc = new Y.Doc();
        const wsUrl = toWsUrl(relayUrl);

        const provider = new WebsocketProvider(wsUrl, roomId, doc, {
            connect: true,
            maxBackoffTime: 5000,
        });

        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout on ${relayUrl}`));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timeoutId);
            provider.disconnect();
            provider.destroy();
            doc.destroy();
        };

        let resolved = false;

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
                } catch (e) {
                    // Not valid JSON yet, keep waiting
                }
            }
        };

        provider.on('sync', (synced) => {
            if (synced) tryExtract();
        });

        provider.on('connection-error', () => {
            if (!resolved) {
                cleanup();
                reject(new Error(`Connection failed to ${relayUrl}`));
            }
        });

        doc.getMap('profile').observe(() => tryExtract());
    });
}

/**
 * Race multiple relay nodes to find a profile.
 * Queries all relays in parallel and returns the first successful result.
 * If the cached entry has a sourceRelay, that relay is tried with priority
 * (given a shorter timeout before falling back to all relays).
 *
 * @param {string} roomId - Y.js room name
 * @param {string[]} relayUrls - List of relay URLs to query
 * @param {string|null} preferredRelay - Relay that last served this profile
 * @returns {Promise<{profile: object, sourceRelay: string}>}
 */
async function fetchFromNetwork(roomId, relayUrls, preferredRelay = null) {
    if (relayUrls.length === 0) {
        throw new Error('No relay URLs configured');
    }

    // If we have a preferred relay, try it first with a short timeout
    if (preferredRelay && relayUrls.includes(preferredRelay)) {
        try {
            console.log(`[Network] Trying preferred relay ${preferredRelay} for ${roomId}`);
            const profile = await fetchFromRelay(roomId, preferredRelay, 5000);
            return { profile, sourceRelay: preferredRelay };
        } catch (e) {
            console.log(`[Network] Preferred relay failed, querying all nodes...`);
        }
    }

    // Query all relays in parallel — first one to return profile data wins
    const results = relayUrls.map(async (relayUrl) => {
        try {
            const profile = await fetchFromRelay(roomId, relayUrl, 10000);
            return { profile, sourceRelay: relayUrl };
        } catch (e) {
            throw e; // Let Promise.any handle it
        }
    });

    try {
        return await Promise.any(results);
    } catch (aggregateError) {
        // All relays failed
        const reasons = aggregateError.errors?.map(e => e.message).join(', ') || 'All relays failed';
        throw new Error(`Profile not found on any relay: ${reasons}`);
    }
}

/**
 * Get a profile by its profile ID.
 * Resolves the ID to a room name, checks cache, then queries
 * all configured relay nodes in parallel to find the profile.
 *
 * @param {string} profileId - Profile ID or full room name
 * @param {string[]} relayUrls - List of relay URLs to search
 * @returns {Promise<object|null>} Profile data or null
 */
export async function getProfile(profileId, relayUrls) {
    const roomId = toRoomId(profileId);
    const urls = Array.isArray(relayUrls) ? relayUrls : [relayUrls];

    // 1. Check cache
    const cached = readCache(roomId);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
        console.log(`[Store] Cache hit for ${roomId}`);
        return cached.profile;
    }

    // 2. Fetch from network (all relays in parallel)
    try {
        console.log(`[Store] Searching ${urls.length} relay(s) for ${roomId}...`);
        const { profile, sourceRelay } = await fetchFromNetwork(
            roomId,
            urls,
            cached?.sourceRelay || null
        );
        writeCache(roomId, profile, sourceRelay);
        return profile;
    } catch (e) {
        console.error(`[Store] Network fetch failed for ${roomId}:`, e.message);

        // 3. Fall back to stale cache
        if (cached) {
            console.log(`[Store] Using stale cache for ${roomId}`);
            return cached.profile;
        }

        return null;
    }
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
