// Umbral — bandeja de salida (PC → teléfono)
// Los archivos se COPIAN a outboxDir (el original puede moverse o borrarse sin
// romper nada). El estado "entregado" vive en outbox.json al lado de la carpeta.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function createOutbox(outboxDir) {
  const stateFile = outboxDir + '.json';
  let state = {}; // name → { delivered: ms | null }

  async function load() {
    await fsp.mkdir(outboxDir, { recursive: true });
    try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')) || {}; } catch { state = {}; }
  }

  // Temporal de nombre único + rename con reintentos: dos escrituras seguidas
  // con un .tmp fijo se pisan y una se pierde.
  async function save() {
    const tmp = `${stateFile}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state));
    for (let i = 0; ; i++) {
      try { await fsp.rename(tmp, stateFile); return; } catch (err) {
        if (i >= 5) { await fsp.rm(tmp, { force: true }); throw err; }
        await new Promise((r) => setTimeout(r, 40 * (i + 1)));
      }
    }
  }

  const full = (name) => path.join(outboxDir, path.basename(name));
  const isImage = (name) => IMG_EXTS.has(path.extname(name).toLowerCase());

  async function meta(name) {
    const st = await fsp.stat(full(name));
    return {
      name,
      path: full(name),
      size: st.size,
      mtime: st.mtimeMs,
      image: isImage(name),
      delivered: state[name]?.delivered ?? null,
    };
  }

  async function list() {
    const files = await fsp.readdir(outboxDir).catch(() => []);
    const metas = [];
    for (const f of files) {
      const m = await meta(f).catch(() => null);
      if (m && (await fsp.stat(m.path)).isFile()) metas.push(m);
    }
    return metas.sort((a, b) => b.mtime - a.mtime);
  }

  // "foto.jpg" ya existe → "foto (2).jpg"
  async function freeName(wanted) {
    const ext = path.extname(wanted);
    const stem = path.basename(wanted, ext) || 'archivo';
    for (let i = 1; ; i++) {
      const name = i === 1 ? stem + ext : `${stem} (${i})${ext}`;
      try { await fsp.access(full(name)); } catch { return name; }
    }
  }

  async function touch(name) {
    // mtime = momento en que entró a la bandeja, no la fecha del original
    const now = new Date();
    await fsp.utimes(full(name), now, now);
    state[name] = { delivered: null };
    await save();
    return meta(name);
  }

  async function addPath(src) {
    const st = await fsp.stat(src).catch(() => null);
    if (!st || !st.isFile()) return null;
    const name = await freeName(path.basename(src));
    await fsp.copyFile(src, full(name));
    return touch(name);
  }

  async function addBuffer(data, wantedName) {
    const name = await freeName(wantedName);
    await fsp.writeFile(full(name), data);
    return touch(name);
  }

  async function remove(name) {
    name = path.basename(name);
    await fsp.rm(full(name), { force: true });
    delete state[name];
    await save();
  }

  async function clear() {
    const files = await fsp.readdir(outboxDir).catch(() => []);
    await Promise.all(files.map((f) => fsp.rm(full(f), { force: true })));
    state = {};
    await save();
  }

  async function markDelivered(name) {
    name = path.basename(name);
    if (!state[name]) state[name] = {};
    state[name].delivered = Date.now();
    await save();
    return meta(name);
  }

  return { load, list, meta, addPath, addBuffer, remove, clear, markDelivered, full, isImage };
}

module.exports = { createOutbox };
