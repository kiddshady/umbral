'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — proceso principal
   La puerta entre el teléfono y la UCX: servidor LAN, inbox de capturas,
   bandeja para el celu, tray y auto-update. La ventana es la de Onyx.

   ── La ventana sin un solo frame blanco ────────────────────────────────────
   Hay dos destellos blancos distintos y se arreglan distinto:

   A) Flash de contenido (FOUC). Antes de que el renderer pinte, Chromium
      muestra el fondo por defecto de la ventana. Se mata con `show:false` +
      `backgroundColor` oscuro + `paintWhenInitiallyHidden` + el splash inline
      del index.html.

   B) Flash del compositor (DWM). Cuando el HWND pasa de oculto a visible,
      el compositor de Windows pinta su backdrop POR ENCIMA del swap chain de
      Chromium. Ningún CSS lo alcanza. No se puede evitar: se puede PROVOCAR
      donde nadie lo vea. Por eso la ventana nace en x:-20000, hace su primer
      show() ahí, y recién 200 ms después se mueve a su lugar.

   · -20000  → fuera de cualquier monitor, incluso en setups multi-pantalla.
   · 200 ms  → lo que tarda DWM en asentar la superficie off-screen. Con 120
               el flash vuelve de forma intermitente.
   · Electron ≥ 40 → el frame fantasma de minimizar→restaurar se pinta con el
               `backgroundColor` de la ventana. En la 33 y anteriores es blanco.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, shell, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { createUmbralServer } = require('./server');
const { createOutbox } = require('./outbox');
const updater = require('./updater');

/* Color base de arranque. Tiene que coincidir con --ox-bg de tokens.css (lo
   sincroniza `node tools/retint.mjs` y lo vigila `npm test`). El renderer se
   lo vuelve a mandar ya resuelto apenas carga (win:set-bg). */
const BG = '#0b0a0f';

const BASE_PORT = Number(process.env.UMBRAL_PORT) || 4747;
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/* El humo (test/renderer.test.cjs) arranca este mismo archivo con una carpeta
   temporal: la ventana se queda fuera de pantalla y no hay tray, ni acceso de
   «Enviar a», ni búsqueda de actualizaciones. */
const SMOKE = !!process.env.UMBRAL_SMOKE;

const DEFAULT_W = 1240;
const DEFAULT_H = 820;
const MIN_W = 900;
const MIN_H = 600;

let mainWindow = null;
let tray = null;
let quitting = false; // true solo cuando el usuario sale de verdad (tray → Salir)
let serverInfo = { ip: null, port: null, url: null };

// En desarrollo, userData propio: si no, comparte el lock de instancia única
// con la Umbral instalada y el `npm start` se cierra solo apenas arranca.
if (process.env.UMBRAL_DATA) app.setPath('userData', path.join(process.env.UMBRAL_DATA, 'userdata'));
else if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.devdata'));

// Los ajustes y el estado de la ventana: dev → data/, empaquetada → userData.
const store = require('./src/store.cjs');
const ipc = require('./src/ipc.cjs');

// Inbox y outbox: en desarrollo van junto al proyecto (el sandbox de Claude
// virtualiza las escrituras a AppData en un overlay que Explorer no ve;
// C:\tools pasa directo al disco real). Empaquetada y lanzada por Fran,
// AppData es seguro y sobrevive reinstalaciones.
const dataDir = process.env.UMBRAL_DATA || (app.isPackaged ? app.getPath('userData') : __dirname);
const inboxDir = path.join(dataDir, 'inbox');
const outbox = createOutbox(path.join(dataDir, 'outbox'));

// Archivos que llegan por línea de comandos ("Enviar a → Umbral") antes de
// que el renderer esté listo para recibirlos.
let pendingArgs = [];
let rendererReady = false;

// Instancia única: reabrir el exe trae la ventana existente en vez de duplicar.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showMain();
    queueArgFiles(argv.slice(1));
  });
}

// ---------------------------------------------------------------------------
// Bandeja de salida (PC → teléfono)
// ---------------------------------------------------------------------------

const outMeta = (m) => m && { ...m, url: pathToFileURL(m.path).href + '?v=' + m.mtime };

// Solo los argumentos que son archivos de verdad: descarta flags, el exe y,
// en desarrollo, el "." que recibe electron.
function argFiles(args) {
  return args.filter((a) => {
    if (!a || a.startsWith('-')) return false;
    try { return fs.statSync(a).isFile(); } catch { return false; }
  });
}

