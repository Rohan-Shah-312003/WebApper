const { contextBridge, ipcRenderer } = require("electron");

// appId is embedded in the toolbar.html URL as a query param by main.js,
// so it is available synchronously here before any async IPC.
const params = new URLSearchParams(location.search);
const APP_ID = params.get("appId") || "";

contextBridge.exposeInMainWorld("toolbar", {
  // Pass appId as argument so the single shared handler can look it up
  getInfo: () => ipcRenderer.invoke("toolbar:getInfo", APP_ID),
  reload: () => ipcRenderer.send(`toolbar:reload:${APP_ID}`),
  back: () => ipcRenderer.send(`toolbar:back:${APP_ID}`),
  forward: () => ipcRenderer.send(`toolbar:forward:${APP_ID}`),
  home: () => ipcRenderer.send(`toolbar:home:${APP_ID}`),
  onUpdate: (cb) => ipcRenderer.on("toolbar:update", (_, data) => cb(data)),
});
