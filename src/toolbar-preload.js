const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolbar", {
  // Called once on load — returns the full app info object
  getInfo: () => ipcRenderer.invoke("toolbar:getInfo"),
  reload: (id) => ipcRenderer.send(`toolbar:reload:${id}`),
  onUpdate: (cb) => ipcRenderer.on("toolbar:update", (_, data) => cb(data)),
});
