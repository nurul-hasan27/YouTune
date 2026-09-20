/**
 * YouTune - Controls Component
 * Renders playback action buttons (Previous, Play/Pause, Next).
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  const ICONS = {
    play: `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5.14v13.72a1 1 0 001.53.85l11-6.86a1 1 0 000-1.7l-11-6.86A1 1 0 008 5.14z"/>
      </svg>
    `,
    pause: `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 5h4a1 1 0 011 1v12a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1zm8 0h4a1 1 0 011 1v12a1 1 0 01-1 1h-4a1 1 0 01-1-1V6a1 1 0 011-1z"/>
      </svg>
    `,
    spinner: `
      <svg class="youtune-spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle class="youtune-spinner-track" cx="12" cy="12" r="9" stroke-opacity="0.25"/>
        <path class="youtune-spinner-head" d="M12 3a9 9 0 019 9" stroke-linecap="round"/>
      </svg>
    `,
    previous: `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 5a1 1 0 011 1v12a1 1 0 11-2 0V6a1 1 0 011-1zm12.5.85a1 1 0 00-1.53-.85l-9 5.85a1 1 0 000 1.7l9 5.85a1 1 0 001.53-.85V5.85z"/>
      </svg>
    `,
    next: `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 5a1 1 0 011 1v12a1 1 0 11-2 0V6a1 1 0 011-1zM5.5 5.85a1 1 0 011.53-.85l9 5.85a1 1 0 010 1.7l-9 5.85A1 1 0 015.5 17.15V5.85z"/>
      </svg>
    `
  };

  class ControlsView {
    constructor(adapter) {
      this.adapter = adapter || window.YouTune.adapter;

      this.element = null;
      this._prevBtn = null;
      this._playPauseBtn = null;
      this._nextBtn = null;

      this._onNext = null;
      this._onPrevious = null;
    }

    setCallbacks({ onNext, onPrevious } = {}) {
      this._onNext = onNext;
      this._onPrevious = onPrevious;
    }

    render() {
      if (this.element) return this.element;

      this.element = document.createElement('div');
      this.element.className = 'youtune-controls-container';

      // Center Playback Buttons Row
      const mainRow = document.createElement('div');
      mainRow.className = 'youtune-main-controls-row';

      // Previous Button
      this._prevBtn = this._createButton({
        className: 'youtune-btn youtune-btn-prev',
        ariaLabel: 'Previous track',
        iconSvg: ICONS.previous,
        onClick: () => {
          const currentTime = this.adapter.getCurrentTime();
          if (currentTime <= 1.5) {
            if (this._onPrevious) this._onPrevious();
            this.adapter.previousTrack();
          } else {
            this.adapter.seek(0);
          }
        }
      });

      // Play/Pause Button
      this._playPauseBtn = this._createButton({
        className: 'youtune-btn youtune-btn-playpause',
        ariaLabel: 'Play',
        iconSvg: ICONS.play,
        onClick: () => this.adapter.togglePlayPause()
      });

      // Next Button
      this._nextBtn = this._createButton({
        className: 'youtune-btn youtune-btn-next',
        ariaLabel: 'Next track',
        iconSvg: ICONS.next,
        onClick: () => {
          if (this._onNext) this._onNext();
          this.adapter.next();
        }
      });

      mainRow.appendChild(this._prevBtn);
      mainRow.appendChild(this._playPauseBtn);
      mainRow.appendChild(this._nextBtn);

      this.element.appendChild(mainRow);
      return this.element;
    }

    _createButton({ className, ariaLabel, iconSvg, onClick }) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.setAttribute('aria-label', ariaLabel);
      btn.innerHTML = iconSvg;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
      });
      return btn;
    }

    updatePlaybackState(state) {
      if (!this._playPauseBtn) return;

      if (state === 'playing') {
        this._playPauseBtn.innerHTML = ICONS.pause;
        this._playPauseBtn.setAttribute('aria-label', 'Pause');
      } else if (state === 'buffering') {
        this._playPauseBtn.innerHTML = ICONS.spinner;
        this._playPauseBtn.setAttribute('aria-label', 'Buffering');
      } else {
        this._playPauseBtn.innerHTML = ICONS.play;
        this._playPauseBtn.setAttribute('aria-label', 'Play');
      }
    }
  }

  window.YouTune.UI.ControlsView = ControlsView;
})();
