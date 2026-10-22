'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — proceso principal
   La puerta entre el teléfono y la UCX: servidor LAN, lo que llega del celu,
   bandeja para el celu, el Notepad, tray y auto-update. La ventana es la de
   Opal (desde la 0.13; hasta la 0.12 fue la de Onyx).

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
   · Electron 44 → el `clipboard` del main es el de la web: async, sin
               writeImage/readImage/readBuffer. Imágenes con ClipboardItem.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow, screen, ipcMain, Tray, Menu, shell, clipboard, ClipboardItem, nativeImage, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const QRCode = require('qrcode');
const { createUmbralServer } = require('./server');
const { createOutbox } = require('./outbox');
const { createPairing } = require('./pairing');
const { createNotepad, migrate: migrateNotepad } = require('./notepad');
const updater = require('./updater');

/* Color base de arranque. Tiene que coincidir con --op-bg de tokens.css (lo
   sincroniza `node tools/retint.mjs` y lo vigila `npm test`). El renderer se
   lo vuelve a mandar ya resuelto apenas carga (win:set-bg). */
const BG = '#0a0a0a';

const BASE_PORT = Number(process.env.UMBRAL_PORT) || 4747;

// El atajo global: trae Umbral desde cualquier lado, y si ya está al frente la esconde.
const HOTKEY = 'Control+Shift+U';
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/* El humo (test/renderer.test.cjs) arranca este mismo archivo con una carpeta
   temporal: la ventana se queda fuera de pantalla y no hay tray, ni acceso de
   «Enviar a», ni búsqueda de actualizaciones. */
const SMOKE = !!process.env.UMBRAL_SMOKE;

// Desde la 1.0 abre del tamaño mínimo, que es como la usa Fran.
const DEFAULT_W = 900;
const DEFAULT_H = 600;
const MIN_W = 900;
const MIN_H = 600;

let mainWindow = null;
let tray = null;
let quitting = false; // true solo cuando el usuario sale de verdad (tray → Salir)
let serverInfo = { ip: null, port: null, url: null };
let pairing = null;   // la llave del servidor y el código de vinculación (pairing.js)

/* Al iniciar sesión, Windows la abre con --oculta: el servidor arranca y la
   ventana espera en el tray hasta que Fran la llame. */
const START_HIDDEN = process.argv.includes('--oculta');

// En desarrollo, userData propio: si no, comparte el lock de instancia única
// con la Umbral instalada y el `npm start` se cierra solo apenas arranca.
if (process.env.UMBRAL_DATA) app.setPath('userData', path.join(process.env.UMBRAL_DATA, 'userdata'));
else if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.devdata'));

// Los ajustes y el estado de la ventana: dev → data/, empaquetada → userData.
const store = require('./src/store.cjs');
const ipc = require('./src/ipc.cjs');
const { keepAlive } = require('./src/recover.cjs');

// Inbox y outbox: en desarrollo van junto al proyecto (el sandbox de Claude
// virtualiza las escrituras a AppData en un overlay que Explorer no ve;
// C:\tools pasa directo al disco real). Empaquetada y lanzada por Fran,
// AppData es seguro y sobrevive reinstalaciones.
const dataDir = process.env.UMBRAL_DATA || (app.isPackaged ? app.getPath('userData') : __dirname);
const inboxDir = path.join(dataDir, 'inbox');
const outbox = createOutbox(path.join(dataDir, 'outbox'));

// El Notepad: un notepad.txt junto al inbox (hasta la 0.12, borrador.txt; se
// renombra al arrancar). Lo que cambia el celu, CC o un editor de afuera se le
// avisa al renderer; lo que escribe la PC ya lo tiene. Nace en el arranque,
// después de la migración.
let notepad = null;

/* Las notas del mod viejo de la terminal (S:\tools\Notepad\notas.md) pasan una
   sola vez al final del Notepad: desde la 0.13 el Notepad de Fran y CC es
   este. Solo la instalada, que es la que usa Fran; el ajuste lo recuerda. */
