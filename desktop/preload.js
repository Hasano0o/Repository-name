// جسر آمن بين واجهة Bandly والبرنامج — يظهر في الواجهة كـ globalThis.bandlyDesktop
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bandlyDesktop', {
  version: '1.0.0',
  fetch: (id, req) => ipcRenderer.invoke('net:fetch', id, req),
  abort: (id) => ipcRenderer.send('net:abort', id),
  secretGet: (k) => ipcRenderer.invoke('secret:get', k),
  secretSet: (k, v) => ipcRenderer.invoke('secret:set', k, v),
  secretDel: (k) => ipcRenderer.invoke('secret:del', k),
  dialog: (title, message, buttons, cancelId) => ipcRenderer.invoke('ui:dialog', title, message, buttons, cancelId),
  openExternal: (url) => ipcRenderer.send('ui:open', url),
});
