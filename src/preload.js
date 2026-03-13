const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webapper", {
  listApps: () => ipcRenderer.invoke("apps:list"),
  saveApps: (apps) => ipcRenderer.invoke("apps:save", apps),
  launchApp: (app) => ipcRenderer.invoke("apps:launch", app),
  deleteApp: (id) => ipcRenderer.invoke("apps:delete", id),
  fetchFavicon: (url) => ipcRenderer.invoke("app:fetchFavicon", url),
  pickImage: () => ipcRenderer.invoke("dialog:pickImage"),
});

contextBridge.exposeInMainWorld("toolbar", {
  getInfo: (id) => ipcRenderer.invoke("toolbar:getInfo", id),
  getState: (id) => ipcRenderer.invoke("toolbar:getState", id),
  reload: (id) => ipcRenderer.send("toolbar:reload", id),
  back: (id) => ipcRenderer.send("toolbar:back", id),
  forward: (id) => ipcRenderer.send("toolbar:forward", id),
  onState: (cb) => ipcRenderer.on("toolbar:state", (_, d) => cb(d)),
});
