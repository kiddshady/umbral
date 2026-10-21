/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — motion (runtime)
   La mitad JS del sistema de movimiento. Su trabajo más importante es el que
   más se olvida: que lo que se va del DOM TERMINE su animación de salida antes
   de irse. Sin esto los overlays parpadean al cerrarse y la app se siente rota.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Dos frames: garantiza que el navegador ya aplicó los estilos iniciales. */
export function raf2(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Saca un elemento del DOM DESPUÉS de su animación de salida.
 * Marca data-state="closing" (el CSS engancha ahí) y espera al animationend,
 * con un timeout de red por si el elemento no tiene animación declarada.
 *
 * Lo que se está yendo se puede REVIVIR: sacarle `data-state` antes de que
 * termine lo deja en el DOM (y `onDone` no corre). Hace falta cuando vuelve a
 * hacer falta a mitad de su salida: el número de un contador que vuelve
 * mientras se iba (contador(), abajo; cortar la salida y entrar de nuevo desde
 * 0 era un parpadeo). Si después vuelve a salir, esa salida es otra: la vieja
 * no lo saca antes de tiempo. De Onyx (Quire).
 */
export function exit(el, { fallback = 400, onDone } = {}) {
  if (!el) return Promise.resolve();
  // Ya se está yendo: la misma salida (quien espera, espera a que se vaya).
  if (el.dataset.state === 'closing') return el.__leaving || Promise.resolve();
  el.dataset.state = 'closing';

  const salida = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener('animationend', onAnim);
      const sigueYendose = el.__leaving === salida && el.dataset.state === 'closing';
      if (sigueYendose) { el.remove(); onDone?.(); }
      resolve();
    };
    // Solo nos importa la animación del propio elemento, no la de sus hijos.
    const onAnim = (e) => { if (e.target === el) finish(); };
    el.addEventListener('animationend', onAnim);
    const timer = setTimeout(finish, fallback);
  });
  el.__leaving = salida;
  return salida;
}

/** Escalona los hijos de un contenedor seteando --i (el CSS lo usa de delay). */
export function stagger(container, selector = ':scope > *', step = 1) {
  container.querySelectorAll(selector).forEach((el, i) => {
    el.style.setProperty('--i', String(i * step));
  });
}

/* ── Click-flash ────────────────────────────────────────────────────────────
   Un velo de luz que nace con el press y decae. No viaja como un ripple de
   Material: solo confirma que el click llegó, y se limpia solo. */
export function initClickFlash(root = document) {
  root.addEventListener('pointerdown', (e) => {
    const target = e.target.closest?.('.op-flashable');
    if (!target || target.disabled) return;
    const flash = document.createElement('span');
    flash.className = 'op-flash';
    target.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  });
}

/* ── Esfumado del scroll ────────────────────────────────────────────────────
   Apaga el fade del lado donde no hay nada recortado: pegado arriba no se
   esfuma arriba. Sin esto el primer item vive a media luz sin razón. */
export function scrollFade(el) {
  if (!el || el.__vcFade) return;
  el.__vcFade = true;

  const update = () => {
    const slack = el.scrollHeight - el.clientHeight;
    if (slack <= 1) {                       // no hay nada que recortar
      el.classList.add('is-top', 'is-bottom');
      return;
    }
    el.classList.toggle('is-top', el.scrollTop <= 1);
    el.classList.toggle('is-bottom', el.scrollTop >= slack - 1);
  };

  el.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(el);
  // El contenido puede cambiar de alto sin que cambie el del contenedor.
  new MutationObserver(update).observe(el, { childList: true, subtree: true });
  update();
}

/** Aplica scrollFade a todo .op-scroll que todavía no lo tenga. */
export function initScrollFades(root = document) {
  root.querySelectorAll('.op-scroll').forEach(scrollFade);
}

/* ── Segmentados y tabs ─────────────────────────────────────────────────────
   Cada opción lleva su propia cápsula (o su subrayado) y se prende en su
   lugar con `.is-active`: no hay nada que medir. Hasta oct 2026 había un solo
   indicador que viajaba de una opción a la otra, y estas dos funciones le
   medían el lugar; quedan para no romper a quien las llama. */
export function syncSegmented() {}
export function syncTabs() {}

/**
 * Cablea un grupo (segmentado o tabs) para que se comporte solo.
 * onChange recibe el value del botón elegido.
 */
export function bindSwitcher(root, onChange) {
  const isSeg = root.classList.contains('op-segmented');
  const optSel = isSeg ? '.op-segmented__opt' : '.op-tab';
  /* Para un lector de pantalla, cuál es la elegida: un segmentado es un grupo
     de botones apretados o no (aria-pressed); unos tabs, una lista de tabs. */
  if (!isSeg) root.setAttribute('role', 'tablist');
  const aria = () => root.querySelectorAll(optSel).forEach((o) => {
    const on = o.classList.contains('is-active');
    if (isSeg) o.setAttribute('aria-pressed', String(on));
    else { o.setAttribute('role', 'tab'); o.setAttribute('aria-selected', String(on)); }
  });
  const sync = () => aria();

  root.addEventListener('click', (e) => {
    const opt = e.target.closest(optSel);
    if (!opt || opt.classList.contains('is-active')) return;
    root.querySelectorAll(optSel).forEach((o) => o.classList.remove('is-active'));
    opt.classList.add('is-active');
    sync();
    onChange?.(opt.dataset.value, opt);
  });

  sync();
  return sync;
}

/**
 * Cablea un `.op-switch` o un `.op-check`: alterna `is-on` con el click y le
 * dice a un lector de pantalla qué es y cómo está (role + aria-checked). Sin
 * esto un switch era «botón» a secas, prendido o apagado.
 * onChange recibe el estado nuevo. Devuelve set(on), para cambiarlo desde
 * afuera sin disparar onChange.
 */
export function bindToggle(el, onChange) {
  if (!el) return () => {};
  el.setAttribute('role', el.classList.contains('op-check') ? 'checkbox' : 'switch');
  const set = (on) => {
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
  };
  set(el.classList.contains('is-on'));
  el.addEventListener('click', () => {
    const on = !el.classList.contains('is-on');
    set(on);
    onChange?.(on, el);
  });
  return set;
}

/* ── Campo numérico ─────────────────────────────────────────────────────────
   El spinner de `<input type=number>` es de Chromium y está tapado en el CSS.
   Esto le devuelve las flechas, ya dibujadas por nosotros.

   El input NO se reemplaza: sigue siendo el dueño del valor, del foco y del
   teclado. Por eso cada paso despacha `input` Y `change` con bubbles — quien
   escuchaba al campo antes de tener flechas sigue funcionando sin tocar nada.

   Mantener apretado repite, y acelera: un campo de copias que llega a 50 de a
   un click por vez no lo usa nadie. */

const ESPERA = 380;    // antes de empezar a repetir: distingue click de aguante
const PASO_LENTO = 110;
const PASO_RAPIDO = 45;
const ACELERA_A = 1200;   // ms aguantando antes de pasar a rápido

/**
 * Cablea un `.op-stepper` (input + dos flechas).
 * onChange recibe el valor numérico ya acotado a min/max.
 */
