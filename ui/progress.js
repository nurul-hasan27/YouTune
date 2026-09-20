/**
 * YouTune - Progress & Time Component
 * Seekable, draggable, keyboard-accessible progress bar with elapsed and remaining time readouts.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  /**
   * Formats seconds into standard audio time notation (e.g., "0:05", "1:05", "1:00:05").
   */
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

    const totalSeconds = Math.floor(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const padSecs = secs.toString().padStart(2, '0');

    if (hrs > 0) {
      const padMins = mins.toString().padStart(2, '0');
      return `${hrs}:${padMins}:${padSecs}`;
    }
    return `${mins}:${padSecs}`;
  }

  class ProgressView {
    constructor(adapter) {
      this.adapter = adapter || window.YouTune.adapter;

      this.element = null;
      this._track = null;
      this._fill = null;
      this._thumb = null;
      this._timeElapsed = null;
      this._timeRemaining = null;

      this._isDragging = false;
      this._dragTargetSeconds = 0;
      this._lastDuration = 0;
      this._lastCurrentTime = 0;

      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
    }

    render() {
      if (this.element) return this.element;

      this.element = document.createElement('div');
      this.element.className = 'youtune-progress-wrapper';

      // Interactive Slider
      this._track = document.createElement('div');
      this._track.className = 'youtune-progress-track';
      this._track.setAttribute('role', 'slider');
      this._track.setAttribute('tabindex', '0');
      this._track.setAttribute('aria-label', 'Playback timeline');
      this._track.setAttribute('aria-valuemin', '0');
      this._track.setAttribute('aria-valuemax', '100');
      this._track.setAttribute('aria-valuenow', '0');

      this._fill = document.createElement('div');
      this._fill.className = 'youtune-progress-fill';

      this._thumb = document.createElement('div');
      this._thumb.className = 'youtune-progress-thumb';

      this._fill.appendChild(this._thumb);
      this._track.appendChild(this._fill);

      // Time Display Row
      const timesRow = document.createElement('div');
      timesRow.className = 'youtune-times-row';

      this._timeElapsed = document.createElement('span');
      this._timeElapsed.className = 'youtune-time youtune-time-elapsed';
      this._timeElapsed.textContent = '0:00';

      this._timeRemaining = document.createElement('span');
      this._timeRemaining.className = 'youtune-time youtune-time-remaining';
      this._timeRemaining.textContent = '-0:00';

      timesRow.appendChild(this._timeElapsed);
      timesRow.appendChild(this._timeRemaining);

      this.element.appendChild(this._track);
      this.element.appendChild(timesRow);

      this._bindEvents();

      return this.element;
    }

    _bindEvents() {
      this._track.addEventListener('pointerdown', this._onPointerDown);
      this._track.addEventListener('keydown', this._onKeyDown);
    }

    _onPointerDown(e) {
      if (e.button !== 0) return; // Only primary mouse button
      this._isDragging = true;
      this._track.setPointerCapture(e.pointerId);

      this._track.addEventListener('pointermove', this._onPointerMove);
      this._track.addEventListener('pointerup', this._onPointerUp);
      this._track.addEventListener('pointercancel', this._onPointerUp);

      this._updateFromPointer(e);
    }

    _onPointerMove(e) {
      if (!this._isDragging) return;
      this._updateFromPointer(e);
    }

    _onPointerUp(e) {
      if (!this._isDragging) return;
      this._isDragging = false;

      try {
        this._track.releasePointerCapture(e.pointerId);
      } catch (_) {}

      this._track.removeEventListener('pointermove', this._onPointerMove);
      this._track.removeEventListener('pointerup', this._onPointerUp);
      this._track.removeEventListener('pointercancel', this._onPointerUp);

      // Perform the actual seek on the YouTube player
      this.adapter.seek(this._dragTargetSeconds);
    }

    _updateFromPointer(e) {
      const rect = this._track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = this.adapter.getDuration() || this._lastDuration || 0;
      const targetSecs = ratio * duration;

      this._dragTargetSeconds = targetSecs;
      this._renderProgress(targetSecs, duration);
    }

    _onKeyDown(e) {
      const duration = this.adapter.getDuration() || this._lastDuration || 0;
      if (duration <= 0) return;

      const current = this.adapter.getCurrentTime();

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.adapter.seek(Math.max(0, current - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.adapter.seek(Math.min(duration, current + 5));
          break;
        case 'Home':
          e.preventDefault();
          this.adapter.seek(0);
          break;
        case 'End':
          e.preventDefault();
          this.adapter.seek(duration);
          break;
      }
    }

    update(currentTime, duration) {
      if (this._isDragging) return; // Do not interrupt active scrub

      this._lastCurrentTime = currentTime || 0;
      this._lastDuration = duration || 0;

      this._renderProgress(this._lastCurrentTime, this._lastDuration);
    }

    _renderProgress(current, duration) {
      const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
      const percent = (ratio * 100).toFixed(2);

      if (this._fill) {
        this._fill.style.width = `${percent}%`;
      }

      if (this._timeElapsed) {
        this._timeElapsed.textContent = formatTime(current);
      }

      if (this._timeRemaining) {
        if (duration > 0) {
          const remaining = Math.max(0, duration - current);
          this._timeRemaining.textContent = `-${formatTime(remaining)}`;
        } else {
          this._timeRemaining.textContent = '-0:00';
        }
      }

      if (this._track) {
        this._track.setAttribute('aria-valuenow', Math.round(current).toString());
        this._track.setAttribute('aria-valuemax', Math.round(duration).toString());
        this._track.setAttribute('aria-valuetext', `${formatTime(current)} of ${formatTime(duration)}`);
      }
    }
  }

  window.YouTune.UI.formatTime = formatTime;
  window.YouTune.UI.ProgressView = ProgressView;
})();
