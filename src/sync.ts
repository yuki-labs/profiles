import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { ProfileData } from './types.ts';

const PROFILE_KEY = 'profileData';
const ROOM_PREFIX = 'profile-';

/**
 * Converts an HTTP(S) relay URL to a WebSocket URL.
 * e.g. https://example.com → wss://example.com
 *      http://localhost:8765 → ws://localhost:8765
 */
export function toWsUrl(url: string): string {
    return url
        .replace(/\/+$/, '')          // strip trailing slashes
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
 * Accepts http(s) or ws(s) URLs. Stores as the base URL without trailing slashes.
 */
export function normalizeRelayUrl(url: string): string {
    return url.replace(/\/+$/, '').trim();
}

export interface ShareResult {
    roomId: string;
    cleanup: () => void;
}

/**
 * Share a profile via the Y.js relay.
 * Creates a Y.Doc, stores the profile data, and connects to the relay.
 * Returns once the initial sync is complete or times out.
 */
export function shareProfile(
    profile: ProfileData,
    relayUrl: string
): Promise<ShareResult> {
    return new Promise((resolve, reject) => {
        const roomId = ROOM_PREFIX + Math.random().toString(36).substring(2, 11);
        const doc = new Y.Doc();
        const profileMap = doc.getMap('profile');

        // Store the entire profile as a JSON string to preserve all nested structures
        profileMap.set(PROFILE_KEY, JSON.stringify(profile));
        profileMap.set('updatedAt', Date.now());

        const wsUrl = toWsUrl(relayUrl);

        const provider = new WebsocketProvider(wsUrl, roomId, doc, {
            connect: true,
            maxBackoffTime: 5000,
        });

        const timeoutId = setTimeout(() => {
            // If we haven't synced in 8s, resolve anyway — data is in the doc
            // and will sync when the connection is established
            console.warn('[Y.js] Share timed out waiting for sync, but doc is ready');
            resolve({ roomId, cleanup });
        }, 8000);

        const cleanup = () => {
            provider.disconnect();
            provider.destroy();
            doc.destroy();
        };

        provider.on('sync', (synced: boolean) => {
            if (synced) {
                clearTimeout(timeoutId);
                console.log('[Y.js] Profile shared and synced to relay');
                resolve({ roomId, cleanup });
            }
        });

        provider.on('connection-error', (err: Error) => {
            clearTimeout(timeoutId);
            console.error('[Y.js] Connection error:', err);
            cleanup();
            reject(new Error(`Failed to connect to relay: ${err.message}`));
        });
    });
}

export interface ViewResult {
    cleanup: () => void;
}

/**
 * View a shared profile by connecting to its Y.js room on the relay.
 * Calls onData when profile data is received.
 * Calls onTimeout if no data arrives within the timeout period.
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

    // Listen for sync events — data arrives when the relay sends the doc
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

    // Also observe changes in case data arrives after initial sync
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
