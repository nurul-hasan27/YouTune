/**
 * YouTune - Background Service Worker
 * Manages extension commands, keyboard shortcuts, tab communication, and badge state.
 */

const LOG_PREFIX = '[YouTune ServiceWorker]';

// Set default storage preferences on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`${LOG_PREFIX} Installed reason: ${details.reason}`);
  try {
    const data = await chrome.storage.local.get(['youtune_enabled', 'youtune_options']);
    const defaults = {};
    if (data.youtune_enabled === undefined) {
      defaults.youtune_enabled = false;
    }
    if (!data.youtune_options) {
      defaults.youtune_options = {
        preserveOnNavigation: true,
        dynamicBackground: true,
        keyboardShortcuts: true
      };
    }
    if (Object.keys(defaults).length > 0) {
      await chrome.storage.local.set(defaults);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Error initializing defaults:`, err);
  }
});

// Handle extension keyboard shortcut (e.g. Alt+Shift+Y)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-youtune') {
    console.log(`${LOG_PREFIX} Command received: toggle-youtune`);
    await toggleActiveTab();
  }
});

/**
 * Sends a toggle message to the active YouTube tab.
 */
async function toggleActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url) return;

    if (!tab.url.includes('youtube.com')) {
      console.log(`${LOG_PREFIX} Active tab is not YouTube (${tab.url})`);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_YOUTUNE' });
      console.log(`${LOG_PREFIX} Toggle response from tab:`, response);
    } catch (sendErr) {
      console.warn(`${LOG_PREFIX} Content script not responding, might need reload or page is still loading:`, sendErr.message);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to toggle active tab:`, err);
  }
}

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case 'PING':
      sendResponse({ status: 'PONG' });
      return false;

    case 'TOGGLE_ACTIVE_TAB':
      toggleActiveTab().then(() => sendResponse({ success: true }));
      return true; // async response

    case 'UPDATE_BADGE':
      if (sender.tab && sender.tab.id) {
        const text = message.enabled ? 'ON' : '';
        chrome.action.setBadgeText({ text, tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: sender.tab.id });
      }
      sendResponse({ success: true });
      return false;

    case 'EXTRACT_COLORS':
      extractDominantColors(message.url)
        .then((colors) => sendResponse({ success: true, colors }))
        .catch((err) => {
          console.warn(`${LOG_PREFIX} Color extraction failed:`, err);
          sendResponse({ success: false, colors: null });
        });
      return true; // async response

    default:
      return false;
  }
});

/**
 * Extracts dominant vibrant colors from an image URL using OffscreenCanvas.
 */
async function extractDominantColors(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 32, 32);

    const imageData = ctx.getImageData(0, 0, 32, 32).data;
    const colorBuckets = new Map();

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const a = imageData[i + 3];

      if (a < 128) continue; // skip transparent

      // Calculate saturation and brightness
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 510;
      const d = max - min;
      const s = max === 0 ? 0 : d / max;

      // Filter out pure blacks, pure whites, and muddy greys
      if (l < 0.15 || l > 0.95 || s < 0.12) continue;

      // Quantize to 5-bit color buckets
      const qr = Math.round(r / 20) * 20;
      const qg = Math.round(g / 20) * 20;
      const qb = Math.round(b / 20) * 20;
      const key = `${qr},${qg},${qb}`;

      // Heavily reward saturated and luminous colors
      const score = (colorBuckets.get(key) || 0) + (1 + s * 3.5 + l * 1.5);
      colorBuckets.set(key, score);
    }

    // Sort buckets by score
    const sorted = Array.from(colorBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0].split(',').map(Number));

    if (sorted.length > 0) {
      const primary = sorted[0];
      // Pick a secondary color that is visually distinct from primary
      let secondary = sorted[1] || primary;
      for (let i = 1; i < sorted.length; i++) {
        const c = sorted[i];
        const dist = Math.hypot(c[0] - primary[0], c[1] - primary[1], c[2] - primary[2]);
        if (dist > 50) {
          secondary = c;
          break;
        }
      }

      // Preserve rich, vibrant colors with elevated luminosity so background is not too dark
      const boostR = (val) => Math.min(255, Math.round(val * 1.15 + 15));
      const boostG = (val) => Math.min(255, Math.round(val * 1.15 + 15));
      const boostB = (val) => Math.min(255, Math.round(val * 1.15 + 25));

      const pR = boostR(primary[0]);
      const pG = boostG(primary[1]);
      const pB = boostB(primary[2]);

      const sR = boostR(secondary[0]);
      const sG = boostG(secondary[1]);
      const sB = boostB(secondary[2]);

      const deepR = Math.max(12, Math.round(primary[0] * 0.35 + 8));
      const deepG = Math.max(14, Math.round(primary[1] * 0.35 + 10));
      const deepB = Math.max(26, Math.round(primary[2] * 0.45 + 18));

      return {
        primary: `rgba(${pR}, ${pG}, ${pB}, 0.82)`,
        secondary: `rgba(${sR}, ${sG}, ${sB}, 0.65)`,
        ambient: `rgba(${deepR}, ${deepG}, ${deepB}, 0.92)`,
        base: `rgb(${Math.round(deepR * 0.55)}, ${Math.round(deepG * 0.55)}, ${Math.round(deepB * 0.7)})`
      };
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error processing image bitmap:`, err);
  }

  return null;
}
