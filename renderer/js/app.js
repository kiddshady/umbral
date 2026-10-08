/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — renderer
   Dos vistas: Recibidas (teléfono → PC) y Para el celu (PC → teléfono). Las
   piezas son de Onyx: el router hace el fundido entre las dos, reconcile()
   pone la galería al día tarjeta por tarjeta, y menú, modal, toast y tooltip
   son los overlays del framework. Lo propio de Umbral es el visor, el QR, el
   velo de arrastrar y la tarjeta de actualización.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Menu, Modal } from './overlays.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, raf2, bindSwitcher, exit, swap, numero, valor, reconcile, stagger, deslizarAlto } from './motion.js';
import { esc, paint, mark, attempt, colorToken } from './ui.js';
import { fmtClock, plural, locale } from './format.js';

const api = window.umbral;
const win = window.onyx.win;
const $ = (id) => document.getElementById(id);
const layer = () => $('ox-layer');

/* ══ Íconos propios ══════════════════════════════════════════════════════════
   Misma receta que el set base: grilla de 16, contenido entre 1.8 y 14.2,
   trazo de .ox-icon. El arco tiene que coincidir con el splash del index.html
   y con la marca de la titlebar. */
Icons.add({
  arch: '<path d="M3.67 13.67v-6a4.33 4.33 0 0 1 8.66 0v6"/><path d="M8 7.33v6.34"/>',
  qr: '<rect x="2.2" y="2.2" width="4.6" height="4.6" rx=".8"/><rect x="9.2" y="2.2" width="4.6" height="4.6" rx=".8"/>'
    + '<rect x="2.2" y="9.2" width="4.6" height="4.6" rx=".8"/><path d="M9.4 9.4h1.8v1.8H9.4z"/>'
    + '<path d="M13.6 9.4v.01M9.4 13.6h.01M11.9 11.9h.01M13.6 13.6v.01"/>',
  phoneDown: '<rect x="4.4" y="1.8" width="7.2" height="12.4" rx="1.7"/><path d="M8 5v4.6"/><path d="M6 7.7l2 2 2-2"/>',
  sweep: '<circle cx="8" cy="8" r="5.8"/><path d="M5.5 8.1l1.7 1.7 3.3-3.6"/>',
  exportar: '<path d="M8 2v7.2"/><path d="M5 5l3-3 3 3"/><path d="M3.3 8.7v3.9a1.4 1.4 0 0 0 1.4 1.4h6.6a1.4 1.4 0 0 0 1.4-1.4V8.7"/>',
  quitar: '<circle cx="8" cy="8" r="6"/><path d="M5.3 8h5.4"/>',
  sizeSm: '<rect x="5" y="5" width="6" height="6" rx="1.2"/>',
  sizeLg: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/>',
  // Radiación: el botón nuclear. Este va relleno, como los puntos macizos.
  nuke: ['', ' transform="rotate(120 8 8)"', ' transform="rotate(240 8 8)"']
    .map((t) => `<path fill="currentColor" stroke="none"${t} d="M6.6 5.57 5 2.81a6 6 0 0 1 6 0L9.4 5.57a2.8 2.8 0 0 0-2.8 0z"/>`).join('')
    + '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
});

/* ══ Datos ═══════════════════════════════════════════════════════════════════
   Un espejo en memoria: las vistas se dibujan desde acá y nunca piden datos
   para pintarse. El proceso principal avisa lo que llega y lo que se baja. */

const S = {
  images: [],   // recibidas: { name, url, size, mtime } — la más nueva primero
  out: [],      // para el celu: { name, url, size, mtime, image, delivered }
  url: '',
  qr: '',
  booting: true,
};

const fmtWhen = (ms) => `${fmtClock(ms)} · ${new Date(ms).toLocaleDateString(locale.tag, { day: '2-digit', month: '2-digit' })}`;
const extOf = (n) => (n.includes('.') ? n.split('.').pop().slice(0, 5).toUpperCase() : 'ARCHIVO');

/* ══ Acciones ════════════════════════════════════════════════════════════════ */