export function bindStepper(root, onChange) {
  const input = root?.querySelector('input[type="number"]');
  if (!input) return () => {};

  const num = (attr, fallback) => {
    const v = parseFloat(input.getAttribute(attr));
    return Number.isFinite(v) ? v : fallback;
  };

  const leer = () => {
    const v = parseFloat(input.value);
    return Number.isFinite(v) ? v : num('min', 0);
  };

  /** Los topes se releen en cada paso: el max suele depender de otra cosa. */
  const acotar = (v) => Math.min(num('max', Infinity), Math.max(num('min', -Infinity), v));

  const sync = () => {
    const v = leer();
    const arriba = root.querySelector('[data-step="up"]');
    const abajo = root.querySelector('[data-step="down"]');
    if (arriba) arriba.disabled = v >= num('max', Infinity);
    if (abajo) abajo.disabled = v <= num('min', -Infinity);
  };

  function mover(dir) {
    const antes = leer();
    const v = acotar(antes + dir * num('step', 1));
    if (v === antes) { sync(); return false; }
    input.value = String(v);
    sync();
    // bubbles: los listeners suelen estar en el contenedor, no en el input.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.(v, input);
    return true;
  }

  let timer = null;
  const frenar = () => { clearTimeout(timer); timer = null; };

  function arrancar(dir, desde) {
    const transcurrido = Date.now() - desde;
    if (!mover(dir)) { frenar(); return; }
    timer = setTimeout(() => arrancar(dir, desde), transcurrido > ACELERA_A ? PASO_RAPIDO : PASO_LENTO);
  }

  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn || btn.disabled) return;
    e.preventDefault();                 // que el campo no pierda el foco
    const dir = btn.dataset.step === 'up' ? 1 : -1;
    mover(dir);
    const desde = Date.now();
    timer = setTimeout(() => arrancar(dir, desde), ESPERA);
    /* La captura del puntero es lo que hace que soltar CUENTE aunque el dedo se
       haya ido del botón. Sin esto, arrastrar afuera deja el contador corriendo
       para siempre. */
    btn.setPointerCapture?.(e.pointerId);
  });

  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(ev, frenar);
  }

  input.addEventListener('input', sync);
  sync();
  return sync;
}

/* ── Revelado de alto (grid 0fr → 1fr) ───────────────────────────────────── */
export function toggleReveal(el, open) {
  const next = open ?? !el.classList.contains('is-open');
  el.classList.toggle('is-open', next);
  return next;
}

/* ── Números que cuentan ────────────────────────────────────────────────────
   Un contador que salta de 0 a 1284 no se lee; uno que corre, sí. */