async function addToOutbox(paths, { focus = false, emit = true } = {}) {
  const added = [];
  for (const p of paths) {
    const m = await outbox.addPath(p).catch(() => null);
    if (m) added.push(outMeta(m));
  }
  if (emit && added.length) sendWin('outbox:added', added, { focus });
  return added;
}

function queueArgFiles(args) {
  const files = argFiles(args);
  if (!files.length) return;
  if (rendererReady) addToOutbox(files, { focus: true });
  else pendingArgs.push(...files);
}

// Miniaturas para el celu: una foto de 12 MP pesa 4 MB y la grilla muestra
// decenas. nativeImage entiende PNG/JPEG/BMP; lo demás se sirve original.
const thumbCache = new Map(); // `${name}|${mtime}` → Buffer
async function makeThumb(name) {
  if (!outbox.isImage(name)) return null;
  const m = await outbox.meta(name);
  const key = `${name}|${m.mtime}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const img = nativeImage.createFromPath(m.path);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const side = 360;
  const scaled = width <= side && height <= side ? img
    : width < height ? img.resize({ width: side, quality: 'good' })
    : img.resize({ height: side, quality: 'good' });
  const buf = scaled.toJPEG(80);
  if (thumbCache.size > 300) thumbCache.clear();
  thumbCache.set(key, buf);
  return buf;
}

// "Enviar a → Umbral (al celu)" en el menú contextual del Explorador.
// Se reescribe en cada arranque: si la app se reinstala en otra carpeta,
// el acceso sigue apuntando bien. Solo empaquetada (en dev apuntaría a electron.exe).
function ensureSendToShortcut() {
  if (!app.isPackaged) return;
  // la portable corre desde una copia temporal; el exe real viene en esta variable
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'Umbral (al celu).lnk');
  try {
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
      target: exe,
      icon: exe,
      iconIndex: 0,
      description: 'Deja el archivo en Umbral para bajarlo desde el teléfono',
    });
  } catch (err) {
    console.log('[umbral] no se pudo crear el acceso de Enviar a:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Red
// ---------------------------------------------------------------------------

function lanIp() {
  const nets = os.networkInterfaces();
  let candidate = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('192.168.')) return net.address; // la casa
      candidate ??= net.address;
    }
  }
  return candidate || '127.0.0.1';
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

async function imageMeta(name) {
  const full = path.join(inboxDir, name);
  const st = await fsp.stat(full);
  return { name, url: pathToFileURL(full).href, size: st.size, mtime: st.mtimeMs };
}

async function listImages() {
  const files = await fsp.readdir(inboxDir).catch(() => []);
  const metas = [];
  for (const f of files) {
    if (!IMG_EXTS.has(path.extname(f).toLowerCase())) continue;
    metas.push(await imageMeta(f).catch(() => null));
  }
  return metas.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

/* ── Estado de la ventana ────────────────────────────────────────────────────
   Recordar tamaño y posición entre sesiones. La trampa: si el monitor donde
   estaba ya no existe, la posición guardada deja la ventana en la nada. Por
   eso se valida contra las pantallas actuales antes de usarla. */
const winState = store.doc('window', null);

function visibleOn(x, y, w, h) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    // Con que se vea una esquina razonable alcanza para poder agarrarla.
    return x + w > a.x + 40 && x < a.x + a.width - 40
        && y + h > a.y && y < a.y + a.height - 40;
  });
}

// A mano, porque la ventana nace con x/y explícitos (off-screen) y eso
// desactiva el auto-centrado de Electron.
function centered(w, h) {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2) };
}

async function loadWindowState() {
  const s = await winState.read().catch(() => null);
  const w = Math.max(MIN_W, Number(s?.width) || DEFAULT_W);
  const h = Math.max(MIN_H, Number(s?.height) || DEFAULT_H);
  const hasPos = Number.isFinite(s?.x) && Number.isFinite(s?.y) && visibleOn(s.x, s.y, w, h);
  return { width: w, height: h, maximized: !!s?.maximized, ...(hasPos ? { x: s.x, y: s.y } : centered(w, h)) };
}

let saveTimer = null;
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || SMOKE) return;
  clearTimeout(saveTimer);
  // Debounce: arrastrar una ventana emite decenas de eventos por segundo.
  saveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    // El bounds NORMAL: con el maximizado, al desmaximizar la próxima vez la
    // ventana quedaría del tamaño de la pantalla y sin poder volver.
    const b = mainWindow.getNormalBounds();
    winState.write({ x: b.x, y: b.y, width: b.width, height: b.height, maximized })
      .catch((err) => console.error('[window] no se pudo guardar el estado:', err.message));
  }, 400);
}

function createWindow(state) {
  mainWindow = new BrowserWindow({
    // Nace fuera de pantalla: el flash del compositor ocurre donde nadie lo ve.
    x: -20000,
    y: -20000,
    width: state.width,
    height: state.height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    paintWhenInitiallyHidden: true,
    backgroundColor: BG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    // El flash DWM ocurre acá — off-screen, invisible.
    mainWindow.show();
    if (SMOKE) return;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setPosition(state.x, state.y);
      if (state.maximized) mainWindow.maximize();
    }, 200);
  });

  // En dev, la consola del renderer sale por la terminal: si un módulo no
  // carga o una vista revienta, se ve acá sin abrir devtools.
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') {
        console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
      }
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[renderer] no cargó (${code} ${desc}) → ${url}`);
    });
  }

  mainWindow.on('maximize', () => { sendWin('win:maximized', true); saveWindowState(); });
  mainWindow.on('unmaximize', () => { sendWin('win:maximized', false); saveWindowState(); });
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Nada de navegación fuera de la app; los links externos van al navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Cerrar no cierra: esconde al tray y el servidor sigue recibiendo capturas.
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendWin(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// El ítem de actualización cambia con el estado: Umbral pasa días escondida
// en el tray y ese menú es lo único que se ve de ella.
function updateMenuItem() {
  const u = updater.get();
  if (u.phase === 'ready') return { label: `Reiniciar para actualizar a ${u.version}`, click: () => updater.install(() => { quitting = true; }) };
  if (u.phase === 'available') return { label: `Descargar la ${u.version}`, click: () => { showMain(); updater.download(); } };
  if (u.phase === 'downloading') return { label: `Descargando la ${u.version}... ${Math.round(u.pct * 100)}%`, enabled: false };
  return { label: 'Buscar actualizaciones', enabled: u.phase !== 'checking', click: () => { showMain(); updater.check({ manual: true }); } };
}

let lastMenuKey = '';
function refreshTrayMenu() {
  if (!tray) return;
  const item = updateMenuItem();
  if (item.label === lastMenuKey) return; // el progreso llega muchas veces por segundo
  lastMenuKey = item.label;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar Umbral', click: showMain },
    item,
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  tray.setToolTip(updater.get().phase === 'ready' ? 'Umbral — actualización lista' : 'Umbral');
}

function createTray() {
  const trayIco = path.join(__dirname, 'assets', 'tray.ico');
  if (!fs.existsSync(trayIco)) return; // primer arranque sin `npm run icons`
  tray = new Tray(trayIco);
  refreshTrayMenu();
  tray.on('click', showMain);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const safeJoin = (name) => path.join(inboxDir, path.basename(name));

function copyImageFile(src) {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) return { ok: false };
  clipboard.writeImage(img);
  return { ok: true };
}

// Exportar = "Guardar como": una copia donde Fran elija. La carpeta se
// recuerda mientras la app esté abierta, así exportar varias seguidas no
// obliga a navegar cada vez.
let lastExportDir = null;
async function exportFile(src) {
  const name = path.basename(src);
  const ext = path.extname(name).slice(1);
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar',
    defaultPath: path.join(lastExportDir || app.getPath('downloads'), name),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Todos los archivos', extensions: ['*'] }] : [],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    await fsp.copyFile(src, res.filePath);
  } catch {
    return { ok: false };
  }
  lastExportDir = path.dirname(res.filePath);
  return { ok: true, name: path.basename(res.filePath) };
}