async function copiar(fn) {
  const res = await attempt(fn, { errorTitle: 'No se pudo copiar' });
  if (!res) return;
  if (res.ok) Toast.show({ title: 'Copiada al portapapeles', icon: 'copy', duration: 2600 });
  else Toast.error('No se pudo copiar', 'El archivo no es una imagen que el portapapeles entienda.');
}

async function exportar(fn, femenino = true) {
  const res = await attempt(fn, { errorTitle: 'No se pudo exportar' });
  if (!res || res.canceled) return;
  if (res.ok) Toast.show({ title: femenino ? 'Exportada' : 'Exportado', text: res.name, icon: 'exportar', duration: 3200 });
  else Toast.error('No se pudo exportar', 'No se pudo escribir la copia en esa carpeta.');
}

function removeImage(name) {
  S.images = S.images.filter((i) => i.name !== name);
  api.deleteImage(name);
  sync('recibidas');
}

function removeOut(name) {
  S.out = S.out.filter((i) => i.name !== name);
  api.outbox.remove(name);
  sync('celu');
}

function addImage(img) {
  if (S.images.some((i) => i.name === img.name)) return;
  S.images.unshift(img);
  sync('recibidas');
}

function addOut(items, { focus = false } = {}) {
  let n = 0;
  for (const item of items) {
    if (S.out.some((i) => i.name === item.name)) continue;
    S.out.unshift(item);
    n++;
  }
  if (!n) return;
  if (focus || Router.name !== 'celu') go('celu');
  sync('celu');
  Toast.show({ title: `${plural(n, 'archivo esperando', 'archivos esperando')} al celu`, icon: 'phoneDown', duration: 3200 });
}

async function addFiles(files) {
  if (!files.length) return;
  const added = await attempt(() => api.outbox.addFiles(files), { errorTitle: 'No se pudieron agregar' });
  if (!added) return;
  if (!added.length) Toast.error('No se agregó nada', 'Solo se pueden mandar archivos, no carpetas.');
  addOut(added, { focus: true });
}

/* ══ Menús ═══════════════════════════════════════════════════════════════════
   El mismo menú sirve para la miniatura y para la foto agrandada. Se abre en
   el cursor: el ancla es un punto invisible ahí. */

function menuAt(x, y, items) {
  let p = $('ub-anchor');
  if (!p) {
    p = document.createElement('div');
    p.id = 'ub-anchor';
    p.className = 'ub-anchor';
    document.body.appendChild(p);
  }
  // El ancla es siempre la misma: pedirlo otra vez es abrirlo en el punto nuevo, no cerrarlo.
  Menu.close(true);
  p.style.left = `${Math.round(x)}px`;
  p.style.top = `${Math.round(y) - 6}px`;   // Menu.show lo baja 6 px: que nazca en el cursor
  return Menu.show(p, items);
}

function menuIn(img) {
  return [
    { label: 'Copiar', icon: 'copy', onSelect: () => copiar(() => api.copyImage(img.name)) },
    { label: 'Exportar', icon: 'exportar', onSelect: () => exportar(() => api.exportImage(img.name)) },
    { sep: true },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => { closeLightbox(); removeImage(img.name); } },
  ];
}

function menuOut(item) {
  return [
    ...(item.image ? [{ label: 'Copiar', icon: 'copy', onSelect: () => copiar(() => api.outbox.copy(item.name)) }] : []),
    { label: 'Exportar', icon: 'exportar', onSelect: () => exportar(() => api.outbox.export(item.name), item.image) },
    { sep: true },
    { label: 'Quitar de la bandeja', icon: 'quitar', danger: true, onSelect: () => { closeLightbox(); removeOut(item.name); } },
  ];
}

/* ══ Visor ═══════════════════════════════════════════════════════════════════ */

let lightbox = null;

function openLightbox(url, items) {
  closeLightbox();
  const el = document.createElement('div');
  el.className = 'ub-lightbox';
  el.innerHTML = `<img src="${esc(url)}" alt="">`;
  el.__vuelve = document.activeElement;
  layer().appendChild(el);
  lightbox = el;

  // Si el click afuera solo vino a cerrar un menú, no cierra también el visor.
  let menuAbierto = false;
  el.addEventListener('pointerdown', () => { menuAbierto = Menu.isOpen; });
  el.addEventListener('click', () => { if (!menuAbierto) closeLightbox(); });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menuAt(e.clientX, e.clientY, items());
  });
}

