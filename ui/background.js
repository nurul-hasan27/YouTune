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
            try {
              chrome.runtime.sendMessage(
                { action: 'EXTRACT_COLORS', url: thumbnailUrl },
                (res) => {
                  if (chrome.runtime.lastError) {
                    resolve(null);
                  } else {
                    resolve(res);
                  }
                }
              );
            } catch (_) {
              resolve(null);
            }
          });

          if (response && response.success && response.colors) {
            const { dominant, darker } = response.colors;
            gradient = `radial-gradient(ellipse at 50% 35%, ${dominant} 0%, ${darker} 100%)`;
          }
        }
      } catch (err) {
        console.warn('[YouTune Background] Service worker color extraction error:', err);
      }

      // 2. Client-side fallback with Hue-Saturation clustering
      if (!gradient) {
        try {
          const colors = await this._clientExtract(thumbnailUrl);
          if (colors) {
            gradient = `radial-gradient(ellipse at 50% 35%, ${colors.dominant} 0%, ${colors.darker} 100%)`;
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
            canvas.width = 48;
            canvas.height = 48;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 48, 48);
            const imageData = ctx.getImageData(0, 0, 48, 48).data;

            const hueBuckets = Array.from({ length: 24 }, () => ({
              sumR: 0,
              sumG: 0,
              sumB: 0,
              count: 0,
              score: 0
            }));

            let fallbackR = 0, fallbackG = 0, fallbackB = 0, totalValid = 0;

            for (let i = 0; i < imageData.length; i += 4) {
              const r = imageData[i];
              const g = imageData[i + 1];
              const b = imageData[i + 2];
              const a = imageData[i + 3];

              if (a < 128) continue;

              fallbackR += r;
              fallbackG += g;
              fallbackB += b;
              totalValid++;

              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const l = (max + min) / 510;
              const d = max - min;
              const s = max === 0 ? 0 : d / max;

              // Filter out pure black, pure white, and dull desaturated grays/muds
              if (l < 0.12 || l > 0.92 || s < 0.15) continue;

              let h = 0;
              if (max === r) {
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
              } else if (max === g) {
                h = ((b - r) / d + 2) / 6;
              } else {
                h = ((r - g) / d + 4) / 6;
              }
              const deg = (h * 360) % 360;
              const bucketIdx = Math.min(23, Math.floor(deg / 15));

              const bucket = hueBuckets[bucketIdx];
              bucket.sumR += r;
              bucket.sumG += g;
              bucket.sumB += b;
              bucket.count++;
              bucket.score += (1 + s * 4);
            }

            let bestBucket = null;
            let maxScore = 0;
            for (const b of hueBuckets) {
              if (b.score > maxScore) {
                maxScore = b.score;
                bestBucket = b;
              }
            }

            let domR, domG, domB;
            if (bestBucket && bestBucket.count > 0) {
              domR = Math.round(bestBucket.sumR / bestBucket.count);
              domG = Math.round(bestBucket.sumG / bestBucket.count);
              domB = Math.round(bestBucket.sumB / bestBucket.count);
            } else if (totalValid > 0) {
              domR = Math.round(fallbackR / totalValid);
              domG = Math.round(fallbackG / totalValid);
              domB = Math.round(fallbackB / totalValid);
            } else {
              domR = 30;
              domG = 41;
              domB = 59;
            }

            resolve({
              dominant: `rgb(${domR}, ${domG}, ${domB})`,
              darker: `rgb(${Math.round(domR * 0.2)}, ${Math.round(domG * 0.2)}, ${Math.round(domB * 0.2)})`
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

        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}yt_cors=${Date.now()}`;

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
