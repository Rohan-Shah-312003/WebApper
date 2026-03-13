const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolbar", {
  getInfo: (id) => ipcRenderer.invoke("toolbar:getInfo", id),
  getState: (id) => ipcRenderer.invoke("toolbar:getState", id),
  reload: (id) => ipcRenderer.send("toolbar:reload", id),
  back: (id) => ipcRenderer.send("toolbar:back", id),
  forward: (id) => ipcRenderer.send("toolbar:forward", id),
  onState: (cb) => ipcRenderer.on("toolbar:state", (_, d) => cb(d)),
});