function closeLightbox() {
  if (!lightbox) return;
  const el = lightbox;
  lightbox = null;
  if (el.__vuelve?.isConnected) el.__vuelve.focus({ preventScroll: true });
  exit(el, { fallback: 260 });
}

/* ══ Las vistas ══════════════════════════════════════════════════════════════
   Cada una pinta su scroll con la grilla, o el vacío. La grilla se llena con
   reconcile(): las tarjetas tienen clave (el nombre del archivo), así que lo
   que llega en vivo entra, lo que se borra se esfuma desde donde estaba, y el
   resto se corre a su lugar nuevo. */

function cardIn(img) {
  return `<figure class="ub-card" tabindex="0">
    <img src="${esc(img.url)}" alt="" loading="lazy" draggable="false">
    <figcaption class="ub-card__time">${esc(fmtWhen(img.mtime))}</figcaption>
  </figure>`;
}

const pillHTML = (item) => (item.delivered
  ? `${Icons.svg('check')}<span>Bajada</span>`
  : `${mark('running')}<span>Esperando</span>`);

function cardOut(item) {
  const cls = `ub-card${item.image ? '' : ' ub-card--file'}${item.delivered ? ' is-delivered' : ''}`;
  const body = item.image
    ? `<img src="${esc(item.url)}" alt="" loading="lazy" draggable="false">`
    : `<div class="ub-file">${Icons.svg('file')}
        <span class="ub-file__ext">${esc(extOf(item.name))}</span>
        <span class="ub-file__name ox-truncate ox-copyable">${esc(item.name)}</span>
      </div>`;
  return `<figure class="${cls}" tabindex="0">
    ${body}
    <span class="ub-pill" data-delivered="${item.delivered ? 1 : 0}">${pillHTML(item)}</span>
    <figcaption class="ub-card__time">${esc(fmtWhen(item.mtime))}</figcaption>
  </figure>`;
}

/* Una tarjeta de «Para el celu» que pasó a bajada: la clase corre con su
   transición (el filtro que la apaga) y la píldora hace un relevo. */
function updateOut(el, { it }) {
  el.classList.toggle('is-delivered', !!it.delivered);
  const pill = el.querySelector(':scope > .ub-pill');
  const d = it.delivered ? '1' : '0';
  if (pill && pill.dataset.delivered !== d) {
    pill.dataset.delivered = d;
    swap(pill, pillHTML(it), { relevo: true });
  }
}

const VIEWS = {
  recibidas: {
    list: () => S.images,
    card: cardIn,
    menu: menuIn,
    empty: () => `
      <div class="ox-empty ub-empty">${Icons.svg('arch')}
        <div class="ox-empty__title">El umbral está despejado</div>
        <div class="ox-empty__text">Compartí una captura desde el teléfono y aparece acá.</div>
        ${S.url ? `<span class="ub-empty__addr ox-copyable">${esc(S.url)}</span>` : ''}
      </div>`,
  },
  celu: {
    list: () => S.out,
    card: cardOut,
    menu: menuOut,
    update: updateOut,
    empty: () => `
      <div class="ox-empty ub-empty">${Icons.svg('phoneDown')}
        <div class="ox-empty__title">Nada esperando al celu</div>
        <div class="ox-empty__text">Arrastrá archivos acá, pegá una imagen con Ctrl+V o usá
          <strong>Enviar a <span class="ub-empty__inline">${Icons.svg('chevronRight')}</span> Umbral (al celu)</strong>
          en el Explorador. En el teléfono aparecen en la pestaña <strong>Recibir</strong> de:</div>
        ${S.url ? `<span class="ub-empty__addr ox-copyable">${esc(S.url)}</span>` : ''}
      </div>`,
  },
};

const items = (v) => VIEWS[v].list().map((it) => ({ key: it.name, html: VIEWS[v].card(it), it }));

