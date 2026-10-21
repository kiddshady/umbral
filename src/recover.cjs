'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — si se cae la interfaz, vuelve sola
   El renderer de la ventana es un proceso aparte, y se puede caer: falta de
   memoria, un fallo de la GPU, un bug de Chromium. Sin nadie escuchando, la
   ventana quedaba en blanco y muerta, y la única salida era cerrar la app y
   volver a abrirla. Como el estado vive en el disco y en el proceso
   principal, recargar alcanza: la app arranca de nuevo, con sus datos.

   Con tope: si se cae más de `max` veces en `per` ms, algo la está tirando
   apenas arranca, y recargar sin fin sería un bucle que no deja ni cerrarla.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Engancha la recuperación a una ventana. `onGone(detalles)` se avisa en cada
 * caída (para el log); devuelve una función que la desengancha.
 */
function keepAlive(win, { max = 3, per = 60_000, delay = 300, onGone } = {}) {
  const wc = win.webContents;
  let caidas = [];
  const gone = (_e, details) => {
    // Cerrar la ventana también termina el proceso: eso no es una caída.
    if (details.reason === 'clean-exit') return;
    onGone?.(details);
    const ahora = Date.now();
    caidas = caidas.filter((t) => ahora - t < per);
    caidas.push(ahora);
    if (caidas.length > max) {
      console.error(`[recover] la interfaz se cayó ${caidas.length} veces en ${per / 1000} s: no se recarga más`);
      return;
    }
    console.error(`[recover] la interfaz se cayó (${details.reason}): se recarga`);
    setTimeout(() => { if (!win.isDestroyed()) wc.reload(); }, delay);
  };
  wc.on('render-process-gone', gone);
  return () => wc.off('render-process-gone', gone);
}

module.exports = { keepAlive };
