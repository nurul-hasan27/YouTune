/**
 * YouTune - Storage Manager
 * Safely persists and retrieves extension preferences with fallbacks.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class StorageManager {
    constructor() {
      this._hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
      this._memoryFallback = new Map();
      this._listeners = new Set();

      if (this._hasChromeStorage) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            for (const [key, change] of Object.entries(changes)) {
              this._notify(key, change.newValue, change.oldValue);
            }
          }
        });
      }
    }

    async get(key, defaultValue = null) {
      if (this._hasChromeStorage) {
        try {
          const result = await chrome.storage.local.get([key]);
          return result[key] !== undefined ? result[key] : defaultValue;
        } catch (err) {
          console.warn('[YouTune Storage] Storage get error, using fallback:', err);
        }
      }
      return this._memoryFallback.has(key) ? this._memoryFallback.get(key) : defaultValue;
    }

    async set(key, value) {
      this._memoryFallback.set(key, value);
      if (this._hasChromeStorage) {
        try {
          await chrome.storage.local.set({ [key]: value });
          return;
        } catch (err) {
          console.warn('[YouTune Storage] Storage set error, using fallback:', err);
        }
      }
      this._notify(key, value, null);
    }

    onChange(callback) {
      this._listeners.add(callback);
      return () => this._listeners.delete(callback);
    }

    _notify(key, newValue, oldValue) {
      for (const listener of this._listeners) {
        try {
          listener(key, newValue, oldValue);
        } catch (e) {
          console.error('[YouTune Storage] Listener callback error:', e);
        }
      }
    }
  }

  window.YouTune.storage = new StorageManager();
})();
