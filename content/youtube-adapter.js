/**
 * YouTune - YouTube Adapter
 * Stable abstraction layer interfacing with the native YouTube player and DOM.
 * Isolates all YouTube-specific DOM lookups and provides robust fallbacks.
 */
(() => {
  window.YouTune = window.YouTune || {};

  const PlaybackState = {
    IDLE: 'idle',
    PLAYING: 'playing',
    PAUSED: 'paused',
    BUFFERING: 'buffering',
    ENDED: 'ended'
  };

  class YouTubeAdapter {
    constructor() {
      this._videoElement = null;
      this._listeners = new Map();
      this._savedVolume = 1.0;
      this._savedMuted = false;
      this._isVolumeLocked = false;
      this._isSelfVolumeChange = false;
      this._boundVideoHandlers = {
        play: () => this._onVideoEvent('play'),
        playing: () => this._onVideoEvent('playing'),
        pause: () => this._onVideoEvent('pause'),
        timeupdate: () => this._onVideoEvent('timeupdate'),
        seeking: () => this._onVideoEvent('seeking'),
        seeked: () => this._onVideoEvent('seeked'),
        waiting: () => this._onVideoEvent('waiting'),
        ended: () => this._onVideoEvent('ended'),
        durationchange: () => this._onVideoEvent('durationchange'),
        volumechange: () => this._onVolumeChangeEvent(),
        loadedmetadata: () => this._onVideoEvent('loadedmetadata')
      };
    }

    /**
     * Finds and returns the active HTML5 <video> element.
     */
    getVideoElement() {
      if (this._videoElement && document.contains(this._videoElement)) {
        return this._videoElement;
      }

      let video = null;
      const moviePlayer = document.getElementById('movie_player');
      if (moviePlayer) {
        video = moviePlayer.querySelector('video');
      }

      if (!video) {
        video = document.querySelector('video.html5-main-video');
      }

      if (!video) {
        video = document.querySelector('ytd-watch-flexy video');
      }

      if (!video) {
        const allVideos = Array.from(document.querySelectorAll('video'));
        video = allVideos.find(v => v.src || v.srcObject || v.readyState > 0) || allVideos[0] || null;
      }

      if (video && video !== this._videoElement) {
        this.attachToVideo(video);
      }

      return this._videoElement;
    }

    attachToVideo(video) {
      if (this._videoElement === video) return;

      this.detach();

      this._videoElement = video;
      if (!this._videoElement) return;

      for (const [evtName, handler] of Object.entries(this._boundVideoHandlers)) {
        this._videoElement.addEventListener(evtName, handler);
      }

      if (this._isVolumeLocked) {
        this.applySavedVolume();
      }

      this._emit('attached', this._videoElement);
    }

    detach() {
      if (!this._videoElement) return;

      for (const [evtName, handler] of Object.entries(this._boundVideoHandlers)) {
        try {
          this._videoElement.removeEventListener(evtName, handler);
        } catch (_) {}
      }
      this._videoElement = null;
      this._emit('detached');
    }

    getCurrentVideoId() {
      try {
        const url = new URL(window.location.href);
        const v = url.searchParams.get('v');
        if (v && v.trim().length > 0) {
          return v.trim();
        }
        if (url.pathname.startsWith('/shorts/')) {
          const parts = url.pathname.split('/');
          if (parts[2]) return parts[2];
        }
      } catch (e) {
        console.warn('[YouTune Adapter] Error parsing URL for video ID:', e);
      }
      return null;
    }

    /**
     * Detects current video title with multi-tiered fallbacks.
     */
    getTitle() {
      // 1. YouTube HTML5 player in-DOM title (updates synchronously with player)
      const playerTitle = document.querySelector('#movie_player .ytp-title-link, .html5-video-player .ytp-title-link, a.ytp-title-link');
      if (playerTitle && playerTitle.textContent && playerTitle.textContent.trim()) {
        return playerTitle.textContent.trim();
      }

      // 2. Primary YouTube watch metadata title
      const watchTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, ytd-watch-metadata #title yt-formatted-string, ytd-watch-metadata h1');
      if (watchTitle && watchTitle.textContent && watchTitle.textContent.trim()) {
        return watchTitle.textContent.trim();
      }

      // 3. Document title cleanup
      if (document.title) {
        const cleaned = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
        if (cleaned && !cleaned.toLowerCase().includes('youtube')) {
          return cleaned;
        }
      }

      // 4. Legacy watch title
      const legacyTitle = document.querySelector('#container > h1.title yt-formatted-string, h1.title.style-scope.ytd-video-primary-info-renderer');
      if (legacyTitle && legacyTitle.textContent && legacyTitle.textContent.trim()) {
        return legacyTitle.textContent.trim();
      }

      // 5. OpenGraph / Meta tag
      const metaTitle = document.querySelector('meta[property="og:title"], meta[name="title"]');
      if (metaTitle && metaTitle.content && metaTitle.content.trim()) {
        return metaTitle.content.trim();
      }

      return 'Unknown Title';
    }

    /**
     * Detects current video's channel name directly from the DOM.
     * Updates synchronously whenever the video changes.
     */
    getChannelName() {
      const selectors = [
        'ytd-watch-metadata #channel-name a',
        'ytd-watch-metadata ytd-channel-name a',
        'ytd-watch-metadata ytd-channel-name #text a',
        'ytd-watch-metadata ytd-channel-name #text',
        '#owner #channel-name a',
        '#upload-info ytd-channel-name a',
        'ytd-video-owner-renderer #channel-name a',
        '#movie_player .ytp-title-channel-name',
        '.ytp-title-channel-name'
      ];

      const currentTitle = (this.getTitle() || '').trim().toLowerCase();

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim()) {
          const name = el.textContent.trim();
          const lower = name.toLowerCase();
          if (
            name &&
            lower !== 'subscribe' &&
            lower !== 'subscribed' &&
            lower !== 'youtube' &&
            lower !== 'unknown title' &&
            lower !== currentTitle
          ) {
            return name;
          }
        }
      }

      return null;
    }

    getThumbnailUrls(videoId) {
      const id = videoId || this.getCurrentVideoId();
      if (!id) {
        const metaImg = document.querySelector('meta[property="og:image"]');
        if (metaImg && metaImg.content) {
          return [metaImg.content];
        }
        return [];
      }

      return [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/default.jpg`
      ];
    }

    getCurrentTime() {
      const video = this.getVideoElement();
      if (!video || !Number.isFinite(video.currentTime)) return 0;
      return Math.max(0, video.currentTime);
    }

    getDuration() {
      const video = this.getVideoElement();
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return 0;
      return video.duration;
    }

    getVolume() {
      if (this._isVolumeLocked) {
        return this._savedVolume;
      }
      const video = this.getVideoElement();
      return video ? video.volume : this._savedVolume;
    }

    isMuted() {
      if (this._isVolumeLocked) {
        return this._savedMuted;
      }
      const video = this.getVideoElement();
      return video ? video.muted : this._savedMuted;
    }

    getPlaybackState() {
      const video = this.getVideoElement();
      if (!video) return PlaybackState.IDLE;

      if (video.ended) return PlaybackState.ENDED;
      if (video.seeking || video.readyState < 2) return PlaybackState.BUFFERING;
      if (video.paused) return PlaybackState.PAUSED;
      return PlaybackState.PLAYING;
    }

    isPlaying() {
      return this.getPlaybackState() === PlaybackState.PLAYING;
    }

    isPaused() {
      return this.getPlaybackState() === PlaybackState.PAUSED;
    }

    isBuffering() {
      return this.getPlaybackState() === PlaybackState.BUFFERING;
    }

    isEnded() {
      return this.getPlaybackState() === PlaybackState.ENDED;
    }

    /**
     * Controls - Play
     */
    async play() {
      const playBtn = document.querySelector('.ytp-play-button, button.ytp-play-button');
      if (playBtn && this.isPaused()) {
        playBtn.click();
      }

      const video = this.getVideoElement();
      if (video && video.paused) {
        try {
          await video.play();
        } catch (_) {}
      }
      return true;
    }

    /**
     * Controls - Pause
     */
    pause() {
      const playBtn = document.querySelector('.ytp-play-button, button.ytp-play-button');
      if (playBtn && this.isPlaying()) {
        playBtn.click();
      }

      const video = this.getVideoElement();
      if (video && !video.paused) {
        video.pause();
      }
      return true;
    }

    /**
     * Controls - Toggle Play / Pause
     * Resiliently toggles playback: uses YouTube's native play button or direct video control with fallback verification.
     */
    togglePlayPause() {
      const video = this.getVideoElement();
      const wasPaused = video ? video.paused : null;

      const playBtn = document.querySelector('.ytp-play-button, button.ytp-play-button');
      if (playBtn) {
        playBtn.click();
      } else if (video) {
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }

      // Verification fallback: if state didn't change after 120ms, directly control video element
      if (video && wasPaused !== null) {
        setTimeout(() => {
          if (video.paused === wasPaused) {
            if (wasPaused) {
              video.play().catch(() => {});
            } else {
              video.pause();
            }
          }
        }, 120);
      }

      return true;
    }

    seek(seconds) {
      const video = this.getVideoElement();
      if (!video) return;

      const duration = this.getDuration();
      const clamped = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);

      try {
        video.currentTime = clamped;
        this._emit('seeked', clamped);
      } catch (e) {
        console.warn('[YouTune Adapter] Error seeking video:', e);
      }
    }

    seekBy(offsetSeconds) {
      const current = this.getCurrentTime();
      this.seek(current + offsetSeconds);
    }

    setSavedVolume(vol, muted) {
      if (typeof vol === 'number' && !isNaN(vol)) {
        this._savedVolume = Math.max(0, Math.min(1, vol));
      }
      if (typeof muted === 'boolean') {
        this._savedMuted = muted;
      }
    }

    enableVolumeLock() {
      this._isVolumeLocked = true;
      this._enforceVolumeOnVideo();
      this._syncToBridge(this._savedVolume, this._savedMuted, true);
    }

    disableVolumeLock() {
      this._isVolumeLocked = false;
      this._syncToBridge(this._savedVolume, this._savedMuted, false);
      try {
        window.dispatchEvent(new CustomEvent('youtune:bridge-command', {
          detail: { action: 'UNLOCK_VOLUME' }
        }));
      } catch (_) {}
    }

    applySavedVolume() {
      this._enforceVolumeOnVideo();
    }

    _enforceVolumeOnVideo() {
      const video = this.getVideoElement();
      if (!video) return;

      this._isSelfVolumeChange = true;
      try {
        video.volume = this._savedVolume;
        video.muted = this._savedMuted;
      } catch (err) {
        console.warn('[YouTune Adapter] Error enforcing video volume:', err);
      } finally {
        this._isSelfVolumeChange = false;
      }

      this._syncToBridge(this._savedVolume, this._savedMuted, this._isVolumeLocked);
    }

    _syncToBridge(volume, muted, isLocked) {
      const volPercent = Math.round(volume * 100);

      // 1. Dispatch custom event to main-world bridge
      try {
        window.dispatchEvent(new CustomEvent('youtune:bridge-command', {
          detail: {
            action: isLocked ? 'LOCK_VOLUME' : 'SET_VOLUME',
            volume: volPercent,
            muted: !!muted,
            locked: !!isLocked
          }
        }));
      } catch (_) {}

      // 2. Sync to localStorage for YouTube native player
      try {
        localStorage.setItem('yt-player-volume', JSON.stringify({
          data: JSON.stringify({ volume: volPercent, muted: !!muted }),
          creation: Date.now()
        }));
      } catch (_) {}
    }

    _onVolumeChangeEvent() {
      const video = this.getVideoElement();
      if (!video) return;

      if (this._isSelfVolumeChange) return;

      // Anti-slide: If YouTune volume lock is active, prevent automated drops/slides
      if (this._isVolumeLocked) {
        const volumeDiff = Math.abs(video.volume - this._savedVolume);
        const muteDiff = video.muted !== this._savedMuted;

        if (volumeDiff > 0.01 || muteDiff) {
          // Automatic decrease/drop detected (e.g. YouTube dropping volume to 27%).
          // Restore the user's saved volume immediately.
          this._enforceVolumeOnVideo();
          return;
        }
      }

      this._emit('volumechange', {
        state: this.getPlaybackState(),
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
        volume: this.getVolume(),
        muted: this.isMuted()
      });
    }

    setVolume(vol, isUserAction = true) {
      const video = this.getVideoElement();
      const clamped = Math.max(0, Math.min(1, vol));

      if (isUserAction) {
        this._savedVolume = clamped;
        if (clamped > 0) {
          this._savedMuted = false;
        }
        if (window.YouTune && window.YouTune.storage) {
          window.YouTune.storage.set('youtune_volume', clamped);
          window.YouTune.storage.set('youtune_muted', this._savedMuted);
        }
      }

      if (video) {
        this._isSelfVolumeChange = true;
        try {
          video.volume = clamped;
          if (clamped > 0 && video.muted) {
            video.muted = false;
          }
        } catch (e) {
          console.warn('[YouTune Adapter] Error setting video.volume:', e);
        } finally {
          this._isSelfVolumeChange = false;
        }
      }

      this._syncToBridge(clamped, this._savedMuted, this._isVolumeLocked);

      this._emit('volumechange', {
        state: this.getPlaybackState(),
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
        volume: clamped,
        muted: this._savedMuted
      });
    }

    toggleMute(isUserAction = true) {
      const video = this.getVideoElement();
      const newMuted = !this.isMuted();

      if (isUserAction) {
        this._savedMuted = newMuted;
        if (window.YouTune && window.YouTune.storage) {
          window.YouTune.storage.set('youtune_muted', newMuted);
        }
      }

      if (video) {
        this._isSelfVolumeChange = true;
        try {
          video.muted = newMuted;
        } catch (e) {
          console.warn('[YouTune Adapter] Error setting video.muted:', e);
        } finally {
          this._isSelfVolumeChange = false;
        }
      }

      this._syncToBridge(this._savedVolume, newMuted, this._isVolumeLocked);

      this._emit('volumechange', {
        state: this.getPlaybackState(),
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
        volume: this.getVolume(),
        muted: newMuted
      });

      return newMuted;
    }

    /**
     * Checks if YouTube player currently has a reachable next video.
     */
    hasNextTrack() {
      const nextBtn = document.querySelector('.ytp-next-button, button.ytp-next-button, a.ytp-next-button');
      if (nextBtn) {
        const ariaDisabled = nextBtn.getAttribute('aria-disabled');
        const isHidden = nextBtn.style.display === 'none' || nextBtn.offsetParent === null;
        const isDisabledClass = nextBtn.classList.contains('ytp-button-disabled');
        if (ariaDisabled !== 'true' && !isHidden && !isDisabledClass) {
          return true;
        }
      }

      const playlistNext = document.querySelector('ytd-playlist-panel-video-renderer[selected] + ytd-playlist-panel-video-renderer a#wc-endpoint');
      if (playlistNext) {
        return true;
      }

      return false;
    }

    /**
     * Checks if YouTube player currently has a reachable previous video.
     */
    hasPreviousTrack() {
      const prevBtn = document.querySelector('.ytp-prev-button, button.ytp-prev-button, a.ytp-prev-button');
      if (prevBtn) {
        const ariaDisabled = prevBtn.getAttribute('aria-disabled');
        const isHidden = prevBtn.style.display === 'none' || prevBtn.offsetParent === null;
        const isDisabledClass = prevBtn.classList.contains('ytp-button-disabled');
        if (ariaDisabled !== 'true' && !isHidden && !isDisabledClass) {
          return true;
        }
      }

      const currentSelected = document.querySelector('ytd-playlist-panel-video-renderer[selected]');
      if (currentSelected && currentSelected.previousElementSibling) {
        const prevLink = currentSelected.previousElementSibling.querySelector('a#wc-endpoint');
        if (prevLink) {
          return true;
        }
      }

      return false;
    }

    next() {
      if (!this.hasNextTrack()) {
        return false;
      }

      const nextBtn = document.querySelector('.ytp-next-button, button.ytp-next-button, a.ytp-next-button');
      if (nextBtn && nextBtn.getAttribute('aria-disabled') !== 'true' && nextBtn.style.display !== 'none') {
        nextBtn.click();
        return true;
      }

      const playlistNext = document.querySelector('ytd-playlist-panel-video-renderer[selected] + ytd-playlist-panel-video-renderer a#wc-endpoint');
      if (playlistNext) {
        playlistNext.click();
        return true;
      }

      return false;
    }

    previous() {
      const currentTime = this.getCurrentTime();
      if (currentTime > 1.5 || !this.hasPreviousTrack()) {
        this.seek(0);
        return false;
      }
      return this.previousTrack();
    }

    previousTrack() {
      if (!this.hasPreviousTrack()) {
        this.seek(0);
        return false;
      }

      const prevBtn = document.querySelector('.ytp-prev-button, button.ytp-prev-button, a.ytp-prev-button');
      if (prevBtn && prevBtn.getAttribute('aria-disabled') !== 'true' && prevBtn.style.display !== 'none') {
        prevBtn.click();
        return true;
      }

      const currentSelected = document.querySelector('ytd-playlist-panel-video-renderer[selected]');
      if (currentSelected && currentSelected.previousElementSibling) {
        const prevLink = currentSelected.previousElementSibling.querySelector('a#wc-endpoint');
        if (prevLink) {
          prevLink.click();
          return true;
        }
      }

      this.seek(0);
      return false;
    }

    on(event, callback) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, new Set());
      }
      this._listeners.get(event).add(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(callback);
      }
    }

    _emit(event, data) {
      if (this._listeners.has(event)) {
        for (const cb of this._listeners.get(event)) {
          try {
            cb(data);
          } catch (e) {
            console.error(`[YouTune Adapter] Error in listener for "${event}":`, e);
          }
        }
      }
    }

    _onVideoEvent(evtName) {
      this._emit(evtName, {
        state: this.getPlaybackState(),
        currentTime: this.getCurrentTime(),
        duration: this.getDuration(),
        volume: this.getVolume(),
        muted: this.isMuted()
      });
    }
  }

  window.YouTune.PlaybackState = PlaybackState;
  window.YouTune.YouTubeAdapter = YouTubeAdapter;
  window.YouTune.adapter = new YouTubeAdapter();
})();
