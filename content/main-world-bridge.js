/**
 * YouTune - Main World Bridge
 * Runs directly in the page's execution context (world: "MAIN") on YouTube.
 * Interfaces with YouTube's native player (`#movie_player`), syncs persistent volume
 * preferences, and prevents YouTube's internal normalization/scripts from automatically
 * sliding down or resetting the audio volume away from the user's saved state.
 */
(() => {
  if (window.__youtune_main_bridge_initialized) return;
  window.__youtune_main_bridge_initialized = true;

  let lockedVolume = null; // null = no active lock, 0-100 = locked percentage
  let lockedMuted = false;
  let isInternalCall = false;

  let mediaVolumeDescriptor = null;
  let mediaMutedDescriptor = null;
  try {
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype) {
      mediaVolumeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
      mediaMutedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
    }
  } catch (_) {}

  function getMoviePlayer() {
    const mp = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (mp && !mp.__youtune_hooked) {
      hookMoviePlayer(mp);
    }
    return mp;
  }

  function syncLocalStorage(volumePercent, muted) {
    try {
      const dataStr = JSON.stringify({
        volume: Math.round(volumePercent),
        muted: !!muted
      });
      localStorage.setItem('yt-player-volume', JSON.stringify({
        data: dataStr,
        creation: Date.now()
      }));
    } catch (_) {}
  }

  function applyVolumeToNative(volumePercent, muted) {
    if (typeof volumePercent !== 'number' || isNaN(volumePercent)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));

    syncLocalStorage(clamped, muted);

    isInternalCall = true;
    try {
      const mp = getMoviePlayer();
      if (mp) {
        if (typeof mp.setVolume === 'function') {
          mp.setVolume(clamped);
        }
        if (muted && typeof mp.mute === 'function') {
          mp.mute();
        } else if (!muted && typeof mp.unMute === 'function') {
          mp.unMute();
        }
      }

      const video = document.querySelector('video') || (mp && mp.querySelector ? mp.querySelector('video') : null);
      if (video) {
        const targetFrac = clamped / 100;
        if (mediaVolumeDescriptor && mediaVolumeDescriptor.set) {
          mediaVolumeDescriptor.set.call(video, targetFrac);
        } else {
          video.volume = targetFrac;
        }
        if (typeof muted === 'boolean') {
          if (mediaMutedDescriptor && mediaMutedDescriptor.set) {
            mediaMutedDescriptor.set.call(video, muted);
          } else {
            video.muted = muted;
          }
        }
      }
    } catch (err) {
      console.warn('[YouTune Bridge] Error setting native player volume:', err);
    } finally {
      isInternalCall = false;
    }
  }

  function hookMoviePlayer(mp) {
    if (!mp || mp.__youtune_hooked) return;
    mp.__youtune_hooked = true;

    // Intercept native setVolume: prevent automated slide-down / normalization drops
    const originalSetVolume = mp.setVolume;
    if (typeof originalSetVolume === 'function') {
      mp.setVolume = function(vol, ...args) {
        if (lockedVolume !== null && !isInternalCall) {
          if (typeof vol === 'number' && Math.abs(vol - lockedVolume) > 1) {
            // Block external attempts to drop/alter the locked volume
            return originalSetVolume.call(this, lockedVolume, ...args);
          }
        }
        return originalSetVolume.call(this, vol, ...args);
      };
    }

    // Intercept native mute/unMute
    const originalMute = mp.mute;
    if (typeof originalMute === 'function') {
      mp.mute = function(...args) {
        if (lockedVolume !== null && !isInternalCall && !lockedMuted) {
          return;
        }
        return originalMute.call(this, ...args);
      };
    }

    const originalUnMute = mp.unMute;
    if (typeof originalUnMute === 'function') {
      mp.unMute = function(...args) {
        if (lockedVolume !== null && !isInternalCall && lockedMuted) {
          return;
        }
        return originalUnMute.call(this, ...args);
      };
    }
    // Intercept native getVolume and isMuted to report locked state consistently
    const originalGetVolume = mp.getVolume;
    if (typeof originalGetVolume === 'function') {
      mp.getVolume = function(...args) {
        if (lockedVolume !== null && !isInternalCall) {
          return lockedVolume;
        }
        return originalGetVolume.call(this, ...args);
      };
    }

    const originalIsMuted = mp.isMuted;
    if (typeof originalIsMuted === 'function') {
      mp.isMuted = function(...args) {
        if (lockedVolume !== null && !isInternalCall) {
          return lockedMuted;
        }
        return originalIsMuted.call(this, ...args);
      };
    }
  }

  // Hook HTMLMediaElement prototype to protect direct <video>.volume assignments
  try {
    if (mediaVolumeDescriptor && mediaVolumeDescriptor.set) {
      const originalVolumeSet = mediaVolumeDescriptor.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
        configurable: true,
        enumerable: true,
        get: mediaVolumeDescriptor.get,
        set: function(val) {
          if (lockedVolume !== null && !isInternalCall) {
            const target = lockedVolume / 100;
            if (typeof val === 'number' && Math.abs(val - target) > 0.01) {
              return originalVolumeSet.call(this, target);
            }
          }
          return originalVolumeSet.call(this, val);
        }
      });
    }

    if (mediaMutedDescriptor && mediaMutedDescriptor.set) {
      const originalMutedSet = mediaMutedDescriptor.set;
      Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        configurable: true,
        enumerable: true,
        get: mediaMutedDescriptor.get,
        set: function(val) {
          if (lockedVolume !== null && !isInternalCall) {
            if (val !== lockedMuted) {
              return originalMutedSet.call(this, lockedMuted);
            }
          }
          return originalMutedSet.call(this, val);
        }
      });
    }
  } catch (err) {
    console.warn('[YouTune Bridge] Could not hook HTMLMediaElement prototype:', err);
  }

  // Observe DOM for movie_player initialization or SPA recreation
  const observer = new MutationObserver(() => {
    const mp = getMoviePlayer();
    if (mp && !mp.__youtune_hooked) {
      hookMoviePlayer(mp);
      if (lockedVolume !== null) {
        applyVolumeToNative(lockedVolume, lockedMuted);
      }
    }
  });

  const rootTarget = document.documentElement || document.body;
  if (rootTarget) {
    observer.observe(rootTarget, { childList: true, subtree: true });
  }

  const initialMp = getMoviePlayer();
  if (initialMp) {
    hookMoviePlayer(initialMp);
  }

  // Listen for commands dispatched from YouTune content script
  window.addEventListener('youtune:bridge-command', (event) => {
    if (!event || !event.detail) return;
    const { action, volume, muted, locked } = event.detail;

    switch (action) {
      case 'SET_VOLUME': {
        if (typeof volume === 'number') {
          if (locked) {
            lockedVolume = Math.round(volume);
            lockedMuted = !!muted;
          } else {
            lockedVolume = null;
          }
          applyVolumeToNative(volume, muted);
        }
        break;
      }
      case 'LOCK_VOLUME': {
        if (typeof volume === 'number') {
          lockedVolume = Math.round(volume);
          lockedMuted = !!muted;
          applyVolumeToNative(volume, muted);
        }
        break;
      }
      case 'UNLOCK_VOLUME': {
        lockedVolume = null;
        break;
      }
      default:
        break;
    }
  });
})();
