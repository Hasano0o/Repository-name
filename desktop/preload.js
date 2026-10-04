// جسر آمن بين واجهة Bandly والبرنامج — يظهر في الواجهة كـ globalThis.bandlyDesktop
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bandlyDesktop', {
  version: ipcRenderer.sendSync('app:version'),
  fetch: (id, req) => ipcRenderer.invoke('net:fetch', id, req),
  abort: (id) => ipcRenderer.send('net:abort', id),
  secretGet: (k) => ipcRenderer.invoke('secret:get', k),
  secretSet: (k, v) => ipcRenderer.invoke('secret:set', k, v),
  secretDel: (k) => ipcRenderer.invoke('secret:del', k),
  dialog: (title, message, buttons, cancelId) => ipcRenderer.invoke('ui:dialog', title, message, buttons, cancelId),
  openExternal: (url) => ipcRenderer.send('ui:open', url),
  netDiag: () => ipcRenderer.invoke('net:diag'),
  netRepair: () => ipcRenderer.invoke('net:repair'),
  openWifiSettings: () => ipcRenderer.send('net:wifiSettings'),
  openTech: (code) => ipcRenderer.send('tech:open', code || ''),
  checkUpdate: () => ipcRenderer.send('update:check'),
});
