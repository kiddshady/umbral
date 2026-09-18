// Umbral — servidor LAN
// Teléfono → PC
//   POST /drop            → recibe capturas (raw image o multipart/form-data)
// PC → teléfono
//   GET  /out             → lista de la bandeja de salida (JSON)
//   GET  /out/thumb/:name → miniatura liviana (o el original si no se puede achicar)
//   GET  /out/file/:name  → el archivo; con ?dl=1 lo marca como entregado
// Otros
//   GET  /                → página mobile (enviar / recibir)
//   GET  /ping            → health-check

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 64 * 1024 * 1024; // 64 MB por request — de sobra para capturas

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.heic': 'image/heic', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// --- detección por magic bytes: solo entran imágenes de verdad -------------

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

async function saveImage(inboxDir, data) {
  const ext = sniff(data);
  if (!ext) return null;
  const name = `cap_${stamp()}_${crypto.randomBytes(2).toString('hex')}.${ext}`;
  await fsp.writeFile(path.join(inboxDir, name), data);
  return name;
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
      let body = chunk.slice(headerEnd + 4);
      if (body.slice(-2).toString('latin1') === '\r\n') body = body.slice(0, -2); // CRLF de cierre
      if (body.length) parts.push({ data: body });
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

// --- servidor --------------------------------------------------------------

function createUmbralServer({ inboxDir, basePort, onImage, outbox, thumb, onDelivered }) {
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
        return json(res, 200, { ok: true, app: 'umbral' });
      }
      if (req.method === 'GET' && p === '/icon') {
        // el ícono maestro, para bajarlo al teléfono (shortcut personalizado, etc.)
        const png = await fsp.readFile(path.join(__dirname, 'assets', 'icon.png')).catch(() => null);
        if (!png) return json(res, 404, { ok: false, error: 'no-icon' });
        res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': 'inline; filename="umbral.png"' });
        return res.end(png);
      }

      // ---------------------------------------------------- teléfono → PC
      if (req.method === 'POST' && p === '/drop') {
        const body = await readBody(req);
        const ctype = req.headers['content-type'] || '';
        const saved = [];
        const bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
        if (ctype.includes('multipart/form-data') && bMatch) {
          for (const part of parseMultipart(body, (bMatch[1] || bMatch[2]).trim())) {
            const name = await saveImage(inboxDir, part.data);
            if (name) saved.push(name);
          }
        } else {
          const name = await saveImage(inboxDir, body);
          if (name) saved.push(name);
        }
        if (!saved.length) return json(res, 415, { ok: false, error: 'no-image' });
        for (const name of saved) onImage?.(name);
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

module.exports = { createUmbralServer };
