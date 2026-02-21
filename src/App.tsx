import { useState, useEffect, useRef } from 'react';
import './App.css';
import type { ProfileData } from './types.ts';
import { defaultProfile } from './types.ts';
import { ensureProfileId } from './profileId.ts';

import ProfilePreview from './components/ProfilePreview.tsx';
import { Download, Upload, RefreshCcw, Share2, Copy, X, Globe, Settings, Activity, Plus, Trash2, KeyRound } from 'lucide-react';
import { shareProfile, viewProfile, checkRelayHealth, normalizeRelayUrl } from './sync.ts';

declare global {
  interface Window {
    electronAPI?: {
      onOpenProfile: (callback: (id: string) => void) => void;
    };
  }
}

function App() {
  const [profile, setProfile] = useState<ProfileData>(() => {
    const saved = localStorage.getItem('profile_maker_data');
    const loaded = saved ? JSON.parse(saved) : defaultProfile;
    return ensureProfileId(loaded);
  });
  const [shareData, setShareData] = useState<{ shareUrl: string, deepLink: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [showSettings, setShowSettings] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState('');
  const [customPeers, setCustomPeers] = useState<string[]>(() => {
    const saved = localStorage.getItem('p2p_peers');
    return saved ? JSON.parse(saved) : [];
  });
  const [activePeers, setActivePeers] = useState<string[]>([]);

  const customPeersRef = useRef<string[]>(customPeers);
  const shareCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    customPeersRef.current = customPeers;
  }, [customPeers]);

  const [viewId, setViewId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view');
  });
  const [viewData, setViewData] = useState<ProfileData | null>(null);
  const [isViewing, setIsViewing] = useState(false);

  // Persist profile to localStorage
  useEffect(() => {
    localStorage.setItem('profile_maker_data', JSON.stringify(profile));
  }, [profile]);

  // View a shared profile via Y.js
  useEffect(() => {
    if (viewId) {
      setIsViewing(true);
      setViewData(null);

      console.log(`Loading shared profile: ${viewId}`);

      // Need at least one relay to fetch from
      const relayUrl = customPeersRef.current[0];
      if (!relayUrl) {
        alert('No relay configured. Please add a relay URL in Settings to view shared profiles.');
        setIsViewing(false);
        setViewId(null);
        return;
      }

      const { cleanup } = viewProfile(
        viewId,
        relayUrl,
        (profileData) => {
          console.log('Profile data received!');
          setViewData(profileData);
          setIsViewing(false);
        },
        () => {
          alert('Profile not found. The relay might be unreachable or the profile has expired.');
          setIsViewing(false);
          setViewId(null);
        }
      );

      return cleanup;
    }
  }, [viewId]);

  // Peer health check
  useEffect(() => {
    const checkHealth = async () => {
      const currentPeers = customPeersRef.current;
      if (currentPeers.length === 0) {
        setActivePeers([]);
        return;
      }

      const results = await Promise.all(
        currentPeers.map(async (peerUrl) => {
          const isAlive = await checkRelayHealth(peerUrl);
          return isAlive ? peerUrl : null;
        })
      );

      setActivePeers(results.filter((url): url is string => url !== null));
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  // Handle deep links from Electron
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOpenProfile((id: string) => {
        console.log('Deep link received:', id);
        setViewId(id);
      });
    }
  }, []);

  const addCustomPeer = () => {
    const url = normalizeRelayUrl(newPeerUrl);
    if (url && (url.startsWith('http') || url.startsWith('ws')) && !customPeers.includes(url)) {
      const newPeers = [...customPeers, url];
      setCustomPeers(newPeers);
      localStorage.setItem('p2p_peers', JSON.stringify(newPeers));
      setNewPeerUrl('');
    } else if (url) {
      alert('Please enter a valid HTTP(S) or WS(S) URL.');
    }
  };

  const removeCustomPeer = (url: string) => {
    const newPeers = customPeers.filter(p => p !== url);
    setCustomPeers(newPeers);
    localStorage.setItem('p2p_peers', JSON.stringify(newPeers));
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
        // Preserve existing profile ID — imported data gets our identity
        setProfile(prev => ({ ...data, id: prev.id }));
      } catch (err) {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const resetProfile = () => {
    if (confirm('Are you sure you want to reset your profile?')) {
      // Keep the existing ID so the network address stays stable
      setProfile(prev => ({ ...defaultProfile, id: prev.id }));
    }
  };

  const handleShare = async () => {
    if (customPeers.length === 0) {
      alert('No relay configured. Please add a relay URL in Settings first.');
      return;
    }

    setIsSharing(true);
    setSyncStatus('syncing');

    // Clean up any previous share connection
    if (shareCleanupRef.current) {
      shareCleanupRef.current();
      shareCleanupRef.current = null;
    }

    try {
      const relayUrl = customPeers[0]; // Use first configured relay
      const { cleanup } = await shareProfile(profile, relayUrl);
      shareCleanupRef.current = cleanup;

      setSyncStatus('synced');

      const roomId = `profile-${profile.id}`;
      const shareUrl = `${window.location.origin}${window.location.pathname}?view=${roomId}`;
      const deepLink = `profilemaker://${roomId}`;
      setShareData({ shareUrl, deepLink });
    } catch (err) {
      console.error('Share failed:', err);
      setSyncStatus('error');
      alert('Share failed. The relay may be unreachable. Please check your relay settings and try again.');
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
              <p>{isViewing ? 'Connecting to relay...' : 'Profile not found'}</p>
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
            <span>Offline: No relays configured. You won't be able to share or view profiles.</span>
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
                  <label><Activity size={14} /> Relay Servers</label>
                </div>
                <div className="input-with-action" style={{ marginBottom: '1rem' }}>
                  <input
                    value={newPeerUrl}
                    onChange={(e) => setNewPeerUrl(e.target.value)}
                    placeholder="https://your-relay.example.com"
                    onKeyDown={(e) => e.key === 'Enter' && addCustomPeer()}
                  />
                  <button className="btn btn-primary" onClick={addCustomPeer} title="Add Relay">
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
                🌐 Connected to {activePeers.length} of {customPeers.length} relay(s).
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
                <label><KeyRound size={14} /> Profile Identity</label>
                <div className="input-with-action">
                  <input readOnly value={profile.id} />
                  <button onClick={() => {
                    navigator.clipboard.writeText(profile.id);
                    alert('Profile ID copied!');
                  }}><Copy size={16} /></button>
                </div>
                <div className="tip" style={{ marginTop: '0.5rem' }}>
                  🆔 Your unique network address. Viewers use this to find your profile.
                </div>
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
