import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { ProfileData } from './types.ts';

const PROFILE_KEY = 'profileData';
const ROOM_PREFIX = 'profile-';

/**
 * Converts an HTTP(S) relay URL to a WebSocket URL.
 */
export function toWsUrl(url: string): string {
    return url
        .replace(/\/+$/, '')
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://');
}

/**
 * Converts a WebSocket relay URL to an HTTP URL for health checks.
 */
export function toHttpUrl(url: string): string {
    return url
        .replace(/\/+$/, '')
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://');
}

/**
 * Normalizes a relay URL for display/storage.
 */
export function normalizeRelayUrl(url: string): string {
    return url.replace(/\/+$/, '').trim();
}

export interface ShareResult {
    cleanup: () => void;
}

// ── Persistent Y.Doc pool ──
// Reuse the same Y.Doc + provider per room so subsequent shares use the
// same client ID. This ensures Y.js CRDT "last writer wins" always
// resolves in favor of the latest write (same client, higher clock).
interface ActiveRoom {
    doc: Y.Doc;
    provider: WebsocketProvider;
    relayUrl: string;
}

const activeRooms = new Map<string, ActiveRoom>();

/**
 * Clean up a persistent room connection.
 */
function destroyRoom(roomId: string) {
    const room = activeRooms.get(roomId);
    if (!room) return;
    try { room.provider.disconnect(); } catch { }
    try { room.provider.destroy(); } catch { }
    try { room.doc.destroy(); } catch { }
    activeRooms.delete(roomId);
}

/**
 * Get or create a persistent Y.Doc + provider for a room.
 * If the relay URL changed, the old connection is torn down and replaced.
 */
function getOrCreateRoom(roomId: string, relayUrl: string): ActiveRoom {
    const existing = activeRooms.get(roomId);
    if (existing && existing.relayUrl === relayUrl) {
        return existing;
    }

    // Tear down old connection if relay changed
    if (existing) {
        destroyRoom(roomId);
    }

    const doc = new Y.Doc();
    const wsUrl = toWsUrl(relayUrl);
    const provider = new WebsocketProvider(wsUrl, roomId, doc, {
        connect: true,
        maxBackoffTime: 5000,
    });

    const room: ActiveRoom = { doc, provider, relayUrl };
    activeRooms.set(roomId, room);
    return room;
}

/**
 * Share a profile via the Y.js relay.
 * Reuses a persistent Y.Doc per room so that subsequent shares always
 * use the same client ID, avoiding CRDT conflicts where old data could win.
 */
export function shareProfile(
    profile: ProfileData,
    relayUrl: string
): Promise<ShareResult> {
    return new Promise((resolve, reject) => {
        if (!profile.id) {
            reject(new Error('Profile must have an ID before sharing'));
            return;
        }

        const roomId = ROOM_PREFIX + profile.id;
        const room = getOrCreateRoom(roomId, relayUrl);
        const { doc, provider } = room;

        const profileMap = doc.getMap('profile');
        profileMap.set(PROFILE_KEY, JSON.stringify(profile));
        profileMap.set('updatedAt', Date.now());

        const cleanup = () => {
            destroyRoom(roomId);
        };

        // If already connected and synced, the update propagates immediately
        if (provider.synced) {
            console.log('[Y.js] Profile updated on existing connection');
            resolve({ cleanup });
            return;
        }

        const timeoutId = setTimeout(() => {
            console.warn('[Y.js] Share timed out waiting for sync, but doc is ready');
            resolve({ cleanup });
        }, 8000);

        const onSync = (synced: boolean) => {
            if (synced) {
                clearTimeout(timeoutId);
                provider.off('sync', onSync);
                console.log('[Y.js] Profile shared and synced to relay');
                resolve({ cleanup });
            }
        };

        provider.on('sync', onSync);

        provider.on('connection-error', (evt: Event) => {
            clearTimeout(timeoutId);
            console.error('[Y.js] Connection error:', evt);
            cleanup();
            reject(new Error('Failed to connect to relay'));
        });
    });
}

export interface ViewResult {
    cleanup: () => void;
}

/**
 * View a shared profile by connecting to its Y.js room on the relay.
 */
export function viewProfile(
    roomId: string,
    relayUrl: string,
    onData: (profile: ProfileData) => void,
    onTimeout: () => void,
    timeoutMs: number = 15000
): ViewResult {
    const doc = new Y.Doc();
    const wsUrl = toWsUrl(relayUrl);

    const provider = new WebsocketProvider(wsUrl, roomId, doc, {
        connect: true,
        maxBackoffTime: 5000,
    });

    let found = false;

    const timeoutId = setTimeout(() => {
        if (!found) {
            console.warn('[Y.js] View timed out — profile not found');
            onTimeout();
        }
    }, timeoutMs);

    const cleanup = () => {
        clearTimeout(timeoutId);
        provider.disconnect();
        provider.destroy();
        doc.destroy();
    };

    provider.on('sync', (synced: boolean) => {
        if (synced && !found) {
            const profileMap = doc.getMap('profile');
            const rawData = profileMap.get(PROFILE_KEY);

            if (rawData && typeof rawData === 'string') {
                try {
                    const profile = JSON.parse(rawData) as ProfileData;
                    found = true;
                    clearTimeout(timeoutId);
                    console.log('[Y.js] Profile data received');
                    onData(profile);
                } catch (e) {
                    console.error('[Y.js] Failed to parse profile data:', e);
                }
            }
        }
    });

    const profileMap = doc.getMap('profile');
    profileMap.observe(() => {
        if (found) return;
        const rawData = profileMap.get(PROFILE_KEY);
        if (rawData && typeof rawData === 'string') {
            try {
                const profile = JSON.parse(rawData) as ProfileData;
                found = true;
                clearTimeout(timeoutId);
                console.log('[Y.js] Profile data received via observe');
                onData(profile);
            } catch (e) {
                console.error('[Y.js] Failed to parse observed data:', e);
            }
        }
    });

    return { cleanup };
}

/**
 * Check if a relay URL is reachable via HTTP health check.
 */
export async function checkRelayHealth(relayUrl: string): Promise<boolean> {
    try {
        const httpUrl = toHttpUrl(relayUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        await fetch(httpUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the number of embed clients currently subscribed to a profile.
 * Reads the `embedClients` Y.Map from the active room's Y.Doc.
 */
export function getEmbedClientCount(profileId: string): number {
    const roomId = ROOM_PREFIX + profileId;
    const room = activeRooms.get(roomId);
    if (!room) return 0;

    const embedMap = room.doc.getMap('embedClients');
    return embedMap.size;
}

/**
 * Observe changes to the embed client count for a profile.
 * Calls onChange with the new count whenever embed clients connect/disconnect.
 * Returns a cleanup function to stop observing.
 */
export function onEmbedCountChange(
    profileId: string,
    onChange: (count: number) => void
): () => void {
    const roomId = ROOM_PREFIX + profileId;
    const room = activeRooms.get(roomId);
    if (!room) return () => { };

    const embedMap = room.doc.getMap('embedClients');

    const observer = () => {
        onChange(embedMap.size);
    };

    embedMap.observe(observer);
    return () => embedMap.unobserve(observer);
}