function view(v) {
  const list = VIEWS[v].list();
  paint(list.length
    ? `<div class="ox-scroll ox-grow"><div class="ub-grid" id="grid"></div></div>`
    : `<div class="ox-grow" style="display:grid;place-items:center">${VIEWS[v].empty()}</div>`);
  const grid = $('grid');
  if (!grid) return;
  reconcile(grid, items(v), { enter: false, update: VIEWS[v].update, created: (el) => Icons.mount(el) });
  // Solo al arrancar las tarjetas entran escalonadas; al cambiar de vista,
  // la nueva ya está entera y quieta debajo del fundido.
  if (S.booting) { stagger(grid); grid.classList.add('ub-grid--entra'); }
  wireGrid(grid, v);
}

/* La delegación va en la grilla, que muere con el pintado: en #view se
   acumularía un escuchador por visita. */
function wireGrid(grid, v) {
  const itemOf = (card) => card && VIEWS[v].list().find((i) => i.name === card.dataset.key);
  const open = (card) => {
    const it = itemOf(card);
    if (!it || (v === 'celu' && !it.image)) return;
    openLightbox(it.url, () => VIEWS[v].menu(it));
  };
  grid.addEventListener('click', (e) => open(e.target.closest('.ub-card')));
  grid.addEventListener('contextmenu', (e) => {
    const it = itemOf(e.target.closest('.ub-card'));
    if (!it) return;
    e.preventDefault();
    menuAt(e.clientX, e.clientY, VIEWS[v].menu(it));
  });
  grid.addEventListener('keydown', (e) => {
    const card = e.target.closest('.ub-card');
    if (!card) return;
    if (e.key === 'Enter') { e.preventDefault(); open(card); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = card.getBoundingClientRect();
      menuAt(r.left + r.width / 2, r.top + r.height / 2, VIEWS[v].menu(itemOf(card)));
    }
  });
}

/* Lo que cambió en una vista: si es la que se ve, se pone al día en el lugar;
   si pasa de vacía a llena (o al revés), se repinta con fundido. La otra se
   pinta con lo último la próxima vez que se entre. */
function sync(v) {
  updateChrome();
  if (Router.name !== v) return;
  const grid = $('grid');
  const llena = VIEWS[v].list().length > 0;
  if (!!grid !== llena) return Router.refresh();
  if (grid) reconcile(grid, items(v), { update: VIEWS[v].update, created: (el) => Icons.mount(el) });
}

function go(v) {
  if (Router.name === v) return;
  closeLightbox();
  Router.go(v);
}

/* ══ El chrome ═══════════════════════════════════════════════════════════════ */

let syncSeg = () => {};

function updateChrome() {
  const v = Router.name;
  numero($('n-in'), S.images.length);
  numero($('n-out'), S.out.length);
  $('n-out').classList.toggle('is-hot', S.out.some((i) => !i.delivered));

  const sweep = $('btn-sweep');
  sweep.disabled = !S.out.some((i) => i.delivered);
  sweep.dataset.tip = sweep.disabled ? 'Quitar las ya bajadas: ninguna bajó todavía' : 'Quitar las ya bajadas';

  const nuke = $('btn-nuke');
  const vacia = v === 'celu' ? !S.out.length : !S.images.length;
  nuke.disabled = vacia;
  nuke.dataset.tip = v === 'celu'
    ? (vacia ? 'La bandeja ya está vacía' : 'Vaciar la bandeja')
    : (vacia ? 'No hay nada que purgar' : 'Purgar todo');

  $('btn-folder').dataset.tip = v === 'celu' ? 'Abrir la carpeta de la bandeja' : 'Abrir la carpeta de las capturas';
  $('out-tools').hidden = v !== 'celu';

  // El segmentado sigue a la vista también cuando cambia sola (arrastrar, Enviar a).
  for (const o of $('seg').querySelectorAll('.ox-segmented__opt')) o.classList.toggle('is-active', o.dataset.value === v);
  syncSeg();
}

