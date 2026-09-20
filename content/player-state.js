/**
 * YouTune - Player State Manager
 * Central reactive state store synchronizing with YouTube player.
 * Supports granular key-level subscriptions for optimal rendering performance.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class PlayerState {
    constructor() {
      this._state = {
        enabled: false,
        videoId: null,
        title: '',
        channel: '',
        thumbnailUrl: null,
        currentTime: 0,
        duration: 0,
        playbackState: window.YouTune.PlaybackState ? window.YouTune.PlaybackState.IDLE : 'idle',
        volume: 1,
        muted: false,
        isFullscreen: false,
        isBuffering: false,
        hasVideo: false
      };

      this._listeners = new Set();
      this._keyListeners = new Map();
    }

    getState() {
      return { ...this._state };
    }

    get(key) {
      return this._state[key];
    }

    /**
     * Updates multiple properties in the state.
     * Emits events to listeners only for modified keys.
     */
    update(partial) {
      if (!partial || typeof partial !== 'object') return;

      const changedKeys = [];
      for (const [key, value] of Object.entries(partial)) {
        if (this._state[key] !== value) {
          this._state[key] = value;
          changedKeys.push(key);
        }
      }

      if (changedKeys.length === 0) return;

      // Notify key listeners
      for (const key of changedKeys) {
        if (this._keyListeners.has(key)) {
          const val = this._state[key];
          for (const cb of this._keyListeners.get(key)) {
            try {
              cb(val, this._state);
            } catch (e) {
              console.error(`[YouTune State] Error in key listener for "${key}":`, e);
            }
          }
        }
      }

      // Notify global listeners
      for (const listener of this._listeners) {
        try {
          listener(this._state, changedKeys);
        } catch (e) {
          console.error('[YouTune State] Error in global state listener:', e);
        }
      }
    }

    /**
     * Subscribe to any state change.
     */
    subscribe(callback) {
      this._listeners.add(callback);
      return () => this._listeners.delete(callback);
    }

    /**
     * Subscribe to a specific state property change.
     */
    subscribeKey(key, callback) {
      if (!this._keyListeners.has(key)) {
        this._keyListeners.set(key, new Set());
      }
      this._keyListeners.get(key).add(callback);
      return () => {
        if (this._keyListeners.has(key)) {
          this._keyListeners.get(key).delete(callback);
        }
      };
    }
  }

  window.YouTune.PlayerState = PlayerState;
  window.YouTune.playerState = new PlayerState();
})();
