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
 * Extracts the most dominant color of the thumbnail and its darker version.
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
    let sumR = 0, sumG = 0, sumB = 0, validPixels = 0;

    for (let i = 0; i < imageData.length; i += 4) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const a = imageData[i + 3];

      if (a < 128) continue; // skip transparent

      sumR += r;
      sumG += g;
      sumB += b;
      validPixels++;

      // Filter extreme edge cases (near-black letterbox bars and blinding pure white)
      if ((r < 20 && g < 20 && b < 20) || (r > 240 && g > 240 && b > 240)) continue;

      // Group into color buckets
      const qr = Math.round(r / 16) * 16;
      const qg = Math.round(g / 16) * 16;
      const qb = Math.round(b / 16) * 16;
      const key = `${qr},${qg},${qb}`;

      colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
    }

    let dominantR, dominantG, dominantB;

    if (colorBuckets.size > 0) {
      // Find the most frequent color bucket
      let maxCount = 0;
      let bestKey = null;
      for (const [key, count] of colorBuckets.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestKey = key;
        }
      }
      [dominantR, dominantG, dominantB] = bestKey.split(',').map(Number);
    } else if (validPixels > 0) {
      dominantR = Math.round(sumR / validPixels);
      dominantG = Math.round(sumG / validPixels);
      dominantB = Math.round(sumB / validPixels);
    } else {
      dominantR = 30;
      dominantG = 41;
      dominantB = 59;
    }

    // Use the exact picked dominant color without dimming
    const domR = dominantR;
    const domG = dominantG;
    const domB = dominantB;

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
