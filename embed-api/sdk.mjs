/**
 * Returns the JavaScript source for the <profile-embed> Web Component.
 * Developers include this via <script src="/embed.js">.
 *
 * The Web Component fetches rendered HTML from the embed API server,
 * then opens an SSE connection for live updates.
 *
 * Usage:
 *   <profile-embed profile-id="YOUR_PROFILE_ID" show="name,title,skills"></profile-embed>
 */
export function getSdkSource(apiBaseUrl) {
    return `
(function() {
    class ProfileEmbed extends HTMLElement {
        static get observedAttributes() { return ['profile-id', 'show']; }

        constructor() {
            super();
            this._shadow = this.attachShadow({ mode: 'open' });
            this._shadow.innerHTML = '<div style="font-family:Inter,sans-serif;color:#94a3b8;padding:24px;text-align:center;font-size:14px;">Loading profile...</div>';
            this._eventSource = null;
            this._retryDelay = 1000;
            this._maxRetry = 30000;
            this._retryTimer = null;
        }

        connectedCallback() {
            this._load();
        }

        disconnectedCallback() {
            this._closeSSE();
        }

        attributeChangedCallback() {
            this._closeSSE();
            this._load();
        }

        _closeSSE() {
            if (this._eventSource) {
                this._eventSource.close();
                this._eventSource = null;
            }
            if (this._retryTimer) {
                clearTimeout(this._retryTimer);
                this._retryTimer = null;
            }
        }

        async _load() {
            var profileId = this.getAttribute('profile-id');
            if (!profileId) {
                this._shadow.innerHTML = '<div style="color:#ef4444;padding:16px;">Missing "profile-id" attribute</div>';
                return;
            }

            var show = this.getAttribute('show') || '';
            var baseUrl = '${apiBaseUrl}'.replace(/\\\\/+$/, '');
            var embedUrl = show
                ? baseUrl + '/embed/' + encodeURIComponent(profileId) + '?show=' + encodeURIComponent(show)
                : baseUrl + '/embed/' + encodeURIComponent(profileId);

            try {
                var resp = await fetch(embedUrl);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                var html = await resp.text();
                this._applyHTML(html);
            } catch (e) {
                this._shadow.innerHTML = '<div style="color:#ef4444;padding:16px;font-family:Inter,sans-serif;">Failed to load profile</div>';
                console.error('[profile-embed]', e);
            }

            // Open SSE connection for live updates
            this._connectSSE(profileId, baseUrl);
        }

        _applyHTML(html) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');

            var styles = doc.querySelectorAll('style');
            var container = doc.querySelector('.embed-container');

            var shadowHTML = '';
            styles.forEach(function(s) { shadowHTML += '<style>' + s.textContent + '</style>'; });
            shadowHTML += container ? container.outerHTML : '<div>No content</div>';

            this._shadow.innerHTML = shadowHTML;
        }

        _connectSSE(profileId, baseUrl) {
            var self = this;
            if (typeof EventSource === 'undefined') {
                // Fallback to polling
                self._pollTimer = setInterval(function() {
                    var show = self.getAttribute('show') || '';
                    var url = show
                        ? baseUrl + '/api/profile/' + encodeURIComponent(profileId) + '?fields=' + encodeURIComponent(show)
                        : baseUrl + '/api/profile/' + encodeURIComponent(profileId);
                    fetch(url)
                        .then(function(r) { return r.json(); })
                        .then(function(p) { if (p && !p.error) self._updateFromJSON(p, baseUrl, profileId); })
                        .catch(function() {});
                }, 30000);
                return;
            }

            var sseUrl = baseUrl + '/subscribe/' + encodeURIComponent(profileId);
            var es = new EventSource(sseUrl);
            self._eventSource = es;

            es.addEventListener('update', function(e) {
                try {
                    var profile = JSON.parse(e.data);
                    self._updateFromJSON(profile, baseUrl, profileId);
                    self._retryDelay = 1000;
                } catch (err) {
                    console.error('[profile-embed] Failed to parse update:', err);
                }
            });

            es.onerror = function() {
                es.close();
                self._eventSource = null;
                console.warn('[profile-embed] SSE lost, retrying in ' + self._retryDelay + 'ms');
                self._retryTimer = setTimeout(function() {
                    self._connectSSE(profileId, baseUrl);
                }, self._retryDelay);
                self._retryDelay = Math.min(self._retryDelay * 2, self._maxRetry);
            };
        }

        _updateFromJSON(profile, baseUrl, profileId) {
            // Re-fetch rendered HTML to get proper server-side rendering
            var show = this.getAttribute('show') || '';
            var embedUrl = show
                ? baseUrl + '/embed/' + encodeURIComponent(profileId) + '?show=' + encodeURIComponent(show)
                : baseUrl + '/embed/' + encodeURIComponent(profileId);

            var self = this;
            fetch(embedUrl)
                .then(function(r) { return r.text(); })
                .then(function(html) { self._applyHTML(html); })
                .catch(function(e) { console.error('[profile-embed] Re-render failed:', e); });
        }
    }

    if (!customElements.get('profile-embed')) {
        customElements.define('profile-embed', ProfileEmbed);
    }
})();
`;
}
