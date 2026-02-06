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

// Initialize Gun with public relay peers for bootstrap
const RELAY_PEERS = ['https://gun-manhattan.herokuapp.com/gun'];
const gun = Gun(RELAY_PEERS);
const profiles = gun.get('profile-maker-p2p-v1');


function App() {
  const [profile, setProfile] = useState<ProfileData>(() => {
    const saved = localStorage.getItem('profile_maker_data');
    return saved ? JSON.parse(saved) : defaultProfile;
  });
  const [shareData, setShareData] = useState<{ id: string, shareUrl: string, deepLink: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState('');
  const [customPeers, setCustomPeers] = useState<string[]>(() => {
    const saved = localStorage.getItem('p2p_peers');
    return saved ? JSON.parse(saved) : RELAY_PEERS;
  });
  const [activePeers, setActivePeers] = useState<string[]>(customPeers);

  const customPeersRef = useRef<string[]>(customPeers);

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
        if (data && (data.name || data.bio)) {
          console.log("Profile data found!");
          found = true;
          clearTimeout(timeout);
          setViewData(data as ProfileData);
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
    // 1. Listen for new dedicated nodes in the discovery bucket
    console.log("Starting P2P discovery listener...");
    const discoveryBucket = gun.get('profile-maker-discovery').get('relays');

    discoveryBucket.map().on((node: any, urlKey: string) => {
      // Gun sometimes returns the key as the second argument
      const url = (node && typeof node === 'object' && node.url) ? node.url : urlKey;
      const lastSeen = (node && typeof node === 'object' && node.lastSeen) ? node.lastSeen : (typeof node === 'number' ? node : 0);

      const currentPeers = customPeersRef.current;

      if (url && url.startsWith('http') && !currentPeers.includes(url)) {
        // Validation: Seen in the last 30 minutes (giving more buffer)
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);

        if (lastSeen > thirtyMinutesAgo) {
          console.log(`Found candidate relay: ${url}`);
          const newPeers = [...currentPeers, url];
          setCustomPeers(newPeers);
          localStorage.setItem('p2p_peers', JSON.stringify(newPeers));

          // Add the NEW list of all peers to gun
          gun.opt({ peers: newPeers });
        }
      }
    });

    // 2. Basic peer discovery check (Gun internally manages this, but we can poll for connectivity)
    const interval = setInterval(() => {
      // @ts-ignore
      const peers = gun.back('opt.peers');
      if (peers) {
        // Just show the URLs we have in our peer graph
        setActivePeers(Object.keys(peers));
      }
    }, 3000);
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
    if (customPeers.length <= 1) return alert('You need at least one peer.');
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
    try {
      // Create a unique P2P ID for this profile
      const id = 'p2p-' + Math.random().toString(36).substr(2, 9);

      // Put the profile data into Gun decentralized mesh
      profiles.get(id).put(profile);

      const shareUrl = `${window.location.origin}${window.location.pathname}?view=${id}`;
      const deepLink = `profilemaker://${id}`;
      setShareData({ id, shareUrl, deepLink });
    } catch (err) {
      alert('P2P Share failed. Please try again.');
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
                  {customPeers.map((peer, i) => (
                    <div key={i} className="peer-item">
                      <div className={`status-indicator ${activePeers.includes(peer) ? 'online' : 'offline'}`}></div>
                      <span className="peer-url">{peer}</span>
                      {customPeers.length > 1 && (
                        <button className="btn-remove-tag" onClick={() => removeCustomPeer(peer)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
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
              <button className="btn-icon" onClick={() => setShareData(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>Your profile is live! Copy the link or embed code below:</p>

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
