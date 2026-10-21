/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — renderer
   Tres vistas en el rail: Recibidas (teléfono → PC), Para el celu (PC →
   teléfono) y el Notepad, un texto de paso que comparten la PC, el celu y
   CC. Las piezas son de Opal (desde la 0.13; antes, de Onyx): el router hace
   el fundido entre ellas, reconcile() pone la galería al día tarjeta por
   tarjeta, y menú, modal, toast y tooltip son los overlays del framework. Lo
   propio de Umbral es el visor, el QR, el velo de arrastrar y la tarjeta de
   actualización.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Menu, FieldMenu, Modal } from './overlays.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, raf2, exit, swap, numero, valor, frase, reconcile, stagger, deslizarAlto, roll } from './motion.js';
import { esc, paint, head, mark, attempt, colorToken } from './ui.js';
import { Shell } from './shell.js';
import { fmtClock, plural, locale } from './format.js';

const api = window.umbral;
const win = window.opal.win;
const $ = (id) => document.getElementById(id);
const layer = () => $('op-layer');

/* ══ Íconos propios ══════════════════════════════════════════════════════════
   Misma receta que el set base: grilla de 16, contenido entre 1.8 y 14.2,
   trazo de .op-icon. El arco tiene que coincidir con el splash del index.html
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
  // Una hoja con renglones: el Notepad.
  notepad: '<rect x="3.2" y="1.8" width="9.6" height="12.4" rx="1.6"/><path d="M5.6 5.4h4.8M5.6 8h4.8M5.6 10.6h2.8"/>',
  // Radiación: el botón nuclear. Este va relleno, como los puntos macizos.
  nuke: ['', ' transform="rotate(120 8 8)"', ' transform="rotate(240 8 8)"']
    .map((t) => `<path fill="currentColor" stroke="none"${t} d="M6.6 5.57 5 2.81a6 6 0 0 1 6 0L9.4 5.57a2.8 2.8 0 0 0-2.8 0z"/>`).join('')
    + '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>',
});

/* ══ Datos ═══════════════════════════════════════════════════════════════════
   Un espejo en memoria: las vistas se dibujan desde acá y nunca piden datos
   para pintarse. El proceso principal avisa lo que llega y lo que se baja. */

const S = {
  inbox: [],    // recibidas: { name, url, size, mtime, image } — la más nueva primero
  out: [],      // para el celu: { name, url, size, mtime, image, delivered }
  url: '',
  qr: '',
  thumb: 220,   // px de las miniaturas; se cambia con el slider y queda en settings
  booting: true,
  // El Notepad: un espejo de notepad.txt, que es del main.
  notepad: '',
  notepadDesde: null, // { desde, t }: el último cambio que vino de afuera, para decirlo abajo
  notepadSel: null,   // { start, end, scroll } al irse de la vista, para volver al mismo lugar
  notepadLetra: 12,   // px; se cambia con Ctrl + / Ctrl - / Ctrl 0 y queda en settings
  notepadLetraT: 0,   // cuándo se cambió, para decirlo abajo un rato
  notepadAviso: null, // { texto, t }: algo que se hizo con una tecla (Ctrl+K), para decirlo abajo un rato
  buscado: '',         // lo último que se buscó con Ctrl+F: vuelve al abrir de nuevo
};

const fmtWhen = (ms) => `${fmtClock(ms)} · ${new Date(ms).toLocaleDateString(locale.tag, { day: '2-digit', month: '2-digit' })}`;
const extOf = (n) => (n.includes('.') ? n.split('.').pop().slice(0, 5).toUpperCase() : 'ARCHIVO');

/* ══ Acciones ════════════════════════════════════════════════════════════════ */

/* Lo que no tiene vuelta atrás arranca con el foco en Cancelar: un Enter que
   venía para otra cosa no purga nada. El Modal.confirm de Opal enfoca el que
   confirma; el de Onyx, que usaba Umbral hasta la 0.12, era así. */
const confirmar = ({ title, sub, confirmLabel, danger = false }) => Modal.show({
  title,
  sub,
  actions: [
    { label: 'Cancelar', value: false, autofocus: danger },
    { label: confirmLabel, value: true, variant: danger ? 'danger-solid' : 'primary', autofocus: !danger },
  ],
}).then((v) => v === true);

// Una imagen se copia como imagen; lo demás, como archivo (se pega en una
// carpeta o en Claude, como un Ctrl+C del Explorador).
async function copiar(fn) {
  const res = await attempt(fn, { errorTitle: 'No se pudo copiar' });
  if (!res) return;
  if (res.ok) Toast.show({ title: res.image ? 'Copiada al portapapeles' : 'Copiado al portapapeles', icon: 'copy', duration: 2600 });
  else Toast.error('No se pudo copiar', 'Windows no dejó poner el archivo en el portapapeles.');
}

async function abrir(fn) {
  const res = await attempt(fn, { errorTitle: 'No se pudo abrir' });
  if (res && !res.ok) Toast.error('No se pudo abrir', 'El archivo ya no está en la carpeta.');
}

async function exportar(fn, femenino = true) {
  const res = await attempt(fn, { errorTitle: 'No se pudo exportar' });
  if (!res || res.canceled) return;
  if (res.ok) Toast.show({ title: femenino ? 'Exportada' : 'Exportado', text: res.name, icon: 'exportar', duration: 3200 });
  else Toast.error('No se pudo exportar', 'No se pudo escribir la copia en esa carpeta.');
}

function removeIn(name) {
  S.inbox = S.inbox.filter((i) => i.name !== name);
  api.recibidas.remove(name);
  sync('recibidas');
}

function removeOut(name) {
  S.out = S.out.filter((i) => i.name !== name);
  api.outbox.remove(name);
  sync('celu');
}

