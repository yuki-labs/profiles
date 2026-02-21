import { nanoid } from 'nanoid';
import type { ProfileData } from './types.ts';

/**
 * Generate a new unique profile ID.
 * Uses nanoid (21-char, URL-safe, collision-resistant).
 */
export function generateProfileId(): string {
    return nanoid();
}

/**
 * Ensure a profile has an ID.
 * If the profile already has a non-empty ID, it is returned unchanged.
 * Otherwise, a new ID is generated and attached.
 */
export function ensureProfileId(profile: ProfileData): ProfileData {
    if (profile.id && profile.id.length > 0) {
        return profile;
    }
    return { ...profile, id: generateProfileId() };
}
