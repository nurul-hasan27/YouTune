/**
 * YouTune - Dynamic Atmospheric Background
 * Creates rich, luminous ambient lighting that morphs according to the dominant colors of the thumbnail.
 */
(() => {
  window.YouTune = window.YouTune || {};
  window.YouTune.UI = window.YouTune.UI || {};

  const DEFAULT_GRADIENT = 'radial-gradient(ellipse at 50% 38%, rgb(30, 41, 59) 0%, rgb(10, 14, 23) 100%)';

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

      this.element.appendChild(this._layerA);
      this.element.appendChild(this._layerB);

      return this.element;
    }

    /**
     * Updates the background using the most dominant color of the thumbnail and its darker version.
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
            const { dominant, darker } = response.colors;
            gradient = `radial-gradient(ellipse at 50% 38%, ${dominant} 0%, ${darker} 100%)`;
          }
        }
      } catch (err) {
        console.warn('[YouTune Background] Service worker color extraction error:', err);
      }

      // 2. Client-side fallback
      if (!gradient) {
        try {
          const colors = await this._clientExtract(thumbnailUrl);
          if (colors) {
            gradient = `radial-gradient(ellipse at 50% 38%, ${colors.dominant} 0%, ${colors.darker} 100%)`;
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
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 32, 32);
            const data = ctx.getImageData(0, 0, 32, 32).data;

            const colorBuckets = new Map();
            let sumR = 0, sumG = 0, sumB = 0, total = 0;

            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const a = data[i + 3];

              if (a < 128) continue;
              sumR += r; sumG += g; sumB += b; total++;

              if ((r < 20 && g < 20 && b < 20) || (r > 240 && g > 240 && b > 240)) continue;

              const qr = Math.round(r / 16) * 16;
              const qg = Math.round(g / 16) * 16;
              const qb = Math.round(b / 16) * 16;
              const key = `${qr},${qg},${qb}`;
              colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
            }

            let domR, domG, domB;
            if (colorBuckets.size > 0) {
              let maxCount = 0, bestKey = null;
              for (const [key, count] of colorBuckets.entries()) {
                if (count > maxCount) {
                  maxCount = count;
                  bestKey = key;
                }
              }
              [domR, domG, domB] = bestKey.split(',').map(Number);
            } else if (total > 0) {
              domR = Math.round(sumR / total);
              domG = Math.round(sumG / total);
              domB = Math.round(sumB / total);
            } else {
              domR = 30; domG = 41; domB = 59;
            }

            const cR = domR;
            const cG = domG;
            const cB = domB;

            resolve({
              dominant: `rgb(${cR}, ${cG}, ${cB})`,
              darker: `rgb(${Math.round(cR * 0.2)}, ${Math.round(cG * 0.2)}, ${Math.round(cB * 0.2)})`
            });
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
        }, 1200);
      });
    }

    reset() {
      this._currentUrl = null;
      this._crossFade(DEFAULT_GRADIENT);
    }
  }

  window.YouTune.UI.BackgroundView = BackgroundView;
})();
