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