export function countTo(el, to, { from = 0, duration = 700, format = (n) => n } = {}) {
  // Repintando la misma vista, el número ya estaba en pantalla: volver a
  // contar desde 0 lo haría entrar de nuevo. Va el valor; si cambió, el
  // fundido del repintado lo muestra.
  if (asentandoAlgo()) { el.textContent = format(Math.round(to)); return; }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(Math.round(from + (to - from) * ease(t)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Marca un valor que acaba de cambiar: destella y vuelve. */
export function tick(el) {
  el.classList.remove('op-ticked');
  void el.offsetWidth;          // reinicia la animación
  el.classList.add('op-ticked');
}

/* ── Lo que se anima desde JS ───────────────────────────────────────────────
   Las listas y los tamaños no se pueden escribir en una hoja: van por la Web
   Animations API. Las duraciones y las curvas salen de tokens.css, leídas la
   primera vez que hacen falta: si cambiás --op-t-3 o --op-ease, lo de acá
   cambia con todo lo demás. Lo que no tiene token (la espera del relevo, el
   escalonado) va escrito acá. */
let tokens = null;
function T() {
  if (tokens) return tokens;
  const cs = getComputedStyle(document.documentElement);
  const ms = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? (/ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n) : fallback;
  };
  const curve = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const slow = ms('--op-t-3', 280);
  tokens = {
    in: slow, move: slow, size: slow,
    out: ms('--op-t-out', 150),   // las salidas son más cortas que las entradas
    after: 80,     // lo nuevo espera a que lo viejo casi no se vea
    step: 14,      // escalonado de las filas que entran juntas
    // Una caja que cambia de tamaño con un relevo adentro (deslizarAlto,
    // deslizarAncho): viaja en t-2 y, al achicarse, espera `pliegue` a que el
    // calco del relevo (--op-t-out, in-out) casi no se vea. Medido en Onyx.
    viaje: ms('--op-t-2', 180),
    pliegue: 100,
    ease: curve('--op-ease', 'cubic-bezier(.16, 1, .3, 1)'),
    both: curve('--op-ease-both', 'cubic-bezier(.65, 0, .35, 1)'),
    soft: curve('--op-ease-soft', 'cubic-bezier(.33, 1, .68, 1)'),
  };
  return tokens;
}

/** Una animación hecha desde JS que, si la ventana no pinta, igual termina. */
function settled(anim, ms, fn) {
  let done = false;
  const go = () => { if (!done) { done = true; fn(); } };
  anim.finished.then(go, () => {});
  setTimeout(go, ms);
}

/* ── Números que corren ─────────────────────────────────────────────────────
   Como countTo(), pero arranca de lo que se ve AHORA: cada dato nuevo retoma
   la carrera desde donde iba en vez de volver a cero o saltar. Es lo que pide
   un porcentaje que llega de a pedazos (una descarga, una sincronización).
   `to` es un número o un objeto de números; `paint` recibe el valor (o el
   objeto) de cada cuadro y escribe. La primera vez escribe sin correr, salvo
   que `from` diga qué número muestra ya el texto. */
export function roll(el, to, paint, { duration = 420, from: start0 } = {}) {
  if (!el) return;
  const obj = typeof to === 'object' && to !== null;
  if (!el.__roll && Number.isFinite(start0)) el.__roll = { cur: start0, to: start0, raf: 0 };   // lo que ya dice el texto
  const st = el.__roll;
  if (!st) { el.__roll = { cur: to, to, raf: 0 }; paint(to); return; }
  if (JSON.stringify(st.to) === JSON.stringify(to)) return;
  cancelAnimationFrame(st.raf);
  st.to = to;
  const from = st.cur;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, k) => (Number.isFinite(a) ? a + (b - a) * k : b);
  const frame = (now) => {
    if (!el.isConnected) return;
    const k = ease(Math.min(1, (now - start) / duration));
    st.cur = obj
      ? Object.fromEntries(Object.keys(to).map((key) => [key, lerp(from?.[key], to[key], k)]))
      : lerp(from, to, k);
    paint(st.cur);
    if (k < 1) st.raf = requestAnimationFrame(frame);
  };
  st.raf = requestAnimationFrame(frame);
}

/* ── Tamaño que viaja ───────────────────────────────────────────────────────
   Un elemento que cambió de tamaño va del que tenía (`from`, medido antes del
   cambio) al de ahora, en vez de saltar. Se anima el tamaño y no un transform
   porque lo que está al lado tiene que acompañarlo; es breve y en cosas
   chicas. `ignore` son hijos que se están yendo: no cuentan para el destino. */
export function glideSize(el, from, { ignore = [], width = true, height = true } = {}) {
  if (!el || !from) return;
  ignore.forEach((o) => { o.style.display = 'none'; });
  const to = { w: el.offsetWidth, h: el.offsetHeight };
  ignore.forEach((o) => { o.style.display = ''; });
  const dw = width && Math.abs(to.w - from.w) >= 1;
  const dh = height && Math.abs(to.h - from.h) >= 1;
  if (!dw && !dh) return;
  el.__glide?.cancel();
  const a = {}; const b = {};
  if (dw) { a.width = `${from.w}px`; b.width = `${to.w}px`; }
  if (dh) { a.height = `${from.h}px`; b.height = `${to.h}px`; }
  /* Si se ACHICA con algo yéndose adentro, primero se va lo de adentro y
     recién después se pliega la caja. Al revés, la caja cortaba lo que todavía
     se veía casi entero (en Prism, ocultar una contraseña larga: el segundo
     renglón salía partido al medio a los 30 ms), y eso se lee como un
     deslizamiento. Para crecer no hace falta esperar: primero se abre,
     después entra. */
  const shrinks = ignore.length > 0 && ((dw && to.w < from.w) || (dh && to.h < from.h));
  // Mientras viaja, lo que todavía no entra no se desborda de la caja.
  el.__glide = el.animate([{ ...a, overflow: 'hidden' }, { ...b, overflow: 'hidden' }], shrinks
    ? { duration: T().size - 40, delay: T().out - 50, easing: T().both, fill: 'backwards' }
    : { duration: T().size, easing: T().ease });
}

/* ── swap: reescribir un bloque sin cortes ──────────────────────────────────
   Un `innerHTML` a secas es un corte: lo viejo desaparece en el cuadro en que
   llega lo nuevo. Es el swap() de Onyx (octubre de 2026), el mismo en las dos
   plantillas, así que lo que se escribe sobre él (frase, ocupar, contador…)
   se porta copiando. Cada caso pide algo distinto:

   · APARECE (vacío → algo): lo nuevo entra con un fundido.
   · SE VA (algo → vacío): cada hijo termina de irse antes de salir del DOM.
     Hijo por hijo y no en una caja: si el contenedor es una grilla, una caja
     en el medio desarmaría las filas mientras se esfuman.
   · CAMBIA DE VALORES (algo → algo): se reescribe en el lugar y SIN volver a
     animar. Una ficha que se recalcula seguido destellaba en cada cambio.
   · CAMBIA DE ESTADO (`relevo`: pista → cargando → resultado, un rótulo por
     otro): lo viejo se esfuma en un calco ENCIMA, en el mismo lugar, y lo
     nuevo asoma cuando lo viejo ya va por un tercio. El calco copia el acomodo
     del contenedor para que lo viejo no se mueva mientras se va.
     Con `dir` (1 sube, -1 baja) es un relevo con dirección: lo viejo se va
     hacia un lado y lo nuevo llega del otro (un contador que avanza o
     retrocede). Es lo que hacía el swap() de antes de Opal.
   · CAMBIA DE FORMA UN BLOQUE GRANDE (`fundido`: una tabla que gana o pierde
     columnas): la espera del relevo destapa, y el bloque entero queda a
     media luz. Con fundido el calco lleva un fondo opaco (ver fondoDetras) y
     va por encima del `th` sticky de la tabla nueva, y lo nuevo está entero y
     quieto debajo desde el primer cuadro.

   En los dos, el calco conserva la caja que tenía lo viejo (ancho, alto y
   dónde caía), no la del contenedor ya con lo nuevo: con `inset: 0`, una
   frase que se iba dentro de una caja más angosta se partía en dos renglones
   mientras se esfumaba, y una más ancha se corría.

   Con el mismo HTML de la última vez no hace nada: se puede llamar en cada
   refresco. La primera vez, si `html` es lo que el elemento ya dice, tampoco.
   Y si lo de antes todavía estaba ENTRANDO, lo nuevo sigue desde el mismo
   punto del fundido en vez de cortarlo.

   Antes de octubre de 2026 el swap() de Opal relevaba SIEMPRE (`{ dir, size }`,
   con celdas `.op-swap__item`). Si traés este archivo a una app vieja: lo que
   era `swap(el, html)` y tiene que cruzarse pasa a `{ relevo: true }`, y
   `size` es `deslizarAncho(el, () => swap(el, html, { relevo: true }))`. */
const ultimo = new WeakMap();

export function swap(el, html, { relevo = false, fundido = false, dir = 0 } = {}) {
  if (!el) return;
  if (ultimo.get(el) === html) return;
  const primera = !ultimo.has(el);
  ultimo.set(el, html);
  if (primera && el.innerHTML === html) return;
  const sentido = dir > 0 ? 'up' : dir < 0 ? 'down' : '';
  if (sentido) relevo = true;

  const viejos = [...el.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('op-swap-out')));
  const antes = viejos.some((n) => n.nodeType === 1 || n.textContent.trim());
  const despues = html.trim() !== '';
  if (!antes && !despues) return;

  // Lo que todavía se estaba yendo EN el flujo se corta: si no, durante el
  // fundido habría dos juegos de filas.
  if (despues) el.querySelectorAll(':scope > .op-swap-out:not(.op-swap-out--over)').forEach((n) => n.remove());

  // Solo las entradas: lo que gira para siempre (un spinner) no se toca.
  const finitas = () => el.getAnimations({ subtree: true })
    .filter((a) => a.effect?.getTiming().iterations !== Infinity);

  if (antes && despues && !relevo && !fundido) {
    const enCurso = finitas().filter((a) => a.playState === 'running').map((a) => a.currentTime);
    const t = enCurso.length ? Math.max(...enCurso) : null;
    el.innerHTML = html;
    if (t != null) for (const n of el.children) entrar(n);
    for (const a of finitas()) { if (t != null) a.currentTime = t; else a.cancel(); }
    return;
  }

  // Lo que todavía estaba ENTRANDO no se da por terminado: finish() lo llevaba
  // a opaco y el calco lo esfumaba desde ahí, y dos relevos seguidos
  // («Buscando…» y el resultado a los 30 ms) mostraban entero, un instante, un
  // estado que nunca se había visto. Lo que no había asomado se va sin calco;
  // lo que iba a mitad de camino sale desde la opacidad que tenía.
  const aMitad = new Map();
  for (const n of viejos) {
    if (n.nodeType !== 1 || !n.classList.contains('op-swap-in') || n.classList.contains('is-settled')) continue;
    const op = +getComputedStyle(n).opacity;
    if (op < 0.02) n.remove(); else aMitad.set(n, op);
  }
  const vivos = viejos.filter((n) => n.isConnected);
  const quedan = vivos.some((n) => n.nodeType === 1 || n.textContent.trim());
  // Si algo de antes se sigue yendo, lo nuevo igual espera su turno.
  const yendose = !!el.querySelector(':scope > .op-swap-out');

  if (antes && !despues) {
    for (let n of vivos) {
      // Un texto suelto no puede salir animado: se borraba de golpe. Va en un
      // <span> y sale como los demás.
      if (n.nodeType === 3 && n.textContent.trim()) {
        const s = document.createElement('span');
        n.replaceWith(s);
        s.append(n);
        n = s;
      }
      if (n.nodeType !== 1) { n.remove(); continue; }
      // La salida no tiene `from`: parte de la opacidad de abajo, que sin esto
      // sería 1 aunque lo estuviera agarrando a mitad de su entrada.
      if (aMitad.has(n)) n.style.opacity = String(aMitad.get(n));
      n.classList.remove('op-swap-in', 'is-after');
      n.classList.add('op-swap-out');
      n.inert = true;
      exit(n, { fallback: 220 });
    }
    return;
  }

  let calco = null;
  let caja = null;
  if (quedan) {
    caja = cajaDe(el);
    calco = document.createElement('div');
    calco.className = `op-swap-out op-swap-out--over${fundido ? ' op-swap-out--fundido' : ''}${sentido ? ` op-swap-out--${sentido}` : ''}`;
    calco.inert = true;
    calco.setAttribute('aria-hidden', 'true');
    calco.append(...vivos);
    for (const x of calco.querySelectorAll('[id]')) x.removeAttribute('id');
    if (getComputedStyle(el).position === 'static') el.classList.add('op-swap-host');
    if (fundido) {
      calco.style.background = fondoDetras(el);
      calco.style.backgroundAttachment = 'fixed';
    }
    el.prepend(calco);
    // Mover un nodo le reinicia las animaciones CSS: lo que tenía su propia
    // entrada volvería a entrar desde cero adentro del calco que se va. Se da
    // por terminada, salvo la de lo que venía entrando: esa se cancela (una
    // de CSS cancelada no vuelve mientras no cambie su nombre) y queda en la
    // opacidad en que se la agarró.
    for (const a of calco.getAnimations({ subtree: true })) {
      if (aMitad.has(a.effect?.target)) a.cancel();
      else if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    }
    for (const [n, op] of aMitad) n.style.opacity = String(op);
    exit(calco, { fallback: 220 });
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  // Un texto suelto no se puede animar: aparecía entero de golpe debajo de lo
  // viejo que se estaba yendo. Va en un <span> (con clase: con `dir`, el CSS
  // lo hace inline-block, que si no un transform en línea no se mueve).
  for (const n of [...tpl.content.childNodes]) {
    if (n.nodeType !== 3 || !n.textContent.trim()) continue;
    const s = document.createElement('span');
    s.className = 'op-swap-texto';
    n.replaceWith(s);
    s.append(n);
  }
  // Con fundido lo nuevo no anima: está entero debajo y el calco lo destapa.
  if (!(fundido && calco)) for (const n of tpl.content.children) entrar(n, quedan || yendose, sentido);
  el.append(tpl.content);

  // Con dirección ya no sube ni baja (hasta oct 2026, 5 px): destella, como
  // un número que cambió.
  if (sentido) tick(el);

  // El calco, clavado en la caja vieja: medida ya con lo nuevo adentro.
  if (calco) {
    const ahora = cajaDe(el);
    Object.assign(calco.style, {
      inset: 'auto',
      left: `${caja.left - ahora.left}px`,
      top: `${caja.top - ahora.top}px`,
      width: `${caja.w}px`,
      height: `${caja.h}px`,
    });
  }
}

/** El texto de un elemento: swap() con el texto escapado. */
export const swapText = (el, text, opts) => swap(el, esc(text), opts);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* La caja de relleno de `el` (donde se apoya un hijo absoluto), con
   decimales. clientWidth redondea: a una frase de 105,06 px le daba 105 y
   no entraba —se partía en dos renglones igual—. */
function cajaDe(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  return {
    left: r.left + bl,
    top: r.top + bt,
    w: r.width - bl - (parseFloat(cs.borderRightWidth) || 0),
    h: r.height - bt - (parseFloat(cs.borderBottomWidth) || 0),
  };
}

/* El fondo que tiene que llevar el calco de un fundido para tapar lo nuevo sin
   que se note un parche. En Onyx es el primer color opaco hacia arriba; en
   Opal casi nada es opaco: una card es relleno translúcido sobre la vista, y
   la vista es transparente sobre la niebla. Así que se apilan los rellenos
   translúcidos que hay de acá hacia arriba sobre lo que corte:
   · un color opaco: ese;
   · el chasis (.op-app): la niebla, --op-sustrato, con attachment fixed para
     que caiga donde cae la de .op-fog (lo mismo que el calco de la vista);
   · una hoja de vidrio (backdrop-filter): lo que esmerila no se puede copiar,
     y lo que hay detrás de un overlay es casi parejo: --op-bg. */
function fondoDetras(el) {
  const capas = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.classList.contains('op-app')) return [...capas, 'var(--op-sustrato)', 'var(--op-bg)'].join(', ');
    const cs = getComputedStyle(n);
    const a = alfaDe(cs.backgroundColor);
    if (a >= 1) return [...capas, cs.backgroundColor].join(', ');
    if (a > 0) capas.push(`linear-gradient(${cs.backgroundColor}, ${cs.backgroundColor})`);
    if (cs.backdropFilter && cs.backdropFilter !== 'none') break;
  }
  return [...capas, 'var(--op-bg)'].join(', ');
}

