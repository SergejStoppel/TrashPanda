const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('raccoon', {
  openPanel: () => ipcRenderer.send('companion:open-panel'),
  hideCompanion: () => ipcRenderer.send('companion:hide'),
  showContextMenu: () => ipcRenderer.send('companion:context-menu'),
  startDrag: (point) => ipcRenderer.send('companion:drag-start', point),
  dragMove: (point) => ipcRenderer.send('companion:drag-move', point),
  endDrag: () => ipcRenderer.send('companion:drag-end'),
  dragHang: (anchor) => ipcRenderer.send('companion:drag-hang', anchor),
  getScan: () => ipcRenderer.invoke('panel:get-scan'),
  scanNow: () => ipcRenderer.invoke('panel:scan-now'),
  analyzeFolder: () => ipcRenderer.invoke('panel:analyze-folder'),
  getAnimations: () => ipcRenderer.invoke('companion:get-animations'),
  sortFiles: (payload) => ipcRenderer.invoke('panel:sort-files', payload),
  chooseFolder: () => ipcRenderer.invoke('panel:choose-folder'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setPaused: (paused) => ipcRenderer.invoke('settings:set-paused', paused),
  onCompanionUpdate: (callback) => subscribe('companion:update', callback),
  onAnimations: (callback) => subscribe('companion:animations', callback),
  onCursor: (callback) => subscribe('companion:cursor', callback),
  onScanResult: (callback) => subscribe('panel:scan-result', callback),
  onSortResult: (callback) => subscribe('panel:sort-result', callback),
  onSettings: (callback) => subscribe('settings:update', callback)
});
