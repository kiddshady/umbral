'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — preload
   La única puerta entre el renderer y el sistema. `onyx` es la del framework
   (ventana, ajustes, documentos) y `umbral` la de la app: así se nota qué es
   de cada uno. Regla: exponé funciones, nunca objetos de Electron.
   ═══════════════════════════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Desenvuelve {ok,data|error} y convierte el error en una excepción real. */
const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) throw new Error(res?.error || `Falló ${channel}`);
  return res.data;
};

/** Suscripción que devuelve cómo soltarla. */
const on = (channel, cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('onyx', {
  info: () => call('app:info'),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    /** El renderer le pasa a la ventana su color base ya resuelto (ver app.js). */
    setBackground: (hex) => ipcRenderer.send('win:set-bg', hex),
    onMaximized: (cb) => on('win:maximized', cb),
  },

  settings: {
    get: () => call('settings:get'),
    save: (patch) => call('settings:save', patch),
  },

  doc: {
    read: (name, fallback = null) => call('doc:read', name, fallback),
    write: (name, data) => call('doc:write', name, data),
  },
});

contextBridge.exposeInMainWorld('umbral', {
  listImages: () => ipcRenderer.invoke('images:list'),
  copyImage: (name) => ipcRenderer.invoke('images:copy', name),
  exportImage: (name) => ipcRenderer.invoke('images:export', name),
  deleteImage: (name) => ipcRenderer.invoke('images:delete', name),
  clearAll: () => ipcRenderer.invoke('images:clear'),
  serverInfo: () => ipcRenderer.invoke('server:info'),
  qr: () => ipcRenderer.invoke('server:qr'),
  openInbox: (which) => ipcRenderer.invoke('inbox:open', which),
  onNewImage: (cb) => on('image:new', cb),
  outbox: {
    list: () => ipcRenderer.invoke('outbox:list'),
    // File.path ya no existe desde Electron 32: la ruta real sale de webUtils
    addFiles: (files) => ipcRenderer.invoke('outbox:addPaths', [...files].map((f) => webUtils.getPathForFile(f))),
    paste: () => ipcRenderer.invoke('outbox:paste'),
    remove: (name) => ipcRenderer.invoke('outbox:remove', name),
    clear: () => ipcRenderer.invoke('outbox:clear'),
    copy: (name) => ipcRenderer.invoke('outbox:copy', name),
    export: (name) => ipcRenderer.invoke('outbox:export', name),
    onAdded: (cb) => on('outbox:added', cb),
    onDelivered: (cb) => on('outbox:delivered', cb),
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    open: () => ipcRenderer.invoke('update:open'),
    onState: (cb) => on('update:state', cb),
  },
  ready: () => ipcRenderer.send('renderer:ready'),
});