ipcMain.handle('images:list', () => listImages());

ipcMain.handle('images:copy', (_e, name) => copyImageFile(safeJoin(name)));

ipcMain.handle('images:export', (_e, name) => exportFile(safeJoin(name)));

ipcMain.handle('images:delete', async (_e, name) => {
  await fsp.rm(safeJoin(name), { force: true });
  return { ok: true };
});

ipcMain.handle('images:clear', async () => {
  const files = await fsp.readdir(inboxDir).catch(() => []);
  await Promise.all(
    files
      .filter((f) => IMG_EXTS.has(path.extname(f).toLowerCase()))
      .map((f) => fsp.rm(path.join(inboxDir, f), { force: true }))
  );
  return { ok: true };
});

ipcMain.handle('server:info', () => serverInfo);

ipcMain.handle('server:qr', () =>
  QRCode.toDataURL(serverInfo.url, {
    margin: 1,
    width: 220,
    color: { dark: '#16131f', light: '#f2f0fa' }, // clásico oscuro-sobre-claro: escanea siempre
  })
);

ipcMain.handle('inbox:open', (_e, which) => {
  // explorer.exe directo: shell.openPath falla silencioso en algunos contextos
  const dir = which === 'outbox' ? path.join(dataDir, 'outbox') : inboxDir;
  spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
});

