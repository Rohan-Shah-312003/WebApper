const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webapper', {
  listApps: () => ipcRenderer.invoke('apps:list'),
  saveApps: (apps) => ipcRenderer.invoke('apps:save', apps),
  launchApp: (app) => ipcRenderer.invoke('apps:launch', app),
  deleteApp: (id) => ipcRenderer.invoke('apps:delete', id),
  fetchFavicon: (url) => ipcRenderer.invoke('app:fetchFavicon', url),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
});
