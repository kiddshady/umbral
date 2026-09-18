// Umbral — preload (contextBridge, sin nodeIntegration)

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('umbral', {
  listImages: () => ipcRenderer.invoke('images:list'),
  copyImage: (name) => ipcRenderer.invoke('images:copy', name),
  deleteImage: (name) => ipcRenderer.invoke('images:delete', name),
  clearAll: () => ipcRenderer.invoke('images:clear'),
  serverInfo: () => ipcRenderer.invoke('server:info'),
  qr: () => ipcRenderer.invoke('server:qr'),
  openInbox: (which) => ipcRenderer.invoke('inbox:open', which),
  onNewImage: (cb) => ipcRenderer.on('image:new', (_e, img) => cb(img)),
  outbox: {
    list: () => ipcRenderer.invoke('outbox:list'),
    // File.path ya no existe desde Electron 32: la ruta real sale de webUtils
    addFiles: (files) => ipcRenderer.invoke('outbox:addPaths', [...files].map((f) => webUtils.getPathForFile(f))),
    paste: () => ipcRenderer.invoke('outbox:paste'),
    remove: (name) => ipcRenderer.invoke('outbox:remove', name),
    clear: () => ipcRenderer.invoke('outbox:clear'),
    onAdded: (cb) => ipcRenderer.on('outbox:added', (_e, items, opts) => cb(items, opts)),
    onDelivered: (cb) => ipcRenderer.on('outbox:delivered', (_e, item) => cb(item)),
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    open: () => ipcRenderer.invoke('update:open'),
    onState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  },
  ready: () => ipcRenderer.send('renderer:ready'),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  },
});