function wireChrome() {
  $('win-min').addEventListener('click', () => win.minimize());
  $('win-close').addEventListener('click', () => win.close());
  const maxBtn = $('win-max');
  maxBtn.addEventListener('click', () => win.toggleMaximize());
  win.onMaximized((isMax) => {
    maxBtn.innerHTML = Icons.svg(isMax ? 'winRestore' : 'winMax');
    maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
  });

  syncSeg = bindSwitcher($('seg'), (v) => go(v));

  $('btn-qr').addEventListener('click', toggleQr);
  $('btn-folder').addEventListener('click', () => api.openInbox(Router.name === 'celu' ? 'outbox' : 'inbox'));
  $('btn-nuke').addEventListener('click', purgar);
  $('btn-add').addEventListener('click', () => $('file-pick').click());
  $('file-pick').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    addFiles(files);
  });
  $('btn-sweep').addEventListener('click', () => {
    const done = S.out.filter((i) => i.delivered);
    if (!done.length) return;
    S.out = S.out.filter((i) => !i.delivered);
    for (const item of done) api.outbox.remove(item.name);
    sync('celu');
    Toast.show({ title: plural(done.length, 'archivo quitado', 'archivos quitados'), icon: 'sweep', duration: 2600 });
  });

  document.addEventListener('keydown', onKey);
  wireDrop();
}

function onKey(e) {
  if (Modal.isOpen || Menu.isOpen) return;   // el Escape y el Enter son de ellos
  if (e.key === 'Escape') {
    if (qr) closeQr();
    else if (lightbox) closeLightbox();
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    pegar();
  }
}

async function pegar() {
  const res = await attempt(() => api.outbox.paste(), { errorTitle: 'No se pudo pegar' });
  if (!res) return;
  if (res.ok) addOut(res.items, { focus: true });
  else Toast.error('No hay nada que pegar', 'El portapapeles no tiene una imagen ni archivos.');
}

/* ── Tamaño de las miniaturas ───────────────────────────────────────────── */

function wireSize(px) {
  const s = $('thumb-size');
  const put = (v) => {
    document.documentElement.style.setProperty('--ub-thumb', `${v}px`);
    s.style.setProperty('--ox-pct', `${((v - s.min) / (s.max - s.min)) * 100}%`);
  };
  s.value = px;
  put(Number(s.value));
  let t = 0;
  s.addEventListener('input', () => {
    put(Number(s.value));
    clearTimeout(t);
    t = setTimeout(() => window.onyx.settings.save({ miniatura: Number(s.value) }).catch(() => {}), 300);
  });
}

/* ── QR ─────────────────────────────────────────────────────────────────── */

let qr = null;

