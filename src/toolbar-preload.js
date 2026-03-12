const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolbar', {
  // appId will be read from query params in the page's own JS
  back:    (id) => ipcRenderer.send(`toolbar:back:${id}`),
  forward: (id) => ipcRenderer.send(`toolbar:forward:${id}`),
  reload:  (id) => ipcRenderer.send(`toolbar:reload:${id}`),
  home:    (id) => ipcRenderer.send(`toolbar:home:${id}`),
  onUpdate: (cb) => ipcRenderer.on('toolbar:update', (_, data) => cb(data)),
});
