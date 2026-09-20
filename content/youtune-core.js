/**
 * YouTune - Core Engine
 * Orchestrates YouTube adapter, reactive state, UI views, navigation, jitter-free transitions, and keyboard shortcuts.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class YouTuneCore {
    constructor() {
      this.adapter = window.YouTune.adapter;
      this.state = window.YouTune.playerState;
      this.metadata = window.YouTune.metadata;
      this.navigation = window.YouTune.navigation;
      this.recovery = window.YouTune.recovery;
      this.storage = window.YouTune.storage;

      this.fullscreen = new window.YouTune.UI.FullscreenManager(this.state);
      this.playerView = new window.YouTune.UI.PlayerView({
        adapter: this.adapter,
        state: this.state,
        fullscreen: this.fullscreen
      });

      this._tickTimer = null;
      this._boundKeyHandler = this._onKeyDown.bind(this);
      this._isInitialized = false;

      // Jitter-free transition queue
      this._pendingTransitionId = null;
      this._pendingTransitionTimer = null;
    }

    async initialize() {
      if (this._isInitialized) return;
      this._isInitialized = true;

      console.log('[YouTune] Initializing core engine...');

      // 1. Mount UI view (hidden initially)
      this.playerView.mount();

      // 2. Start Fullscreen, Navigation & Recovery observers
      this.fullscreen.start();
      this.navigation.start();
      this.recovery.start();

      // 3. Bind adapter events
      this._bindAdapterEvents();

      // 4. Bind navigation & recovery events
      this.navigation.onVideoChange((info) => this._onVideoChange(info));
      this.recovery.onRecovered((video) => this._onPlayerRecovered(video));

      // 5. Global keyboard shortcuts inside active mode (window + document capture)
      window.addEventListener('keydown', this._boundKeyHandler, true);
      document.addEventListener('keydown', this._boundKeyHandler, true);

      // 6. Initial check: probe for current video and player
      this.adapter.getVideoElement();
      await this.metadata.resolveCurrent();

      // 7. Check saved preference
      const shouldAutoEnable = await this.storage.get('youtune_enabled', false);
      const isWatchPage = window.location.pathname === '/watch' || !!this.adapter.getCurrentVideoId();

      if (shouldAutoEnable && isWatchPage) {
        console.log('[YouTune] Restoring active mode from user preference');
        this.enable();
      }
    }

    _bindAdapterEvents() {
      const syncPlayback = () => {
        this.state.update({
          playbackState: this.adapter.getPlaybackState(),
          currentTime: this.adapter.getCurrentTime(),
          duration: this.adapter.getDuration(),
          volume: this.adapter.getVolume(),
          muted: this.adapter.isMuted()
        });
      };

      const handlePlayingOrPlay = () => {
        this.state.update({ playbackState: 'playing' });
        this._startTick();

        // If a video transition is pending, commit new metadata now that the new song is playing
        if (this._pendingTransitionId) {
          this._commitPendingTransition();
        } else {
          // Verify metadata is fresh
          this.metadata.resolveCurrent();
        }
      };

      this.adapter.on('play', handlePlayingOrPlay);
      this.adapter.on('playing', handlePlayingOrPlay);

      this.adapter.on('pause', () => {
        this.state.update({ playbackState: 'paused' });
        this._stopTick();
        syncPlayback();
      });

      this.adapter.on('timeupdate', () => {
        this.state.update({
          currentTime: this.adapter.getCurrentTime(),
          duration: this.adapter.getDuration()
        });
      });

      this.adapter.on('durationchange', () => {
        this.state.update({ duration: this.adapter.getDuration() });
      });

      this.adapter.on('volumechange', () => {
        this.state.update({
          volume: this.adapter.getVolume(),
          muted: this.adapter.isMuted()
        });
      });

      this.adapter.on('waiting', () => {
        this.state.update({ playbackState: 'buffering' });
      });

      this.adapter.on('ended', () => {
        this.state.update({ playbackState: 'ended' });
        this._stopTick();
      });

      this.adapter.on('seeked', () => {
        syncPlayback();
      });
    }

    _startTick() {
      this._stopTick();
      this._tickTimer = setInterval(() => {
        if (this.state.get('enabled') && this.adapter.isPlaying()) {
          this.state.update({
            currentTime: this.adapter.getCurrentTime(),
            duration: this.adapter.getDuration()
          });
        }
      }, 250);
    }

    _stopTick() {
      if (this._tickTimer) {
        clearInterval(this._tickTimer);
        this._tickTimer = null;
      }
    }

    /**
     * Jitter-free SPA navigation handler:
     * When next video is requested, keep the existing cover until the new video starts playing.
     */
    async _onVideoChange({ currentVideoId, isWatchPage }) {
      console.log(`[YouTune] Video transition detected: ${currentVideoId} (watch: ${isWatchPage})`);

      if (!isWatchPage) {
        if (this.state.get('enabled')) {
          this.playerView.setVisible(false);
        }
        return;
      }

      this._pendingTransitionId = currentVideoId;
      clearTimeout(this._pendingTransitionTimer);

      this.adapter.getVideoElement();

      // Delay commit until new video starts playing or timeout
      this._pendingTransitionTimer = setTimeout(() => {
        if (this._pendingTransitionId === currentVideoId) {
          this._commitPendingTransition();
        }
      }, 1000);
    }

    async _commitPendingTransition() {
      clearTimeout(this._pendingTransitionTimer);
      const videoId = this._pendingTransitionId || this.adapter.getCurrentVideoId();
      this._pendingTransitionId = null;

      console.log(`[YouTune] Committing transition to video: ${videoId}`);

      this.state.update({
        currentTime: 0,
        duration: this.adapter.getDuration(),
        videoId: videoId
      });

      await this.metadata.resolveCurrent();

      if (this.state.get('enabled')) {
        this.playerView.setVisible(true);
        if (this.adapter.isPlaying()) {
          this._startTick();
        }
      }
    }

    _onPlayerRecovered(video) {
      console.log('[YouTune] Player recovered, resynchronizing...');
      this.adapter.attachToVideo(video);
      this.metadata.resolveCurrent();
      this.state.update({
        playbackState: this.adapter.getPlaybackState(),
        currentTime: this.adapter.getCurrentTime(),
        duration: this.adapter.getDuration(),
        volume: this.adapter.getVolume(),
        muted: this.adapter.isMuted()
      });
      if (this.adapter.isPlaying() && this.state.get('enabled')) {
        this._startTick();
      }
    }

    enable() {
      console.log('[YouTune] Enabling YouTune mode');
      this.playerView.mount();

      // Blur any background elements that may hold focus
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      this.adapter.getVideoElement();
      this.metadata.resolveCurrent();

      this.state.update({
        enabled: true,
        playbackState: this.adapter.getPlaybackState(),
        currentTime: this.adapter.getCurrentTime(),
        duration: this.adapter.getDuration(),
        volume: this.adapter.getVolume(),
        muted: this.adapter.isMuted()
      });

      if (this.adapter.isPlaying()) {
        this._startTick();
      }

      this.storage.set('youtune_enabled', true);
      this._notifyServiceWorker(true);
    }

    async disable() {
      console.log('[YouTune] Disabling YouTune mode');
      this._stopTick();

      if (this.fullscreen.isBrowserFullscreen()) {
        await this.fullscreen.exit();
      }

      this.state.update({ enabled: false });
      this.storage.set('youtune_enabled', false);
      this._notifyServiceWorker(false);
    }

    toggle() {
      if (this.state.get('enabled')) {
        this.disable();
      } else {
        this.enable();
      }
    }

    _notifyServiceWorker(enabled) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', enabled });
        } catch (_) {}
      }
    }

    _onKeyDown(e) {
      if (!this.state.get('enabled')) return;

      // Space = Play/Pause (Prioritized above everything when YouTune is active)
      const isSpace = e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space' || e.keyCode === 32;
      if (isSpace) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }

        const now = Date.now();
        if (this._lastSpaceTime && now - this._lastSpaceTime < 250) {
          return;
        }
        this._lastSpaceTime = now;

        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.blur();
        }

        this.adapter.togglePlayPause();
        return;
      }

      // Escape exits browser fullscreen first, or exits YouTune mode
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this.fullscreen.isBrowserFullscreen()) {
          this.fullscreen.exit();
        } else {
          this.disable();
        }
        return;
      }

      // ArrowUp = Increase volume
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const curVol = this.adapter.getVolume();
        const nextVol = Math.min(1, Math.round((curVol + 0.05) * 100) / 100);
        this.adapter.setVolume(nextVol);
        this.playerView.showVolumeToast(Math.round(nextVol * 100));
        return;
      }

      // ArrowDown = Decrease volume
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const curVol = this.adapter.getVolume();
        const nextVol = Math.max(0, Math.round((curVol - 0.05) * 100) / 100);
        this.adapter.setVolume(nextVol);
        this.playerView.showVolumeToast(Math.round(nextVol * 100));
        return;
      }

      // ArrowLeft = Seek back, or Previous with right swipe ONLY IF <= 1.5s
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          const currentTime = this.adapter.getCurrentTime();
          if (currentTime <= 1.5) {
            this.playerView.triggerSwipe('right');
            this.adapter.previousTrack();
          } else {
            this.adapter.seek(0);
          }
        } else {
          this.adapter.seekBy(-5);
        }
        return;
      }

      // ArrowRight = Seek forward, or Next with left swipe
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          this.playerView.triggerSwipe('left');
          this.adapter.next();
        } else {
          this.adapter.seekBy(5);
        }
        return;
      }

      // M = Toggle Mute
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        const isMuted = this.adapter.toggleMute();
        this.playerView.showVolumeToast(isMuted ? 'Muted' : Math.round(this.adapter.getVolume() * 100));
        return;
      }

      // F = Fullscreen toggle
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        e.stopPropagation();
        this.fullscreen.toggle(this.playerView.rootElement);
        return;
      }
    }

    destroy() {
      this._stopTick();
      clearTimeout(this._pendingTransitionTimer);
      window.removeEventListener('keydown', this._boundKeyHandler, true);
      document.removeEventListener('keydown', this._boundKeyHandler, true);
      this.navigation.stop();
      this.recovery.stop();
      this.fullscreen.stop();
      this.adapter.detach();
      this.playerView.unmount();
      this._isInitialized = false;
    }
  }

  window.YouTune.YouTuneCore = YouTuneCore;
  window.YouTune.core = new YouTuneCore();
})();
