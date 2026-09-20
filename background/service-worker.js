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
 * Extracts the true dominant color of the thumbnail using Hue-Saturation clustering,
 * and creates a darker version of that same color for the gradient.
 */
async function extractDominantColors(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(48, 48);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 48, 48);

    const imageData = ctx.getImageData(0, 0, 48, 48).data;

    // 24 hue sectors of 15 degrees each (0-360)
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

      if (a < 128) continue; // skip transparent

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
      // This prevents dark letterbox bars, shadows, or gray backgrounds from hijacking the artwork color
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
      // Heavily weight chromatic/saturated pixels so the true theme color wins
      bucket.score += (1 + s * 4);
    }

    // Find the hue sector with the highest chromatic score
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

    // Darker version of the same color (20% intensity)
    const darkR = Math.round(domR * 0.2);
    const darkG = Math.round(domG * 0.2);
    const darkB = Math.round(domB * 0.2);

    return {
      dominant: `rgb(${domR}, ${domG}, ${domB})`,
      darker: `rgb(${darkR}, ${darkG}, ${darkB})`
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error processing image bitmap:`, err);
  }

  return null;
}
