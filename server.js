// Umbral — servidor LAN
// Teléfono → PC
//   POST /drop            → recibe archivos (crudo en el cuerpo, o multipart/form-data)
// PC → teléfono
//   GET  /out             → lista de la bandeja de salida (JSON)
//   GET  /out/thumb/:name → miniatura liviana (o el original si no se puede achicar)
//   GET  /out/file/:name  → el archivo; con ?dl=1 lo marca como entregado
// El Notepad (0.7; hasta la 0.12 se llamó Borrador), el mismo texto en los dos lados
//   GET  /notepad         → { text, hash }
//   PUT  /notepad         → { text, base? } → { hash }; 409 si base ya no es la actual
//   /borrador             → lo mismo, para Umbral Mobile 0.4 y anteriores
// Otros
//   GET  /                → página mobile (enviar / recibir)
//   GET  /favicon.ico     → el ícono de la pestaña
//   GET  /icon            → el ícono maestro (PNG 512)
//   GET  /ping            → health-check; con el nombre del equipo, que la app del celu muestra
//   POST /pair            → {code} de 6 dígitos → la llave de esta PC (ver pairing.js)
//
// Desde la 0.4 todo lo que mueve archivos (/drop y /out*) pide la llave, y el Notepad también:
// Authorization: Bearer <llave>, o ?k=<llave>. Lo demás queda abierto, porque
// el celu tiene que poder encontrar la PC y vincularse antes de tenerla.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 256 MB por pedido: entra un PDF pesado o un video corto del celu. El cuerpo
// se junta en memoria, así que no conviene mucho más.
const MAX_BYTES = 256 * 1024 * 1024;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
// Al revés, para ponerle extensión a un archivo que llega sin nombre. Gana la
// primera de cada tipo (.jpg y no .jpeg).
const EXT_OF_MIME = {};
for (const [ext, mime] of Object.entries(MIME)) EXT_OF_MIME[mime.split(';')[0]] ??= ext;

// --- qué es lo que llega ---------------------------------------------------
// Las imágenes se reconocen por los bytes (magic bytes), no por el nombre:
// entran aunque el celu no mande nombre, y la galería las muestra como foto.
// Hasta la 0.4 eran lo único que entraba; desde la 0.5 entra cualquier
// archivo, con el nombre que trae.

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

// Un nombre que viene de afuera, apto para Windows: sin carpetas, sin los
// caracteres prohibidos, sin punto ni espacio al final (Windows los come) y
// sin los nombres de dispositivo (CON, NUL…), que después no se pueden borrar.
const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
function cleanName(raw) {
  let n = path.basename(String(raw || '').replace(/\\/g, '/'));
  n = n.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').trim();
  if (!n || /^\.+$/.test(n)) return '';
  if (n.length > 120) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, 120 - ext.length) + ext;
  }
  if (RESERVADOS.test(n.split('.')[0])) n = `_${n}`;
  return n;
}

// "informe.pdf" ya existe → "informe (2).pdf". Con `wx` el chequeo y la
// escritura son una sola cosa: dos que llegan juntos no se pisan.
async function writeFree(dir, wanted, data) {
  const ext = path.extname(wanted);
  const base = wanted.slice(0, wanted.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? wanted : `${base} (${i})${ext}`;
    try {
      await fsp.writeFile(path.join(dir, name), data, { flag: 'wx' });
      return name;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('no-name');
}

// `name` es el nombre que trajo: '' si no trajo ninguno, y undefined para un
// campo de formulario sin archivo (un texto, no un adjunto), que solo entra si
// sus bytes son una imagen, como siempre.
async function saveDrop(inboxDir, data, { name, type = '' } = {}) {
  if (!data?.length) return null;
  const ext = sniff(data);
  if (ext) {
    const capName = `cap_${stamp()}_${crypto.randomBytes(2).toString('hex')}.${ext}`;
    await fsp.writeFile(path.join(inboxDir, capName), data);
    return capName;
  }
  if (name === undefined) return null;
  const fallback = `archivo_${stamp()}${EXT_OF_MIME[type.split(';')[0].trim().toLowerCase()] || '.bin'}`;
  return writeFree(inboxDir, cleanName(name) || fallback, data);
}

// El nombre del Content-Disposition de una parte: filename*=UTF-8''… si está
// (RFC 5987), si no filename="…", que los navegadores mandan en UTF-8 crudo.
function partName(headers) {
  const star = /filename\*\s*=\s*utf-8''([^;\r\n]+)/i.exec(headers);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* sigue con el otro */ } }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;\r\n]*))/i.exec(headers);
  return plain ? (plain[1] ?? plain[2] ?? '').trim() : undefined;
}

