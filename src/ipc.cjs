'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — puente IPC (de Opal)
   El renderer no tiene fs, ni require, ni red: `contextIsolation` está activo.
   Todo lo que necesite del sistema pasa por acá, y acá se decide qué se puede
   pedir. Es la superficie de ataque de la app: todo lo que agregues es una
   puerta más.

   Convención: cada handler devuelve {ok:true, data} o {ok:false, error}. El
   preload la desenvuelve y convierte el error en una excepción real, así el
   renderer escribe try/catch normal en vez de chequear banderas.
   ═══════════════════════════════════════════════════════════════════════════ */

const { ipcMain, app, clipboard } = require('electron');
const path = require('path');
const store = require('./store.cjs');

/* Las colecciones que el renderer puede tocar. Es una lista blanca a
   propósito: sin ella, cualquier bug en el renderer puede crear carpetas
   sueltas en tu directorio de datos. Agregá las tuyas acá. */
const COLLECTIONS = [];   // Umbral no guarda colecciones: sus datos son las carpetas inbox/ y outbox/

function coll(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`collection not allowed: ${name}`);
  return store.collection(name);
}

/** Envuelve un handler para que un throw viaje como error y no como crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function register() {
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataDir: store.ROOT,
    electron: process.versions.electron,
  }));
  // Los archivos de datos que se apartaron por ilegibles: la app lo avisa.
  handle('store:asides', () => store.asides().map((a) => ({ file: path.basename(a.file), dead: a.dead })));

  /* El texto del portapapeles, para el "Pegar" del menú de los campos. Desde
     la página, leerlo pide un permiso; acá no. Con tope: un portapapeles
     gigante no tiene por qué cruzar entero. Desde Electron 44 el
     portapapeles del proceso principal es asíncrono, como el de la web. */
  handle('clip:read', async () => (await clipboard.readText()).slice(0, 100000));

  handle('settings:get', () => store.loadSettings());
  handle('settings:save', (patch) => store.saveSettings(patch));

  handle('doc:read', (name, fallback = null) => store.doc(name, fallback).read());
  handle('doc:write', (name, data) => store.doc(name).write(data).then(() => true));

  handle('col:list', (name) => coll(name).list());
  handle('col:get', (name, id) => coll(name).get(id));
  handle('col:save', (name, item) => coll(name).save(item));
  handle('col:remove', (name, id) => coll(name).remove(id).then(() => true));
  handle('col:next-id', (name, prefix) => coll(name).nextId(prefix));
}

module.exports = { register, COLLECTIONS };
