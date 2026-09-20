/**
 * YouTune - Fullscreen Manager
 * Manages native Browser Fullscreen API and synchronizes with YouTune Immersive Mode.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  class FullscreenManager {
    constructor(state) {
      this.state = state || window.YouTune.playerState;
      this._boundChangeHandler = this._onFullscreenChange.bind(this);
      this._isListening = false;
    }

    start() {
      if (this._isListening) return;
      this._isListening = true;

      document.addEventListener('fullscreenchange', this._boundChangeHandler);
      document.addEventListener('webkitfullscreenchange', this._boundChangeHandler);
    }

    stop() {
      if (!this._isListening) return;
      this._isListening = false;

      document.removeEventListener('fullscreenchange', this._boundChangeHandler);
      document.removeEventListener('webkitfullscreenchange', this._boundChangeHandler);
    }

    isBrowserFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    /**
     * Toggles browser fullscreen mode.
     * Must be called from a user gesture (button click or key event).
     */
    async toggle(targetElement) {
      if (this.isBrowserFullscreen()) {
        await this.exit();
      } else {
        await this.enter(targetElement);
      }
    }

    async enter(targetElement) {
      try {
        const el = targetElement || document.getElementById('youtune-root') || document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      } catch (err) {
        console.warn('[YouTune Fullscreen] Request fullscreen rejected:', err.message);
      }
    }

    async exit() {
      try {
        if (this.isBrowserFullscreen()) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            await document.webkitExitFullscreen();
          }
        }
      } catch (err) {
        console.warn('[YouTune Fullscreen] Exit fullscreen error:', err.message);
      }
    }

    _onFullscreenChange() {
      const isFs = this.isBrowserFullscreen();
      this.state.update({ isFullscreen: isFs });
    }
  }

  window.YouTune.UI.FullscreenManager = FullscreenManager;
})();
