/* ═══════════════════════════════════════════════════════════════════════════
   Humo de Umbral: arranca el main.cjs DE VERDAD y recorre la app.

   Se corre con `npm run smoke` (necesita Electron). Usa una carpeta de datos
   temporal y otro puerto: nunca toca el inbox ni la bandeja reales, ni choca
   con la Umbral instalada. La ventana se queda fuera de pantalla.

   El camino es el real de punta a punta: la captura entra por POST /drop
   como desde el teléfono, el archivo para el celu entra como «Enviar a» (el
   evento second-instance), y la bajada es un GET /out/file?dl=1.

   La regla que lo guía es la de Onyx: **medí dónde CAE una cosa, no solo si
   existe.**
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-humo-'));
const PORT = 4790;
process.env.UMBRAL_DATA = DIR;
process.env.UMBRAL_PORT = String(PORT);
process.env.UMBRAL_SMOKE = '1';

const BG_MAIN = (fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8')
  .match(/const BG = '(#[0-9a-f]{6})'/i)?.[1] || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const bail = (w, e) => { console.log(`ABORTADO ${w}`, e?.stack || e || ''); app.exit(3); };
process.on('unhandledRejection', (e) => bail('rechazo', e));
process.on('uncaughtException', (e) => bail('excepción', e));
setTimeout(() => bail('timeout de 120s'), 120000);

/* Un PNG de 4×3 de verdad (el servidor mira los magic bytes). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAAEcQEBVtl8zQAAAABJRU5ErkJggg==', 'base64');

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p,
      headers: body ? { 'content-type': 'image/png', 'content-length': body.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// El main real: servidor, IPC y la ventana, con lo de arriba en el entorno.
require(path.join(ROOT, 'main.cjs'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(50); }
  if (!win) return bail('la ventana no apareció');
  const errores = [];
  win.webContents.on('console-message', (e) => { if (e.level >= 2) errores.push(`${e.level}: ${e.message}`); });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await sleep(1800);

  const js = (c) => win.webContents.executeJavaScript(c);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.click(); return true; })()`);
  // Un click real es pointerdown → pointerup → click: varios overlays se cierran en pointerdown.
  const tap = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    el.click(); return true; })()`);
  const key = (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const rect = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
  const dentro = (r) => !!r && r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= r.vw && r.y + r.h <= r.vh;
  const cards = () => js(`document.querySelectorAll('#grid > .ub-card:not([data-state=closing])').length`);

  console.log('\n1. Arranque');
  ok('el splash se fue', !(await js(`!!document.getElementById('boot-splash')`)));
  ok('el shell de Onyx está montado', await js(`!!document.querySelector('.ox-titlebar') && !!document.querySelector('.ox-segmented') && !!document.getElementById('view')`));
  ok('los <i data-icon> se reemplazaron por SVG', !(await js(`!!document.querySelector('i[data-icon]')`)));
  const vista = await rect('#view');
  ok('la vista ocupa todo el ancho de la ventana (no hay rail)', !!vista && vista.x === 0 && Math.abs(vista.w - vista.vw) < 1, JSON.stringify(vista));
  ok('la vista inicial es Recibidas y está vacía', await js(`!!document.querySelector('#view .ub-empty')`));
  const addr = await js(`document.getElementById('addr').textContent`);
  ok('la dirección del servidor se ve', new RegExp(`^http://[\\d.]+:${PORT}$`).test(addr), addr);
  ok('el contador nace vacío y se llena sin destellar',
    await js(`document.getElementById('n-in').textContent === '0' && !document.querySelector('.ub-bar .ox-ticked')`));
  ok('las herramientas de la bandeja están escondidas', await js(`document.getElementById('out-tools').hidden`));
  ok('el botón de purga está apagado y dice por qué',
    await js(`(() => { const b = document.getElementById('btn-nuke'); return b.disabled && b.dataset.tip === 'No hay nada que purgar'; })()`));
  ok(`la ventana tiene el color de los tokens (${BG_MAIN})`, win.getBackgroundColor().toLowerCase().startsWith(BG_MAIN), win.getBackgroundColor());
  const seg = await js(`(() => { const s = document.getElementById('seg'); const o = s.querySelector('.is-active').getBoundingClientRect();
    const x = parseFloat(getComputedStyle(s).getPropertyValue('--seg-x')); const w = parseFloat(getComputedStyle(s).getPropertyValue('--seg-w'));
    const sr = s.getBoundingClientRect(); return { opt: o.left - sr.left, ow: o.width, x, w }; })()`);
  ok('la cápsula del segmentado nace debajo de la opción activa', Math.abs(seg.opt - seg.x) < 1 && Math.abs(seg.ow - seg.w) < 1, JSON.stringify(seg));

  console.log('\n2. Una captura llega por la red');
  const drop = await request('POST', '/drop', PNG);
  ok('POST /drop la acepta', drop.status === 200, `${drop.status} ${drop.body}`);
  await sleep(900);
  ok('aparece una tarjeta en la galería', (await cards()) === 1);
  ok('el contador sube a 1', (await js(`document.getElementById('n-in').textContent`)) === '1');
  const toast = await rect('.ox-toast');
  ok('el toast cae adentro de la ventana', dentro(toast), JSON.stringify(toast));
  ok('y lleva la miniatura en vez del ícono', await js(`!!document.querySelector('.ox-toast .ub-toast-thumb')`));
  const card = await rect('#grid > .ub-card');
  ok('la tarjeta cae adentro de la vista', dentro(card), JSON.stringify(card));
  ok('la purga se enciende', await js(`!document.getElementById('btn-nuke').disabled`));

  console.log('\n3. Menú contextual y visor');
  await js(`(() => { const c = document.querySelector('#grid > .ub-card'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })); })()`);
  await sleep(300);
  const menu = await rect('.ox-menu');
  ok('el menú abre adentro de la ventana', dentro(menu), JSON.stringify(menu));
  ok('nace en el cursor', !!menu && Math.abs(menu.x - (card.x + 20)) < 12 && Math.abs(menu.y - (card.y + 20)) < 12, JSON.stringify({ menu, card }));
  ok('trae Copiar, Exportar y Eliminar', (await js(`[...document.querySelectorAll('.ox-menu .ox-menuitem')].map(b => b.textContent.trim()).join('|')`)) === 'Copiar|Exportar|Eliminar');
  key('Escape');
  await sleep(400);
  ok('Escape lo cierra', !(await js(`!!document.querySelector('.ox-menu')`)));

  await tap('#grid > .ub-card');
  await sleep(450);
  const lb = await rect('.ub-lightbox img');
  ok('el click abre el visor con la foto adentro de la ventana', dentro(lb), JSON.stringify(lb));
  key('Escape');
  await sleep(500);
  ok('Escape cierra el visor (y sale animado del DOM)', !(await js(`!!document.querySelector('.ub-lightbox')`)));

  console.log('\n4. Para el celu');
  await tap('.ox-segmented__opt[data-value="celu"]');
  await sleep(600);
  ok('el segmentado lleva a la bandeja vacía', await js(`!!document.querySelector('#view .ub-empty') && document.querySelector('.ox-segmented__opt.is-active').dataset.value === 'celu'`));
  ok('las herramientas de la bandeja aparecen', !(await js(`document.getElementById('out-tools').hidden`)));
  ok('barrer está apagado y dice por qué', await js(`(() => { const b = document.getElementById('btn-sweep'); return b.disabled && /ninguna bajó/.test(b.dataset.tip); })()`));

  const archivo = path.join(DIR, 'notas de prueba ñ.txt');
  fs.writeFileSync(archivo, 'hola celu');
  app.emit('second-instance', {}, ['umbral.exe', archivo]);   // lo que hace «Enviar a → Umbral»
  await sleep(1000);
  ok('el archivo entra a la bandeja como ficha', (await cards()) === 1 && await js(`!!document.querySelector('#grid .ub-card--file .ub-file__name')`));
  ok('el nombre llega entero (con la ñ)', (await js(`document.querySelector('#grid .ub-file__name')?.textContent`)) === 'notas de prueba ñ.txt');
  ok('la píldora dice Esperando y el contador se enciende',
    await js(`document.querySelector('#grid .ub-pill').textContent.trim() === 'Esperando' && document.getElementById('n-out').classList.contains('is-hot')`));

  const bajada = await request('GET', `/out/file/${encodeURIComponent('notas de prueba ñ.txt')}?dl=1`);
  ok('el celu lo baja', bajada.status === 200 && bajada.body.toString() === 'hola celu', String(bajada.status));
  await sleep(900);
  const pill = await js(`(() => { const c = document.querySelector('#grid .ub-card'); const p = c?.querySelector(':scope > .ub-pill');
    const nuevo = p && [...p.childNodes].filter((n) => !(n.classList?.contains('ox-swap-out'))).map((n) => n.textContent).join('').trim();
    return { clase: c?.classList.contains('is-delivered'), nuevo }; })()`);
  ok('la tarjeta pasa a bajada', pill.clase && pill.nuevo === 'Bajada', JSON.stringify(pill));
  ok('el contador se apaga y barrer se enciende',
    await js(`!document.getElementById('n-out').classList.contains('is-hot') && !document.getElementById('btn-sweep').disabled`));
  await tap('#btn-sweep');
  await sleep(900);
  ok('barrer la saca y vuelve el vacío', (await cards()) === 0 && await js(`!!document.querySelector('#view .ub-empty')`));

  console.log('\n5. QR');
  await tap('#btn-qr');
  await sleep(400);
  const qr = await rect('.ub-qr');
  const btnQr = await rect('#btn-qr');
  ok('el QR abre adentro de la ventana, debajo de su botón', dentro(qr) && qr.y >= btnQr.y + btnQr.h, JSON.stringify({ qr, btnQr }));
  ok('trae la imagen del código', await js(`!!document.querySelector('.ub-qr img[src^="data:image/png"]')`));
  await tap('#view');
  await sleep(400);
  ok('un click afuera lo cierra', !(await js(`!!document.querySelector('.ub-qr')`)));

  console.log('\n6. Purga');
  await tap('.ox-segmented__opt[data-value="recibidas"]');
  await sleep(600);
  ok('volver a Recibidas muestra la captura', (await cards()) === 1);
  await tap('#btn-nuke');
  await sleep(500);
  ok('pide confirmación con un modal propio', await js(`!!document.querySelector('.ox-modal')`));
  ok('el foco arranca en Cancelar', await js(`document.activeElement?.textContent.trim() === 'Cancelar'`));
  const modal = await rect('.ox-modal');
  ok('el modal cae adentro de la ventana', dentro(modal), JSON.stringify(modal));
  key('Escape');
  await sleep(500);
  ok('Escape cancela y la captura sigue', (await cards()) === 1 && fs.readdirSync(path.join(DIR, 'inbox')).length === 1);
  await tap('#btn-nuke');
  await sleep(500);
  await tap('.ox-modal .ox-btn--danger-solid');
  await sleep(1200);
  ok('confirmar la borra de la galería y del disco', (await cards()) === 0 && fs.readdirSync(path.join(DIR, 'inbox')).length === 0);
  ok('y vuelve el vacío', await js(`!!document.querySelector('#view .ub-empty')`));

  console.log('\n6-bis. La tarjeta de actualización');
  // Lo que manda updater.js: el humo no busca en GitHub, le pasa los estados.
  const estado = (s) => win.webContents.send('update:state', { current: '0.2.5', version: '0.3.0', name: 'Umbral 0.3.0 — entra a la familia Onyx', bytes: 104857600, pct: 0, manual: false, ...s });
  estado({ phase: 'available' });
  await sleep(500);
  const upd = await rect('.ub-upd');
  ok('una versión nueva aparece abajo a la izquierda, adentro de la ventana', dentro(upd) && upd.x < 40, JSON.stringify(upd));
  ok('dice qué trae y cuánto pesa', (await js(`document.querySelector('.ub-upd__sub').textContent`)) === 'Entra a la familia Onyx · 100 MB');
  ok('con Descargar como primario', await js(`document.querySelector('.ub-upd .ox-btn--primary')?.textContent === 'Descargar'`));
  estado({ phase: 'downloading', pct: 0.42 });
  await sleep(600);
  ok('bajando lleva su barra', (await js(`getComputedStyle(document.querySelector('.ub-upd .ox-meter__fill')).getPropertyValue('--ox-pct').trim()`)) === '42.0%');
  estado({ phase: 'downloading', pct: 0.5 });
  await sleep(300);
  ok('y el número cambia en el lugar', (await js(`document.querySelector('.ub-upd__sub').textContent`)) === '50 %'
    && (await js(`document.querySelectorAll('.ub-upd').length`)) === 1);
  estado({ phase: 'ready' });
  await sleep(600);
  ok('lista: ofrece reiniciar', await js(`[...document.querySelectorAll('.ub-upd .ox-btn')].some(b => b.textContent === 'Reiniciar')`));
  await tap('.ub-upd [data-upd="close"]');
  await sleep(500);
  ok('la cruz la cierra', !(await js(`!!document.querySelector('.ub-upd')`)));
  estado({ phase: 'current' });
  await sleep(300);
  ok('«al día» sin pedirlo no aparece', !(await js(`!!document.querySelector('.ub-upd')`)));

  console.log('\n7. Las reglas de oro');
  const glifos = await js(`(() => {
    const malo = /[\\u2190-\\u21FF\\u2300-\\u23FF\\u25A0-\\u27BF\\u2B00-\\u2BFF\\uFE0F\\u{1F300}-\\u{1FAFF}]/u;
    const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (malo.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40));
    return out;
  })()`);
  ok('cero emojis y glifos unicode en la UI', glifos.length === 0, JSON.stringify(glifos));
  ok('cero title= nativo', (await js(`document.querySelectorAll('[title]').length`)) === 0);
  /* Ningún botón de solo ícono con el SVG corrido o desbordando (el padding
     de fábrica de Chromium; ver «Un botón nuevo declara SU padding»). */
  const corridos = await js(`[...document.querySelectorAll('.ox-iconbtn, .ox-wincontrol')].map((b) => {
    const s = b.querySelector('svg'); if (!s) return null; const a = b.getBoundingClientRect(); const r = s.getBoundingClientRect();
    if (a.width < 2) return null;
    const dx = Math.abs((r.left + r.width / 2) - (a.left + a.width / 2)); const dy = Math.abs((r.top + r.height / 2) - (a.top + a.height / 2));
    return dx > .5 || dy > .5 ? b.id + ' ' + dx.toFixed(1) + ',' + dy.toFixed(1) : null; }).filter(Boolean)`);
  ok('los íconos de los botones están centrados', corridos.length === 0, JSON.stringify(corridos));

  /* ── Ningún anillo de foco se corta (el 9-bis de Onyx) ── */
  const AUDITAR_ANILLOS = `((scope) => {
  if (!document.getElementById('aud-notr')) document.head.insertAdjacentHTML('beforeend', '<style id="aud-notr">*,*::before{transition:none!important}</style>');
  // Cuánto sale el anillo REAL por fuera del elemento: se lo enfoca como con
  // teclado y se leen sus sombras de afuera y su outline.
  const extent = (el) => {
    el.focus({ focusVisible: true, preventScroll: true });
    const s = getComputedStyle(el);
    let m = 0;
    for (const part of s.boxShadow.split(/,(?![^(]*\\))/)) {
      if (part.includes('inset') || part.trim() === 'none') continue;
      const nums = part.replace(/rgba?\\([^)]*\\)|oklch\\([^)]*\\)/g, '').match(/-?[\\d.]+px/g) || [];
      const [x = 0, y = 0, blur = 0, spread = 0] = nums.map(parseFloat);
      if (blur > 0) continue;   // una sombra difusa (elevación, brillo) no es el anillo
      m = Math.max(m, spread + Math.max(Math.abs(x), Math.abs(y)));
    }
    if (s.outlineStyle !== 'none' && !/rgba\\(0, 0, 0, 0\\)/.test(s.outlineColor)) m = Math.max(m, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
    el.blur();
    return m;
  };
  const SEL = 'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  const name = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
    const txt = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' «' + txt + '»' : '');
  };
  const out = [];
  for (const el of scope.querySelectorAll(SEL)) {
    if (el.closest('[inert],[hidden],[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const R = extent(el);
    if (R <= 0.5) continue;
    const boxes = [{ who: 'ventana', l: 0, t: 0, r: innerWidth, b: innerHeight }];
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none' || /paint|strict|content/.test(s.contain)) {
        const ar = a.getBoundingClientRect();
        const l = ar.left + a.clientLeft; const t = ar.top + a.clientTop;
        boxes.push({ who: name(a), l, t, r: l + a.clientWidth, b: t + a.clientHeight });
      }
    }
    const e = 0.5;
    // ¿Roza el canto de una superficie (card, panel, modal)? Un fondo o una
    // sombra con radio: el anillo se pisa con su borde aunque nada lo recorte.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      const surf = (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none') && parseFloat(s.borderTopLeftRadius) > 0;
      if (!surf) continue;
      const ar = a.getBoundingClientRect();
      const g = [r.left - ar.left, r.top - ar.top, ar.right - r.right, ar.bottom - r.bottom];
      if (g.some((x) => x < -e)) continue;
      const lados = ['izq', 'arriba', 'der', 'abajo'].filter((_, i) => g[i] < R - e).map((n, i) => n);
      const det = g.map((x, i) => ['izq', 'arriba', 'der', 'abajo'][i] + ' ' + x.toFixed(1)).filter((_, i) => g[i] < R - e);
      if (det.length) { out.push(name(el) + '  roza ' + name(a) + '  [' + det.join(', ') + ']'); break; }
    }
    for (const bx of boxes) {
      const inside = r.left >= bx.l - e && r.top >= bx.t - e && r.right <= bx.r + e && r.bottom <= bx.b + e;
      if (!inside) break;   // el elemento mismo ya está recortado: no es culpa del anillo
      const lados = [];
      if (r.left - R < bx.l - e) lados.push('izq ' + (r.left - bx.l).toFixed(1));
      if (r.top - R < bx.t - e) lados.push('arriba ' + (r.top - bx.t).toFixed(1));
      if (r.right + R > bx.r + e) lados.push('der ' + (bx.r - r.right).toFixed(1));
      if (r.bottom + R > bx.b + e) lados.push('abajo ' + (bx.b - r.bottom).toFixed(1));
      if (lados.length) { out.push(name(el) + '  ← ' + bx.who + '  [' + lados.join(', ') + ']'); break; }
    }
  }
  document.querySelectorAll('.ox-scroll, .ox-main, [class*="scroll"]').forEach((s) => { s.scrollTop = 0; s.scrollLeft = 0; });
  return out;
})(document)`;
  win.focus();
  win.webContents.focus();
  await sleep(150);
  ok('la ventana tiene el foco (si no, no hay anillos que medir)', await js('document.hasFocus()'));
  await request('POST', '/drop', PNG);
  await sleep(900);
  for (const v of ['recibidas', 'celu']) {
    await tap(`.ox-segmented__opt[data-value="${v}"]`);
    await sleep(700);
    const cortes = await js(AUDITAR_ANILLOS);
    ok(`${v}: ningún anillo de foco se corta ni roza un canto`, cortes.length === 0, '\n      ' + cortes.join('\n      '));
  }

  console.log('\n8. Consola');
  ok('sin errores ni advertencias del renderer', errores.length === 0, '\n      ' + errores.join('\n      '));

  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* el lock de Windows: queda en temp */ }
  app.exit(fail ? 1 : 0);
});