/** La opacidad de un color computado: `rgba(…, a)`, `oklch(… / a)` o sin alfa. */
function alfaDe(color) {
  if (!color || color === 'transparent') return 0;
  const barra = color.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (barra) return Number(barra[1]) / (barra[2] ? 100 : 1);
  const rgba = color.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

function entrar(n, tarde = false, sentido = '') {
  n.classList.add('op-swap-in');
  if (tarde) n.classList.add('is-after');
  if (sentido) n.classList.add(`op-swap-in--${sentido}`);
  // Terminada la entrada se apaga con una clase y no con style.animation: un
  // fill `both` retenido deja la opacidad clavada, y un inline le ganaría
  // después a la regla de salida.
  n.addEventListener('animationend', function fin(ev) {
    if (ev.target !== n) return;
    n.removeEventListener('animationend', fin);
    n.classList.add('is-settled');
  });
}

/* ── Lo que cambia con la app andando ───────────────────────────────────────
   Para lo que se pone al día SIN repintar la vista: un textContent o un
   innerHTML a secas cambian de un cuadro al otro. De Onyx (octubre de 2026),
   que los juntó de Finway, Apex y Quire; antes cada app tenía su copia (Moji,
   al pasar a Opal, las suplió a mano en su app.js).
     numero(el, v)               un número suelto: en su lugar, con destello
     frase(el, html)             una frase: si cambiaron solo sus cifras,
                                 destella; si cambió la frase, relevo
                                 (las dos con `{ destello: false }` para un
                                 progreso: en su lugar, sin destello)
     valor(el, html)           algo que cambia MUY seguido (las flechas de un
                                 stepper apretadas): siempre en su lugar
     celda(el, i)                los estados de algo en la misma celda: la
                                 caja no cambia nunca, se cruzan en su lugar
     deslizarAlto(el, cambio)    la caja va de su alto al nuevo, no salta
     deslizarAncho(el, cambio)   lo mismo a lo ancho (un ítem de una fila)
     ocupar(btn, ocupado, html)  un botón libre ↔ ocupado; con una celda
                                 adentro, sin cambiar de ancho
     contador(el, n)             un contador que aparece, cambia y se va */

const reducido = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Un número suelto (un contador, un monto): se reescribe en su lugar y
    destella en el acento. No se apaga: tipeando cambia en cada tecla, y
    apagarse y prenderse en cada una se leería como un parpadeo. El primer
    llenado (el elemento vacío) no es un cambio y no destella: por eso un
    contador del chrome nace vacío en el HTML, no en «0» —si no, el primer
    dato cuenta como cambio y queda teñido mientras se va el splash—.

    `{ destello: false }` es para un progreso (el % de una descarga o de una
    instalación): cambia varias veces por segundo, cada destello arrancaba
    antes de que terminara el anterior y el número se prendía y apagaba sin
    parar, como un bug. El destello es para un valor que cambió porque alguien
    lo cambió, no para uno que corre solo. Para que el % corra suave en vez
    de saltar, roll() (que no destella). Igual que en Onyx (oct 2026). */
export function numero(el, v, { destello = true } = {}) {
  if (!el) return;
  const texto = String(v);
  if (el.textContent === texto) return;
  const primero = el.textContent === '';
  el.textContent = texto;
  if (!primero && destello) tick(el);
}

const textoDe = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.textContent.trim();
};
/** La frase con los números tapados: «3 tomas» y «4 tomas» son la misma
    frase; «1 toma» y «2 tomas», no. */
const molde = (s) => s.replace(/\d[\d.,]*/g, '#');

