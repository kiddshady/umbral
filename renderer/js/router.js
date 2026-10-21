/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — router
   Una app de escritorio no tiene URLs: tiene un nombre de vista y, a lo sumo,
   un parámetro. Eso es todo lo que hace falta, y hacerlo con un router web
   (history, hash, rutas parseadas) es traer una máquina para clavar un clavo.

   Su trabajo real, el que se olvida y produce fugas, es el CICLO DE VIDA:
   antes de montar una vista nueva hay que soltar los suscriptores, timers y
   observers de la anterior. Sin eso, cada navegación deja basura escuchando y
   la app se degrada sola después de un rato de uso.
   ═══════════════════════════════════════════════════════════════════════════ */

import { calcar, recienCalcado } from './motion.js';

const routes = new Map();
const listeners = new Set();

/** Trabajo de limpieza que dejó la vista actual. Se vacía al navegar. */
let cleanups = [];

let current = { name: null, param: null };
let host = null;

/**
 * Declara las vistas.
 *   Router.define({
 *     inicio: { view: viewInicio },
 *     item:   { view: viewItem, nav: 'inicio' },   // nav = qué ítem del rail se ilumina
 *   }, document.getElementById('view'));
 */
export function define(map, hostEl) {
  host = hostEl || host || document.getElementById('view');
  for (const [name, def] of Object.entries(map)) {
    routes.set(name, typeof def === 'function' ? { view: def } : def);
  }
}

/**
 * Registra limpieza para la vista que se está montando ahora.
 * Devolvé desde tu vista lo que haya que soltar:
 *   Router.onLeave(store.onEvent(repintar));
 *   Router.onLeave(() => clearInterval(id));
 */
export function onLeave(fn) {
  if (typeof fn === 'function') cleanups.push(fn);
}

function release() {
  const pending = cleanups;
  cleanups = [];
  for (const fn of pending) {
    // Una limpieza que explota no puede impedir las demás ni bloquear la
    // navegación: la vista nueva tiene que montar igual.
    try { fn(); } catch (err) { console.error('[Router] falló una limpieza:', err); }
  }
}

/** Navega. Repetir la vista+parámetro actual no hace nada (evita repintados). */
export function go(name, param = null) {
  const route = routes.get(name);
  if (!route) {
    console.warn(`[Router] no existe la vista "${name}"`);
    return false;
  }
  if (name === current.name && param === current.param) return false;

  release();
  const from = { ...current };
  current = { name, param };

  // El rail marca activo el grupo, no la vista: el detalle de un ítem sigue
  // iluminando la sección de la que salió.
  const navKey = route.nav || name;
  document.querySelectorAll('.op-navitem').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === navKey));

  /* La vista que se va pasa a un calco que se esfuma encima (calcar, en
     motion.js): sin esto se iba de un cuadro al otro y la nueva arrancaba
     desde transparente, un cuadro vacío en cada navegación.

     Salvo que el host se haya calcado hace un instante (un refresh() y un
     go() en la misma tarea): lo que hay es un estado intermedio que el calco,
     todavía casi opaco, no dejó ver. Calcarlo otra vez dejaba DOS calcos
     fundiéndose y el intermedio asomaba a mitad de camino (lo midió Onyx en
     Quire). Se descarta, y lo nuevo va directo debajo del calco que ya está.

     `__pinta` avisa que en el host vive otra vista: lo que el repintado de
     recién dejó pendiente (devolver el scroll y el foco) ya no es para ella. */
  if (host) host.__pinta = (host.__pinta ?? 0) + 1;
  const intermedio = !!host && recienCalcado(host);
  if (intermedio) host.replaceChildren();
  const saliente = intermedio || calcar(host);

  route.view(param);

  /* Si hay una vista yéndose, la nueva no anima nada: ya está entera y
     quieta debajo del calco, que es opaco, y el relevo lo hace el calco al
     esfumarse. Si entrara aflorando (subiendo desde transparente), la
     pantalla se destaparía hasta la mitad y volvería, y lo que las dos vistas
     tienen en el mismo lugar (el encabezado, las barras) temblaría. Aflora
     sola, sin nada que se vaya: al arrancar. La transición se reinicia a
     mano: sin el reflow intermedio el navegador no vuelve a dispararla. */
  if (host) host.classList.remove('op-view');
  if (host && !saliente) {
    void host.offsetWidth;
    host.classList.add('op-view');
    /* Y la clase se VA cuando la animación termina — no es prolijidad. Una
       animación de opacidad retenida (fill both) deja al contenedor como
       frontera de backdrop: cualquier vidrio ADENTRO de la vista (un velo,
       una .op-card--glass) computa su blur pero no tiene qué muestrear — el
       esmerilado no pinta y el contenido de abajo se ve nítido. Comprobado a
       píxel: con la clase puesta no esmerila; sacándola, sí. La duración se
       lee del computado para no desincronizarse con --op-t-4. */
    clearTimeout(host.__opViewTimer);
    const dur = (parseFloat(getComputedStyle(host).animationDuration) || 0.42) * 1000;
    host.__opViewTimer = setTimeout(() => host.classList.remove('op-view'), dur + 80);
  }

  listeners.forEach((fn) => fn({ ...current }, from));
  return true;
}

/** Vuelve a montar la vista actual (después de un cambio de datos de fondo).
 *  Es un fundido que no pierde el lugar (scroll, foco, revelados, cápsulas)
 *  y no vuelve a hacer entrar nada: lo hace paint() (repintar, en motion.js). */
export function refresh() {
  const route = routes.get(current.name);
  if (!route) return;
  release();
  route.view(current.param);
}

/** Se avisa después de cada navegación: (a, desde) => {} */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const Router = {
  define, go, refresh, onLeave, onChange,
  get current() { return { ...current }; },
  get name() { return current.name; },
  get param() { return current.param; },
  has: (name) => routes.has(name),
};

export default Router;
