/**
 * Dynamic Google Font loader.
 * Only the font name string is stored/synced — actual font files are fetched
 * client-side from Google Fonts on demand.
 */

const loadedFonts = new Set<string>();

/**
 * Injects a Google Fonts <link> tag to load the specified font family.
 * No-ops if the font is already loaded or if fontName is falsy.
 */
export function loadGoogleFont(fontName: string | undefined): void {
    if (!fontName || loadedFonts.has(fontName)) return;

    loadedFonts.add(fontName);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap`;
    document.head.appendChild(link);
}

/** Curated font list — only names are stored, never font files. */
export const FONT_OPTIONS: { name: string; category: string }[] = [
    { name: 'Inter', category: 'Sans Serif' },
    { name: 'Roboto', category: 'Sans Serif' },
    { name: 'Outfit', category: 'Sans Serif' },
    { name: 'Space Grotesk', category: 'Sans Serif' },
    { name: 'DM Sans', category: 'Sans Serif' },
    { name: 'Poppins', category: 'Sans Serif' },
    { name: 'Playfair Display', category: 'Serif' },
    { name: 'Lora', category: 'Serif' },
    { name: 'Merriweather', category: 'Serif' },
    { name: 'Cormorant Garamond', category: 'Serif' },
    { name: 'Pacifico', category: 'Script' },
    { name: 'Dancing Script', category: 'Script' },
    { name: 'Great Vibes', category: 'Script' },
    { name: 'Caveat', category: 'Script' },
    { name: 'Bebas Neue', category: 'Display' },
    { name: 'Righteous', category: 'Display' },
    { name: 'Permanent Marker', category: 'Display' },
    { name: 'Press Start 2P', category: 'Display' },
    { name: 'JetBrains Mono', category: 'Monospace' },
    { name: 'Fira Code', category: 'Monospace' },
];

const loadedCustomFonts = new Set<string>();

/**
 * Loads a font from base64-encoded WOFF2 data by injecting a @font-face rule.
 * Used for custom uploaded fonts where the subset data is stored in the profile.
 */
export function loadFontFromData(fontName: string, base64Data: string): void {
    if (!fontName || !base64Data) return;

    // Use a versioned key so re-subsets (different data) get re-applied
    const key = `${fontName}:${base64Data.slice(0, 32)}`;
    if (loadedCustomFonts.has(key)) return;
    loadedCustomFonts.add(key);

    const style = document.createElement('style');
    style.textContent = `
        @font-face {
            font-family: '${fontName}';
            src: url(data:font/woff2;base64,${base64Data}) format('woff2');
            font-display: swap;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Convenience: loads the correct font based on whether custom data exists.
 */
export function loadNameFont(nameFont?: string, nameFontData?: string): void {
    if (!nameFont) return;
    if (nameFontData) {
        loadFontFromData(nameFont, nameFontData);
    } else {
        loadGoogleFont(nameFont);
    }
}