function addIn(item) {
  if (S.inbox.some((i) => i.name === item.name)) return;
  S.inbox.unshift(item);
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
   el cursor: el ancla es un punto invisible ahí. Lo que no es imagen suma
   Abrir arriba de todo: no tiene visor, se abre con su programa. */

function menuAt(x, y, items) {
  return Menu.showAt(x, y, items);
}

const itemAbrir = (fn) => ({ label: 'Abrir', icon: 'file', onSelect: () => abrir(fn) });

function menuIn(item) {
  return [
    ...(item.image ? [] : [itemAbrir(() => api.recibidas.open(item.name))]),
    { label: 'Copiar', icon: 'copy', onSelect: () => copiar(() => api.recibidas.copy(item.name)) },
    { label: 'Exportar', icon: 'exportar', onSelect: () => exportar(() => api.recibidas.export(item.name), item.image) },
    { sep: true },
    { label: 'Eliminar', icon: 'trash', danger: true, onSelect: () => { closeLightbox(); removeIn(item.name); } },
  ];
}

function menuOut(item) {
  return [
    ...(item.image ? [] : [itemAbrir(() => api.outbox.open(item.name))]),
    { label: 'Copiar', icon: 'copy', onSelect: () => copiar(() => api.outbox.copy(item.name)) },
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

// La foto, o la ficha con la extensión y el nombre: igual en las dos vistas.
const cardBody = (item) => (item.image
  ? `<img src="${esc(item.url)}" alt="" loading="lazy" draggable="false">`
  : `<div class="ub-file">${Icons.svg('file')}
      <span class="ub-file__ext">${esc(extOf(item.name))}</span>
      <span class="ub-file__name op-truncate op-copyable">${esc(item.name)}</span>
    </div>`);

function cardIn(item) {
  return `<figure class="ub-card${item.image ? '' : ' ub-card--file'}" tabindex="0">
    ${cardBody(item)}
    <figcaption class="ub-card__time">${esc(fmtWhen(item.mtime))}</figcaption>
  </figure>`;
}

const pillHTML = (item) => (item.delivered
  ? `${Icons.svg('check')}<span>Bajada</span>`
  : `${mark('running')}<span>Esperando</span>`);

function cardOut(item) {
  const cls = `ub-card${item.image ? '' : ' ub-card--file'}${item.delivered ? ' is-delivered' : ''}`;
  return `<figure class="${cls}" tabindex="0">
    ${cardBody(item)}
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
    title: 'Recibidas',
    sub: 'Lo que mandaste desde el teléfono',
    list: () => S.inbox,
    card: cardIn,
    menu: menuIn,
    open: (name) => api.recibidas.open(name),
    empty: () => `
      <div class="op-empty ub-empty">${Icons.svg('arch')}
        <div class="op-empty__title">El umbral está despejado</div>
        <div class="op-empty__text">Compartí imágenes o archivos desde el teléfono y aparecen acá.</div>
        ${S.url ? `<span class="ub-empty__addr op-copyable">${esc(S.url)}</span>` : ''}
      </div>`,
  },
  celu: {
    title: 'Para el celu',
    sub: 'Lo que el teléfono baja desde su pestaña Recibir',
    list: () => S.out,
    card: cardOut,
    menu: menuOut,
    open: (name) => api.outbox.open(name),
    update: updateOut,
    empty: () => `
      <div class="op-empty ub-empty">${Icons.svg('phoneDown')}
        <div class="op-empty__title">Nada esperando al celu</div>
        <div class="op-empty__text">Arrastrá archivos acá, pegá una imagen con Ctrl+V o usá
          <strong>Enviar a <span class="ub-empty__inline">${Icons.svg('chevronRight')}</span> Umbral (al celu)</strong>
          en el Explorador. En el teléfono aparecen en la pestaña <strong>Recibir</strong> de:</div>
        ${S.url ? `<span class="ub-empty__addr op-copyable">${esc(S.url)}</span>` : ''}
      </div>`,
  },
};

const items = (v) => VIEWS[v].list().map((it) => ({ key: it.name, html: VIEWS[v].card(it), it }));

/* Las herramientas de cada vista van en su encabezado, a la derecha del
   título: viven y mueren con el pintado. Los tooltips que cambian con el
   estado (apagado, por qué) los pone updateChrome(). */
const iconBtn = (id, icon, tip, cls = '') =>
  `<button class="op-iconbtn ${cls}" id="${id}" data-tip="${esc(tip)}" data-tip-side="bottom"><i data-icon="${icon}"></i></button>`;
const SEP = '<span class="op-vr ub-vr"></span>';
const SIZE = `<div class="ub-size" data-tip="Tamaño de las miniaturas" data-tip-side="bottom">
  <i data-icon="sizeSm"></i>
  <input type="range" class="op-slider" id="thumb-size" min="150" max="420" step="10" aria-label="Tamaño de las miniaturas">
  <i data-icon="sizeLg"></i>
</div>`;
const TOOLS = {
  recibidas: () => `${SIZE}${SEP}${iconBtn('btn-folder', 'folder', 'Abrir la carpeta de lo recibido')}${iconBtn('btn-nuke', 'nuke', 'Purgar todo', 'ub-nuke')}`,
  celu: () => `${iconBtn('btn-add', 'plus', 'Agregar archivos')}${iconBtn('btn-sweep', 'sweep', 'Quitar las ya bajadas')}${SEP}${SIZE}${SEP}`
    + `${iconBtn('btn-folder', 'folder', 'Abrir la carpeta de la bandeja')}${iconBtn('btn-nuke', 'nuke', 'Vaciar la bandeja', 'ub-nuke')}`,
  // Limpiar y Copiar todo van arriba: abajo a la derecha caen los toasts.
  notepad: () => `${iconBtn('btn-folder', 'folder', 'Mostrar notepad.txt en su carpeta')}${SEP}
    <button class="op-btn op-btn--ghost op-btn--sm" id="note-clear"><i data-icon="trash"></i> Limpiar</button>
    <button class="op-btn op-btn--secondary op-btn--sm" id="note-copy"><i data-icon="copy"></i> Copiar todo</button>`,
};

function view(v) {
  const list = VIEWS[v].list();
  paint(`${head({ title: VIEWS[v].title, sub: VIEWS[v].sub, actions: TOOLS[v]() })}${list.length
    ? `<div class="op-scroll op-grow"><div class="ub-grid" id="grid"></div></div>`
    : `<div class="op-grow" style="display:grid;place-items:center">${VIEWS[v].empty()}</div>`}`);
  wireHead(v);
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
  // Una imagen se agranda en el visor; lo demás se abre con su programa.
  const open = (card) => {
    const it = itemOf(card);
    if (!it) return;
    if (it.image) openLightbox(it.url, () => VIEWS[v].menu(it));
    else abrir(() => VIEWS[v].open(it.name));
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

/* ══ El Notepad ═════════════════════════════════════════════════════════════
   Una instancia intermedia para copiar y pegar: un comando, un link, unas
   palabras. Vive en notepad.txt (notepad.js, en el main) y es el mismo que
   ve Umbral Mobile. Lo que se escribe acá sale 250 ms después de la última
   tecla; lo que cambia el celu, o un editor que abra el .txt, llega por
   `notepad:changed` y entra en el lugar, con el cursor junto al mismo texto.
   Si las dos puntas escriben a la vez, gana la última. Limpiar no pregunta:
   el toast trae Deshacer por si fue sin querer. */

let noteTimer = 0;   // distinto de 0 = hay algo escrito acá que todavía no salió

function guardarNotepad({ ya = false } = {}) {
  clearTimeout(noteTimer);
  const sale = () => {
    noteTimer = 0;
    api.notepad.set(S.notepad).catch((err) => Toast.error('No se pudo guardar el notepad', err.message));
  };
  if (ya) sale();
  else noteTimer = setTimeout(sale, 250);
}

const DESDE = { celu: 'el celu', cc: 'CC', archivo: 'el archivo' };

const notepadInfo = () => {
  const d = S.notepadDesde;
  // Los avisos de paso (la letra, un Ctrl+K, un cambio de afuera) se dicen un
  // rato; si se pisan, se dice el último.
  const aviso = [
    { t: S.notepadLetraT, dura: 1600, texto: `Letra de ${S.notepadLetra} px` },
    S.notepadAviso && { t: S.notepadAviso.t, dura: 1600, texto: S.notepadAviso.texto },
    d && { t: d.t, dura: 2400, texto: `Cambió desde ${DESDE[d.desde] || 'afuera'}` },
  ].filter((a) => a && Date.now() - a.t < a.dura).sort((a, b) => b.t - a.t)[0];
  if (aviso) return aviso.texto;
  const n = S.notepad.length;
  if (!n) return 'Se guarda solo, y lo ven el celu y CC';
  const lineas = S.notepad.split('\n').length;
  return `${plural(n, 'carácter', 'caracteres')}${lineas > 1 ? ` · ${plural(lineas, 'línea', 'líneas')}` : ''}`;
};

function syncNotepad() {
  const vacio = !S.notepad;
  const copy = $('note-copy');
  const clear = $('note-clear');
  if (!copy) return;
  copy.disabled = clear.disabled = vacio;
  copy.dataset.tip = vacio ? 'No hay nada que copiar' : 'Copiar todo el texto';
  clear.dataset.tip = vacio ? 'Ya está vacío' : 'Borrar todo el texto';
  // Sin destello: con cada tecla se reiniciaba y al dejar de escribir se cortaba.
  frase($('note-info'), esc(notepadInfo()), { destello: false });
  for (const fn of alDia) fn();
}

/* Lo que se dibuja encima del campo (el cursor, los números de línea) y hay
   que poner al día cuando el texto cambia por código, sin evento de input. */
let alDia = [];

/* El cursor del Notepad: un bloque de luz con aureola, el mismo de NTX. Un
   textarea no tiene cursor de bloque, así que el nativo va transparente y el
   bloque se dibuja encima. Para saber dónde cae, un espejo invisible con la
   misma letra, el mismo ancho y los mismos cortes de renglón repite el texto
   hasta el cursor, y una marca al final dice la posición. Adentro del bloque
   va la letra que tapa, en oscuro; en la mitad apagada del parpadeo se ve la
   del campo. Con una selección no hay bloque: se ve la selección. */
const ESPEJAR = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'whiteSpace', 'overflowWrap', 'wordBreak'];
const LETRA_CURSOR = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'];

function cursorBloque(ta) {
  const caja = ta.parentElement;
  const cur = document.createElement('div');
  cur.className = 'ub-cursor';
  cur.setAttribute('aria-hidden', 'true');
  const letra = document.createElement('span');
  letra.className = 'ub-cursor__letra';
  cur.append(letra);
  const espejo = document.createElement('div');
  espejo.className = 'ub-cursor__espejo';
  espejo.setAttribute('aria-hidden', 'true');
  caja.append(espejo, cur);

  let raf = 0;
  let antes = '';
  const pintar = () => {
    raf = 0;
    if (!ta.isConnected) return;
    const cs = getComputedStyle(ta);
    for (const p of ESPEJAR) espejo.style[p] = cs[p];
    for (const p of LETRA_CURSOR) cur.style[p] = cs[p];
    espejo.style.width = `${ta.clientWidth}px`;

    const v = ta.value;
    const pos = ta.selectionEnd;
    const ch = v[pos];
    const real = ch !== undefined && ch !== '\n';
    espejo.textContent = v.slice(0, pos);
    const marca = document.createElement('span');
    marca.textContent = real ? ch : '​';   // al final de un renglón no hay letra: solo el lugar
    const ancho = document.createElement('span');
    ancho.textContent = '0';                     // mono: todas miden lo mismo
    espejo.append(marca, ancho);

    const fs = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || fs * 1.6;
    const pad = parseFloat(cs.paddingTop);
    const e = espejo.getBoundingClientRect();
    const m = marca.getBoundingClientRect();
    // El renglón sale de dónde cae la marca; la caja de una letra es más baja
    // que el renglón, así que se toma su centro.
    const renglon = pad + Math.floor((m.top + m.height / 2 - e.top - pad) / lh) * lh;
    const x = ta.offsetLeft + ta.clientLeft + (m.left - e.left);
    const y = ta.offsetTop + ta.clientTop + renglon - ta.scrollTop;
    const w = real ? m.width || ancho.getBoundingClientRect().width : ancho.getBoundingClientRect().width;
    cur.style.transform = `translate(${x}px, ${y}px)`;
    cur.style.width = `${w}px`;
    cur.style.height = `${lh}px`;
    letra.style.lineHeight = `${lh}px`;
    // Vacío: el bloque se para sobre la primera letra del texto de ayuda.
    letra.textContent = real ? ch : (!v && ta.placeholder ? ta.placeholder[0] : '');

    const visible = renglon >= ta.scrollTop - 1 && renglon + lh <= ta.scrollTop + ta.clientHeight + 1;
    const enFoco = document.activeElement === ta && document.hasFocus();
    cur.classList.toggle('is-oculto', ta.selectionStart !== ta.selectionEnd || !visible);
    cur.classList.toggle('is-quieto', !enFoco);
    // Si se movió, el parpadeo vuelve a empezar encendido: mientras se escribe no titila.
    const ahora = `${x},${y},${v.length}`;
    if (enFoco && ahora !== antes) {
      cur.classList.remove('is-latiendo');
      void cur.offsetWidth;
      cur.classList.add('is-latiendo');
    }
    antes = ahora;
  };
  const pedir = () => { if (!raf) raf = requestAnimationFrame(pintar); };

  const eventos = ['input', 'scroll', 'focus', 'blur', 'select'];
  for (const ev of eventos) ta.addEventListener(ev, pedir);
  // La letra cambia de tamaño con transición: al terminar se mide de nuevo.
  ta.addEventListener('transitionend', (e) => { if (e.propertyName === 'font-size') pedir(); });
  document.addEventListener('selectionchange', pedir);
  window.addEventListener('focus', pedir);
  window.addEventListener('blur', pedir);
  const ro = new ResizeObserver(pedir);
  ro.observe(ta);
  document.fonts?.ready.then(pedir);
  alDia.push(pedir);
  pedir();

  Router.onLeave(() => {
    cancelAnimationFrame(raf);
    document.removeEventListener('selectionchange', pedir);
    window.removeEventListener('focus', pedir);
    window.removeEventListener('blur', pedir);
    ro.disconnect();
    alDia = alDia.filter((fn) => fn !== pedir);
  });
}

/* Los números de línea, como en Notepad++: uno por renglón escrito, en la
   primera fila que ocupa (un renglón largo que se parte en dos lleva un solo
   número), y el del renglón donde está el cursor más claro. Van en una
   columna encima del margen izquierdo del campo, que se ensancha con los
   dígitos (dos como mínimo, así no salta del 9 al 10). Dónde cae cada número
   lo mide un espejo con un bloque por renglón. */
function numerosDeLinea(ta) {
  const caja = ta.parentElement;
  const col = document.createElement('div');
  col.className = 'ub-lineas';
  col.setAttribute('aria-hidden', 'true');
  const tira = document.createElement('div');
  tira.className = 'ub-lineas__tira';
  col.append(tira);
  const espejo = document.createElement('div');
  espejo.className = 'ub-cursor__espejo';
  espejo.setAttribute('aria-hidden', 'true');
  caja.append(espejo, col);

  const nums = [];
  let actual = null;
  let medido = '';
  let raf = 0;
  const marcarActual = () => {
    const n = nums[ta.value.slice(0, ta.selectionStart).split('\n').length - 1] || null;
    if (n === actual) return;
    actual?.classList.remove('is-actual');
    n?.classList.add('is-actual');
    actual = n;
  };
  const correr = () => { tira.style.transform = `translateY(${-ta.scrollTop}px)`; };
  const medir = () => {
    raf = 0;
    if (!ta.isConnected) return;
    const lineas = ta.value.split('\n');
    caja.style.setProperty('--ub-note-num', Math.max(2, String(lineas.length).length));
    const cs = getComputedStyle(ta);
    for (const p of LETRA_CURSOR) col.style[p] = cs[p];
    col.style.transform = `translate(${ta.offsetLeft + ta.clientLeft}px, ${ta.offsetTop + ta.clientTop}px)`;
    col.style.height = `${ta.clientHeight}px`;

    const clave = [ta.value, ta.clientWidth, cs.fontSize, cs.paddingLeft].join('|');
    if (clave !== medido) {
      medido = clave;
      for (const p of ESPEJAR) espejo.style[p] = cs[p];
      espejo.style.width = `${ta.clientWidth}px`;
      espejo.replaceChildren(...lineas.map((l) => {
        const d = document.createElement('div');
        d.textContent = l || '​';
        return d;
      }));
      // Primero se leen todas las alturas y después se escribe: intercalarlas
      // obliga a maquetar de nuevo en cada número.
      const tops = [...espejo.children].map((d) => d.offsetTop);
      espejo.replaceChildren();
      const lh = `${parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6}px`;
      tops.forEach((top, i) => {
        let n = nums[i];
        if (!n) {
          n = document.createElement('div');
          n.className = 'ub-lineas__n';
          n.textContent = i + 1;
          tira.append(n);
          nums.push(n);
        }
        n.style.transform = `translateY(${top}px)`;
        n.style.height = n.style.lineHeight = lh;
      });
      while (nums.length > tops.length) {
        const n = nums.pop();
        if (n === actual) actual = null;
        n.remove();
      }
    }
    marcarActual();
    correr();
  };
  const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };

  ta.addEventListener('input', pedir);
  ta.addEventListener('scroll', correr);   // en el acto, para que no se atrase un cuadro
  ta.addEventListener('transitionend', (e) => { if (e.propertyName === 'font-size') pedir(); });
  document.addEventListener('selectionchange', marcarActual);
  const ro = new ResizeObserver(pedir);
  ro.observe(ta);
  document.fonts?.ready.then(pedir);
  alDia.push(pedir);
  medir();

  Router.onLeave(() => {
    cancelAnimationFrame(raf);
    document.removeEventListener('selectionchange', marcarActual);
    ro.disconnect();
    alDia = alDia.filter((fn) => fn !== pedir);
  });
}

/* Ctrl+K corta el renglón donde está el cursor, como en nano: lo saca del
   texto y lo deja en el portapapeles. Varios Ctrl+K seguidos, sin tocar nada
   en el medio, se juntan en el portapapeles y se pegan de una. Con una
   selección corta todos los renglones que toca. Va por execCommand para que
   Ctrl+Z lo deshaga. */
let corte = null;   // { valor, pos, texto }: el último Ctrl+K, para juntar los seguidos

async function cortarLinea(ta) {
  const v = ta.value;
  if (!v) return;
  const { selectionStart: a, selectionEnd: b } = ta;
  let desde = a === 0 ? 0 : v.lastIndexOf('\n', a - 1) + 1;
  // Una selección que termina justo después de un salto no toca el renglón de abajo.
  const fin = b > a && v[b - 1] === '\n' ? b - 1 : b;
  let hasta = v.indexOf('\n', fin);
  let texto;
  if (hasta === -1) {
    texto = `${v.slice(desde)}\n`;
    hasta = v.length;
    if (desde > 0) desde -= 1;   // el último renglón se lleva el salto de antes: no queda uno vacío
  } else {
    hasta += 1;
    texto = v.slice(desde, hasta);
  }
  const seguido = corte && corte.valor === v && corte.pos === a && a === b;
  ta.setSelectionRange(desde, hasta);
  if (!document.execCommand('delete')) {
    ta.setRangeText('', desde, hasta, 'start');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const junto = seguido ? corte.texto + texto : texto;
  corte = { valor: ta.value, pos: ta.selectionStart, texto: junto };
  const n = junto.split('\n').length - 1;
  S.notepadAviso = {
    texto: n === 1 ? 'Línea cortada: quedó en el portapapeles' : `${n} líneas cortadas, juntas en el portapapeles`,
    t: Date.now(),
  };
  syncNotepad();
  setTimeout(syncNotepad, 1700);   // y después vuelve el conteo
  await attempt(() => api.copyText(junto), { errorTitle: 'No se pudo copiar la línea' });
}

/* Ctrl+F busca en el Notepad, como en VS Code: una barra flotante arriba a
   la derecha, sin distinguir mayúsculas ni tildes («cancion» encuentra
   «Canción»). Las coincidencias se pintan en una capa encima del campo, con
   un espejo que tiene la misma letra y los mismos cortes de renglón; la
   actual va como el cursor, de luz con la letra en oscuro. Enter y
   Shift+Enter (o F3 y Shift+F3) van a la siguiente y a la anterior; Esc
   cierra y deja seleccionada la que estaba marcada. */
let buscar = null;   // el buscador de la vista del Notepad que se ve

/* El texto plegado (sin tildes, en minúscula) y, para cada letra plegada, en
   qué letra del original estaba: así lo encontrado vuelve a su lugar. */
function plegar(s) {
  let t = '';
  const idx = [];
  for (let i = 0; i < s.length; i++) {
    const p = s[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < p.length; k++) idx.push(i);
    t += p;
  }
  idx.push(s.length);
  return { t, idx };
}

function buscador(ta) {
  const caja = ta.parentElement;
  const capa = document.createElement('div');
  capa.className = 'ub-hallazgos';
  capa.setAttribute('aria-hidden', 'true');
  ta.after(capa);

  let barra = null;
  let tira = null;
  let marcas = [];
  let hallados = [];   // [desde, hasta] en el texto del campo
  let actual = -1;
  let ancla = 0;       // desde dónde se busca: el cursor al abrir, o la última a la que se fue
  let pintado = { texto: null, q: null, clave: '' };
  let plegado = { texto: null, p: null };
  let raf = 0;

  const q = () => barra?.querySelector('.ub-buscar__q').value || '';
  const encontrar = (texto, consulta) => {
    const pq = plegar(consulta).t;
    if (!pq) return [];
    if (plegado.texto !== texto) plegado = { texto, p: plegar(texto) };
    const { t, idx } = plegado.p;
    const out = [];
    for (let i = t.indexOf(pq); i !== -1 && out.length < 5000; i = t.indexOf(pq, i + pq.length)) {
      out.push([idx[i], idx[i + pq.length]]);
    }
    return out;
  };

  const correr = () => {
    for (const t of capa.children) t.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  const armarTira = () => {
    const t = document.createElement('div');
    t.className = 'ub-hallazgos__tira';
    const v = ta.value;
    let desde = 0;
    marcas = hallados.map(([a, b]) => {
      if (a > desde) t.append(v.slice(desde, a));
      const m = document.createElement('mark');
      m.className = 'ub-hallazgo';
      m.textContent = v.slice(a, b);
      m.dataset.desde = a;
      t.append(m);
      desde = b;
      return m;
    });
    t.append(v.slice(desde) || '​');
    return t;
  };

  const contar = () => {
    if (!barra) return;
    const n = hallados.length;
    const sin = !!q() && !n;
    barra.classList.toggle('is-sin', sin);
    for (const b of barra.querySelectorAll('[data-ir]')) b.disabled = n === 0;
    frase(barra.querySelector('.ub-buscar__n'), n ? `${actual + 1} de ${n}` : sin ? 'Sin resultados' : '', { destello: false });
  };

  const marcar = (i, { mostrar = false } = {}) => {
    marcas[actual]?.classList.remove('is-actual');
    actual = i;
    const m = marcas[i];
    contar();
    if (!m) return;
    m.classList.add('is-actual');
    if (!mostrar) return;
    // Que se vea, y no debajo de la barra: si queda afuera, va a un tercio del alto.
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19;
    const top = m.offsetTop;
    const st = ta.scrollTop;
    const tapa = barra ? barra.offsetTop + barra.offsetHeight - ta.offsetTop : 0;
    if (top < st + tapa || top + lh > st + ta.clientHeight) {
      ta.scrollTo({ top: Math.max(0, top - ta.clientHeight / 3), behavior: 'smooth' });
    }
  };

  const pintar = ({ mostrar = false } = {}) => {
    raf = 0;
    if (!ta.isConnected) return;
    const cs = getComputedStyle(ta);
    capa.style.transform = `translate(${ta.offsetLeft + ta.clientLeft}px, ${ta.offsetTop + ta.clientTop}px)`;
    capa.style.width = `${ta.clientWidth}px`;
    capa.style.height = `${ta.clientHeight}px`;
    const texto = ta.value;
    const consulta = barra ? q() : '';
    const clave = [ta.clientWidth, cs.fontSize, cs.paddingLeft].join('|');
    if (texto === pintado.texto && consulta === pintado.q && clave === pintado.clave) return correr();

    const antes = hallados[actual]?.[0];
    const soloLaBusqueda = texto === pintado.texto && clave === pintado.clave;
    // Dónde quedan ahora las que ya estaban: si cambió el texto, se corren con él.
    const ya = new Set(pintado.texto == null ? []
      : hallados.map(([a]) => (texto === pintado.texto ? a : moverCursor(pintado.texto, texto, a))));
    hallados = encontrar(texto, consulta);
    const nuevas = new Set(hallados.map(([a]) => a));

    // Las que siguen se quedan quietas y las nuevas entran. Si cambió solo lo
    // buscado, las que ya no están se esfuman en un calco donde estaban; si
    // cambió el texto, se fueron con él.
    const vieja = tira;
    tira = armarTira();
    for (const p of ESPEJAR) tira.style[p] = cs[p];
    tira.style.width = `${ta.clientWidth}px`;
    for (const m of marcas) if (!ya.has(+m.dataset.desde)) m.classList.add('is-nueva');
    if (vieja) {
      const sale = soloLaBusqueda && [...vieja.children].some((m) => !nuevas.has(+m.dataset.desde));
      if (sale) {
        for (const m of vieja.querySelectorAll('.ub-hallazgo')) {
          m.classList.remove('is-nueva');
          if (nuevas.has(+m.dataset.desde)) m.classList.add('is-sigue');
        }
        exit(vieja, { fallback: 200 });
      } else vieja.remove();
    }
    capa.append(tira);
    pintado = { texto, q: consulta, clave };
    correr();

    // La marcada: si cambió lo buscado, la primera desde el ancla; si cambió
    // el texto, la que estaba (o la que le sigue).
    const desde = soloLaBusqueda ? ancla : antes ?? ancla;
    let i = hallados.findIndex(([a]) => a >= desde);
    if (i === -1) i = hallados.length ? 0 : -1;
    actual = -1;
    marcar(i, { mostrar: mostrar || soloLaBusqueda });
  };
  const pedir = () => { if (!raf) raf = requestAnimationFrame(() => pintar()); };

  const ir = (paso) => {
    if (!hallados.length) return;
    const i = (Math.max(actual, 0) + paso + hallados.length) % hallados.length;
    ancla = hallados[i][0];
    marcar(i, { mostrar: true });
  };

  const abrir = () => {
    // Lo seleccionado en un solo renglón es lo que se busca; si no, lo último.
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const sel = document.activeElement === ta && b > a && b - a <= 200 ? v.slice(a, b) : '';
    if (!barra) {
      ancla = a;
      barra = document.createElement('div');
      barra.className = 'ub-buscar';
      barra.setAttribute('role', 'search');
      barra.innerHTML = `${Icons.svg('search')}
        <input class="ub-buscar__q" spellcheck="false" placeholder="Buscar" aria-label="Buscar en el notepad">
        <span class="ub-buscar__n"></span>
        <button class="op-iconbtn op-iconbtn--sm" data-ir="-1" aria-label="Anterior" data-tip="Anterior" data-tip-key="Shift+Enter" data-tip-side="bottom" disabled>${Icons.svg('chevronUp')}</button>
        <button class="op-iconbtn op-iconbtn--sm" data-ir="1" aria-label="Siguiente" data-tip="Siguiente" data-tip-key="Enter" data-tip-side="bottom" disabled>${Icons.svg('chevronDown')}</button>
        <button class="op-iconbtn op-iconbtn--sm" data-cerrar aria-label="Cerrar" data-tip="Cerrar" data-tip-key="Esc" data-tip-side="bottom">${Icons.svg('close')}</button>`;
      const input = barra.querySelector('.ub-buscar__q');
      input.value = S.buscado;
      input.addEventListener('input', () => { S.buscado = input.value; pintar(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ir(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
      });
      barra.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-cerrar')) cerrar();
        else { ir(Number(b.dataset.ir)); input.focus({ preventScroll: true }); }
      });
      caja.append(barra);
    }
    const input = barra.querySelector('.ub-buscar__q');
    if (sel && !sel.includes('\n')) { input.value = S.buscado = sel; ancla = a; }
    input.focus({ preventScroll: true });
    input.select();
    pintar({ mostrar: true });
  };

  function cerrar() {
    if (!barra) return;
    const el = barra;
    barra = null;
    exit(el, { fallback: 200 });
    const h = hallados[actual];
    hallados = [];
    marcas = [];
    actual = -1;
    pintado = { texto: null, q: null, clave: '' };
    if (tira) { exit(tira, { fallback: 200 }); tira = null; }
    ta.focus({ preventScroll: true });
    if (h) ta.setSelectionRange(h[0], h[1]);
  }

  // Lo que cambie el texto, la letra o el ancho mueve las marcas.
  const siAbierto = () => { if (barra) pedir(); };
  ta.addEventListener('input', siAbierto);
  ta.addEventListener('scroll', correr);
  ta.addEventListener('transitionend', (e) => { if (e.propertyName === 'font-size') siAbierto(); });
  const ro = new ResizeObserver(siAbierto);
  ro.observe(ta);
  alDia.push(siAbierto);

  Router.onLeave(() => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    alDia = alDia.filter((fn) => fn !== siAbierto);
    buscar = null;
  });

  return { abrir, cerrar, ir, get abierto() { return !!barra; } };
}

function viewNotepad() {
  paint(`${head({ title: 'Notepad', sub: 'Lo escriben la PC, el celu y CC', actions: TOOLS.notepad() })}
  <div class="ub-note op-grow">
    <textarea class="op-textarea op-textarea--mono ub-note__text" id="note" spellcheck="false"
      placeholder="Pegá o escribí algo para tenerlo a mano: un comando, un link, una nota para CC."></textarea>
    <div class="ub-note__foot">
      <span class="ub-note__info" id="note-info"></span>
    </div>
  </div>`);
  const ta = $('note');
  wireHead('notepad');
  ta.value = S.notepad;
  buscar = buscador(ta);
  numerosDeLinea(ta);
  cursorBloque(ta);
  syncNotepad();

  ta.addEventListener('input', () => {
    S.notepad = ta.value;
    S.notepadDesde = null;
    syncNotepad();
    guardarNotepad();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyK') {
      e.preventDefault();
      cortarLinea(ta);
    }
  });
  $('note-copy').addEventListener('click', copiarNotepad);
  $('note-clear').addEventListener('click', limpiarNotepad);
  // Ctrl + rueda también agranda o achica, de a un paso por muesca.
  let rueda = 0;
  ta.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    rueda += e.deltaY;
    if (Math.abs(rueda) < 50) return;
    letraNotepad(rueda < 0 ? 1 : -1);
    rueda = 0;
  }, { passive: false });
  Router.onLeave(() => { S.notepadSel = { start: ta.selectionStart, end: ta.selectionEnd, scroll: ta.scrollTop }; });

  // El foco se pone al navegar: se vuelve al mismo lugar donde estaba el cursor.
  const sel = S.notepadSel;
  ta.focus({ preventScroll: true });
  if (sel) { ta.setSelectionRange(sel.start, sel.end); ta.scrollTop = sel.scroll; }
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* El tamaño de la letra del Notepad, aparte del zoom de la ventana: Ctrl +
   y Ctrl - de a un píxel, Ctrl 0 vuelve al de siempre. Se ve abajo un rato
   («Letra de 14 px») y queda guardado para la próxima. */
const LETRA = { min: 9, max: 32, base: 12 };
let letraTimer = 0;
let letraInfoTimer = 0;

function ponerLetra(px) {
  document.documentElement.style.setProperty('--ub-note-fs', `${px}px`);
}

function letraNotepad(paso) {
  const px = paso === 0 ? LETRA.base : Math.min(LETRA.max, Math.max(LETRA.min, S.notepadLetra + paso));
  S.notepadLetraT = Date.now();
  if (px !== S.notepadLetra) {
    S.notepadLetra = px;
    ponerLetra(px);
    clearTimeout(letraTimer);
    letraTimer = setTimeout(() => window.opal.settings.save({ notepadLetra: px }).catch(() => {}), 300);
  }
  syncNotepad();
  clearTimeout(letraInfoTimer);
  letraInfoTimer = setTimeout(syncNotepad, 1700);   // y después vuelve el conteo
}

/* Dónde queda el cursor cuando el texto cambia desde afuera: si lo cambiado
   está después, no se mueve; si está antes, se corre con el texto; si cae
   adentro de lo cambiado, va al final de lo nuevo. */
function moverCursor(viejo, nuevo, pos) {
  const max = Math.min(viejo.length, nuevo.length);
  let pre = 0;
  while (pre < max && viejo[pre] === nuevo[pre]) pre++;
  if (pos <= pre) return pos;
  let suf = 0;
  while (suf < max - pre && viejo[viejo.length - 1 - suf] === nuevo[nuevo.length - 1 - suf]) suf++;
  if (pos >= viejo.length - suf) return pos + (nuevo.length - viejo.length);
  return nuevo.length - suf;
}

function notepadDeAfuera({ text, desde }) {
  if (text === S.notepad) return;
  if (noteTimer) return;   // lo escrito acá todavía no salió: cuando salga, gana
  S.notepad = text;
  S.notepadSel = null;
  S.notepadDesde = { desde, t: Date.now() };
  const ta = $('note');
  if (ta) {
    const viejo = ta.value;
    const [a, b, top] = [ta.selectionStart, ta.selectionEnd, ta.scrollTop];
    ta.value = text;
    if (document.activeElement === ta) ta.setSelectionRange(moverCursor(viejo, text, a), moverCursor(viejo, text, b));
    ta.scrollTop = top;
    // Un destello del canto dice que el cambio vino de afuera.
    ta.classList.remove('is-remoto');
    void ta.offsetWidth;
    ta.classList.add('is-remoto');
  }
  syncNotepad();
  setTimeout(syncNotepad, 2500);   // y después vuelve el conteo
}

async function copiarNotepad() {
  if (!S.notepad) return;
  const ok = await attempt(() => api.copyText(S.notepad), { errorTitle: 'No se pudo copiar' });
  if (ok) Toast.show({ title: 'Copiado al portapapeles', icon: 'copy', duration: 2200 });
}

/* El texto se funde por color, no por opacidad (con opacity el campo sube a
   una capa propia y pierde ClearType: un «brillo» al terminar). Recién
   esfumado se vacía el campo. */
function limpiarNotepad() {
  if (!S.notepad) return;
  const antes = S.notepad;
  const sel = S.notepadSel;
  S.notepad = '';
  S.notepadSel = null;
  S.notepadDesde = null;
  guardarNotepad({ ya: true });
  const ta = $('note');
  if (ta) {
    ta.classList.add('is-limpiando');
    setTimeout(() => {
      if (!ta.isConnected) return;
      ta.value = S.notepad;
      ta.classList.remove('is-limpiando');
      ta.focus({ preventScroll: true });
      for (const fn of alDia) fn();
    }, 180);
  }
  syncNotepad();
  Toast.show({ title: 'Notepad limpio', icon: 'trash', duration: 5200, action: { label: 'Deshacer', run: () => {
    if (S.notepad) return;   // ya escribiste algo nuevo (acá o en el celu): no se pisa
    S.notepad = antes;
    S.notepadSel = sel;
    guardarNotepad({ ya: true });
    const t = $('note');
    if (t) { t.value = antes; t.focus({ preventScroll: true }); }
    syncNotepad();
  } } });
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

function updateChrome() {
  const v = Router.name;
  numero($('n-in'), S.inbox.length);
  numero($('n-out'), S.out.length);
  $('n-out').classList.toggle('is-hot', S.out.some((i) => !i.delivered));

  // Las herramientas son del encabezado de la vista: solo están las de la que se ve.
  const sweep = $('btn-sweep');
  if (sweep) {
    sweep.disabled = !S.out.some((i) => i.delivered);
    sweep.dataset.tip = sweep.disabled ? 'Quitar las ya bajadas: ninguna bajó todavía' : 'Quitar las ya bajadas';
  }
  const nuke = $('btn-nuke');
  if (nuke) {
    const vacia = v === 'celu' ? !S.out.length : !S.inbox.length;
    nuke.disabled = vacia;
    nuke.dataset.tip = v === 'celu'
      ? (vacia ? 'La bandeja ya está vacía' : 'Vaciar la bandeja')
      : (vacia ? 'No hay nada que purgar' : 'Purgar todo');
  }
}

function wireChrome() {
  $('win-min').addEventListener('click', () => win.minimize());
  $('win-close').addEventListener('click', () => win.close());
  const maxBtn = $('win-max');
  maxBtn.addEventListener('click', () => win.toggleMaximize());
  win.onMaximized((isMax) => {
    maxBtn.classList.toggle('is-b', isMax);   // los dos íconos se cruzan (.op-iconswap)
    maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
  });

  // El rail: el router marca el activo, también cuando la vista cambia sola (arrastrar, Enviar a).
  document.querySelectorAll('.op-navitem').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

  $('btn-qr').addEventListener('click', toggleQr);
  api.onShortcut(() => { if (Router.name === 'notepad') $('note')?.focus({ preventScroll: true }); });
  $('file-pick').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    addFiles(files);
  });

  document.addEventListener('keydown', onKey);
  wireDrop();
}

/* Lo del encabezado de la vista que se acaba de pintar. Muere con el pintado:
   cada visita engancha lo suyo y nada se acumula. */
function wireHead(v) {
  $('btn-folder')?.addEventListener('click', () => api.openInbox({ celu: 'outbox', notepad: 'notepad' }[v] || 'inbox'));
  $('btn-nuke')?.addEventListener('click', purgar);
  $('btn-add')?.addEventListener('click', () => $('file-pick').click());
  $('btn-sweep')?.addEventListener('click', quitarBajadas);
  if ($('thumb-size')) wireSize();
  updateChrome();
}

function quitarBajadas() {
  const done = S.out.filter((i) => i.delivered);
  if (!done.length) return;
  S.out = S.out.filter((i) => !i.delivered);
  for (const item of done) api.outbox.remove(item.name);
  sync('celu');
  Toast.show({ title: plural(done.length, 'archivo quitado', 'archivos quitados'), icon: 'sweep', duration: 2600 });
}

function onKey(e) {
  if (Modal.isOpen || Menu.isOpen) return;   // el Escape y el Enter son de ellos
  if (e.key === 'Escape') {
    if (qr) closeQr();
    else if (lightbox) closeLightbox();
    else if (buscar?.abierto) buscar.cerrar();
    return;
  }
  // Ctrl+F busca en el Notepad; F3 y Shift+F3 siguen buscando con la barra abierta.
  if (buscar && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyF') {
    e.preventDefault();
    buscar.abrir();
    return;
  }
  if (buscar?.abierto && e.key === 'F3' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    buscar.ir(e.shiftKey ? -1 : 1);
    return;
  }
  // Ctrl 1, 2 y 3 van a cada vista, en el orden del rail. Sale del código
  // físico para que ande igual con el teclado numérico.
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
    const v = n && document.querySelectorAll('.op-navitem')[n - 1]?.dataset.view;
    if (v) { e.preventDefault(); go(v); return; }
  }
  // En el Notepad, Ctrl + / Ctrl - / Ctrl 0 son de la letra, no del zoom de la ventana.
  if (Router.name === 'notepad' && e.ctrlKey && !e.altKey) {
    const { key: tecla, code } = e;
    const paso = ['+', '='].includes(tecla) || code === 'NumpadAdd' ? 1
      : ['-', '_'].includes(tecla) || code === 'NumpadSubtract' ? -1
      : tecla === '0' || code === 'Numpad0' ? 0 : null;
    if (paso !== null) { e.preventDefault(); letraNotepad(paso); return; }
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

function ponerMiniatura(px) {
  document.documentElement.style.setProperty('--ub-thumb', `${px}px`);
}

let thumbTimer = 0;
function wireSize() {
  const s = $('thumb-size');
  const put = (v) => {
    S.thumb = v;
    ponerMiniatura(v);
    s.style.setProperty('--op-pct', `${((v - s.min) / (s.max - s.min)) * 100}%`);
  };
  s.value = S.thumb;
  put(Number(s.value));
  s.addEventListener('input', () => {
    put(Number(s.value));
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => window.opal.settings.save({ miniatura: Number(s.value) }).catch(() => {}), 300);
  });
}

/* ── QR ─────────────────────────────────────────────────────────────────── */

let qr = null;

/* Desde la 0.4 el servidor pide una llave (pairing.js en el main). El QR la
   lleva adentro, así que el navegador del celu queda vinculado al escanearlo.
   La app del celu no escanea: se vincula con un código de 6 dígitos que vale
   2 minutos y que se anula al cerrar este cartel. */
let pairTimer = 0;

const pairIdleHTML = (nota = '') => `
  <button class="op-btn op-btn--secondary op-btn--sm" data-pair="start"><i data-icon="link"></i> Código para la app del celu</button>
  ${nota ? `<div class="ub-qr__text">${esc(nota)}</div>` : ''}`;

const restante = (expires) => {
  const s = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
  return `Vence en ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function pairSwap(html) {
  if (!qr) return;
  const box = qr.querySelector('.ub-qr__pair');
  deslizarAlto(qr, () => swap(box, html, { relevo: true }));
  Icons.mount(box);
}

function pairStop() {
  clearInterval(pairTimer);
  pairTimer = 0;
}

async function pairStart() {
  const p = await attempt(() => api.pair.start(), { errorTitle: 'No se pudo generar el código' });
  if (!p || !qr) return;
  const code = `${p.code.slice(0, 3)} ${p.code.slice(3)}`;
  pairSwap(`
    <div class="ub-pair__code op-mono op-copyable">${esc(code)}</div>
    <div class="ub-qr__text">Escribilo en Umbral Mobile. <span class="ub-pair__left">${restante(p.expires)}</span></div>`);
  pairStop();
  pairTimer = setInterval(() => {
    if (!qr) return pairStop();
    if (Date.now() >= p.expires) {
      pairStop();
      return pairSwap(pairIdleHTML('El código venció.'));
    }
    valor(qr.querySelector('.ub-pair__left'), restante(p.expires));
  }, 1000);
}

async function olvidarDispositivos() {
  closeQr();
  const ok = await confirmar({
    title: '¿Olvidar los dispositivos vinculados?',
    sub: 'Umbral cambia su llave. El celu y los navegadores que ya estaban vinculados van a tener que vincularse de nuevo.',
    confirmLabel: 'Olvidar',
    danger: true,
  });
  if (!ok) return;
  const nuevo = await attempt(() => api.pair.revoke(), { errorTitle: 'No se pudo cambiar la llave' });
  if (!nuevo) return;
  S.qr = nuevo;
  Toast.show({ title: 'Dispositivos olvidados', text: 'Hay que volver a vincular el celu.', icon: 'lock', duration: 3600 });
}

function toggleQr() {
  if (qr) return closeQr();
  const btn = $('btn-qr');
  const el = document.createElement('div');
  el.className = 'ub-qr';
  el.innerHTML = `
    <div class="ub-qr__code">${S.qr ? `<img src="${esc(S.qr)}" alt="QR de ${esc(S.url)}">` : ''}</div>
    <div class="ub-qr__text">Escanealo con el teléfono para abrir Umbral en su navegador. Ya va vinculado.</div>
    <div class="ub-qr__pair">${pairIdleHTML()}</div>
    <button class="op-btn op-btn--ghost op-btn--sm ub-qr__forget" data-pair="forget"><i data-icon="lock"></i> Olvidar dispositivos</button>`;
  Icons.mount(el);
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pair]');
    if (b?.dataset.pair === 'start') pairStart();
    else if (b?.dataset.pair === 'forget') olvidarDispositivos();
  });
  layer().appendChild(el);
  // El botón está al pie del rail: el cartel se apoya arriba de él por su
  // borde de abajo, así lo que crece (el código de vinculación) crece hacia arriba.
  const a = btn.getBoundingClientRect();
  el.style.left = `${Math.round(Math.max(10, a.left))}px`;
  el.style.bottom = `${Math.round(window.innerHeight - a.top + 8)}px`;
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
  if (pairTimer) { pairStop(); api.pair.cancel(); }   // el código no queda vivo con el cartel cerrado
  document.removeEventListener('pointerdown', el.__afuera);
  $('btn-qr').classList.remove('is-open');
  exit(el, { fallback: 200 });
}

/* ── Purga ──────────────────────────────────────────────────────────────── */

async function purgar() {
  if (!VIEWS[Router.name]) return;   // en el Notepad no hay nada que purgar
  const celu = Router.name === 'celu';
  const n = celu ? S.out.length : S.inbox.length;
  if (!n) return;
  const okay = await confirmar(celu
    ? { title: 'Vaciar la bandeja', sub: `Se van a quitar ${plural(n, 'archivo', 'archivos')} y el celu deja de verlos. Los originales en tu PC no se tocan.`, confirmLabel: 'Vaciar', danger: true }
    : { title: 'Purga total', sub: `Se van a eliminar ${plural(n, 'archivo recibido', 'archivos recibidos')}. No hay vuelta atrás.`, confirmLabel: 'Purgar', danger: true });
  if (!okay) return;
  if (celu) {
    S.out = [];
    await attempt(() => api.outbox.clear(), { errorTitle: 'No se pudo vaciar' });
    Toast.show({ title: 'Bandeja vacía', icon: 'check', duration: 2600 });
  } else {
    S.inbox = [];
    await attempt(() => api.recibidas.clear(), { errorTitle: 'No se pudo purgar' });
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
    // Texto arrastrado al Notepad (o al buscador): que lo suelte el propio campo.
    if (!isFiles(e) && e.target.closest?.('textarea, input')) return;
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
      acts: [['open', 'Ver novedades', 'op-btn--secondary'], ['download', 'Descargar', 'op-btn--primary']] };
    case 'downloading': return { ico: 'download', title: `Descargando la ${s.version}`, sub: `${Math.round(s.pct * 100)} %`, bar: s.pct, sticky: true };
    case 'ready': return { ico: 'check', title: `La ${s.version} está lista`, sub: 'Si no reiniciás ahora, se instala cuando salgas de Umbral.',
      acts: [['install', 'Reiniciar', 'op-btn--primary']] };
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
        <div class="ub-upd__sub op-copyable">${esc(v.sub || '')}</div>
      </div>
      ${v.sticky ? '' : `<button class="op-iconbtn op-iconbtn--sm ub-upd__x" data-upd="close" aria-label="Cerrar">${Icons.svg('close')}</button>`}
    </div>
    ${v.bar != null ? `<div class="op-meter"><div class="op-meter__fill" style="--op-pct:${(v.bar * 100).toFixed(1)}%"></div></div>` : ''}
    ${v.acts ? `<div class="ub-upd__acts">${v.acts.map(([a, l, c]) => `<button class="op-btn op-btn--sm ${c}" data-upd="${a}">${esc(l)}</button>`).join('')}</div>` : ''}`;
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
    /* Mientras baja solo cambian el número y la barra: no se rearma la tarjeta.
       El número corre con roll() desde el que se ve, sin destello: con valor()
       destellaba en cada aviso del principal, varias veces por segundo, y el
       % se prendía y apagaba sin parar. Se busca lo vivo, no lo que todavía
       se esfuma en el calco del relevo. */
    const vivo = (sel) => [...upd.querySelectorAll(sel)].find((n) => !n.closest('.op-swap-out'));
    const sub = vivo('.ub-upd__sub');
    if (sub) roll(sub, Math.round(v.bar * 100), (n) => { sub.textContent = `${Math.round(n)} %`; },
      { from: parseInt(sub.textContent, 10) });
    vivo('.op-meter__fill')?.style.setProperty('--op-pct', `${(v.bar * 100).toFixed(1)}%`);
  } else if (key !== updKey) {
    const el = upd;
    deslizarAlto(el, () => swap(el, updHTML(v), { relevo: true }));
  }
  updKey = key;

  clearTimeout(updTimer);
  if (v.auto) updTimer = setTimeout(() => { updDismissed = key; hideUpd(); }, v.auto);
}

/* Un archivo de datos ilegible se aparta (store.cjs) y la app arranca sin él.
   Sin este aviso, para Fran sus ajustes simplemente desaparecieron. */
async function tellAsides() {
  const list = await window.opal.asides().catch(() => []);
  if (!list.length) return;
  const files = [...new Set(list.map((a) => a.file))];
  Toast.show({
    tone: 'error',
    duration: 0,
    title: files.length === 1 ? `${files[0]} estaba dañado` : `${files.join(', ')} estaban dañados`,
    text: `${files.length === 1 ? 'Quedó' : 'Quedaron'} aparte en la carpeta de datos, con «.corrupto-» en el nombre, y Umbral arrancó sin ${files.length === 1 ? 'él' : 'ellos'}.`,
  });
}

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

function syncWindowColor() {
  const hex = colorToken('--op-bg');
  if (hex) win.setBackground(hex);
}

async function boot() {
  Icons.mount(document);      // reemplaza los <i data-icon> del index.html
  Tooltip.init();
  FieldMenu.init();           // el click derecho en un campo: cortar, copiar, pegar
  initClickFlash();
  initScrollFades();
  Shell.init();               // dónde caen los toasts: la esquina de la hoja de la vista
  syncWindowColor();
  $('srv-mark').outerHTML = mark('running');
  Router.define({ recibidas: () => view('recibidas'), celu: () => view('celu'), notepad: viewNotepad }, $('view'));

  let settings = {};
  try {
    const info = await api.serverInfo();
    S.url = info.url || '';
    let nota;
    [S.inbox, S.out, settings, nota] = await Promise.all([
      api.recibidas.list(), api.outbox.list(), window.opal.settings.get().catch(() => ({})), api.notepad.get(),
    ]);
    S.notepad = nota?.text || '';
    S.qr = await api.qr().catch(() => '');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo iniciar', err.message);
  }

  $('addr').textContent = S.url;
  S.thumb = Number(settings.miniatura) || 220;
  ponerMiniatura(S.thumb);
  // Hasta la 0.12 el ajuste se llamaba borradorLetra.
  S.notepadLetra = Math.min(LETRA.max, Math.max(LETRA.min, Number(settings.notepadLetra ?? settings.borradorLetra) || LETRA.base));
  ponerLetra(S.notepadLetra);
  wireChrome();
  Router.onChange(updateChrome);
  Router.go('recibidas');
  updateChrome();
  S.booting = false;

  api.recibidas.onNew((item) => {
    addIn(item);
    const t = Toast.show({ title: item.image ? 'Imagen recibida' : 'Archivo recibido', text: item.name,
      icon: item.image ? 'download' : 'file', duration: 3200 });
    if (!item.image) return;
    const thumb = document.createElement('img');
    thumb.className = 'ub-toast-thumb';
    thumb.src = item.url;
    thumb.alt = '';
    t.el.querySelector(':scope > .op-icon')?.replaceWith(thumb);
  });
  api.pair.onDone((d) => {
    if (pairTimer) { pairStop(); pairSwap(pairIdleHTML('Listo, quedó vinculado.')); }
    Toast.show({ title: 'Celu vinculado', text: d?.device || '', icon: 'check', duration: 3200 });
  });
  api.outbox.onAdded((list, opts) => addOut(list, opts));
  api.notepad.onChanged(notepadDeAfuera);
  // /notepad, desde CC: la ventana ya vino al frente, falta la vista.
  api.notepad.onIr(() => {
    go('notepad');
    $('note')?.focus({ preventScroll: true });
  });
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
  tellAsides();

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
