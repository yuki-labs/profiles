import subsetFont from 'subset-font';

/**
 * Subset a font buffer to only include the glyphs for the given text.
 * Returns a WOFF2 buffer containing only the necessary character data.
 */
export async function subsetFontForText(
    fontBuffer: Uint8Array,
    text: string
): Promise<Uint8Array> {
    // Deduplicate characters to minimize subset size
    const uniqueChars = [...new Set(text)].join('');
    const result = await subsetFont(fontBuffer, uniqueChars, {
        targetFormat: 'woff2',
    });
    return new Uint8Array(result);
}

/** Convert a Uint8Array to a base64 string. */
export function bufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
        binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
}

/** Convert a base64 string back to a Uint8Array. */
export function base64ToBuffer(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Key used to store the full (unsubsetted) font in localStorage. */
const LOCAL_FONT_KEY = 'profii_custom_font_source';

/** Store the full font buffer locally for re-subsetting when the name changes. */
export function storeLocalFontSource(buffer: Uint8Array, fileName: string): void {
    const data = {
        fileName,
        base64: bufferToBase64(buffer),
    };
    localStorage.setItem(LOCAL_FONT_KEY, JSON.stringify(data));
}

/** Retrieve the locally stored full font buffer, if any. */
export function getLocalFontSource(): { fileName: string; buffer: Uint8Array } | null {
    const raw = localStorage.getItem(LOCAL_FONT_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        return {
            fileName: data.fileName,
            buffer: base64ToBuffer(data.base64),
        };
    } catch {
        return null;
    }
}

/** Remove the locally stored font source. */
export function clearLocalFontSource(): void {
    localStorage.removeItem(LOCAL_FONT_KEY);
}
