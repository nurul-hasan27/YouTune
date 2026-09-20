/**
 * YouTune - Navigation Manager
 * Reliably detects YouTube SPA page transitions, history events, and video changes.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class NavigationManager {
    constructor(adapter) {
      this.adapter = adapter || window.YouTune.adapter;
      this._lastVideoId = null;
      this._lastUrl = window.location.href;
      this._listeners = new Set();
      this._pollInterval = null;
      this._debounceTimer = null;
      this._isObserving = false;

      this._handleNavigationEvent = this._handleNavigationEvent.bind(this);
    }

    start() {
      if (this._isObserving) return;
      this._isObserving = true;

      this._lastVideoId = this.adapter.getCurrentVideoId();
      this._lastUrl = window.location.href;

      // Native YouTube SPA custom lifecycle events
      window.addEventListener('yt-navigate-start', this._handleNavigationEvent, true);
      window.addEventListener('yt-navigate-finish', this._handleNavigationEvent, true);
      window.addEventListener('yt-page-data-updated', this._handleNavigationEvent, true);

      // Browser history events (back / forward)
      window.addEventListener('popstate', this._handleNavigationEvent, true);

      // Fallback polling for SPA edge cases
      this._pollInterval = setInterval(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== this._lastUrl) {
          this._handleNavigationEvent();
        }
      }, 600);
    }

    stop() {
      if (!this._isObserving) return;
      this._isObserving = false;

      window.removeEventListener('yt-navigate-start', this._handleNavigationEvent, true);
      window.removeEventListener('yt-navigate-finish', this._handleNavigationEvent, true);
      window.removeEventListener('yt-page-data-updated', this._handleNavigationEvent, true);
      window.removeEventListener('popstate', this._handleNavigationEvent, true);

      if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
      }
      clearTimeout(this._debounceTimer);
    }

    onVideoChange(callback) {
      this._listeners.add(callback);
      return () => this._listeners.delete(callback);
    }

    _handleNavigationEvent() {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._checkChange();
      }, 150);
    }

    _checkChange() {
      const currentUrl = window.location.href;
      const currentVideoId = this.adapter.getCurrentVideoId();
      const isWatchPage = window.location.pathname === '/watch' || !!currentVideoId;

      if (currentVideoId !== this._lastVideoId || currentUrl !== this._lastUrl) {
        const previousVideoId = this._lastVideoId;
        this._lastVideoId = currentVideoId;
        this._lastUrl = currentUrl;

        console.log(`[YouTune Navigation] Video change detected: ${previousVideoId} -> ${currentVideoId} (watchPage: ${isWatchPage})`);

        for (const cb of this._listeners) {
          try {
            cb({
              previousVideoId,
              currentVideoId,
              isWatchPage,
              url: currentUrl
            });
          } catch (e) {
            console.error('[YouTune Navigation] Error in navigation listener:', e);
          }
        }
      }
    }
  }

  window.YouTune.NavigationManager = NavigationManager;
  window.YouTune.navigation = new NavigationManager();
})();
