/* ═══════════════════════════════════════════════════════════════════════════
   UMBRAL — renderer
   Tres vistas: Recibidas (teléfono → PC), Para el celu (PC → teléfono) y el
   Borrador, un texto de paso que comparten la PC y el celu. Las piezas son de
   Onyx: el router hace el fundido entre ellas, reconcile()
   pone la galería al día tarjeta por tarjeta, y menú, modal, toast y tooltip
   son los overlays del framework. Lo propio de Umbral es el visor, el QR, el
   velo de arrastrar y la tarjeta de actualización.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Tooltip, Toast, Menu, Modal } from './overlays.js';
import Router from './router.js';
import { initClickFlash, initScrollFades, raf2, bindSwitcher, exit, swap, numero, valor, frase, reconcile, stagger, deslizarAlto, roll } from './motion.js';
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
  inbox: [],    // recibidas: { name, url, size, mtime, image } — la más nueva primero
  out: [],      // para el celu: { name, url, size, mtime, image, delivered }
  url: '',
  qr: '',
  booting: true,
  // El Borrador: un espejo de borrador.txt, que es del main.
  borrador: '',
  borradorDesde: null, // { desde, t }: el último cambio que vino de afuera, para decirlo abajo
  borradorSel: null,   // { start, end, scroll } al irse de la vista, para volver al mismo lugar
  borradorLetra: 12,   // px; se cambia con Ctrl + / Ctrl - / Ctrl 0 y queda en settings
  borradorLetraT: 0,   // cuándo se cambió, para decirlo abajo un rato
  borradorAviso: null, // { texto, t }: algo que se hizo con una tecla (Ctrl+K), para decirlo abajo un rato
};

const fmtWhen = (ms) => `${fmtClock(ms)} · ${new Date(ms).toLocaleDateString(locale.tag, { day: '2-digit', month: '2-digit' })}`;
const extOf = (n) => (n.includes('.') ? n.split('.').pop().slice(0, 5).toUpperCase() : 'ARCHIVO');

/* ══ Acciones ════════════════════════════════════════════════════════════════ */

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
      <span class="ub-file__name ox-truncate ox-copyable">${esc(item.name)}</span>
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
    list: () => S.inbox,
    card: cardIn,
    menu: menuIn,
    open: (name) => api.recibidas.open(name),
    empty: () => `
      <div class="ox-empty ub-empty">${Icons.svg('arch')}
        <div class="ox-empty__title">El umbral está despejado</div>
        <div class="ox-empty__text">Compartí imágenes o archivos desde el teléfono y aparecen acá.</div>
        ${S.url ? `<span class="ub-empty__addr ox-copyable">${esc(S.url)}</span>` : ''}
      </div>`,
  },
  celu: {
    list: () => S.out,
    card: cardOut,
    menu: menuOut,
    open: (name) => api.outbox.open(name),
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

/* ══ El Borrador ═════════════════════════════════════════════════════════════
   Una instancia intermedia para copiar y pegar: un comando, un link, unas
   palabras. Vive en borrador.txt (borrador.js, en el main) y es el mismo que
   ve Umbral Mobile. Lo que se escribe acá sale 250 ms después de la última
   tecla; lo que cambia el celu, o un editor que abra el .txt, llega por
   `borrador:changed` y entra en el lugar, con el cursor junto al mismo texto.
   Si las dos puntas escriben a la vez, gana la última. Limpiar no pregunta:
   el toast trae Deshacer por si fue sin querer. */

let borrTimer = 0;   // distinto de 0 = hay algo escrito acá que todavía no salió

function guardarBorrador({ ya = false } = {}) {
  clearTimeout(borrTimer);
  const sale = () => {
    borrTimer = 0;
    api.borrador.set(S.borrador).catch((err) => Toast.error('No se pudo guardar el borrador', err.message));
  };
  if (ya) sale();
  else borrTimer = setTimeout(sale, 250);
}

const DESDE = { celu: 'el celu', archivo: 'el archivo' };

const borradorInfo = () => {
  const d = S.borradorDesde;
  // Los avisos de paso (la letra, un Ctrl+K, un cambio de afuera) se dicen un
  // rato; si se pisan, se dice el último.
  const aviso = [
    { t: S.borradorLetraT, dura: 1600, texto: `Letra de ${S.borradorLetra} px` },
    S.borradorAviso && { t: S.borradorAviso.t, dura: 1600, texto: S.borradorAviso.texto },
    d && { t: d.t, dura: 2400, texto: `Cambió desde ${DESDE[d.desde] || 'afuera'}` },
  ].filter((a) => a && Date.now() - a.t < a.dura).sort((a, b) => b.t - a.t)[0];
  if (aviso) return aviso.texto;
  const n = S.borrador.length;
  if (!n) return 'Se guarda solo y se ve también en Umbral Mobile';
  const lineas = S.borrador.split('\n').length;
  return `${plural(n, 'carácter', 'caracteres')}${lineas > 1 ? ` · ${plural(lineas, 'línea', 'líneas')}` : ''}`;
};

function syncBorrador() {
  const vacio = !S.borrador;
  const copy = $('borr-copy');
  const clear = $('borr-clear');
  if (!copy) return;
  copy.disabled = clear.disabled = vacio;
  copy.dataset.tip = vacio ? 'No hay nada que copiar' : 'Copiar todo el texto';
  clear.dataset.tip = vacio ? 'Ya está vacío' : 'Borrar todo el texto';
  // Sin destello: con cada tecla se reiniciaba y al dejar de escribir se cortaba.
  frase($('borr-info'), esc(borradorInfo()), { destello: false });
  for (const fn of alDia) fn();
}

/* Lo que se dibuja encima del campo (el cursor, los números de línea) y hay
   que poner al día cuando el texto cambia por código, sin evento de input. */
let alDia = [];

/* El cursor del Borrador: un bloque violeta con aureola, el mismo de NTX. Un
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
    caja.style.setProperty('--ub-borr-num', Math.max(2, String(lineas.length).length));
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
  S.borradorAviso = {
    texto: n === 1 ? 'Línea cortada: quedó en el portapapeles' : `${n} líneas cortadas, juntas en el portapapeles`,
    t: Date.now(),
  };
  syncBorrador();
  setTimeout(syncBorrador, 1700);   // y después vuelve el conteo
  await attempt(() => api.copyText(junto), { errorTitle: 'No se pudo copiar la línea' });
}

function viewBorrador() {
  paint(`<div class="ub-borr ox-grow">
    <textarea class="ox-textarea ox-textarea--mono ub-borr__text" id="borr" spellcheck="false"
      placeholder="Pegá o escribí algo para tenerlo a mano un rato: un comando, un link, unas palabras."></textarea>
    <div class="ub-borr__foot">
      <span class="ub-borr__info" id="borr-info"></span>
      <div class="ox-spacer"></div>
      <button class="ox-btn ox-btn--ghost ox-btn--sm" id="borr-clear"><i data-icon="trash"></i> Limpiar</button>
      <button class="ox-btn ox-btn--secondary ox-btn--sm" id="borr-copy"><i data-icon="copy"></i> Copiar todo</button>
    </div>
  </div>`);
  const ta = $('borr');
  Icons.mount(ta.parentElement);
  ta.value = S.borrador;
  numerosDeLinea(ta);
  cursorBloque(ta);
  syncBorrador();

  ta.addEventListener('input', () => {
    S.borrador = ta.value;
    S.borradorDesde = null;
    syncBorrador();
    guardarBorrador();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyK') {
      e.preventDefault();
      cortarLinea(ta);
    }
  });
  $('borr-copy').addEventListener('click', copiarBorrador);
  $('borr-clear').addEventListener('click', limpiarBorrador);
  // Ctrl + rueda también agranda o achica, de a un paso por muesca.
  let rueda = 0;
  ta.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    rueda += e.deltaY;
    if (Math.abs(rueda) < 50) return;
    letraBorrador(rueda < 0 ? 1 : -1);
    rueda = 0;
  }, { passive: false });
  Router.onLeave(() => { S.borradorSel = { start: ta.selectionStart, end: ta.selectionEnd, scroll: ta.scrollTop }; });

  // El foco se pone al navegar: se vuelve al mismo lugar donde estaba el cursor.
  const sel = S.borradorSel;
  ta.focus({ preventScroll: true });
  if (sel) { ta.setSelectionRange(sel.start, sel.end); ta.scrollTop = sel.scroll; }
  else ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* El tamaño de la letra del Borrador, aparte del zoom de la ventana: Ctrl +
   y Ctrl - de a un píxel, Ctrl 0 vuelve al de siempre. Se ve abajo un rato
   («Letra de 14 px») y queda guardado para la próxima. */
const LETRA = { min: 9, max: 32, base: 12 };
let letraTimer = 0;
let letraInfoTimer = 0;

function ponerLetra(px) {
  document.documentElement.style.setProperty('--ub-borr-fs', `${px}px`);
}

function letraBorrador(paso) {
  const px = paso === 0 ? LETRA.base : Math.min(LETRA.max, Math.max(LETRA.min, S.borradorLetra + paso));
  S.borradorLetraT = Date.now();
  if (px !== S.borradorLetra) {
    S.borradorLetra = px;
    ponerLetra(px);
    clearTimeout(letraTimer);
    letraTimer = setTimeout(() => window.onyx.settings.save({ borradorLetra: px }).catch(() => {}), 300);
  }
  syncBorrador();
  clearTimeout(letraInfoTimer);
  letraInfoTimer = setTimeout(syncBorrador, 1700);   // y después vuelve el conteo
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

function borradorDeAfuera({ text, desde }) {
  if (text === S.borrador) return;
  if (borrTimer) return;   // lo escrito acá todavía no salió: cuando salga, gana
  S.borrador = text;
  S.borradorSel = null;
  S.borradorDesde = { desde, t: Date.now() };
  const ta = $('borr');
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
  syncBorrador();
  setTimeout(syncBorrador, 2500);   // y después vuelve el conteo
}

async function copiarBorrador() {
  if (!S.borrador) return;
  const ok = await attempt(() => api.copyText(S.borrador), { errorTitle: 'No se pudo copiar' });
  if (ok) Toast.show({ title: 'Copiado al portapapeles', icon: 'copy', duration: 2200 });
}

/* El texto se funde por color, no por opacidad (con opacity el campo sube a
   una capa propia y pierde ClearType: un «brillo» al terminar). Recién
   esfumado se vacía el campo. */
function limpiarBorrador() {
  if (!S.borrador) return;
  const antes = S.borrador;
  const sel = S.borradorSel;
  S.borrador = '';
  S.borradorSel = null;
  S.borradorDesde = null;
  guardarBorrador({ ya: true });
  const ta = $('borr');
  if (ta) {
    ta.classList.add('is-limpiando');
    setTimeout(() => {
      if (!ta.isConnected) return;
      ta.value = S.borrador;
      ta.classList.remove('is-limpiando');
      ta.focus({ preventScroll: true });
      for (const fn of alDia) fn();
    }, 180);
  }
  syncBorrador();
  Toast.show({ title: 'Borrador limpio', icon: 'trash', duration: 5200, action: { label: 'Deshacer', run: () => {
    if (S.borrador) return;   // ya escribiste algo nuevo (acá o en el celu): no se pisa
    S.borrador = antes;
    S.borradorSel = sel;
    guardarBorrador({ ya: true });
    const t = $('borr');
    if (t) { t.value = antes; t.focus({ preventScroll: true }); }
    syncBorrador();
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

let syncSeg = () => {};

function updateChrome() {
  const v = Router.name;
  numero($('n-in'), S.inbox.length);
  numero($('n-out'), S.out.length);
  $('n-out').classList.toggle('is-hot', S.out.some((i) => !i.delivered));

  const sweep = $('btn-sweep');
  sweep.disabled = !S.out.some((i) => i.delivered);
  sweep.dataset.tip = sweep.disabled ? 'Quitar las ya bajadas: ninguna bajó todavía' : 'Quitar las ya bajadas';

  // El Borrador no tiene miniaturas ni nada que purgar; su carpeta es la del .txt.
  $('size-tools').hidden = v === 'borrador';
  $('nuke-tools').hidden = v === 'borrador';

  const nuke = $('btn-nuke');
  const vacia = v === 'celu' ? !S.out.length : !S.inbox.length;
  nuke.disabled = vacia;
  nuke.dataset.tip = v === 'celu'
    ? (vacia ? 'La bandeja ya está vacía' : 'Vaciar la bandeja')
    : (vacia ? 'No hay nada que purgar' : 'Purgar todo');

  $('btn-folder').dataset.tip = { celu: 'Abrir la carpeta de la bandeja', borrador: 'Mostrar borrador.txt en su carpeta' }[v]
    || 'Abrir la carpeta de lo recibido';
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
  $('btn-folder').addEventListener('click', () => api.openInbox({ celu: 'outbox', borrador: 'borrador' }[Router.name] || 'inbox'));
  $('btn-nuke').addEventListener('click', purgar);
  api.onShortcut(() => { if (Router.name === 'borrador') $('borr')?.focus({ preventScroll: true }); });
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
  // Ctrl 1, 2 y 3 van a cada pestaña, en el orden del segmentado. Sale del
  // código físico para que ande igual con el teclado numérico.
  if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
    const v = n && $('seg').querySelectorAll('.ox-segmented__opt')[n - 1]?.dataset.value;
    if (v) { e.preventDefault(); go(v); return; }
  }
  // En el Borrador, Ctrl + / Ctrl - / Ctrl 0 son de la letra, no del zoom de la ventana.
  if (Router.name === 'borrador' && e.ctrlKey && !e.altKey) {
    const { key: tecla, code } = e;
    const paso = ['+', '='].includes(tecla) || code === 'NumpadAdd' ? 1
      : ['-', '_'].includes(tecla) || code === 'NumpadSubtract' ? -1
      : tecla === '0' || code === 'Numpad0' ? 0 : null;
    if (paso !== null) { e.preventDefault(); letraBorrador(paso); return; }
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

/* Desde la 0.4 el servidor pide una llave (pairing.js en el main). El QR la
   lleva adentro, así que el navegador del celu queda vinculado al escanearlo.
   La app del celu no escanea: se vincula con un código de 6 dígitos que vale
   2 minutos y que se anula al cerrar este cartel. */
let pairTimer = 0;

const pairIdleHTML = (nota = '') => `
  <button class="ox-btn ox-btn--secondary ox-btn--sm" data-pair="start"><i data-icon="link"></i> Código para la app del celu</button>
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
    <div class="ub-pair__code ox-mono ox-copyable">${esc(code)}</div>
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
  const ok = await Modal.confirm({
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
    <button class="ox-btn ox-btn--ghost ox-btn--sm ub-qr__forget" data-pair="forget"><i data-icon="lock"></i> Olvidar dispositivos</button>`;
  Icons.mount(el);
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pair]');
    if (b?.dataset.pair === 'start') pairStart();
    else if (b?.dataset.pair === 'forget') olvidarDispositivos();
  });
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
  if (pairTimer) { pairStop(); api.pair.cancel(); }   // el código no queda vivo con el cartel cerrado
  document.removeEventListener('pointerdown', el.__afuera);
  $('btn-qr').classList.remove('is-open');
  exit(el, { fallback: 200 });
}

/* ── Purga ──────────────────────────────────────────────────────────────── */

async function purgar() {
  if (!VIEWS[Router.name]) return;   // en el Borrador no hay nada que purgar
  const celu = Router.name === 'celu';
  const n = celu ? S.out.length : S.inbox.length;
  if (!n) return;
  const okay = await Modal.confirm(celu
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
    // Texto arrastrado al Borrador: que lo suelte el propio campo.
    if (!isFiles(e) && e.target.closest?.('textarea')) return;
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
    /* Mientras baja solo cambian el número y la barra: no se rearma la tarjeta.
       El número corre con roll() desde el que se ve, sin destello: con valor()
       destellaba en cada aviso del principal, varias veces por segundo, y el
       % se prendía y apagaba sin parar. Se busca lo vivo, no lo que todavía
       se esfuma en el calco del relevo. */
    const vivo = (sel) => [...upd.querySelectorAll(sel)].find((n) => !n.closest('.ox-swap-out'));
    const sub = vivo('.ub-upd__sub');
    if (sub) roll(sub, Math.round(v.bar * 100), (n) => { sub.textContent = `${Math.round(n)} %`; },
      { from: parseInt(sub.textContent, 10) });
    vivo('.ox-meter__fill')?.style.setProperty('--ox-pct', `${(v.bar * 100).toFixed(1)}%`);
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
  Router.define({ recibidas: () => view('recibidas'), celu: () => view('celu'), borrador: viewBorrador }, $('view'));

  let settings = {};
  try {
    const info = await api.serverInfo();
    S.url = info.url || '';
    let borr;
    [S.inbox, S.out, settings, borr] = await Promise.all([
      api.recibidas.list(), api.outbox.list(), window.onyx.settings.get().catch(() => ({})), api.borrador.get(),
    ]);
    S.borrador = borr?.text || '';
    S.qr = await api.qr().catch(() => '');
  } catch (err) {
    console.error(err);
    Toast.error('No se pudo iniciar', err.message);
  }

  $('addr').textContent = S.url;
  wireSize(settings.miniatura || 220);
  S.borradorLetra = Math.min(LETRA.max, Math.max(LETRA.min, Number(settings.borradorLetra) || LETRA.base));
  ponerLetra(S.borradorLetra);
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
    t.el.querySelector(':scope > .ox-icon')?.replaceWith(thumb);
  });
  api.pair.onDone((d) => {
    if (pairTimer) { pairStop(); pairSwap(pairIdleHTML('Listo, quedó vinculado.')); }
    Toast.show({ title: 'Celu vinculado', text: d?.device || '', icon: 'check', duration: 3200 });
  });
  api.outbox.onAdded((list, opts) => addOut(list, opts));
  api.borrador.onChanged(borradorDeAfuera);
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
