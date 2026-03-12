// Preload for launched web app windows
// Intentionally minimal — keep the web app experience pristine
// Could be extended to inject custom scripts, ad blocking, etc.

const { ipcRenderer } = require('electron');

// Example: intercept title changes and sync to window
document.addEventListener('DOMContentLoaded', () => {
  // nothing for now
});
