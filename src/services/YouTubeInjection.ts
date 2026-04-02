/**
 * JavaScript injected into the YouTube WebView.
 * Monitors subtitle DOM changes and posts messages to React Native.
 *
 * YouTube mobile renders captions inside:
 *   .ytp-caption-segment  (desktop-like layout on mobile web)
 *   .caption-window        (alternative selector)
 *
 * We observe character data and child-list mutations on the
 * entire body, debounce rapid updates, and post only changed text.
 */

export const YOUTUBE_INJECT_JS = `
(function() {
  if (window.__ytRuTranslatorInjected) return;
  window.__ytRuTranslatorInjected = true;

  const DEBOUNCE_MS = 350;
  const SELECTORS = [
    '.ytp-caption-segment',
    '.caption-visual-line',
    '[class*="caption"]',
  ];

  let lastText = '';
  let debounceTimer = null;

  function collectText() {
    for (const sel of SELECTORS) {
      const els = document.querySelectorAll(sel);
      if (els.length) {
        const text = Array.from(els)
          .map(el => el.textContent ? el.textContent.trim() : '')
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }
    }
    return '';
  }

  function onMutation() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = collectText();
      if (text && text !== lastText) {
        lastText = text;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SUBTITLE',
          text: text,
        }));
      } else if (!text && lastText) {
        lastText = '';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SUBTITLE_CLEAR',
        }));
      }
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(onMutation);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also poll every 500ms as a fallback for SPAs that don't trigger mutations
  setInterval(() => {
    const text = collectText();
    if (text !== lastText) {
      lastText = text || '';
      if (text) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SUBTITLE',
          text: text,
        }));
      }
    }
  }, 500);

  // Signal ready
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
})();
true; // required for injectedJavaScript
`;
