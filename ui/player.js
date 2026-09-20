/**
 * YouTune - Main Player UI Component
 * Assembles the clean fullscreen music player, bottom-left track info, and swipe transitions.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  class PlayerView {
    constructor({ adapter, state, fullscreen }) {
      this.adapter = adapter || window.YouTune.adapter;
      this.state = state || window.YouTune.playerState;
      this.fullscreen = fullscreen;

      this.rootElement = null;
      this.backgroundView = new window.YouTune.UI.BackgroundView();
      this.artworkView = new window.YouTune.UI.ArtworkView();
      this.progressView = new window.YouTune.UI.ProgressView(this.adapter);
      this.controlsView = new window.YouTune.UI.ControlsView(this.adapter);

      this._titleEl = null;
      this._channelEl = null;
      this._volumeToastEl = null;
      this._volumeToastTimer = null;
      this._unsubscribeState = null;
      this._isMounted = false;
      this._lastSwipeDirection = null;
    }

    mount() {
      if (this._isMounted && document.getElementById('youtune-root')) {
        return this.rootElement;
      }

      let root = document.getElementById('youtune-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'youtune-root';
        root.className = 'youtune-hidden';
        root.setAttribute('tabindex', '-1');
        document.body.appendChild(root);
      } else {
        root.setAttribute('tabindex', '-1');
      }
      this.rootElement = root;
      this.rootElement.innerHTML = '';

      // 1. Dynamic background layers
      const bgElement = this.backgroundView.render();
      this.rootElement.appendChild(bgElement);

      // 2. Volume Toast (HUD)
      this._volumeToastEl = document.createElement('div');
      this._volumeToastEl.className = 'youtune-volume-toast';
      this.rootElement.appendChild(this._volumeToastEl);

      // 3. Viewport Content
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'youtune-viewport-content';

      // Center Stage (Enlarged Artwork, Spaced Slider, Controls)
      const stage = document.createElement('main');
      stage.className = 'youtune-stage';

      // Artwork (Enlarged and uncropped)
      const artworkElement = this.artworkView.render();
      stage.appendChild(artworkElement);

      // Progress bar & times (Never hidden)
      const progressElement = this.progressView.render();
      stage.appendChild(progressElement);

      // Playback Controls (Previous, Play/Pause, Next - Never hidden) with swipe callbacks
      this.controlsView.setCallbacks({
        onNext: () => this.triggerSwipe('left'),
        onPrevious: () => this.triggerSwipe('right')
      });
      const controlsElement = this.controlsView.render();
      stage.appendChild(controlsElement);

      contentWrapper.appendChild(stage);

      // 4. Track Information in the Bottom-Left
      const bottomInfo = document.createElement('div');
      bottomInfo.className = 'youtune-track-info';

      this._titleEl = document.createElement('h1');
      this._titleEl.className = 'youtune-track-title';
      this._titleEl.textContent = 'Loading track...';

      this._channelEl = document.createElement('div');
      this._channelEl.className = 'youtune-track-channel';
      this._channelEl.textContent = '';

      bottomInfo.appendChild(this._titleEl);
      bottomInfo.appendChild(this._channelEl);
      contentWrapper.appendChild(bottomInfo);

      this.rootElement.appendChild(contentWrapper);

      // Attach state listeners
      this._bindState();
      this._isMounted = true;

      return this.rootElement;
    }

    triggerSwipe(direction) {
      this._lastSwipeDirection = direction;
      this.artworkView.animateSwipeOut(direction);
    }

    _bindState() {
      if (this._unsubscribeState) {
        this._unsubscribeState();
      }

      this._unsubscribeState = this.state.subscribe((state, changedKeys) => {
        if (changedKeys.includes('title') && this._titleEl) {
          this._titleEl.textContent = state.title || 'Unknown Title';
          this._titleEl.title = state.title || '';
        }

        if (changedKeys.includes('channel') && this._channelEl) {
          const ch = state.channel || '';
          this._channelEl.textContent = ch;
          this._channelEl.style.display = ch ? 'block' : 'none';
        }

        if (changedKeys.includes('thumbnailUrl')) {
          const dir = this._lastSwipeDirection;
          this._lastSwipeDirection = null;
          this.artworkView.update(state.thumbnailUrl, dir);
          this.backgroundView.update(state.thumbnailUrl);
        }

        if (changedKeys.includes('currentTime') || changedKeys.includes('duration')) {
          this.progressView.update(state.currentTime, state.duration);
        }

        if (changedKeys.includes('playbackState')) {
          this.controlsView.updatePlaybackState(state.playbackState);
        }

        if (changedKeys.includes('enabled')) {
          this.setVisible(state.enabled);
        }
      });

      // Sync initial snapshot
      const current = this.state.getState();
      if (this._titleEl) this._titleEl.textContent = current.title || 'Loading track...';
      if (this._channelEl) {
        const ch = current.channel || '';
        this._channelEl.textContent = ch;
        this._channelEl.style.display = ch ? 'block' : 'none';
      }
      if (current.thumbnailUrl) {
        this.artworkView.update(current.thumbnailUrl);
        this.backgroundView.update(current.thumbnailUrl);
      }
      this.progressView.update(current.currentTime, current.duration);
      this.controlsView.updatePlaybackState(current.playbackState);
      this.setVisible(current.enabled);
    }

    showVolumeToast(percent) {
      if (!this._volumeToastEl) return;

      this._volumeToastEl.textContent = typeof percent === 'number' ? `Volume ${percent}%` : percent;
      this._volumeToastEl.classList.add('youtune-toast-visible');

      clearTimeout(this._volumeToastTimer);
      this._volumeToastTimer = setTimeout(() => {
        if (this._volumeToastEl) {
          this._volumeToastEl.classList.remove('youtune-toast-visible');
        }
      }, 1000);
    }

    setVisible(visible) {
      if (!this.rootElement) return;

      if (visible) {
        this.rootElement.classList.remove('youtune-hidden');
        this.rootElement.classList.add('youtune-visible');
        document.documentElement.classList.add('youtune-active-mode');
        try {
          this.rootElement.focus();
        } catch (_) {}
      } else {
        this.rootElement.classList.remove('youtune-visible');
        this.rootElement.classList.add('youtune-hidden');
        document.documentElement.classList.remove('youtune-active-mode');
      }
    }

    unmount() {
      if (this._unsubscribeState) {
        this._unsubscribeState();
        this._unsubscribeState = null;
      }
      if (this.rootElement && this.rootElement.parentNode) {
        this.rootElement.parentNode.removeChild(this.rootElement);
      }
      document.documentElement.classList.remove('youtune-active-mode');
      this._isMounted = false;
      this.rootElement = null;
    }
  }

  window.YouTune.UI.PlayerView = PlayerView;
})();
