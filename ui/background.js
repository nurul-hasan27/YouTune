/**
 * YouTune - Dynamic Atmospheric Background
 * Creates rich, luminous ambient lighting that morphs according to the dominant colors of the thumbnail.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  const DEFAULT_GRADIENT = 'radial-gradient(ellipse at 50% 35%, rgba(67, 56, 202, 0.75) 0%, rgba(30, 27, 75, 0.85) 45%, #0b1124 100%)';

  class BackgroundView {
    constructor() {
      this.element = null;
      this._layerA = null;
      this._layerB = null;
      this._activeLayer = 'A';
      this._currentUrl = null;
    }

    render() {
      if (this.element) return this.element;

      this.element = document.createElement('div');
      this.element.className = 'youtune-background-container';

      this._layerA = document.createElement('div');
      this._layerA.className = 'youtune-bg-layer youtune-bg-active';
      this._layerA.style.background = DEFAULT_GRADIENT;

      this._layerB = document.createElement('div');
      this._layerB.className = 'youtune-bg-layer';
      this._layerB.style.background = DEFAULT_GRADIENT;

      const vignette = document.createElement('div');
      vignette.className = 'youtune-bg-vignette';

      this.element.appendChild(this._layerA);
      this.element.appendChild(this._layerB);
      this.element.appendChild(vignette);

      return this.element;
    }

    /**
     * Updates the ambient background with dominant colors extracted from the thumbnail.
     */
    async update(thumbnailUrl) {
      if (!thumbnailUrl || thumbnailUrl === this._currentUrl) return;
      this._currentUrl = thumbnailUrl;

      let gradient = null;

      // 1. Request dominant color extraction from background service worker
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'EXTRACT_COLORS', url: thumbnailUrl },
              (res) => resolve(res)
            );
          });

          if (response && response.success && response.colors) {
            const { primary, secondary, ambient, base } = response.colors;
            gradient = `radial-gradient(circle at 50% 32%, ${primary} 0%, ${secondary} 40%, ${ambient} 72%, ${base || '#0a0e20'} 100%)`;
          }
        }
      } catch (err) {
        console.warn('[YouTune Background] Service worker color extraction error:', err);
      }

      // 2. Client-side fallback
      if (!gradient) {
        try {
          const clientColors = await this._clientExtract(thumbnailUrl);
          if (clientColors) {
            gradient = `radial-gradient(circle at 50% 32%, ${clientColors[0]} 0%, ${clientColors[1]} 45%, ${clientColors[2]} 80%, #0a0e20 100%)`;
          }
        } catch (_) {}
      }

      if (!gradient) {
        gradient = DEFAULT_GRADIENT;
      }

      this._crossFade(gradient);
    }

    _crossFade(newGradient) {
      const incoming = this._activeLayer === 'A' ? this._layerB : this._layerA;
      const outgoing = this._activeLayer === 'A' ? this._layerA : this._layerB;

      incoming.style.background = newGradient;
      incoming.classList.add('youtune-bg-active');
      outgoing.classList.remove('youtune-bg-active');

      this._activeLayer = this._activeLayer === 'A' ? 'B' : 'A';
    }

    _clientExtract(url) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let settled = false;

        img.onload = () => {
          if (settled) return;
          settled = true;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 16, 16);
            const data = ctx.getImageData(0, 0, 16, 16).data;

            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
              rSum += data[i];
              gSum += data[i + 1];
              bSum += data[i + 2];
              count++;
            }
            const r = Math.round(rSum / count);
            const g = Math.round(gSum / count);
            const b = Math.round(bSum / count);

            const c1 = `rgba(${Math.min(255, r + 45)}, ${Math.min(255, g + 45)}, ${Math.min(255, b + 65)}, 0.85)`;
            const c2 = `rgba(${Math.min(255, r + 15)}, ${Math.min(255, g + 15)}, ${Math.min(255, b + 35)}, 0.7)`;
            const c3 = `rgba(${Math.round(r * 0.35 + 10)}, ${Math.round(g * 0.35 + 12)}, ${Math.round(b * 0.5 + 20)}, 0.9)`;
            resolve([c1, c2, c3]);
          } catch (e) {
            resolve(null);
          }
        };

        img.onerror = () => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        };

        img.src = url;
        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        }, 1000);
      });
    }

    reset() {
      this._currentUrl = null;
      this._crossFade(DEFAULT_GRADIENT);
    }
  }

  window.YouTune.UI.BackgroundView = BackgroundView;
})();