const NOTAS_VIEJAS = 'S:\\tools\\Notepad\\notas.md';
async function traerNotasViejas() {
  if (!app.isPackaged || SMOKE) return;
  const settings = await store.loadSettings().catch(() => ({}));
  if (settings.notasMigradas) return;
  const viejas = (await fsp.readFile(NOTAS_VIEJAS, 'utf8').catch(() => '')).replace(/\r\n?/g, '\n').trim();
  if (viejas) {
    const { text } = notepad.get();
    if (!text.includes(viejas)) notepad.set(text.trim() ? `${text.replace(/\n+$/, '')}\n\n${viejas}` : viejas, { desde: 'archivo' });
    await notepad.flush();
  }
  await store.updateSettings((s) => ({ ...s, notasMigradas: true })).catch(() => {});
}

/* `Umbral.exe --notepad` (lo que corre /notepad, el comando del mod) abre la
   ventana en el Notepad. Si llega antes de que el renderer esté listo, espera. */
let pendingNotepad = process.argv.includes('--notepad');
function irAlNotepad() {
  if (rendererReady) sendWin('ir:notepad');
  else pendingNotepad = true;
}

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
    if (argv.includes('--notepad')) irAlNotepad();
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

// "Enviar a → Umbral" en el menú contextual del Explorador.
// Se reescribe en cada arranque: si la app se reinstala en otra carpeta,
// el acceso sigue apuntando bien. Solo empaquetada (en dev apuntaría a electron.exe).
function ensureSendToShortcut() {
  if (!app.isPackaged) return;
  // la portable corre desde una copia temporal; el exe real viene en esta variable
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const sendTo = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo');
  const lnk = path.join(sendTo, 'Umbral.lnk');
  // Hasta la 0.13 el acceso se llamaba «Umbral (al celu)»: no queda duplicado.
  try {
    fs.rmSync(path.join(sendTo, 'Umbral (al celu).lnk'), { force: true });
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
      target: exe,
      icon: exe,
      iconIndex: 0,
      description: 'Sends the file to Umbral so your phone can download it',
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

// Desde la 0.5 del celu llega cualquier archivo, no solo imágenes: `image`
// dice si la galería lo muestra como foto o como ficha.
async function inboxMeta(name) {
  const full = path.join(inboxDir, name);
  const st = await fsp.stat(full);
  if (!st.isFile()) return null;
  return { name, url: pathToFileURL(full).href, size: st.size, mtime: st.mtimeMs,
    image: IMG_EXTS.has(path.extname(name).toLowerCase()) };
}

async function listInbox() {
  const files = await fsp.readdir(inboxDir).catch(() => []);
  const metas = await Promise.all(files.map((f) => inboxMeta(f).catch(() => null)));
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

/* La ventana tiene que ENTRAR en el área útil de la pantalla donde cae. En una
   1366×768 con la barra de tareas (área útil 1366×720), los 820 px que tenía
   por defecto hasta la 0.14 no entraban: centered() daba y = (720 - 820) / 2
   = -50, Windows recortaba el alto a 720 pero dejaba esa y, y la titlebar
   quedaba 50 px por arriba de la pantalla, sin forma de agarrarla. Lo mismo
   con un tamaño guardado en un monitor más grande. Por eso se achica al área
   útil y se empuja adentro. */
function fitIn(w, h, pos) {
  const a = pos ? screen.getDisplayMatching({ ...pos, width: w, height: h }).workArea
                : screen.getPrimaryDisplay().workArea;
  const width = Math.min(w, a.width);
  const height = Math.min(h, a.height);
  const p = pos ?? centered(width, height);
  return {
    width, height,
    x: Math.max(a.x, Math.min(p.x, a.x + a.width - width)),
    y: Math.max(a.y, Math.min(p.y, a.y + a.height - height)),
  };
}

async function loadWindowState() {
  const s = await winState.read().catch(() => null);
  const w = Math.max(MIN_W, Number(s?.width) || DEFAULT_W);
  const h = Math.max(MIN_H, Number(s?.height) || DEFAULT_H);
  const hasPos = Number.isFinite(s?.x) && Number.isFinite(s?.y) && visibleOn(s.x, s.y, w, h);
  return { maximized: !!s?.maximized, ...fitIn(w, h, hasPos ? { x: s.x, y: s.y } : null) };
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

// Lo que el debounce tenía pendiente, al disco YA y sin soltar el hilo.
function flushPending() {
  notepad?.close();
  if (!saveTimer || !mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const b = mainWindow.getNormalBounds();
  try { winState.writeSync({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWindow.isMaximized() }); }
  catch (err) { console.error('[window] no se pudo guardar el estado:', err.message); }
}

/* El show() fuera de pantalla y, 200 ms después, a su lugar. Arrancando
   oculta no pasa en ready-to-show sino la primera vez que se la llama. */
let placed = false;
let placing = false;
let initialState = null;
function place() {
  if (placed || placing || !mainWindow) return;
  placing = true;
  const state = initialState;
  mainWindow.show();   // el flash DWM ocurre acá: off-screen, invisible
  setTimeout(() => {
    placing = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    placed = true;
    mainWindow.setPosition(state.x, state.y);
    if (state.maximized) mainWindow.maximize();
    mainWindow.focus();
  }, 200);
}

function createWindow(state) {
  initialState = state;
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
  // Si se cae el proceso de la interfaz, la ventana se recarga sola (recover.cjs).
  // El renderer recargado vuelve a avisar que está listo: hasta entonces, lo
  // que llegue espera.
  keepAlive(mainWindow, { onGone: () => { rendererReady = false; } });

  mainWindow.once('ready-to-show', () => {
    if (SMOKE) return mainWindow.show();   // el humo la quiere fuera de pantalla
    if (!START_HIDDEN) place();
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
  /* Apagar, reiniciar o cerrar la sesión de Windows no pasa por Salir:
     Windows avisa y después puede cortar. Lo pendiente del Notepad y de la
     ventana va al disco ahí mismo, sin esperar. */
  mainWindow.on('query-session-end', flushPending);
  mainWindow.on('session-end', flushPending);

  // Nada de navegación fuera de la app; los links externos van al navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Cerrar no cierra: esconde al tray y el servidor sigue recibiendo.
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
  if (!placed) return place();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMain() {
  if (!mainWindow) return;
  if (placed && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) return mainWindow.hide();
  showMain();
  sendWin('atajo:mostrar');
}

function registerHotkey() {
  let ok = false;
  try { ok = globalShortcut.register(HOTKEY, toggleMain); } catch { /* inválido */ }
  if (!ok) console.error(`[atajo] ${HOTKEY} ya lo tiene otra app`);
}

// El ítem de actualización cambia con el estado: Umbral pasa días escondida
// en el tray y ese menú es lo único que se ve de ella.
function updateMenuItem() {
  const u = updater.get();
  if (u.phase === 'ready') return { label: `Restart to update to ${u.version}`, click: () => updater.install(() => { quitting = true; }) };
  if (u.phase === 'available') return { label: `Download ${u.version}`, click: () => { showMain(); updater.download(); } };
  if (u.phase === 'downloading') return { label: `Downloading ${u.version}... ${Math.round(u.pct * 100)}%`, enabled: false };
  return { label: 'Check for updates', enabled: u.phase !== 'checking', click: () => { showMain(); updater.check({ manual: true }); } };
}

let lastMenuKey = '';
function refreshTrayMenu() {
  if (!tray) return;
  const item = updateMenuItem();
  const alIniciar = loginItemOn();
  const menuKey = `${item.label}|${alIniciar}`;
  if (menuKey === lastMenuKey) return; // el progreso llega muchas veces por segundo
  lastMenuKey = menuKey;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Umbral', accelerator: HOTKEY, registerAccelerator: false, click: showMain },
    item,
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: alIniciar, enabled: app.isPackaged,
      click: (mi) => { setLoginItem(mi.checked); store.saveSettings({ abrirAlIniciar: mi.checked }).catch(() => {}); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.setToolTip(updater.get().phase === 'ready' ? 'Umbral — update ready' : 'Umbral');
}

// ---------------------------------------------------------------------------
// Arranque con Windows
// ---------------------------------------------------------------------------

/* Una entrada en el Run del usuario con --oculta. Solo empaquetada: en dev
   apuntaría a electron.exe. La portable usa el exe real, no su copia temporal. */
const loginItem = () => ({ path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--oculta'] });

function setLoginItem(on) {
  if (!app.isPackaged || SMOKE) return;
  app.setLoginItemSettings({ openAtLogin: !!on, ...loginItem() });
}

function loginItemOn() {
  return app.isPackaged && app.getLoginItemSettings(loginItem()).openAtLogin;
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

// Copiar: una imagen va como imagen (se pega en cualquier lado). Lo demás va
// como ARCHIVO, igual que un Ctrl+C en el Explorador: se pega en una carpeta,
// en un mail o en Claude. Electron no escribe CF_HDROP, así que lo hace
// Set-Clipboard; la ruta viaja por el entorno para no pelear con comillas.
// La imagen pasa por nativeImage para que un JPEG o un WebP salgan como PNG,
// el único formato de imagen que el portapapeles de Electron 44 escribe.
async function copyFile(src) {
  if (IMG_EXTS.has(path.extname(src).toLowerCase())) {
    const img = nativeImage.createFromPath(src);
    if (!img.isEmpty()) {
      const png = img.toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      return { ok: true, image: true };
    }
  }
  if (!fs.existsSync(src)) return { ok: false };
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      'Set-Clipboard -LiteralPath $env:UMBRAL_COPIA'],
      { windowsHide: true, env: { ...process.env, UMBRAL_COPIA: src } });
    ps.on('error', () => resolve({ ok: false }));
    ps.on('close', (code) => resolve({ ok: code === 0, image: false }));
  });
}

// Abrir con el programa de cada archivo (el PDF en Quire, etc.). Si
// shell.openPath no puede, el Explorador sí.
async function openFile(src) {
  if (!fs.existsSync(src)) return { ok: false };
  // El humo no lanza programas de verdad: anota qué se habría abierto.
  if (SMOKE) { (global.__umbralAbiertos ??= []).push(path.basename(src)); return { ok: true }; }
  const err = await shell.openPath(src);
  if (err) spawn('explorer.exe', [src], { detached: true, stdio: 'ignore' }).unref();
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
    title: 'Export',
    defaultPath: path.join(lastExportDir || app.getPath('downloads'), name),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : [],
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

ipcMain.handle('recibidas:list', () => listInbox());

ipcMain.handle('recibidas:copy', (_e, name) => copyFile(safeJoin(name)));

ipcMain.handle('recibidas:open', (_e, name) => openFile(safeJoin(name)));

ipcMain.handle('recibidas:export', (_e, name) => exportFile(safeJoin(name)));

ipcMain.handle('recibidas:delete', async (_e, name) => {
  await fsp.rm(safeJoin(name), { force: true });
  return { ok: true };
});

// La carpeta es solo de lo que llegó del celu: se vacía entera.
ipcMain.handle('recibidas:clear', async () => {
  const files = await fsp.readdir(inboxDir).catch(() => []);
  await Promise.all(files.map(async (f) => {
    const full = path.join(inboxDir, f);
    if ((await fsp.stat(full).catch(() => null))?.isFile()) await fsp.rm(full, { force: true });
  }));
  return { ok: true };
});

ipcMain.handle('server:info', () => serverInfo);

// El QR lleva la llave en el fragmento: el navegador del celu la guarda y
// nunca viaja a ningún servidor (ver pairing.js).
const qrDataUrl = () =>
  QRCode.toDataURL(`${serverInfo.url}/#k=${pairing.llave()}`, {
    margin: 1,
    width: 220,
    color: { dark: '#0d0d0e', light: '#ededed' }, // clásico oscuro-sobre-claro: escanea siempre
  });

ipcMain.handle('server:qr', () => qrDataUrl());

// Vincular: el código de 6 dígitos para la app del celu (2 min, un uso).
ipcMain.handle('pair:start', () => pairing.start());
ipcMain.handle('pair:cancel', () => pairing.cancel());
// Olvidar dispositivos: llave nueva, y con ella un QR nuevo.
ipcMain.handle('pair:revoke', async () => { await pairing.revoke(); return qrDataUrl(); });

ipcMain.handle('inbox:open', async (_e, which) => {
  // explorer.exe directo: shell.openPath falla silencioso en algunos contextos
  if (which === 'notepad') {
    // La carpeta con el .txt ya marcado. Si todavía no existe, se crea vacío.
    await notepad.flush();
    if (!fs.existsSync(notepad.file)) await fsp.writeFile(notepad.file, '', 'utf8').catch(() => {});
    spawn('explorer.exe', [`/select,${notepad.file}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const dir = which === 'outbox' ? path.join(dataDir, 'outbox') : inboxDir;
  spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
});

ipcMain.handle('outbox:list', async () => (await outbox.list()).map(outMeta));
ipcMain.handle('outbox:addPaths', (_e, paths) => addToOutbox(argFiles(paths || []), { emit: false }));
ipcMain.handle('outbox:remove', (_e, name) => outbox.remove(name));
ipcMain.handle('outbox:clear', () => outbox.clear());

ipcMain.handle('outbox:copy', (_e, name) => copyFile(outbox.full(name)));

ipcMain.handle('outbox:open', (_e, name) => openFile(outbox.full(name)));

ipcMain.handle('outbox:export', (_e, name) => exportFile(outbox.full(name)));

// Archivos copiados (Ctrl+C en el Explorador, o ShareX, que deja el archivo
// y no la imagen). Electron 44 entrega el CF_HDROP como 'text/uri-list': una
// URL file:// por renglón, la lista entera y sin lanzar PowerShell.
async function clipboardFiles() {
  try {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('text/uri-list')) continue;
      const text = await (await item.getType('text/uri-list')).text();
      const list = text.split(/\r?\n/).map((u) => u.trim()).filter((u) => u.startsWith('file:'))
        .map((u) => { try { return fileURLToPath(u); } catch { return ''; } }).filter(Boolean);
      if (list.length) return list;
    }
  } catch { /* nada legible */ }
  return [];
}

// La imagen del portapapeles como PNG, o null. Electron 44 la entrega como
// un Blob 'image/png' dentro de un ClipboardItem.
async function clipboardPng() {
  try {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const buf = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
      if (buf.length) return buf;
    }
  } catch { /* nada legible */ }
  return null;
}

// Ctrl+V en "Para el celu": archivos copiados, o si no, la imagen del
// portapapeles (un recorte con Win+Shift+S, etc.)
ipcMain.handle('outbox:paste', async () => {
  const files = argFiles(await clipboardFiles());
  if (files.length) {
    const items = await addToOutbox(files, { emit: false });
    if (items.length) return { ok: true, items };
  }
  const png = await clipboardPng();
  if (!png) return { ok: false };
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `recorte_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
  const m = await outbox.addBuffer(png, name);
  return { ok: true, items: [outMeta(m)] };
});

ipcMain.handle('notepad:get', () => notepad.get());
ipcMain.handle('notepad:set', (_e, text) => notepad.set(text, { desde: 'pc' }));

// El Notepad copia texto plano: lo que se pegue después sale tal cual.
ipcMain.handle('texto:copy', async (_e, text) => {
  // El humo no le pisa el portapapeles a Fran: anota qué se habría copiado.
  if (SMOKE) { global.__umbralCopiado = String(text ?? ''); return true; }
  await clipboard.writeText(String(text ?? ''));
  return true;
});

ipcMain.on('renderer:ready', () => {
  rendererReady = true;
  if (pendingNotepad) { pendingNotepad = false; sendWin('ir:notepad'); }
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

// El renderer manda su --op-bg ya resuelto a hex: el frame fantasma del
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

  notepad = createNotepad(await migrateNotepad(dataDir), {
    onChange: (estado, desde) => { if (desde !== 'pc') sendWin('notepad:changed', { ...estado, desde }); },
  });
  await notepad.load();
  await traerNotasViejas();
  const vinculo = store.doc('vinculo', null);
  pairing = await createPairing({
    load: async () => (await vinculo.read())?.llave || null,
    save: (llave) => vinculo.write({ llave }),
  });

  // Servidor primero: cuando el renderer pida server:info, ya está la dirección.
  const { port } = await createUmbralServer({
    inboxDir,
    basePort: BASE_PORT,
    onFile: async (name) => {
      const meta = await inboxMeta(name).catch(() => null);
      if (meta) sendWin('recibidas:new', meta);
    },
    outbox,
    thumb: makeThumb,
    onDelivered: (m) => sendWin('outbox:delivered', outMeta(m)),
    pairing,
    onPaired: (d) => sendWin('pair:done', d),
    notepad,
  });
  const ip = lanIp();
  serverInfo = { ip, port, url: `http://${ip}:${port}` };
  console.log(`[umbral] escuchando en ${serverInfo.url} — inbox: ${inboxDir}`);

  createWindow(await loadWindowState());
  if (SMOKE) return;
  updater.init({ getWin: () => mainWindow, onChange: refreshTrayMenu });
  // El registro sigue al ajuste en cada arranque: si la app se reinstaló en
  // otra carpeta, la entrada vuelve a apuntar bien.
  setLoginItem((await store.loadSettings().catch(() => ({}))).abrirAlIniciar !== false);
  createTray();
  registerHotkey();
  ensureSendToShortcut();
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  notepad?.close();   // lo que estaba por guardarse se escribe ya
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