/**
 * Una frase que se actualiza en vivo (`html` ya escapado). Si cambiaron solo
 * sus números, se reescribe en el lugar con un destello, como un número: un
 * relevo de la frase entera en cada tecla la apagaría y prendería sin parar.
 * Si cambió la frase, relevo; lo vacío entra o se va esfumándose.
 * Con `{ destello: false }` las cifras cambian en su lugar sin destello: es
 * para un progreso («Bajando… 41 %» → «42 %»), como en numero(). El relevo
 * cuando cambia la frase (de «Bajando» a «Instalando») sigue igual.
 */
export function frase(el, html, { destello = true } = {}) {
  if (!el) return;
  // Durante un relevo el textContent junta lo que se va con lo que llega: por
  // eso se compara contra la última frase puesta, no contra el DOM.
  const viejo = el.__frase != null ? textoDe(el.__frase) : el.textContent.trim();
  const nuevo = textoDe(html);
  el.__frase = html;
  if (viejo === nuevo) return;
  const soloCifras = viejo !== '' && nuevo !== '' && molde(viejo) === molde(nuevo);
  swap(el, html, soloCifras ? {} : { relevo: true });
  if (soloCifras && destello) tick(el);
}

/** Algo que cambia muy seguido (con las flechas apretadas, cada 45 ms): se
    reescribe SIEMPRE en el lugar con un destello, aunque cambien palabras
    («hasta el lunes» → «hasta el martes»). Un relevo en cada paso sería un
    parpadeo constante. La primera vez, lo que ya dice no es un cambio. */
export function valor(el, html) {
  if (!el || el.__valor === html) return;
  const primera = el.__valor == null && el.innerHTML === html;
  el.__valor = html;
  if (primera) return;
  swap(el, html);
  tick(el);
}

/* ¿Hay un relevo yéndose adentro de la caja? Es el calco de swap() con
   `relevo`, que conserva la caja vieja mientras se esfuma. El de `fundido`
   no cuenta: dura t-2 y lleva fondo opaco, y la espera de abajo se midió solo
   con la salida del relevo. Con un fundido adentro la caja viaja pareja. */
const releva = (el) => !!el.querySelector('.op-swap-out--over:not(.op-swap-out--fundido)[data-state="closing"]');

/* Cómo viaja una caja que cambia de tamaño. Sin nada yéndose adentro, in-out
   parejo. Con un relevo adentro importa el orden (motion-timing §10):
   · Al ACHICARSE espera `pliegue` a que el calco casi no se vea, y se pliega
     in-out, que en sus primeros cuadros casi no se mueve. Plegándose en el
     acto, la caja le cortaba la frase que se iba cuando todavía estaba casi
     entera (en Quire, congelado: a los 60 ms le tapaba 7,5 px con opacidad
     0,79). `fill: backwards` la tiene en el tamaño viejo durante la espera.
   · Al CRECER no espera, y se abre rápido (expo-out): lo nuevo entra con el
     retardo del relevo y encuentra la caja casi abierta.
   Es el glideSize() de acá, medido de nuevo en Onyx; glideSize() sigue para
   quien mide el tamaño de antes a mano. */
function viaje(achica, relevo) {
  if (!relevo) return { duration: T().viaje, easing: T().both };
  return achica
    ? { duration: T().viaje, delay: T().pliegue, easing: T().both, fill: 'backwards' }
    : { duration: T().viaje, easing: T().ease };
}

/* La caja va del alto `h0` al que tiene ahora. Mientras viaja recorta lo que
   sobra (el calco de un relevo, que conserva el alto viejo). */
function glideAlto(el, h0) {
  const h1 = el.getBoundingClientRect().height;
  if (Math.abs(h1 - h0) < 1 || reducido() || typeof el.animate !== 'function') return;
  el.__glide = el.animate([{ height: `${h0}px`, overflow: 'clip' }, { height: `${h1}px`, overflow: 'clip' }],
    viaje(h1 < h0, releva(el)));
}

/**
 * Hace `cambio()` (que cambia el contenido de `el`) y desliza el alto de `el`
 * desde el que tenía hasta el nuevo, en vez de saltar. Para una caja que
 * cambia de forma adentro de un modal o una card: sin esto todo lo de abajo
 * —y el modal entero— cambiaba de alto en un cuadro. Con un relevo adentro
 * (`deslizarAlto(el, () => swap(el, html, { relevo: true }))`), al achicarse
 * espera a que lo viejo casi no se vea (ver viaje()).
 */
export function deslizarAlto(el, cambio) {
  if (!el) { cambio(); return; }
  // El alto que se VE (si venía deslizándose, desde donde iba), y recién
  // después se corta el viaje anterior: el alto nuevo se mide sin él.
  const h0 = el.getBoundingClientRect().height;
  el.__glide?.cancel();
  cambio();
  glideAlto(el, h0);
}

/* Lo mismo a lo ancho: la caja va del ancho `w0` al que tiene ahora. Lo de
   adentro no se acomoda en dos renglones mientras viaja: queda en uno y lo
   que sobra se recorta. */
function glideAncho(el, w0) {
  const w1 = el.getBoundingClientRect().width;
  if (Math.abs(w1 - w0) < 1 || reducido() || typeof el.animate !== 'function') return;
  el.__glideAncho = el.animate([
    { width: `${w0}px`, overflow: 'clip', whiteSpace: 'nowrap' },
    { width: `${w1}px`, overflow: 'clip', whiteSpace: 'nowrap' },
  ], viaje(w1 < w0, releva(el)));
}

/**
 * deslizarAlto, a lo ancho: hace `cambio()` y el ancho de `el` va del que
 * tenía al nuevo. Para un ítem de una fila que cambia de texto (la
 * statusbar) o un botón que cambia de rótulo: sin esto cambiaba de ancho en
 * un cuadro y todo lo que tenía a la derecha saltaba. Con un relevo adentro
 * (swap con `relevo`) va solo: el calco conserva la caja vieja y no cuenta
 * para el ancho nuevo.
 */
export function deslizarAncho(el, cambio) {
  if (!el) { cambio(); return; }
  const w0 = el.getBoundingClientRect().width;
  el.__glideAncho?.cancel();
  cambio();
  glideAncho(el, w0);
}

/**
 * Prende el estado `i` de una celda (.op-celda, motion.css) y apaga los
 * demás. Todos los estados están siempre en la misma celda de la grilla, así
 * que la caja mide lo del más grande desde que nace y no cambia nunca: no
 * empuja a nadie, ni se corre, ni se achica de golpe. Se cruzan por opacidad
 * (el que se prende espera a que el otro vaya por la mitad). `el` es la
 * celda o algo que la tiene adentro (un botón). Es el arreglo del botón de
 * reiniciar de NTX, hecho pieza (oct 2026). Devuelve la celda.
 */
export function celda(el, i) {
  const c = el?.classList.contains('op-celda') ? el : el?.querySelector(':scope > .op-celda, .op-celda');
  if (!c) return null;
  [...c.children].forEach((h, j) => {
    const on = j === i;
    h.hidden = !on;
    if (on) h.removeAttribute('aria-hidden'); else h.setAttribute('aria-hidden', 'true');
  });
  return c;
}

/**
 * Un botón que hace un trabajo, libre ↔ ocupado («Exportar» ↔ «Exportando…»
 * con un spinner). Con una celda adentro (los dos rótulos ya en el HTML:
 * `<span class="op-celda"><span>Exportar</span><span hidden>Exportando…</span></span>`)
 * prende uno u otro en su lugar y el botón no cambia de ancho: es lo que va.
 * Sin celda (la forma de antes de oct 2026) hace un relevo y el ancho viaja,
 * empujando a los vecinos; `html` es el rótulo del estado al que va.
 *
 * El estado vive en `data-ocupado` y no en la memoria de swap(): esa memoria
 * es del nodo, y si la vista se repinta en medio del trabajo el botón es OTRO,
 * que nace ya ocupado. Por eso el HTML que lo arma lleva `data-ocupado="1"`
 * cuando nace ocupado; sin la marca cuenta como libre. Llamarlo con el mismo
 * estado no hace nada. Apagar el botón (`disabled`) es de quien lo llama.
 */
