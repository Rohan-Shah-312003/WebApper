// Preload for launched web app windows (siteView).
// Forwards window.open() calls intercepted by the injected override in main.js
// back to the main process via ipcRenderer so it can route them correctly.

// const { ipcRenderer } = require("electron");

// window.addEventListener("DOMContentLoaded", () => {
//   // Listen for the custom event dispatched by the window.open override
//   // injected via executeJavaScript in main.js, and relay it to main process.
//   document.addEventListener("__webapper_open", (e) => {
//     const url = e && e.detail && e.detail.url;
//     if (url) {
//       ipcRenderer.send("__webapper_open", url);
//     }
//   });
// });
