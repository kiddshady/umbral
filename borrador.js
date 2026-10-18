'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — el Borrador
   Un texto de paso para copiar y pegar (un comando, un link, unas palabras),
   guardado como un solo `borrador.txt`, nada más sofisticado. Lo editan tres:

     · la PC, desde la pestaña Borrador (IPC);
     · el celu, por el servidor (GET/PUT /borrador, ver server.js);
     · cualquiera que abra el .txt con un editor: se vigila el archivo y lo
       que cambie afuera entra solo.

   Cada versión lleva un `hash` del contenido (no un timestamp: el reloj de
   un sistema de archivos tiene resolución gruesa y dos cambios en el mismo
   segundo empatan). Quien escribe puede mandar la versión de la que partió
   (`base`): si ya no es la actual, alguien cambió el texto en el medio y el
   servidor contesta 409 con lo que hay. Qué hacer con eso lo decide el
   cliente.

   La escritura es atómica como la del store: un `.tmp` de nombre único y
   rename con reintentos (en Windows un antivirus o el editor pueden tener el
   destino tomado un instante).
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// Un millón de caracteres: un borrador no es un documento. Frena a quien
// mande cualquier cosa por el servidor.
const MAX_CHARS = 1_000_000;

const hashOf = (t) => crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 16);

// Lo que viene de un editor de Windows trae CRLF y a veces BOM. Un textarea
// solo conoce \n: sin normalizar, el mismo texto tendría dos versiones.
const norm = (t) => String(t ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renameWithRetry(tmp, file, intentos = 6) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      if (i >= intentos || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      await sleep(30 * 2 ** i);
    }
  }
}

/**
 * @param {string} file  la ruta de borrador.txt
 * @param {object} o
 * @param {(estado: {text, hash}, desde: string) => void} o.onChange  avisa cada cambio con quién lo hizo
 * @param {number} o.delay     cuánto se espera a que deje de escribir antes de ir al disco
 * @param {number} o.interval  cada cuánto se mira el archivo por cambios de afuera (0 = no se mira)
 */
function createBorrador(file, { onChange = () => {}, delay = 400, interval = 1500 } = {}) {
  let text = '';
  let hash = hashOf('');
  let disk = '';        // lo último que se leyó o escribió acá: así se reconoce un cambio ajeno
  let timer = null;
  let writing = Promise.resolve();
  let tmpN = 0;
  let watching = false;

  const get = () => ({ text, hash });

  async function load() {
    try { disk = norm(await fsp.readFile(file, 'utf8')); } catch { disk = ''; }
    text = disk;
    hash = hashOf(text);
    if (interval > 0 && !watching) {
      watching = true;
      fs.watchFile(file, { interval }, onFileChange);
    }
    return get();
  }

  /** Cambia el texto. `base`, si viene, tiene que ser la versión actual. */
  function set(nuevo, { desde = 'pc', base = null } = {}) {
    const t = norm(nuevo);
    if (t.length > MAX_CHARS) return { ok: false, error: 'too-big' };
    if (base != null && base !== hash && t !== text) return { ok: false, error: 'conflict', ...get() };
    if (t !== text) {
      text = t;
      hash = hashOf(t);
      schedule();
      onChange(get(), desde);
    }
    return { ok: true, ...get() };
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  /** Lleva lo pendiente al disco ya. Devuelve cuando terminó. */
  function flush() {
    clearTimeout(timer);
    timer = null;
    const t = text;
    writing = writing.then(async () => {
      if (t === disk) return;
      const tmp = `${file}.${process.pid}.${++tmpN}.tmp`;
      await fsp.writeFile(tmp, t, 'utf8');
      await renameWithRetry(tmp, file);
      disk = t;
    }).catch((err) => console.error('[borrador] no se pudo guardar:', err.message));
    return writing;
  }

  // Alguien lo editó afuera (Notepad++, otro programa). Mientras hay un
  // guardado pendiente no se mira: lo que hay en el disco es viejo y entrarlo
  // pisaría lo que se está escribiendo.
  async function onFileChange(cur, prev) {
    if (timer || cur.mtimeMs === prev.mtimeMs) return;
    await writing;
    if (timer) return;
    let t;
    try { t = norm(await fsp.readFile(file, 'utf8')); } catch { return; }   // borrado o tomado: se queda lo que hay
    if (t === disk) return;
    disk = t;
    if (t === text || t.length > MAX_CHARS) return;
    text = t;
    hash = hashOf(t);
    onChange(get(), 'archivo');
  }

  /** Al salir: deja de mirar y guarda lo pendiente sin esperar a nadie. */
  function close() {
    if (watching) fs.unwatchFile(file, onFileChange);
    watching = false;
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    try { fs.writeFileSync(file, text, 'utf8'); disk = text; } catch { /* sin disco no hay qué hacer */ }
  }

  return { load, get, set, flush, close, file };
}

module.exports = { createBorrador, hashOf, MAX_CHARS };