export function ocupar(btn, ocupado, html) {
  if (!btn) return;
  const v = ocupado ? '1' : '0';
  if ((btn.dataset.ocupado ?? '0') === v) return;
  btn.dataset.ocupado = v;
  btn.setAttribute('aria-busy', String(!!ocupado));
  if (celda(btn, ocupado ? 1 : 0)) return;
  deslizarAncho(btn, () => swap(btn, html, { relevo: true }));
}

/**
 * Un contador que solo se ve cuando hay algo que contar (el de un ítem del
 * rail). `n` en 0, vacío o null es «nada»: el contador queda vacío.
 * · aparece (vacío → n) o se va (n → vacío): se funde, con swap();
 * · cambia (n → m): en su lugar, con destello, como numero();
 * · vuelve mientras se iba (12 → 0 → 12): el que se iba se revive desde la
 *   opacidad en que estaba y, si es otro número, cambia ahí con destello. Con
 *   swap() la salida se cortaba de golpe y lo nuevo entraba desde 0.
 * No se mezclan swap() y numero() sobre el mismo nodo: cada uno lleva su
 * memoria, y numero() compara contra el textContent, que durante una salida
 * todavía tiene el número que se va. Como numero(), nace vacío en el HTML.
 */
export function contador(el, n) {
  if (!el) return;
  const v = n ? String(n) : '';
  const antes = el.__cuenta ?? el.textContent.trim();
  if (v === antes) return;
  el.__cuenta = v;
  const yendose = v ? el.querySelector(':scope > .op-swap-out[data-state="closing"]') : null;
  if (yendose) { revivirCuenta(el, yendose, v); return; }
  if (!v || !antes) { swap(el, v); return; }
  const vivo = el.querySelector(':scope > :not(.op-swap-out)');
  if (vivo) vivo.textContent = v; else el.textContent = v;
  ultimo.set(el, v);
  tick(el);
}

/* El número que se iba vuelve: sin data-state, exit() no lo saca (ver exit),
   y sube desde donde estaba con la curva de las entradas chicas. */
function revivirCuenta(el, hijo, v) {
  const op = +getComputedStyle(hijo).opacity;
  const otro = hijo.textContent.trim() !== v;
  delete hijo.dataset.state;
  hijo.classList.remove('op-swap-out');
  hijo.inert = false;
  hijo.style.opacity = '';
  hijo.textContent = v;
  // swap() tiene que saber que el contador vuelve a mostrar algo: si no, el
  // próximo 0 le parecería el mismo vacío de la última vez y no haría nada.
  ultimo.set(el, v);
  if (!reducido() && typeof hijo.animate === 'function' && op < 0.99) {
    hijo.animate([{ opacity: op }, { opacity: 1 }], { duration: T().viaje, easing: T().soft });
  }
  if (otro) tick(el);
}

/* ── Listas que se ponen al día ─────────────────────────────────────────────
   Rehacer una lista con innerHTML la hace parpadear: lo que estaba se va de
   un cuadro al otro y lo nuevo aparece todo junto, aunque sea casi lo mismo
   (buscar, filtrar, una fila que avanza). reconcile() la pone al día fila por
   fila, por clave:
   · las que siguen son el MISMO nodo, y viajan a su lugar nuevo (FLIP);
   · las que ya no están salen desde donde estaban, fuera del flujo;
   · las nuevas entran, y si había algo yéndose, esperan a que casi no se vea.

   items: [{ key, html, ...lo que quieras }]. Opciones:
     update(el, item)   pone al día una fila que sigue y cuyo html cambió
                        (sin esto se le copian los atributos, y si cambió el
                        contenido se releva con un parpadeo corto)
     created(el, item)  después de crear una fila o reemplazar su contenido
                        (cablear íconos, listeners)
     height             la caja va de su alto al nuevo (un desplegable)
     enter              false: las nuevas aparecen sin animar (no hay nada
                        que contar: la primera pintada de algo que ya entra) */
