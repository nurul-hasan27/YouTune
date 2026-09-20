/**
 * YouTune Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('youtune-toggle');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const shortcutDisplay = document.getElementById('shortcut-display');

  // Detect platform for keyboard shortcut display
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  if (shortcutDisplay) {
    shortcutDisplay.textContent = isMac ? '⌥ + ⇧ + Y' : 'Alt + Shift + Y';
  }

  function setStatus(type, message, enableToggle = false, isChecked = false) {
    statusIndicator.className = 'status-indicator ' + type;
    statusText.textContent = message;
    toggle.disabled = !enableToggle;
    toggle.checked = isChecked;
  }

  // Query active tab
  let activeTab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch (err) {
    setStatus('warning', 'Unable to inspect tab', false);
    return;
  }

  if (!activeTab || !activeTab.url) {
    setStatus('warning', 'No active tab', false);
    return;
  }

  const isYouTube = activeTab.url.includes('youtube.com');
  if (!isYouTube) {
    setStatus('warning', 'Open a YouTube video to use YouTune', false);
    return;
  }

  // Ask content script for current status
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'GET_YOUTUNE_STATUS' });
    if (response) {
      if (response.enabled) {
        setStatus('active', 'Active on YouTube', true, true);
      } else {
        setStatus('ready', response.hasVideo ? 'Ready to activate' : 'Open a video to play', true, false);
      }
    } else {
      setStatus('ready', 'Ready on YouTube', true, false);
    }
  } catch (msgErr) {
    // Content script might not be loaded yet or page is still loading
    const isWatch = activeTab.url.includes('youtube.com/watch');
    if (isWatch) {
      setStatus('ready', 'Ready on YouTube (reload if needed)', true, false);
    } else {
      setStatus('warning', 'Open a YouTube video to use YouTune', false);
    }
  }

  // Handle toggle switch change
  toggle.addEventListener('change', async () => {
    const shouldEnable = toggle.checked;
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        action: 'SET_YOUTUNE_STATE',
        enabled: shouldEnable
      });

      if (response && response.enabled) {
        setStatus('active', 'Active on YouTube', true, true);
      } else {
        setStatus('ready', 'Ready to activate', true, false);
      }
    } catch (err) {
      console.error('Failed to toggle YouTune:', err);
      toggle.checked = !shouldEnable; // revert
      setStatus('warning', 'Could not communicate with player', false);
    }
  });
});
