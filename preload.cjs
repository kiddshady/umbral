'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — preload
   La única puerta entre el renderer y el sistema. `opal` es la del framework
   (ventana, ajustes, documentos) y `umbral` la de la app: así se nota qué es
   de cada uno. Regla: exponé funciones, nunca objetos de Electron.
   ═══════════════════════════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Desenvuelve {ok,data|error} y convierte el error en una excepción real. */
const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) throw new Error(res?.error || `${channel} failed`);
  return res.data;
};

/** Suscripción que devuelve cómo soltarla. */
const on = (channel, cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('opal', {
  info: () => call('app:info'),
  /** Los archivos de datos ilegibles que se apartaron en esta corrida. */
  asides: () => call('store:asides'),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    /** El renderer le pasa a la ventana su color base ya resuelto (ver app.js). */
    setBackground: (hex) => ipcRenderer.send('win:set-bg', hex),
    onMaximized: (cb) => on('win:maximized', cb),
  },

  /** Leer el portapapeles (el "Pegar" del menú de los campos). */
  clip: {
    read: () => call('clip:read'),
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
  // Lo que llegó del celu: imágenes y, desde la 0.5, cualquier archivo.
  recibidas: {
    list: () => ipcRenderer.invoke('recibidas:list'),
    copy: (name) => ipcRenderer.invoke('recibidas:copy', name),
    open: (name) => ipcRenderer.invoke('recibidas:open', name),
    export: (name) => ipcRenderer.invoke('recibidas:export', name),
    remove: (name) => ipcRenderer.invoke('recibidas:delete', name),
    clear: () => ipcRenderer.invoke('recibidas:clear'),
    onNew: (cb) => on('recibidas:new', cb),
  },
  serverInfo: () => ipcRenderer.invoke('server:info'),
  qr: () => ipcRenderer.invoke('server:qr'),
  pair: {
    start: () => ipcRenderer.invoke('pair:start'),
    cancel: () => ipcRenderer.invoke('pair:cancel'),
    revoke: () => ipcRenderer.invoke('pair:revoke'),
    onDone: (cb) => on('pair:done', cb),
  },
  openInbox: (which) => ipcRenderer.invoke('inbox:open', which),
  outbox: {
    list: () => ipcRenderer.invoke('outbox:list'),
    // File.path ya no existe desde Electron 32: la ruta real sale de webUtils
    addFiles: (files) => ipcRenderer.invoke('outbox:addPaths', [...files].map((f) => webUtils.getPathForFile(f))),
    paste: () => ipcRenderer.invoke('outbox:paste'),
    remove: (name) => ipcRenderer.invoke('outbox:remove', name),
    clear: () => ipcRenderer.invoke('outbox:clear'),
    copy: (name) => ipcRenderer.invoke('outbox:copy', name),
    open: (name) => ipcRenderer.invoke('outbox:open', name),
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
  // El Notepad: vive en notepad.txt (main) y lo cambian también el celu y CC.
  notepad: {
    get: () => ipcRenderer.invoke('notepad:get'),
    set: (text) => ipcRenderer.invoke('notepad:set', text),
    onChanged: (cb) => on('notepad:changed', cb),
    // `Umbral.exe --notepad` (el /notepad del mod): ir a la vista.
    onIr: (cb) => on('ir:notepad', cb),
  },
  // Texto plano al portapapeles, y el aviso de que se la llamó con el atajo.
  copyText: (text) => ipcRenderer.invoke('texto:copy', text),
  onShortcut: (cb) => on('atajo:mostrar', cb),
  ready: () => ipcRenderer.send('renderer:ready'),
});