export function reconcile(box, items, { update, created, height = false, enter = true } = {}) {
  const was = new Map();
  const leaving = [];
  for (const el of box.children) {
    if (el.dataset.state === 'closing') continue;
    if (el.dataset.key != null && !was.has(el.dataset.key)) was.set(el.dataset.key, el);
    else leaving.push(el);    // lo que no tiene clave (un innerHTML de antes) también se va
  }
  const keep = new Set(items.map((it) => it.key));
  for (const [k, el] of was) if (!keep.has(k)) leaving.push(el);

  // Dónde estaba cada cosa: todas las lecturas antes de cualquier escritura.
  const box0 = box.getBoundingClientRect();
  const h0 = height ? box.offsetHeight : 0;
  const first = new Map();
  for (const el of box.children) if (el.dataset.state !== 'closing') first.set(el, el.getBoundingClientRect());
  for (const el of was.values()) { el.__move?.cancel(); el.__move = null; }

  /* El origen de la caja y la opacidad de las que se van se leen ACÁ, antes
     de escribir nada. Leídos adentro del bucle de abajo, cada uno venía justo
     después de escribirle el estilo a la fila anterior y obligaba a rehacer
     el layout de la lista entera: con dos mil filas saliendo, la ventana se
     quedaba tildada segundos (Quire, buscando «anti» en un apunte: más de un
     minuto; lector-40). */
  const y0 = box0.top + box.clientTop - box.scrollTop;
  const x0 = box0.left + box.clientLeft - box.scrollLeft;
  const ops = new Map(leaving.map((el) => [el, Number(getComputedStyle(el).opacity) || 0]));
  if (leaving.length && getComputedStyle(box).position === 'static') box.style.position = 'relative';
  for (const el of leaving) {
    const r = first.get(el);
    Object.assign(el.style, {
      position: 'absolute', margin: '0', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '0',
      top: `${r.top - y0}px`,
      left: `${r.left - x0}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    el.dataset.state = 'closing';
    const op = ops.get(el);
    const anim = el.animate([{ opacity: op }, { opacity: 0 }], { duration: T().out, easing: T().both, fill: 'forwards' });
    settled(anim, T().out + 200, () => el.remove());
  }

  const fresh = [];
  let prev = null;
  for (const it of items) {
    let el = was.get(it.key);
    if (!el) {
      el = make(it);
      fresh.push(el);
    } else if (el.__html !== it.html) {
      if (update) update(el, it); else morph(el, it, created);
      el.__html = it.html;
    }
    // A su lugar, salteando lo que se está yendo (no cuenta para el orden).
    let want = prev ? prev.nextElementSibling : box.firstElementChild;
    while (want && want !== el && want.dataset.state === 'closing') want = want.nextElementSibling;
    if (want !== el) {
      box.insertBefore(el, want);
      if (!fresh.includes(el)) quiet(el);   // moverlo le reinicia las animaciones de CSS
    }
    prev = el;
  }
  for (const el of fresh) { quiet(el); created?.(el, el.__item); }

  // Las que siguen viajan de donde estaban a donde quedaron.
  const vh = window.innerHeight;
  for (const el of was.values()) {
    if (!keep.has(el.dataset.key)) continue;
    const a = first.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    if ((a.bottom < 0 && b.bottom < 0) || (a.top > vh && b.top > vh)) continue;   // afuera: nadie lo ve
    el.__move = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: T().move, easing: T().ease });
  }

  if (enter) {
    const wait = leaving.length ? T().after : 0;
    fresh.forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: T().in, easing: T().ease, delay: wait + Math.min(i, 16) * T().step, fill: 'backwards' });
    });
  }

  if (height) glideSize(box, { w: box.offsetWidth, h: h0 }, { width: false, ignore: leaving });
  return { fresh, leaving };
}

function make(it) {
  const t = document.createElement('template');
  t.innerHTML = it.html.trim();
  const el = t.content.firstElementChild;
  el.dataset.key = it.key;
  el.__html = it.html;
  el.__inner = el.innerHTML;
  el.__item = it;
  return el;
}

/* Sin la entrada propia de la fila (la que tiene en su CSS para cuando la
   lista se pinta entera): de entrar se encarga reconcile(). Cancelada por la
   API, una animación de CSS no vuelve hasta que cambie su nombre, así que la
   salida de [data-state=closing] (exit()) sigue funcionando. */
function quiet(el) {
  for (const a of el.getAnimations()) if (a instanceof CSSAnimation && a.effect?.getTiming().iterations !== Infinity) a.cancel();
}

/* Una fila que sigue pero cambió: los atributos se copian (las clases nuevas
   corren con sus transiciones de color), y el contenido, si cambió, se releva
   con un parpadeo corto en vez de cambiar de un cuadro al otro. */
function morph(el, it, created) {
  const t = document.createElement('template');
  t.innerHTML = it.html.trim();
  const nu = t.content.firstElementChild;
  for (const { name } of [...el.attributes]) if (name !== 'data-key' && name !== 'data-state' && !nu.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of [...nu.attributes]) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  el.__item = it;
  if (nu.innerHTML === el.__inner) return;
  el.__inner = nu.innerHTML;
  el.__next = nu;
  if (el.__blink) return;               // ya hay uno en curso: usa lo último que llegue
  el.__blink = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: T().both, fill: 'forwards' });
  settled(el.__blink, 200, () => {
    const latest = el.__next;
    el.__next = null;
    el.replaceChildren(...latest.childNodes);
    created?.(el, el.__item);
    el.__blink.cancel();
    el.__blink = null;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T().in - 100, easing: T().ease });
  });
}

/* ── Plegar y desplegar ─────────────────────────────────────────────────────
   Una fila que se va de una columna se esfuma Y se pliega: así las de abajo
   suben acompañándola en vez de saltar cuando sale del DOM. expand() es lo
   mismo al revés, para una que llega. Si la fila ya se estaba yendo (exit(),
   otro collapse()), devuelve esa misma salida: borrarla en el acto era el
   salto que este helper existe para evitar. */
export function collapse(el, { duration = 200 } = {}) {
  if (!el?.isConnected) return Promise.resolve();
  // Ya se está yendo (y nadie lo revivió): esa misma salida.
  if (el.dataset.state === 'closing' && el.__leaving) return el.__leaving;
  el.dataset.state = 'closing';
  const cs = getComputedStyle(el);
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  const anim = el.animate([
    { opacity: cs.opacity, height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom },
    { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
  ], { duration, easing: T().both, fill: 'forwards' });
  return el.__leaving = new Promise((resolve) => settled(anim, duration + 200, () => { el.remove(); resolve(); }));
}

export function expand(el, { duration = T().in } = {}) {
  if (!el?.isConnected) return;
  const cs = getComputedStyle(el);
  el.animate([
    { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', overflow: 'hidden' },
    { opacity: 1, height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, overflow: 'hidden' },
  ], { duration, easing: T().ease });
}

/** Un nodo que reemplaza a otro en una fila (un ícono): el viejo se apaga, el nuevo se enciende. */
export function replaceSoft(old, node, { out = 90 } = {}) {
  if (!old?.isConnected || !old.getClientRects().length) {
    old?.replaceWith(node);
    node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: T().in - 100, easing: T().ease });
    return;
  }
  const a = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, easing: T().both, fill: 'forwards' });
  settled(a, out + 150, () => {
    if (!old.isConnected) return;
    old.replaceWith(node);
    node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: T().in - 100, easing: T().ease });
  });
}

/* ── Fundido ────────────────────────────────────────────────────────────────
   Para una superficie entera que cambia por otra (un panel): lo nuevo ya está
   quieto debajo y lo viejo, opaco y ENCIMA, se esfuma. Así la pantalla está
   tapada todo el tiempo: el relevo con espera destapaba el fondo en el medio.
   El calco lleva la clase op-dissolving (su CSS le pone el fondo opaco y lo
   sube); el contenedor tiene que apilarlos en la misma celda. */
export function dissolve(old, { fallback = 260 } = {}) {
  if (!old) return Promise.resolve();
  if (old.dataset.state === 'closing') return old.__leaving || Promise.resolve();
  old.inert = true;
  old.removeAttribute('id');
  for (const el of old.querySelectorAll('[id]')) el.removeAttribute('id');
  old.classList.add('op-dissolving');
  // Lo que tenía entrada propia la da por terminada: no vuelve a entrar adentro del calco.
  for (const a of old.getAnimations({ subtree: true })) {
    if (a.effect?.getTiming().iterations !== Infinity) a.finish();
  }
  return exit(old, { fallback });
}

/* ── Cambiar o repintar la vista ────────────────────────────────────────────
   Navegar es un fundido: la vista que se va pasa a un calco opaco encima y se
   esfuma, y la nueva está entera y quieta debajo desde el primer cuadro
   (calcar, lo usa el router). Antes la vieja se iba de un cuadro al otro y la
   nueva arrancaba desde transparente: un cuadro vacío en cada navegación.

   Repintar la MISMA vista (Router.refresh() después de guardar) era un
   innerHTML en seco, y traía cuatro cosas:
   · lo viejo se iba en el mismo cuadro en que llegaba lo nuevo;
   · todo lo que tenía entrada propia volvía a entrar;
   · los contadores (countTo) volvían a contar desde 0;
   · el lugar se perdía: el scroll volvía arriba, un revelado abierto se
     cerraba, el foco se iba y las cápsulas de los segmentados nacían de cero.
   Ahora paint() repinta con repintar(): el mismo calco que al navegar, y lo
   nuevo ASENTADO debajo, sin entradas, con los contadores en su valor y en
   el mismo lugar que lo viejo. Viene de Onyx, que lo midió en Quire y Pharos. */

/**
 * La vista que se va pasa a un calco con la misma clase que `host`, en la
 * misma celda de la grilla, y se esfuma encima (.op-main--saliente). El calco
 * va sin ids, inerte, y conserva su scroll. Si la vieja todavía estaba
 * entrando, arranca desde la opacidad y el corrimiento en que la agarró. Si
 * ya había otro calco yéndose, el nuevo va DEBAJO de ese, pegado a la vista:
 * encima, un calco opaco tapaba de golpe lo que se estaba yendo.
 */
export function calcar(host) {
  if (!host || !host.firstChild || !host.parentElement) return null;
  const cs = getComputedStyle(host);
  const calco = document.createElement(host.tagName);
  calco.className = host.className;
  calco.classList.remove('op-view');
  calco.classList.add('op-main--saliente');
  calco.setAttribute('aria-hidden', 'true');
  calco.inert = true;
  calco.style.opacity = cs.opacity;
  if (cs.transform !== 'none') calco.style.transform = cs.transform;

  const scrolls = [...host.querySelectorAll('*')]
    .filter((el) => el.scrollTop || el.scrollLeft)
    .map((el) => [el, el.scrollTop, el.scrollLeft]);
  calco.append(...host.childNodes);
  for (const el of calco.querySelectorAll('[id]')) el.removeAttribute('id');
  host.after(calco);
  for (const [el, top, left] of scrolls) { el.scrollTop = top; el.scrollLeft = left; }

  // Moverlo le reinicia las animaciones de CSS: lo que tenía entrada propia
  // volvería a entrar adentro del calco que se va. Se dan por terminadas; lo
  // que gira para siempre (un spinner) sigue girando.
  for (const a of calco.getAnimations({ subtree: true })) {
    if (a.effect?.getTiming().iterations !== Infinity) a.finish();
  }

  exit(calco, { fallback: 260 });
  host.__calcadoEn = performance.now();
  // Hasta el cuadro siguiente, lo que se ponga en host no se pintó nunca (ver
  // recienCalcado). El tope es por si la ventana no está pintando.
  const marca = host.__sinPintar = {};
  const pintado = () => { if (host.__sinPintar === marca) host.__sinPintar = null; };
  requestAnimationFrame(pintado);
  setTimeout(pintado, 100);
  return calco;
}

/**
 * Si lo que hay en `host` es un estado intermedio que el calco, todavía casi
 * opaco, no dejó ver: otro calco encima lo mostraría. Pasa con un refresh() y
 * un go() en la misma tarea (guardar algo desde una vista y navegar a otra), o
 * con una vista que pinta «cargando» y el dato a los pocos ms. Lo que llega en
 * ese rato va directo debajo del calco que ya está. Es «todavía no hubo un
 * cuadro desde el calco» o, con la ventana oculta, «hace menos de 60 ms».
 */
export function recienCalcado(host) {
  if (!host) return false;
  if (host.__sinPintar && document.visibilityState === 'visible') return true;
  return performance.now() - (host.__calcadoEn ?? -Infinity) < 60;
}

/** Mientras se asienta un repintado, countTo() no cuenta: escribe el valor.
    Cada uno con la pintada que asienta: si go() ya puso otra vista, la nueva
    cuenta como siempre. */
const asentando = new Set();
const asentandoAlgo = () => [...asentando].some((a) => a.root.__pinta === a.pinta);

/** El lugar de una vista, antes de repintarla. Se reconoce por ids. */
function fotografiar(root) {
  const f = { scrolls: [], revelados: [], foco: null };
  root.querySelectorAll('.op-scroll').forEach((el) => f.scrolls.push(el.scrollTop));
  root.querySelectorAll('.op-reveal.is-open[id]').forEach((el) => f.revelados.push(el.id));
  const act = document.activeElement;
  const dueño = act && root.contains(act) ? act.closest('[id]') : null;
  // Se reconoce por su id, o por el data-value dentro de un grupo con id; si
  // no, no hay forma honesta de encontrar su gemelo y el foco no se devuelve.
  if (dueño && root.contains(dueño) && (dueño === act || act.dataset.value != null)) {
    f.foco = { id: dueño.id, valor: dueño === act ? null : act.dataset.value };
  }
  return f;
}

/** Lo que la vista tiene que ver ANTES de cablearse: los revelados. (Los
    segmentados y los tabs ya no tienen un indicador que viaje: cada opción
    prende el suyo, así que no hay lugar que devolverles.) */
function devolverAlPintar(root, f) {
  for (const id of f.revelados) root.querySelector(`#${CSS.escape(id)}`)?.classList.add('is-open');
}

/**
 * Repinta `root` con `poner()`, que escribe lo nuevo. Si `root` ya tenía una
 * vista, es un fundido que no pierde el lugar y devuelve true; si estaba
 * vacío (o se calcó hace un instante), solo pinta.
 */
export function repintar(root, poner) {
  const f = !recienCalcado(root) && root.firstChild ? fotografiar(root) : null;
  const calco = f ? calcar(root) : null;
  poner();
  if (!calco) return false;
  devolverAlPintar(root, f);
  asentar(root, f);
  return true;
}

/* Lo nuevo queda quieto debajo del calco: sus entradas se dan por terminadas
   (lo que gira para siempre sigue, y las transiciones también: una cápsula
   que viene de donde estaba tiene que llegar viajando). La excepción son los
   plegables: un .op-plegable que nace visible se despliega desde 0 con una
   TRANSICIÓN (@starting-style), así que también hay que asentarlo, o crece
   debajo del fundido (asentarPlegables, abajo). Se hace dos veces: ahora,
   con lo que trajo el HTML, y al terminar la tarea, con lo que la vista haya
   arrancado al cablearse. Recién ahí se devuelven el scroll y el foco, que
   dependen del alto final. */
function asentar(root, f) {
  const terminar = () => {
    asentarPlegables(root);
    for (const a of root.getAnimations({ subtree: true })) {
      if (a.effect?.target === root) continue;
      if (a instanceof CSSTransition) {
        // El que ya había arrancado (algo forzó el estilo antes, como colocar
        // una cápsula), se termina. El de un pseudo no es un plegable.
        if (!a.effect?.pseudoElement && a.effect?.target?.matches?.(PLEGABLE)) a.finish();
        continue;
      }
      if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    }
  };
  /* `__pinta` cuenta las vistas que pasaron por root, y go() lo sube. Si un
     go() llega en la misma tarea, este pendiente ya no es para la vista que
     quedó: no le pone el scroll de la vieja ni le enfoca nada por un id que
     coincida. */
  const yo = { root, pinta: root.__pinta };
  asentando.add(yo);
  terminar();
  queueMicrotask(() => {
    asentando.delete(yo);
    if (root.__pinta !== yo.pinta) return;
    terminar();
    const scrolls = root.querySelectorAll('.op-scroll');
    f.scrolls.forEach((top, i) => { if (scrolls[i] && top) scrolls[i].scrollTop = top; });
    // Si la vista ya puso el foco donde quería, se respeta.
    if (f.foco && (!document.activeElement || document.activeElement === document.body)) {
      const dueño = root.querySelector(`#${CSS.escape(f.foco.id)}`);
      const el = f.foco.valor != null
        ? dueño?.querySelector(`[data-value="${CSS.escape(f.foco.valor)}"]`)
        : dueño;
      el?.focus({ preventScroll: true });
    }
  });
}

const PLEGABLE = '.op-plegable, .op-plegable--ancho';

/**
 * Pone en su lugar, sin desplegarse, los plegables visibles de `root`: les
 * apaga la transición (`.is-placing`), fuerza el estilo y se la devuelve.
 * Si todavía no tenían estilo, nacen ya abiertos (@starting-style no tiene
 * con qué transicionar); si ya venían desplegándose, sacarles la transición
 * los corta en su alto final. Uno que se prende DESPUÉS con `hidden = false`
 * se despliega como siempre.
 *
 * Lo llama solo repintar(). Una vista que se monta navegando y no quiere que
 * los suyos crezcan debajo del calco (una barra que nace visible) lo llama
 * después de pintar. Es lo que hace bindSwitcher con las cápsulas, para los
 * plegables. De Onyx (Quire).
 */
export function asentarPlegables(root) {
  if (!root) return;
  const sel = '.op-plegable:not([hidden]), .op-plegable--ancho:not([hidden])';
  const todos = [...root.querySelectorAll(sel)];
  if (root.matches?.(sel)) todos.unshift(root);
  if (!todos.length) return;
  for (const el of todos) el.classList.add('is-placing');
  for (const el of todos) void getComputedStyle(el).height;
  for (const el of todos) el.classList.remove('is-placing');
}