// --- multipart/form-data mínimo (un boundary, N archivos) ------------------

function parseMultipart(buf, boundary) {
  const parts = [];
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    const chunk = buf.slice(pos + delim.length, next);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = chunk.slice(0, headerEnd).toString('utf8');
      let body = chunk.slice(headerEnd + 4);
      if (body.slice(-2).toString('latin1') === '\r\n') body = body.slice(0, -2); // CRLF de cierre
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || '';
      if (body.length) parts.push({ data: body, name: partName(headers), type });
    }
    pos = next;
  }
  return parts;
}

// --- helpers HTTP ----------------------------------------------------------

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BYTES) { reject(new Error('too-big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// "/out/file/foto%20(2).jpg" → "foto (2).jpg"; basename corta cualquier ../
function nameFrom(pathname, prefix) {
  try { return path.basename(decodeURIComponent(pathname.slice(prefix.length))); } catch { return ''; }
}

// Content-Disposition con nombre UTF-8 (tildes, ñ) + fallback ASCII
function disposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// La llave del pedido: el header, o ?k= para lo que el navegador pide solo (<img src>)
function keyOf(req, url) {
  const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || '');
  return m ? m[1] : url.searchParams.get('k');
}

// Las direcciones de Tailscale de esta PC (100.64.0.0/10): el celu las guarda
// al vincularse y las prueba cuando no encuentra la PC en la red de casa.
function tailnetIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const [a, b] = net.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) out.push(net.address);
    }
  }
  return out;
}

// --- servidor --------------------------------------------------------------

