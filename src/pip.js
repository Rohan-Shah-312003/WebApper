/**
 * pip.js
 *
 * Picture-in-Picture helpers injected into web app WebContentsViews.
 * Called via webContents.executeJavaScript() from main.js.
 *
 * Two exported script strings:
 *   PIP_ENTER_SCRIPT  – find the best playing video and enter PiP
 *   PIP_EXIT_SCRIPT   – exit PiP if active
 *   PIP_SETUP_SCRIPT  – install a MutationObserver so videos added later
 *                       also get PiP when the window is already blurred
 */

/**
 * Finds the most "important" playing video on the page:
 *   1. Largest area that is playing and not muted
 *   2. Largest area that is playing (even if muted)
 *   3. Any playing video
 */
const PIP_ENTER_SCRIPT = `
(async () => {
  // Already in PiP — nothing to do
  if (document.pictureInPictureElement) return 'already';

  // Bail if PiP not supported
  if (!document.pictureInPictureEnabled) return 'unsupported';

  const videos = Array.from(document.querySelectorAll('video'));
  const playing = videos.filter(v => !v.paused && !v.ended && v.readyState >= 2);

  if (!playing.length) return 'no-video';

  // Score: prefer audible, then largest
  const score = v => {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    return (v.muted || v.volume === 0 ? 0 : 1e9) + area;
  };

  const best = playing.sort((a, b) => score(b) - score(a))[0];

  try {
    await best.requestPictureInPicture();
    return 'entered';
  } catch (e) {
    return 'error:' + e.message;
  }
})();
`;

/**
 * Exit PiP if the document currently owns a PiP window.
 */
const PIP_EXIT_SCRIPT = `
(async () => {
  if (!document.pictureInPictureElement) return 'none';
  try {
    await document.exitPictureInPicture();
    return 'exited';
  } catch(e) {
    return 'error:' + e.message;
  }
})();
`;

/**
 * Installed once per page load.
 * Stores a flag on window so we know if the host window is focused.
 * When a video starts playing and the window is blurred, auto-enter PiP.
 */
const PIP_SETUP_SCRIPT = `
(() => {
  if (window.__pipSetupDone) return;
  window.__pipSetupDone = true;
  window.__pipWindowFocused = true; // main.js toggles this via executeJavaScript

  async function tryEnterPip(video) {
    if (window.__pipWindowFocused) return;
    if (document.pictureInPictureElement) return;
    if (!document.pictureInPictureEnabled) return;
    if (video.paused || video.ended || video.readyState < 2) return;
    try { await video.requestPictureInPicture(); } catch(_) {}
  }

  // Watch for play events on existing and future videos
  function attachToVideo(video) {
    if (video.__pipAttached) return;
    video.__pipAttached = true;
    video.addEventListener('play', () => tryEnterPip(video));
  }

  document.querySelectorAll('video').forEach(attachToVideo);

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeName === 'VIDEO') attachToVideo(node);
        if (node.querySelectorAll) node.querySelectorAll('video').forEach(attachToVideo);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;

/** Tell the injected script whether the window is focused */
const pipFocusScript = focused => `window.__pipWindowFocused = ${focused};`;

module.exports = {
	PIP_ENTER_SCRIPT,
	PIP_EXIT_SCRIPT,
	PIP_SETUP_SCRIPT,
	pipFocusScript,
};
