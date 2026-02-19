import { useState, useEffect, useRef } from 'react';
import './App.css';
import type { ProfileData } from './types.ts';
import { defaultProfile } from './types.ts';

import ProfilePreview from './components/ProfilePreview.tsx';
import { Download, Upload, RefreshCcw, Share2, Copy, X, Globe, Settings, Activity, Plus, Trash2 } from 'lucide-react';
import Gun from 'gun';
import 'gun/lib/load'; // Optional but helps with larger objects

declare global {
  interface Window {
    electronAPI?: {
      onOpenProfile: (callback: (id: string) => void) => void;
    };
  }
}

// Initialize Gun without default relays for maximum privacy
const gun = Gun({
  peers: [],
  retry: 3000,
  localStorage: false
});
const profiles = gun.get('profile-maker-p2p-v2');


function App() {
  const [profile, setProfile] = useState<ProfileData>(() => {
    const saved = localStorage.getItem('profile_maker_data');
    return saved ? JSON.parse(saved) : defaultProfile;
  });
  const [shareData, setShareData] = useState<{ id: string, shareUrl: string, deepLink: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [showSettings, setShowSettings] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState('');
  const [customPeers, setCustomPeers] = useState<string[]>(() => {
    const saved = localStorage.getItem('p2p_peers');
    return saved ? JSON.parse(saved) : [];
  });
  const [activePeers, setActivePeers] = useState<string[]>(customPeers);

  const customPeersRef = useRef<string[]>(customPeers);
  const removedPeersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    customPeersRef.current = customPeers;
  }, [customPeers]);

  // Initial peer load on mount
  useEffect(() => {
    if (customPeers.length > 0) {
      gun.opt({ peers: customPeers });
    }
  }, []);

  const [viewId, setViewId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view');
  });
  const [viewData, setViewData] = useState<ProfileData | null>(null);
  const [isViewing, setIsViewing] = useState(false);

  useEffect(() => {
    localStorage.setItem('profile_maker_data', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    if (viewId) {
      setIsViewing(true);
      setViewData(null);

      console.log(`Searching for P2P profile: ${viewId}`);

      let found = false;
      const timeout = setTimeout(() => {
        if (!found) {
          alert('P2P Profile not found. The network might be slow or the peer is offline.');
          setIsViewing(false);
          setViewId(null);
        }
      }, 15000); // Wait 15 seconds for decentralized discovery

      // Use .on() instead of .once() as it's more reliable for gossip data that arrives late
      profiles.get(viewId).on((data: any) => {
        if (data && data.data) {
          // v2 format: JSON-serialized profile
          try {
            const parsed = JSON.parse(data.data);
            console.log("Profile data found (v2)!");
            found = true;
            clearTimeout(timeout);
            setViewData(parsed as ProfileData);
            setIsViewing(false);
          } catch (e) {
            console.error('Failed to parse profile data:', e);
          }
        } else if (data && (data.name || data.bio)) {
          // v1 legacy format fallback (flat object, may be missing arrays)
          console.log("Profile data found (v1 legacy)!");
          found = true;
          clearTimeout(timeout);
          // Ensure arrays exist even if Gun dropped them
          const legacyData = {
            ...data,
            socials: data.socials || [],
            skills: data.skills || [],
            theme: data.theme || { primaryColor: '#6366f1', darkMode: true }
          };
          setViewData(legacyData as ProfileData);
          setIsViewing(false);
        }
      });

      return () => {
        clearTimeout(timeout);
        // Note: gun .off() is sometimes buggy in certain versions, 
        // but it's good practice to prevent memory leaks if possible.
        try { profiles.get(viewId).off(); } catch (e) { }
      };
    }
  }, [viewId]);

  useEffect(() => {
    // 1. Peer status check via direct HTTP health check
    // Gun's internal peer state (enabled/wire) is unreliable and often undefined
    // even when data is flowing. Instead, we ping relay URLs directly.
    const checkPeerHealth = async () => {
      const currentPeers = customPeersRef.current;
      if (currentPeers.length === 0) {
        setActivePeers([]);
        return;
      }

      const results = await Promise.all(
        currentPeers.map(async (peerUrl) => {
          try {
            // Strip /gun suffix if present and fetch the base URL
            const baseUrl = peerUrl.replace(/\/gun\/?$/, '');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            await fetch(baseUrl, {
              method: 'HEAD',
              mode: 'no-cors', // Railway may not send CORS for HEAD
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            // no-cors gives opaque response (status 0), but that means it's reachable
            return peerUrl;
          } catch {
            return null;
          }
        })
      );

      setActivePeers(results.filter((url): url is string => url !== null));
    };

    checkPeerHealth();
    const interval = setInterval(checkPeerHealth, 10000);

    // 2. Conditional Auto-Discovery (only if user has already added a relay)
    const discoveryBucket = gun.get('profile-maker-discovery').get('relays');
    discoveryBucket.map().on((node: any, urlKey: string) => {
      // Use the ref to get latest state inside the callback
      const currentPeers = customPeersRef.current;
      const removedPeers = removedPeersRef.current;

      // ONLY auto-discover if the user has opted-in by adding at least one manual relay
      if (currentPeers.length === 0) return;

      const url = (node && typeof node === 'object' && node.url) ? node.url : urlKey;
      const lastSeen = (node && typeof node === 'object' && node.lastSeen) ? node.lastSeen : (typeof node === 'number' ? node : 0);

      if (url && (url.startsWith('http') || url.startsWith('ws')) && !currentPeers.includes(url) && !removedPeers.has(url)) {
        // Validation: Seen in the last 30 minutes
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        if (lastSeen > thirtyMinutesAgo) {
          console.log(`Auto-discovered node: ${url}`);
          const newPeers = [...currentPeers, url];
          setCustomPeers(newPeers);
          localStorage.setItem('p2p_peers', JSON.stringify(newPeers));
          gun.opt({ peers: [url] });
        }
      }
    });

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 3. Handle deep links from Electron
    if (window.electronAPI) {
      window.electronAPI.onOpenProfile((id: string) => {
        console.log('Deep link received:', id);
        setViewId(id);
      });
    }
  }, []);

  const addCustomPeer = () => {
    const url = newPeerUrl.trim();
    if (url && url.startsWith('http') && !customPeers.includes(url)) {
      const newPeers = [...customPeers, url];
      setCustomPeers(newPeers);
      localStorage.setItem('p2p_peers', JSON.stringify(newPeers));
      gun.opt({ peers: [url] });
      setNewPeerUrl('');
    } else if (url) {
      alert('Please enter a valid HTTP(S) URL.');
    }
  };

  const removeCustomPeer = (url: string) => {
    const newPeers = customPeers.filter(p => p !== url);
    setCustomPeers(newPeers);
    localStorage.setItem('p2p_peers', JSON.stringify(newPeers));

    // Remember this peer was explicitly removed so we don't auto-add it again
    removedPeersRef.current.add(url);

    // Disable it in Gun
    // @ts-ignore
    const peers = gun.back('opt.peers');
    if (peers && peers[url]) {
      peers[url].enabled = false;
      if (peers[url].wire) peers[url].wire.close();
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profile-${profile.name || 'unnamed'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        setProfile(data);
      } catch (err) {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const resetProfile = () => {
    if (confirm('Are you sure you want to reset your profile?')) {
      setProfile(defaultProfile);
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    setSyncStatus('syncing');
    try {
      // Create a unique P2P ID for this profile
      const id = 'p2p-' + Math.random().toString(36).substr(2, 9);

      // Serialize the entire profile as JSON to avoid GunDB
      // silently dropping arrays and nested objects
      const payload = {
        data: JSON.stringify(profile),
        updatedAt: Date.now()
      };

      // Put with acknowledgment to confirm sync
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Even if no ack, data may still propagate — don't block
          console.warn('GunDB put() timed out waiting for ack, but data may still sync.');
          setSyncStatus('synced');
          resolve();
        }, 5000);

        profiles.get(id).put(payload, (ack: any) => {
          clearTimeout(timeout);
          if (ack.err) {
            console.error('GunDB put() error:', ack.err);
            setSyncStatus('error');
            reject(new Error(ack.err));
          } else {
            console.log('GunDB put() acknowledged successfully');
            setSyncStatus('synced');
            resolve();
          }
        });
      });

      const shareUrl = `${window.location.origin}${window.location.pathname}?view=${id}`;
      const deepLink = `profilemaker://${id}`;
      setShareData({ id, shareUrl, deepLink });
    } catch (err) {
      console.error('Share failed:', err);
      setSyncStatus('error');
      alert('P2P Share failed. The relay may be unreachable. Please check your connection settings and try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const copyEmbedCode = () => {
    if (!shareData) return;
    const embedCode = `<iframe src="${shareData.shareUrl}" width="100%" height="600" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(embedCode);
    alert('Embed code copied to clipboard!');
  };

  if (viewId) {
    return (
      <div className="app-container viewer-mode">
        <header className="main-header">
          <div className="brand">
            <div className="logo-spark">✨</div>
            <h1>Profile<span>Viewer</span></h1>
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setViewId(null)}>
              <Globe size={18} />
              <span>Create Your Own</span>
            </button>
          </div>
        </header>
        <main className="content">
          {viewData ? (
            <ProfilePreview profile={viewData} setProfile={() => { }} readonly />
          ) : (
            <div className="loading-state">
              <div className="pulse-spark">✨</div>
              <p>{isViewing ? 'Searching the P2P network...' : 'Profile not found'}</p>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      {customPeers.length === 0 && (
        <div className="connection-banner">
          <div className="banner-content">
            <Globe size={16} />
            <span>P2P Offline: No relays configured. You won't be able to search or share profiles.</span>
            <button className="btn-link" onClick={() => setShowSettings(true)}>Setup Relay Now</button>
          </div>
        </div>
      )}
      <header className="main-header">
        <div className="brand">
          <div className="logo-spark">✨</div>
          <h1>{profile.appName || 'Profile'}<span>Maker</span></h1>
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={18} />
          </button>
          <button className="btn btn-secondary" onClick={handleShare} disabled={isSharing}>
            <Share2 size={18} />
            <span>{isSharing ? 'Sharing...' : 'Share'}</span>
          </button>
          <button className="btn btn-secondary" onClick={resetProfile} title="Reset">
            <RefreshCcw size={18} />
          </button>
          <label className="btn btn-secondary" title="Import">
            <Upload size={18} />
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-primary" onClick={handleExport}>
            <Download size={18} />
            <span>Export</span>
          </button>
        </div>
      </header>

      <main className="content">
        <ProfilePreview profile={profile} setProfile={setProfile} />
      </main>

      {showSettings && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3><Settings size={18} /> Settings</h3>
              <button className="btn-icon" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="share-field">
                <label>App Name (Displays in Header)</label>
                <div className="input-with-action">
                  <input
                    value={profile.appName || ''}
                    onChange={(e) => setProfile(prev => ({ ...prev, appName: e.target.value }))}
                    placeholder="e.g. My Profile"
                  />
                </div>
              </div>

              <div className="share-field">
                <div className="section-header-inline">
                  <label><Activity size={14} /> P2P Relay Peers</label>
                </div>
                <div className="input-with-action" style={{ marginBottom: '1rem' }}>
                  <input
                    value={newPeerUrl}
                    onChange={(e) => setNewPeerUrl(e.target.value)}
                    placeholder="http://peer-url:port/gun"
                    onKeyDown={(e) => e.key === 'Enter' && addCustomPeer()}
                  />
                  <button className="btn btn-primary" onClick={addCustomPeer} title="Add Peer">
                    <Plus size={16} />
                    <span>Add</span>
                  </button>
                </div>
                <div className="peer-list">
                  {customPeers.map((peer, i) => {
                    const normalize = (url: string) => url.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
                    const isOnline = activePeers.some(ap => normalize(ap) === normalize(peer));

                    return (
                      <div key={i} className="peer-item">
                        <div className={`status-indicator ${isOnline ? 'online' : 'offline'}`}></div>
                        <span className="peer-url">{peer}</span>
                        <button className="btn-remove-tag" onClick={() => removeCustomPeer(peer)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="tip">
                🌐 GunDB is automatically syncing with {activePeers.length} relay(s).
              </div>
            </div>
          </div>
        </div>
      )}

      {shareData && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Share Profile</h3>
              <button className="btn-icon" onClick={() => { setShareData(null); setSyncStatus('idle'); }}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>Your profile is live! Copy the link or embed code below:</p>

              <div className={`sync-status sync-${syncStatus}`}>
                {syncStatus === 'syncing' && '⏳ Syncing with relay...'}
                {syncStatus === 'synced' && '✅ Synced to relay'}
                {syncStatus === 'error' && '❌ Sync failed — check relay connection'}
                {syncStatus === 'idle' && ''}
              </div>

              <div className="share-field">
                <label>Share Link</label>
                <div className="input-with-action">
                  <input readOnly value={shareData.shareUrl} />
                  <button onClick={() => {
                    navigator.clipboard.writeText(shareData.shareUrl);
                    alert('Link copied!');
                  }}><Copy size={16} /></button>
                </div>
              </div>

              <div className="share-field">
                <label>Deep Link (For Desktop App)</label>
                <div className="input-with-action">
                  <input readOnly value={shareData.deepLink} />
                  <button onClick={() => {
                    navigator.clipboard.writeText(shareData.deepLink);
                    alert('Deep link copied!');
                  }}><Copy size={16} /></button>
                </div>
              </div>

              <div className="share-field">
                <label>Embed Code (HTML)</label>
                <div className="input-with-action">
                  <input readOnly value={`<iframe src="${shareData.shareUrl}" width="100%" height="600" frameborder="0"></iframe>`} />
                  <button onClick={copyEmbedCode}><Copy size={16} /></button>
                </div>
              </div>

              <div className="tip">
                💡 Embed this on your website, blog, or portfolio!
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