function createUmbralServer({ inboxDir, basePort, onFile, outbox, thumb, onDelivered, pairing, onPaired, notepad }) {
  const pagePath = path.join(__dirname, 'phone.html');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://umbral');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && p === '/') {
        const page = await fsp.readFile(pagePath);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(page);
      }
      if (req.method === 'GET' && p === '/ping') {
        // `paired` le dice al celu si su llave sigue sirviendo; las direcciones
        // de Tailscale solo se las lleva quien ya está vinculado.
        const paired = pairing.check(keyOf(req, url));
        return json(res, 200, { ok: true, app: 'umbral', name: os.hostname(), auth: true, paired,
          ...(paired ? { tailnet: tailnetIps() } : {}) });
      }
      if (req.method === 'POST' && p === '/pair') {
        let body = {};
        try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { /* cuerpo roto: código vacío */ }
        const r = pairing.redeem(body.code);
        if (!r.ok) return json(res, r.error === 'bad-code' ? 403 : 409, r);
        onPaired?.({ device: String(body.device || '').slice(0, 60) });
        return json(res, 200, { ok: true, key: r.key, name: os.hostname(), tailnet: tailnetIps() });
      }
      if (req.method === 'GET' && p === '/favicon.ico') {
        // los navegadores lo buscan acá aunque la página no lo declare
        const ico = await fsp.readFile(path.join(__dirname, 'assets', 'favicon.ico')).catch(() => null);
        if (!ico) return json(res, 404, { ok: false, error: 'no-icon' });
        res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
        return res.end(ico);
      }
      if (req.method === 'GET' && p === '/icon') {
        // el ícono maestro, para bajarlo al teléfono (shortcut personalizado, etc.)
        const png = await fsp.readFile(path.join(__dirname, 'assets', 'icon.png')).catch(() => null);
        if (!png) return json(res, 404, { ok: false, error: 'no-icon' });
        res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': 'inline; filename="umbral.png"' });
        return res.end(png);
      }

      // De acá para abajo, solo con la llave.
      if (!pairing.check(keyOf(req, url))) return json(res, 401, { ok: false, error: 'unauthorized' });

      // ---------------------------------------------------- el Notepad
      // GET → { text, hash }. PUT { text, base? } → { hash }; si `base` ya no
      // es la versión actual, 409 con lo que hay (ver notepad.js). /borrador
      // es el nombre de antes: Umbral Mobile 0.4 todavía lo pide.
      if ((p === '/notepad' || p === '/borrador') && notepad) {
        if (req.method === 'GET') return json(res, 200, { ok: true, ...notepad.get() });
        if (req.method === 'PUT') {
          let body = null;
          try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { /* abajo */ }
          if (typeof body?.text !== 'string') return json(res, 400, { ok: false, error: 'bad-body' });
          const r = notepad.set(body.text, { desde: 'celu', base: typeof body.base === 'string' ? body.base : null });
          if (!r.ok) return json(res, r.error === 'too-big' ? 413 : 409, r);
          return json(res, 200, { ok: true, hash: r.hash });
        }
        return json(res, 405, { ok: false, error: 'method' });
      }

      // ---------------------------------------------------- teléfono → PC
      if (req.method === 'POST' && p === '/drop') {
        const body = await readBody(req);
        const ctype = req.headers['content-type'] || '';
        const saved = [];
        const bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
        if (ctype.includes('multipart/form-data') && bMatch) {
          for (const part of parseMultipart(body, (bMatch[1] || bMatch[2]).trim())) {
            const name = await saveDrop(inboxDir, part.data, part);
            if (name) saved.push(name);
          }
        } else {
          // Crudo en el cuerpo: el nombre viaja en X-Umbral-Name, codificado
          // por las tildes. Sin él, el archivo se llama por la fecha.
          let wanted = '';
          try { wanted = decodeURIComponent(req.headers['x-umbral-name'] || ''); } catch { /* nombre roto: sin nombre */ }
          const name = await saveDrop(inboxDir, body, { name: wanted, type: ctype });
          if (name) saved.push(name);
        }
        if (!saved.length) return json(res, 400, { ok: false, error: 'empty' });
        for (const name of saved) onFile?.(name);
        return json(res, 200, { ok: true, saved });
      }

      // ---------------------------------------------------- PC → teléfono
      if (req.method === 'GET' && p === '/out') {
        const items = (await outbox.list()).map(({ name, size, mtime, image, delivered }) =>
          ({ name, size, mtime, image, delivered }));
        return json(res, 200, { ok: true, items });
      }

      if (req.method === 'GET' && p.startsWith('/out/thumb/')) {
        const name = nameFrom(p, '/out/thumb/');
        const t = name && (await thumb?.(name).catch(() => null));
        if (t) {
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
          return res.end(t);
        }
        // sin miniatura posible (webp, gif...): el original, que el navegador sabe achicar
        return sendFile(req, res, name, { inline: true });
      }

      if (req.method === 'GET' && p.startsWith('/out/file/')) {
        const name = nameFrom(p, '/out/file/');
        const dl = url.searchParams.has('dl');
        return sendFile(req, res, name, {
          inline: !dl,
          onDone: dl ? async () => onDelivered?.(await outbox.markDelivered(name)) : null,
        });
      }

      json(res, 404, { ok: false, error: 'not-found' });
    } catch (err) {
      if (!res.headersSent) json(res, err.message === 'too-big' ? 413 : 500, { ok: false, error: err.message });
      else res.destroy();
    }
  });

  async function sendFile(req, res, name, { inline, onDone }) {
    const file = name && outbox.full(name);
    const st = file && (await fsp.stat(file).catch(() => null));
    if (!st || !st.isFile()) return json(res, 404, { ok: false, error: 'not-found' });
    res.writeHead(200, {
      'content-type': mimeOf(name),
      'content-length': st.size,
      'content-disposition': disposition(inline ? 'inline' : 'attachment', name),
      'cache-control': 'no-store',
    });
    const stream = fs.createReadStream(file);
    stream.pipe(res);
    // 'finish' solo si el último byte salió: una descarga cortada no cuenta como entregada
    if (onDone) res.on('finish', () => { onDone().catch(() => {}); });
    stream.on('error', () => res.destroy());
  }

  // 4747, y si está tomado probamos los siguientes
  return new Promise((resolve, reject) => {
    let port = basePort;
    const tryListen = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < basePort + 10) { port++; tryListen(); }
        else reject(err);
      });
      server.listen(port, '0.0.0.0', () => resolve({ server, port }));
    };
    tryListen();
  });
}

module.exports = { createUmbralServer, tailnetIps, cleanName };
