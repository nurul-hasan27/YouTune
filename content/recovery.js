/**
 * YouTune - Recovery Manager
 * Detects player detachment, recreation, delayed loading, and DOM shifts.
 * Reconnects smoothly without interrupting playback.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class RecoveryManager {
    constructor(adapter, state, metadata) {
      this.adapter = adapter || window.YouTune.adapter;
      this.state = state || window.YouTune.playerState;
      this.metadata = metadata || window.YouTune.metadata;

      this._observer = null;
      this._checkInterval = null;
      this._debounceTimer = null;
      this._recoveryListeners = new Set();
      this._isObserving = false;
      this._retryAttempts = 0;
      this._maxRetries = 10;
    }

    start() {
      if (this._isObserving) return;
      this._isObserving = true;

      // Targeted MutationObserver: watch player container or body
      const target = document.getElementById('player') ||
                     document.querySelector('ytd-watch-flexy') ||
                     document.body;

      if (target) {
        this._observer = new MutationObserver((mutations) => {
          let hasRelevantChange = false;
          for (const m of mutations) {
            if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
              for (const node of m.removedNodes) {
                if (node.nodeName === 'VIDEO' || (node.contains && node.contains(this.adapter.getVideoElement()))) {
                  hasRelevantChange = true;
                  break;
                }
              }
              if (hasRelevantChange) break;
              for (const node of m.addedNodes) {
                if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                  hasRelevantChange = true;
                  break;
                }
              }
              if (hasRelevantChange) break;
            }
          }

          if (hasRelevantChange) {
            this._scheduleCheck();
          }
        });

        this._observer.observe(target, { childList: true, subtree: true });
      }

      // Low-frequency heartbeat to ensure player reference is valid
      this._checkInterval = setInterval(() => {
        this._verifyPlayerHealth();
      }, 2000);
    }

    stop() {
      if (!this._isObserving) return;
      this._isObserving = false;

      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      if (this._checkInterval) {
        clearInterval(this._checkInterval);
        this._checkInterval = null;
      }
      clearTimeout(this._debounceTimer);
    }

    onRecovered(callback) {
      this._recoveryListeners.add(callback);
      return () => this._recoveryListeners.delete(callback);
    }

    _scheduleCheck() {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._verifyPlayerHealth();
      }, 150);
    }

    _verifyPlayerHealth() {
      const currentVideo = this.adapter.getVideoElement();
      const isDead = !currentVideo || !document.contains(currentVideo);

      if (isDead) {
        console.log('[YouTune Recovery] Video element detached or missing. Attempting recovery...');
        this._attemptRecovery();
      }
    }

    _attemptRecovery() {
      // Force adapter to scan for candidate video element
      const video = this.adapter.getVideoElement();
      if (video && document.contains(video)) {
        console.log('[YouTune Recovery] Successfully recovered new active video element.');
        this._retryAttempts = 0;
        this.metadata.resolveCurrent();
        for (const cb of this._recoveryListeners) {
          try {
            cb(video);
          } catch (e) {
            console.error('[YouTune Recovery] Error in recovery listener:', e);
          }
        }
      } else {
        if (this._retryAttempts < this._maxRetries) {
          this._retryAttempts++;
          setTimeout(() => this._attemptRecovery(), 300 * Math.min(this._retryAttempts, 5));
        }
      }
    }
  }

  window.YouTune.RecoveryManager = RecoveryManager;
  window.YouTune.recovery = new RecoveryManager();
})();