ipcMain.handle('outbox:list', async () => (await outbox.list()).map(outMeta));
ipcMain.handle('outbox:addPaths', (_e, paths) => addToOutbox(argFiles(paths || []), { emit: false }));
ipcMain.handle('outbox:remove', (_e, name) => outbox.remove(name));
ipcMain.handle('outbox:clear', () => outbox.clear());

ipcMain.handle('outbox:copy', (_e, name) => copyImageFile(outbox.full(name)));

ipcMain.handle('outbox:export', (_e, name) => exportFile(outbox.full(name)));

// Archivos copiados (Ctrl+C en el Explorador, o ShareX, que deja el archivo
// y no la imagen). Electron no lee CF_HDROP: FileNameW es instantáneo pero
// trae solo el primero, así que la lista completa sale de Get-Clipboard.
function clipboardFiles() {
  let first = '';
  try { first = clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0.*$/s, ''); } catch {}
  if (!first) return Promise.resolve([]);
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object FullName'],
      { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => resolve([first]));
    ps.on('close', () => {
      const list = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      resolve(list.length ? list : [first]);
    });
  });
}

// Ctrl+V en "Para el celu": archivos copiados, o si no, la imagen del
// portapapeles (un recorte con Win+Shift+S, etc.)
ipcMain.handle('outbox:paste', async () => {
  const files = argFiles(await clipboardFiles());
  if (files.length) {
    const items = await addToOutbox(files, { emit: false });
    if (items.length) return { ok: true, items };
  }
  const img = clipboard.readImage();
  if (img.isEmpty()) return { ok: false };
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `recorte_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
  const m = await outbox.addBuffer(img.toPNG(), name);
  return { ok: true, items: [outMeta(m)] };
});

ipcMain.on('renderer:ready', () => {
  rendererReady = true;
  if (pendingArgs.length) {
    const files = pendingArgs;
    pendingArgs = [];
    addToOutbox(files, { focus: true });
  }
});

ipcMain.handle('update:state', () => updater.get());
ipcMain.handle('update:check', () => updater.check({ manual: true }));
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', () => updater.install(() => { quitting = true; }));
ipcMain.handle('update:open', () => shell.openExternal(updater.get().url));

/* La titlebar es nuestra (frame:false): minimizar, maximizar y cerrar los
   cablea la app. Cerrar esconde al tray (ver 'close' en createWindow). */
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// El renderer manda su --ox-bg ya resuelto a hex: el frame fantasma del
// restore sigue camuflado aunque cambie el matiz en tokens.css.
ipcMain.on('win:set-bg', (_e, hex) => {
  if (mainWindow && !mainWindow.isDestroyed() && /^#[0-9a-f]{6}$/i.test(String(hex))) {
    mainWindow.setBackgroundColor(hex);
  }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  ipc.register();
  await fsp.mkdir(inboxDir, { recursive: true });
  await outbox.load();
  // En el humo, argv trae el archivo del test: no es un «Enviar a».
  if (!SMOKE) pendingArgs.push(...argFiles(process.argv.slice(1)));

  // Servidor primero: cuando el renderer pida server:info, ya está la dirección.
  const { port } = await createUmbralServer({
    inboxDir,
    basePort: BASE_PORT,
    onImage: async (name) => {
      const meta = await imageMeta(name).catch(() => null);
      if (meta) sendWin('image:new', meta);
    },
    outbox,
    thumb: makeThumb,
    onDelivered: (m) => sendWin('outbox:delivered', outMeta(m)),
  });
  const ip = lanIp();
  serverInfo = { ip, port, url: `http://${ip}:${port}` };
  console.log(`[umbral] escuchando en ${serverInfo.url} — inbox: ${inboxDir}`);

  createWindow(await loadWindowState());
  if (SMOKE) return;
  updater.init({ getWin: () => mainWindow, onChange: refreshTrayMenu });
  createTray();
  ensureSendToShortcut();
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
