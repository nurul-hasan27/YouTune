/**
 * YouTune - Content Script Bootstrap
 * Idempotent initializer and Chrome message dispatcher.
 */
(() => {
  window.YouTune = window.YouTune || {};

  if (window.YouTune.__bootstrapped) {
    console.log('[YouTune] Already bootstrapped, skipping.');
    return;
  }
  window.YouTune.__bootstrapped = true;

  const core = window.YouTune.core;

  // Initialize core when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => core.initialize(), { once: true });
  } else {
    core.initialize();
  }

  // Handle runtime messages from Popup and Background Service Worker
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.action) return false;

      switch (message.action) {
        case 'GET_YOUTUNE_STATUS': {
          const state = core.state.getState();
          const videoId = core.adapter.getCurrentVideoId();
          const videoEl = core.adapter.getVideoElement();
          sendResponse({
            enabled: state.enabled,
            hasVideo: !!videoId || !!videoEl,
            videoId: videoId,
            title: state.title,
            playbackState: state.playbackState
          });
          return false;
        }

        case 'TOGGLE_YOUTUNE': {
          core.toggle();
          sendResponse({
            success: true,
            enabled: core.state.get('enabled')
          });
          return false;
        }

        case 'SET_YOUTUNE_STATE': {
          if (message.enabled) {
            core.enable();
          } else {
            core.disable();
          }
          sendResponse({
            success: true,
            enabled: core.state.get('enabled')
          });
          return false;
        }

        default:
          return false;
      }
    });
  }
})();
