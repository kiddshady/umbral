/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — shell
   Las variantes del chasis y lo que tiene comportamiento propio: el
   compositor de abajo y dónde caen los toasts. El dibujo vive en shell.css;
   acá solo se prenden clases en .op-app y se mide.

     Shell.set({ titlebar, statusbar, contexto, panel, composer, send })
       titlebar / statusbar / contexto   true = se ven (de fábrica, las tres)
       panel / composer                  true = se prenden (de fábrica, no)
       send                              'tallado' (de fábrica) | 'relleno'

   Shell.onChange((ahora, antes) => {}) avisa después de cada cambio: es
   donde la app dibuja lo que va adentro del panel.

   Lo que se apaga queda `inert`: guardado, el panel o el compositor siguen
   en el DOM (para plegarse con transición) pero Tab no entra.
   ═══════════════════════════════════════════════════════════════════════════ */

const app = () => document.querySelector('.op-app');

const estado = { titlebar: true, statusbar: true, contexto: true, panel: false, composer: false, send: 'tallado' };

function aplicar() {
  const a = app();
  if (!a) return;
  a.classList.toggle('sin-titlebar', !estado.titlebar);
  a.classList.toggle('sin-statusbar', !estado.statusbar);
  a.classList.toggle('sin-contexto', !estado.contexto);
  a.classList.toggle('con-panel', !!estado.panel);
  a.classList.toggle('con-composer', !!estado.composer);
  a.classList.toggle('send-relleno', estado.send === 'relleno');
  const panel = document.getElementById('panel');
  const comp = document.getElementById('composer');
  if (panel) panel.inert = !estado.panel;
  if (comp) comp.inert = !estado.composer;
}

/* ── Dónde caen los toasts ──────────────────────────────────────────────────
   Sobre la esquina de abajo a la derecha de la hoja de la vista, adentro de
   su aire; con el compositor prendido, arriba de él. Se mide en vez de
   calcularse con tokens porque las pistas viajan: durante la transición de
   un panel la esquina se mueve, y el ResizeObserver acompaña cuadro a cuadro. */
function colocarToasts() {
  const main = document.querySelector('.op-body > .op-main:not(.op-main--saliente)');
  if (!main) return;
  const m = main.getBoundingClientRect();
  const box = estado.composer ? document.querySelector('.op-composer__box')?.getBoundingClientRect() : null;
  const root = document.documentElement.style;
  root.setProperty('--op-toasts-right', `${Math.round(innerWidth - m.right + 16)}px`);
  root.setProperty('--op-toasts-bottom', `${Math.round(box && box.height ? innerHeight - box.top + 12 : innerHeight - m.bottom + 16)}px`);
}

const listeners = new Set();

let iniciado = false;
function init() {
  if (iniciado) return;
  iniciado = true;
  aplicar();
  const ro = new ResizeObserver(() => colocarToasts());
  for (const sel of ['.op-body > .op-main', '#composer']) {
    const el = document.querySelector(sel);
    if (el) ro.observe(el);
  }
  addEventListener('resize', colocarToasts);
  colocarToasts();
}

export const Shell = {
  init,
  /** Cambia una o varias variantes y devuelve cómo quedó todo. */
  set(patch = {}) {
    const antes = { ...estado };
    for (const k of Object.keys(estado)) if (k in patch) estado[k] = patch[k];
    aplicar();
    requestAnimationFrame(colocarToasts);
    const ahora = { ...estado };
    listeners.forEach((fn) => fn(ahora, antes));
    return ahora;
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get: () => ({ ...estado }),
};

/* ═══ El compositor ═════════════════════════════════════════════════════════
   Crece con lo que escribís: un gemelo oculto con el mismo ancho y la misma
   letra mide el alto, y el textarea VIAJA a ese alto (transición de height):
   medirlo con height:auto lo haría saltar. Hasta su max-height; después
   scrollea. Enter envía; Mayús+Enter es otra línea.

     Composer.init({ onSend: async (texto) => { … } })
   onSend recibe el texto ya recortado; el campo se vacía antes de llamarlo. */

export const Composer = (() => {
  let input = null, send = null, gemelo = null;

  function crecer() {
    const cs = getComputedStyle(input);
    Object.assign(gemelo.style, {
      position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0',
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxSizing: 'border-box',
      width: `${input.clientWidth}px`, font: cs.font, lineHeight: cs.lineHeight, padding: cs.padding,
    });
    gemelo.textContent = `${input.value}​`;
    const max = parseFloat(cs.maxHeight) || 168;
    const min = parseFloat(cs.minHeight) || 36;
    input.style.height = `${Math.min(max, Math.max(min, gemelo.scrollHeight))}px`;
    input.style.overflowY = gemelo.scrollHeight > max ? 'auto' : 'hidden';
    send.disabled = !input.value.trim();
  }

  function init({ onSend } = {}) {
    input = document.getElementById('composer-input');
    send = document.getElementById('composer-send');
    if (!input || !send) return;
    gemelo = document.createElement('div');
    gemelo.setAttribute('aria-hidden', 'true');
    document.body.appendChild(gemelo);
    input.style.minHeight = getComputedStyle(input).height;

    const enviar = () => {
      const texto = input.value.trim();
      if (!texto) return;
      input.value = '';
      crecer();
      onSend?.(texto);
    };
    input.addEventListener('input', crecer);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
    });
    send.addEventListener('click', enviar);
  }

  return { init, focus: () => input?.focus() };
})();
