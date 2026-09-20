/**
 * YouTune - Metadata Manager
 * Resolves clean song titles, channel info, verified artwork, and dominates color extraction.
 * Dynamically updates both title and channel name synchronously with every video transition.
 * Leaves author/channel as null if not available.
 */
(() => {
  window.YouTune = window.YouTune || {};

  class MetadataManager {
    constructor(adapter, state) {
      this.adapter = adapter || window.YouTune.adapter;
      this.state = state || window.YouTune.playerState;

      this._retryTimeout = null;
      this._debounceTimer = null;
      this._observer = null;
      this._currentResolveId = 0;
      this._lastResolvedVideoId = null;
      this._lastTitle = null;
      this._lastChannel = null;
      this._verifiedThumbnailCache = new Map();

      this._initObservers();
    }

    _initObservers() {
      window.addEventListener('yt-page-data-updated', () => this.resolveCurrent(1), true);
      window.addEventListener('yt-navigate-finish', () => this.resolveCurrent(1), true);

      const observer = new MutationObserver(() => {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.resolveCurrent(1), 150);
      });

      const attachObserver = () => {
        const target = document.querySelector('ytd-watch-metadata') ||
                       document.getElementById('info') ||
                       document.querySelector('ytd-watch-flexy');
        if (target) {
          observer.observe(target, { childList: true, subtree: true, characterData: true });
          this._observer = observer;
        } else {
          setTimeout(attachObserver, 1000);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
      } else {
        attachObserver();
      }
    }

    /**
     * Resolves all metadata for the current track.
     * Leaves channel strictly as null if not available.
     */
    async resolveCurrent(attempt = 1) {
      const resolveId = ++this._currentResolveId;
      const videoId = this.adapter.getCurrentVideoId();
      if (!videoId) return;

      const rawTitle = this.adapter.getTitle();
      const rawChannel = this.adapter.getChannelName();
      const duration = this.adapter.getDuration();

      // Only clean channel if genuine channel string is present, else null
      let channel = null;
      if (rawChannel && typeof rawChannel === 'string' && rawChannel.trim()) {
        const cleaned = this._cleanChannelName(rawChannel.trim());
        const cleanedLower = (cleaned || '').toLowerCase();
        const rawTitleLower = (rawTitle || '').trim().toLowerCase();
        if (
          cleaned &&
          cleanedLower !== 'youtube' &&
          cleanedLower !== 'unknown title' &&
          cleanedLower !== rawTitleLower
        ) {
          channel = cleaned;
        }
      }

      // Title extraction
      const title = this._extractCleanSongTitle(rawTitle, channel);

      // Strict check: if channel matches clean title, drop it
      if (channel && title && channel.toLowerCase() === title.toLowerCase()) {
        channel = null;
      }

      const isVideoChanged = videoId !== this._lastResolvedVideoId;

      // Update state whenever videoId, title, or channel changes
      if (title && (title !== this._lastTitle || channel !== this._lastChannel || isVideoChanged)) {
        this._lastTitle = title;
        this._lastChannel = channel;
        this._lastResolvedVideoId = videoId;

        const thumbUrl = await this.resolveBestThumbnail(videoId);
        if (resolveId !== this._currentResolveId) return;

        this.state.update({
          hasVideo: true,
          videoId,
          title: title,
          channel: channel || null,
          thumbnailUrl: thumbUrl,
          duration: duration > 0 ? duration : this.state.get('duration')
        });
      }

      // Schedule progressive retries up to attempt 5
      if (attempt < 5) {
        clearTimeout(this._retryTimeout);
        const delays = [250, 500, 900, 1500];
        const delay = delays[attempt - 1] || 1000;

        this._retryTimeout = setTimeout(() => {
          if (resolveId === this._currentResolveId) {
            this.resolveCurrent(attempt + 1);
          }
        }, delay);
      }
    }

    /**
     * Cleans channel name by stripping common suffixes like "VEVO", "Official", "- Topic".
     */
    _cleanChannelName(rawChannel) {
      if (!rawChannel) return null;

      let cleaned = rawChannel.trim();
      const stripped = cleaned
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/VEVO$/i, '')
        .replace(/\s+Official(?:\s+Channel)?$/i, '')
        .replace(/\s+Music$/i, '')
        .trim();

      return stripped || cleaned || null;
    }

    /**
     * Extracts concise song title (typically 2-4 words) and strips channel repetition.
     */
    _extractCleanSongTitle(rawTitle, channelName) {
      if (!rawTitle || rawTitle === 'Unknown Title') return 'Unknown Title';

      let title = rawTitle.trim();

      // 1. Remove bracketed noise: [Official Video], (Official Music Video), (Audio), [4K], etc.
      title = title.replace(/\[\s*(?:official\s*(?:video|music\s*video|audio|visualizer|lyric\s*video)?|music\s*video|lyric\s*video|audio|lyrics?|visualizer|remastered|hd|4k|mv|prod|feat|ft)[^\]]*\]/gi, '');
      title = title.replace(/\(\s*(?:official\s*(?:video|music\s*video|audio|visualizer|lyric\s*video)?|music\s*video|lyric\s*video|audio|lyrics?|visualizer|remastered|hd|4k|mv|prod)[^\)]*\)/gi, '');

      // 2. Remove trailing descriptors like | Official Music Video or // Official Audio
      title = title.replace(/\s*[|//]\s*(?:official\s*(?:music\s*)?video|official\s*audio|lyrics?).*$/gi, '');
      title = title.replace(/\s+[-–—]\s+(?:official\s*(?:music\s*)?video|official\s*audio|music\s*video|lyric\s*video).*$/gi, '');

      // 3. Remove (feat. ...) or (ft. ...)
      title = title.replace(/\s*\((?:feat|ft)\.?\s+[^\)]+\)/gi, '');
      title = title.replace(/\s*\[(?:feat|ft)\.?\s+[^\]]+\]/gi, '');

      // 4. Split by artist/title separator with spaces: " - ", " – ", " — ", " | "
      const parts = title.split(/\s+[-–—|]\s+/).map(p => p.trim()).filter(Boolean);

      if (parts.length >= 2) {
        const partA = parts[0];
        const partB = parts[1];
        const normChannel = (channelName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const normPartA = partA.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normPartB = partB.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (normChannel && (normPartA.includes(normChannel) || normChannel.includes(normPartA))) {
          title = partB;
        } else if (normChannel && (normPartB.includes(normChannel) || normChannel.includes(normPartB))) {
          title = partA;
        } else {
          title = partB;
        }
      }

      // 5. Strip redundant channel name from start or end if still present
      if (channelName && channelName.length > 2) {
        const channelRegex = new RegExp(`^${this._escapeRegExp(channelName)}\\s*[-–—:]?\\s*`, 'i');
        const stripped = title.replace(channelRegex, '');
        if (stripped.trim()) {
          title = stripped;
        }
      }

      // 6. Clean quotes and punctuation
      title = title.replace(/^["'“”‘]+|["'“”’]+$/g, '').trim();
      title = title.replace(/\s+/g, ' ').trim();

      return title || rawTitle;
    }

    _escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Finds highest resolution working thumbnail for video ID.
     */
    async resolveBestThumbnail(videoId) {
      if (!videoId) return null;
      if (this._verifiedThumbnailCache.has(videoId)) {
        return this._verifiedThumbnailCache.get(videoId);
      }

      const candidateUrls = this.adapter.getThumbnailUrls(videoId);

      for (const url of candidateUrls) {
        const isOk = await this._testImage(url);
        if (isOk) {
          this._verifiedThumbnailCache.set(videoId, url);
          return url;
        }
      }

      const fallback = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      this._verifiedThumbnailCache.set(videoId, fallback);
      return fallback;
    }

    _testImage(url) {
      return new Promise((resolve) => {
        const img = new Image();
        let settled = false;

        const cleanup = () => {
          img.onload = null;
          img.onerror = null;
        };

        img.onload = () => {
          if (settled) return;
          settled = true;
          const isValid = img.naturalWidth > 120 && img.naturalHeight > 90;
          cleanup();
          resolve(isValid);
        };

        img.onerror = () => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(false);
          }
        };

        img.src = url;

        setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(false);
          }
        }, 1500);
      });
    }

    clear() {
      clearTimeout(this._retryTimeout);
      clearTimeout(this._debounceTimer);
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    }
  }

  window.YouTune.MetadataManager = MetadataManager;
  window.YouTune.metadata = new MetadataManager();
})();
