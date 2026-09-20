/**
 * YouTune - Artwork Component
 * Displays enlarged uncropped track artwork with smooth directional swipe transitions.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  const FALLBACK_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  `;

  class ArtworkView {
    constructor() {
      this.element = null;
      this._imageEl = null;
      this._fallbackEl = null;
      this._frameEl = null;
      this._currentSrc = null;
      this._animatingDirection = null;
      this._swipeSafetyTimer = null;
    }

    render() {
      if (this.element) return this.element;

      this.element = document.createElement('div');
      this.element.className = 'youtune-artwork-wrapper';

      this._frameEl = document.createElement('div');
      this._frameEl.className = 'youtune-artwork-frame';

      this._imageEl = document.createElement('img');
      this._imageEl.className = 'youtune-artwork-img';
      this._imageEl.alt = 'Track Artwork';
      this._imageEl.decoding = 'async';
      this._imageEl.loading = 'eager';

      this._fallbackEl = document.createElement('div');
      this._fallbackEl.className = 'youtune-artwork-fallback';
      this._fallbackEl.innerHTML = FALLBACK_ICON;

      this._imageEl.addEventListener('load', () => {
        this._imageEl.classList.add('youtune-img-loaded');
        this._fallbackEl.classList.remove('youtune-fallback-visible');
      });

      this._imageEl.addEventListener('error', () => {
        this._imageEl.classList.remove('youtune-img-loaded');
        this._fallbackEl.classList.add('youtune-fallback-visible');
      });

      this._frameEl.appendChild(this._imageEl);
      this._frameEl.appendChild(this._fallbackEl);
      this.element.appendChild(this._frameEl);

      return this.element;
    }

    /**
     * Trigger aesthetic swipe-out animation in a given direction ('left' or 'right').
     */
    animateSwipeOut(direction) {
      if (!this._frameEl) return;
      this._animatingDirection = direction;

      this._clearAnimationClasses();
      if (direction === 'left') {
        this._frameEl.classList.add('youtune-swipe-left-out');
      } else if (direction === 'right') {
        this._frameEl.classList.add('youtune-swipe-right-out');
      }

      // Safety recovery: if no new track loads within 750ms, restore thumbnail visibility
      clearTimeout(this._swipeSafetyTimer);
      this._swipeSafetyTimer = setTimeout(() => {
        this._clearAnimationClasses();
        this._animatingDirection = null;
      }, 750);
    }

    /**
     * Updates artwork source and plays entrance animation if transitioning.
     */
    update(thumbnailUrl, incomingDirection = null) {
      if (!this._imageEl) return;

      clearTimeout(this._swipeSafetyTimer);
      const direction = incomingDirection || this._animatingDirection;
      this._animatingDirection = null;

      if (!thumbnailUrl) {
        this._currentSrc = null;
        this._imageEl.classList.remove('youtune-img-loaded');
        this._fallbackEl.classList.add('youtune-fallback-visible');
        return;
      }

      if (thumbnailUrl === this._currentSrc && !direction) return;
      this._currentSrc = thumbnailUrl;

      this._imageEl.classList.remove('youtune-img-loaded');
      this._imageEl.src = thumbnailUrl;

      if (this._frameEl && direction) {
        this._clearAnimationClasses();
        const inClass = direction === 'left' ? 'youtune-swipe-left-in' : 'youtune-swipe-right-in';
        this._frameEl.classList.add(inClass);

        setTimeout(() => {
          this._clearAnimationClasses();
        }, 500);
      }
    }

    _clearAnimationClasses() {
      clearTimeout(this._swipeSafetyTimer);
      if (!this._frameEl) return;
      this._frameEl.classList.remove(
        'youtune-swipe-left-out',
        'youtune-swipe-right-out',
        'youtune-swipe-left-in',
        'youtune-swipe-right-in'
      );
    }
  }

  window.YouTune.UI.ArtworkView = ArtworkView;
})();
