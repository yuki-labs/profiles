/**
 * Returns the JavaScript source for the <profile-embed> Web Component.
 * Developers include this via <script src="/embed.js">.
 *
 * The Web Component fetches rendered HTML from the embed API server
 * and displays it in a shadow DOM.
 */
export function getSdkSource(apiBaseUrl) {
    return `
(function() {
    class ProfileEmbed extends HTMLElement {
        static get observedAttributes() { return ['room', 'show']; }

        constructor() {
            super();
            this._shadow = this.attachShadow({ mode: 'open' });
            this._shadow.innerHTML = '<div style="font-family:Inter,sans-serif;color:#94a3b8;padding:24px;text-align:center;font-size:14px;">Loading profile...</div>';
        }

        connectedCallback() {
            this._load();
        }

        attributeChangedCallback() {
            this._load();
        }

        async _load() {
            const room = this.getAttribute('room');
            if (!room) {
                this._shadow.innerHTML = '<div style="color:#ef4444;padding:16px;">Missing "room" attribute</div>';
                return;
            }

            const show = this.getAttribute('show') || '';
            const baseUrl = '${apiBaseUrl}'.replace(/\\/+$/, '');
            const url = show
                ? baseUrl + '/embed/' + encodeURIComponent(room) + '?show=' + encodeURIComponent(show)
                : baseUrl + '/embed/' + encodeURIComponent(room);

            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const html = await resp.text();

                // Extract the body and style content from the full HTML page
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Copy styles into shadow DOM
                const styles = doc.querySelectorAll('style');
                const container = doc.querySelector('.embed-container');

                let shadowHTML = '';
                styles.forEach(s => { shadowHTML += '<style>' + s.textContent + '</style>'; });
                shadowHTML += container ? container.outerHTML : '<div>No content</div>';

                this._shadow.innerHTML = shadowHTML;
            } catch (e) {
                this._shadow.innerHTML = '<div style="color:#ef4444;padding:16px;font-family:Inter,sans-serif;">Failed to load profile</div>';
                console.error('[profile-embed]', e);
            }
        }
    }

    if (!customElements.get('profile-embed')) {
        customElements.define('profile-embed', ProfileEmbed);
    }
})();
`;
}