function toggleQr() {
  if (qr) return closeQr();
  const btn = $('btn-qr');
  const el = document.createElement('div');
  el.className = 'ub-qr';
  el.innerHTML = `
    <div class="ub-qr__code">${S.qr ? `<img src="${esc(S.qr)}" alt="QR de ${esc(S.url)}">` : ''}</div>
    <div class="ub-qr__text">Escanealo con el teléfono para abrir Umbral en su navegador.</div>`;
  layer().appendChild(el);
  const a = btn.getBoundingClientRect();
  const left = Math.min(Math.max(10, a.left - 8), window.innerWidth - el.offsetWidth - 10);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(a.bottom + 6)}px`;
  btn.classList.add('is-open');
  qr = el;

  // Afuera lo cierra; el botón no, que es su toggle.
  el.__afuera = (ev) => { if (!el.contains(ev.target) && !btn.contains(ev.target)) closeQr(); };
  setTimeout(() => document.addEventListener('pointerdown', el.__afuera), 0);
}

function closeQr() {
  if (!qr) return;
  const el = qr;
  qr = null;
  document.removeEventListener('pointerdown', el.__afuera);
  $('btn-qr').classList.remove('is-open');
  exit(el, { fallback: 200 });
}

/* ── Purga ──────────────────────────────────────────────────────────────── */

async function purgar() {
  const celu = Router.name === 'celu';
  const n = celu ? S.out.length : S.images.length;
  if (!n) return;
  const okay = await Modal.confirm(celu
    ? { title: 'Vaciar la bandeja', sub: `Se van a quitar ${plural(n, 'archivo', 'archivos')} y el celu deja de verlos. Los originales en tu PC no se tocan.`, confirmLabel: 'Vaciar', danger: true }
    : { title: 'Purga total', sub: `Se van a eliminar ${plural(n, 'captura', 'capturas')}. No hay vuelta atrás.`, confirmLabel: 'Purgar', danger: true });
  if (!okay) return;
  if (celu) {
    S.out = [];
    await attempt(() => api.outbox.clear(), { errorTitle: 'No se pudo vaciar' });
    Toast.show({ title: 'Bandeja vacía', icon: 'check', duration: 2600 });
  } else {
    S.images = [];
    await attempt(() => api.clearAll(), { errorTitle: 'No se pudo purgar' });
    Toast.show({ title: 'Umbral despejado', icon: 'check', duration: 2600 });
  }
  // Las tarjetas se esfuman y recién ahí entra el vacío.
  const grid = $('grid');
  if (grid) {
    reconcile(grid, []);
    updateChrome();
    setTimeout(() => { if (!VIEWS[Router.name].list().length) Router.refresh(); }, 260);
  } else sync(celu ? 'celu' : 'recibidas');
}

/* ── Arrastrar y soltar ─────────────────────────────────────────────────── */

function wireDrop() {
  let depth = 0;
  let veil = null;
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const show = () => {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'ub-veil';
    veil.innerHTML = `<div class="ub-veil__card">${Icons.svg('phoneDown')}<div class="ub-veil__title">Soltá para mandarlo al celu</div></div>`;
    layer().appendChild(veil);
  };
  const hide = () => { if (veil) { exit(veil, { fallback: 220 }); veil = null; } };

  document.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) { go('celu'); show(); }
  });
  document.addEventListener('dragover', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    if (--depth <= 0) { depth = 0; hide(); }
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();   // sin esto Electron navega al archivo soltado
    depth = 0;
    hide();
    if (isFiles(e)) addFiles([...e.dataTransfer.files]);
  });
}

/* ══ Actualización ═══════════════════════════════════════════════════════════
   Una tarjeta abajo a la izquierda (los toasts van a la derecha). Aparece sola
   solo si hay algo que hacer; «al día» y los errores, solo si lo pediste. */

let upd = null;
let updKey = '';
let updDismissed = '';
let updTimer = 0;

const mb = (b) => (b ? ` · ${Math.round(b / 1048576)} MB` : '');   // que el número no quede solo en un renglón
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function updView(s) {
  switch (s.phase) {
    // El título del release es «Umbral X — qué trae»: arriba la versión, abajo el qué.
    case 'available': return { ico: 'download', title: `Umbral ${s.version} disponible`,
      sub: `${cap((s.name || '').split(/\s+[—-]\s+/).slice(1).join(' — ')) || `Tenés la ${s.current}`}${mb(s.bytes)}`,
      acts: [['open', 'Ver novedades', 'ox-btn--secondary'], ['download', 'Descargar', 'ox-btn--primary']] };
    case 'downloading': return { ico: 'download', title: `Descargando la ${s.version}`, sub: `${Math.round(s.pct * 100)} %`, bar: s.pct, sticky: true };
    case 'ready': return { ico: 'check', title: `La ${s.version} está lista`, sub: 'Si no reiniciás ahora, se instala cuando salgas de Umbral.',
      acts: [['install', 'Reiniciar', 'ox-btn--primary']] };
    case 'checking': return s.manual && { ico: 'spin', title: 'Buscando actualizaciones', sub: 'Consultando GitHub' };
    case 'current': return s.manual && { ico: 'check', title: 'Estás al día', sub: `Umbral ${s.current}`, auto: 3200 };
    case 'error': return s.manual && { ico: 'alert', bad: true, title: 'No se pudo buscar', sub: s.error };
    case 'unsupported': return s.manual && { ico: 'alert', bad: true, title: 'Sin actualización automática', sub: s.reason };
    default: return null;
  }
}

function updHTML(v) {
  const ico = v.ico === 'spin' ? Icons.spinner() : Icons.svg(v.ico);
  return `
    <div class="ub-upd__head">
      <span class="ub-upd__ico${v.bad ? ' is-bad' : ''}">${ico}</span>
      <div class="ub-upd__txt">
        <div class="ub-upd__title">${esc(v.title)}</div>
        <div class="ub-upd__sub ox-copyable">${esc(v.sub || '')}</div>
      </div>
      ${v.sticky ? '' : `<button class="ox-iconbtn ox-iconbtn--sm ub-upd__x" data-upd="close" aria-label="Cerrar">${Icons.svg('close')}</button>`}
    </div>
    ${v.bar != null ? `<div class="ox-meter"><div class="ox-meter__fill" style="--ox-pct:${(v.bar * 100).toFixed(1)}%"></div></div>` : ''}
    ${v.acts ? `<div class="ub-upd__acts">${v.acts.map(([a, l, c]) => `<button class="ox-btn ox-btn--sm ${c}" data-upd="${a}">${esc(l)}</button>`).join('')}</div>` : ''}`;
}

function hideUpd() {
  clearTimeout(updTimer);
  if (!upd) return;
  exit(upd, { fallback: 260 });
  upd = null;
  updKey = '';
}

function renderUpd(s) {
  const v = updView(s);
  const key = `${s.phase}:${s.version || ''}`;
  if (!v || updDismissed === key) return hideUpd();

  if (!upd) {
    upd = document.createElement('div');
    upd.className = 'ub-upd';
    upd.innerHTML = updHTML(v);
    upd.addEventListener('click', (e) => {
      const act = e.target.closest('[data-upd]')?.dataset.upd;
      if (!act) return;
      if (act === 'close') { updDismissed = updKey; hideUpd(); }
      else api.update[act]();
    });
    layer().appendChild(upd);
  } else if (key === updKey && v.bar != null) {
    // Mientras baja solo cambian el número y la barra: no se rearma la tarjeta.
    valor(upd.querySelector('.ub-upd__sub'), esc(v.sub));
    upd.querySelector('.ox-meter__fill')?.style.setProperty('--ox-pct', `${(v.bar * 100).toFixed(1)}%`);
  } else if (key !== updKey) {
    const el = upd;
    deslizarAlto(el, () => swap(el, updHTML(v), { relevo: true }));
  }
  updKey = key;

  clearTimeout(updTimer);
  if (v.auto) updTimer = setTimeout(() => { updDismissed = key; hideUpd(); }, v.auto);
}

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

function syncWindowColor() {
  const hex = colorToken('--ox-bg');
  if (hex) win.setBackground(hex);
}

async function boot() {
  Icons.mount(document);      // reemplaza los <i data-icon> del index.html
  Tooltip.init();
  initClickFlash();
  initScrollFades();
  syncWindowColor();
  $('srv-mark').outerHTML = mark('running');
  Router.define({ recibidas: () => view('recibidas'), celu: () => view('celu') }, $('view'));

  let settings = {};
  try {
    const info = await api.serverInfo();
    S.url = info.url || '';
    [S.images, S.out, settings] = await Promise.all([
      api.listImages(), api.outbox.list(), window.onyx.settings.get().catch(() => ({})),
    ]);
    S.qr = await api.qr().catch(() => '');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo iniciar', err.message);
  }

  $('addr').textContent = S.url;
  wireSize(settings.miniatura || 220);
  wireChrome();
  Router.onChange(updateChrome);
  Router.go('recibidas');
  updateChrome();
  S.booting = false;

  api.onNewImage((img) => {
    addImage(img);
    const t = Toast.show({ title: 'Captura recibida', text: img.name, icon: 'download', duration: 3200 });
    const thumb = document.createElement('img');
    thumb.className = 'ub-toast-thumb';
    thumb.src = img.url;
    thumb.alt = '';
    t.el.querySelector(':scope > .ox-icon')?.replaceWith(thumb);
  });
  api.outbox.onAdded((list, opts) => addOut(list, opts));
  api.outbox.onDelivered((item) => {
    const cur = S.out.find((i) => i.name === item.name);
    if (!cur) return;
    const first = !cur.delivered;
    cur.delivered = item.delivered;
    sync('celu');
    if (first) Toast.show({ title: 'Bajada en el celu', text: item.name, icon: 'check', duration: 3200 });
  });
  api.update.onState((s) => {
    if (s.manual) updDismissed = '';   // si lo pediste, se muestra aunque la hayas cerrado antes
    renderUpd(s);
  });
  api.update.state().then(renderUpd);

  // El splash se va recién cuando ya hay algo pintado debajo.
  raf2(() => {
    const splash = $('boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  });

  api.ready();   // recién ahora puede llegar lo de «Enviar a»
}

boot();
