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
 * This allows the API to accept either a bare profile ID or a full room name.
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
 * Read a cached profile from disk.
 * Returns { profile, cachedAt } or null.
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
 * Write a profile to disk cache.
 */
function writeCache(roomId, profile) {
    const filePath = path.join(DATA_DIR, `${roomId}.json`);
    try {
        fs.writeFileSync(filePath, JSON.stringify({
            profile,
            cachedAt: Date.now()
        }, null, 2));
        console.log(`[Cache] Saved ${roomId}`);
    } catch (e) {
        console.error(`[Cache] Failed to write ${roomId}:`, e.message);
    }
}

/**
 * Fetch a profile from the Y.js relay network.
 * Connects via WebSocket, syncs the Y.Doc, extracts profile data.
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
            reject(new Error('Timeout waiting for profile sync'));
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

        doc.getMap('profile').observe(() => tryExtract());
    });
}

/**
 * Get a profile by its profile ID (or full room name).
 * Automatically resolves the profile ID to a Y.js room name.
 * Checks local cache first, then fetches from the relay.
 * Saves to cache on successful fetch.
 *
 * @param {string} profileId - Profile ID or full room name
 * @param {string} relayUrl
 * @returns {Promise<object|null>} Profile data or null
 */
export async function getProfile(profileId, relayUrl) {
    const roomId = toRoomId(profileId);

    // 1. Check cache
    const cached = readCache(roomId);
    if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
        console.log(`[Store] Cache hit for ${roomId}`);
        return cached.profile;
    }

    // 2. Fetch from relay
    try {
        console.log(`[Store] Fetching ${roomId} from relay...`);
        const profile = await fetchFromRelay(roomId, relayUrl);
        writeCache(roomId, profile);
        return profile;
    } catch (e) {
        console.error(`[Store] Relay fetch failed for ${roomId}:`, e.message);

        // 3. Fall back to stale cache
        if (cached) {
            console.log(`[Store] Using stale cache for ${roomId}`);
            return cached.profile;
        }

        return null;
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
