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
// Ni el 4747 de la instalada ni el 4790, que es de Wisp.
const PORT = 4757;
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

/* Desde la 0.4 el servidor pide la llave: el humo hace de celu ya vinculado
   y la lee de donde la guarda el main (vinculo.json en UMBRAL_DATA). */
const llave = () => JSON.parse(fs.readFileSync(path.join(DIR, 'vinculo.json'), 'utf8')).llave;

function request(method, p, body, { sinLlave = false, type = 'image/png', extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = body ? { 'content-type': type, 'content-length': body.length, ...extra } : { ...extra };
    if (!sinLlave) headers.authorization = `Bearer ${llave()}`;
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers }, (res) => {
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
  win.webContents.on('console-message', (e) => { if (e.level >= 2 || e.level === 'warning' || e.level === 'error') errores.push(`${e.level}: ${e.message}`); });
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
  ok('el shell de Opal está montado', await js(`!!document.querySelector('.op-titlebar') && !!document.querySelector('.op-rail') && !!document.querySelector('.op-fog') && !!document.getElementById('view')`));
  ok('los <i data-icon> se reemplazaron por SVG', !(await js(`!!document.querySelector('i[data-icon]')`)));
  const vista = await rect('#view');
  const rail = await rect('.op-rail');
  ok('el rail y la vista son hojas separadas por aire', !!vista && !!rail && rail.x > 0 && vista.x > rail.x + rail.w && vista.x + vista.w < vista.vw, JSON.stringify({ rail, vista }));
  ok('las dos hojas son vidrio y la galería no', await js(`['.op-rail', '#view'].every((s) => getComputedStyle(document.querySelector(s)).backdropFilter.includes('blur'))`));
  ok('el rail marca Recibidas', (await js(`document.querySelector('.op-navitem.is-active')?.dataset.view`)) === 'recibidas');
  ok('la vista inicial es Recibidas y está vacía', await js(`!!document.querySelector('#view .ub-empty')`));
  const addr = await js(`document.getElementById('addr').textContent`);
  ok('la dirección del servidor se ve', new RegExp(`^http://[\\d.]+:${PORT}$`).test(addr), addr);
  ok('el contador nace vacío y se llena sin destellar',
    await js(`document.getElementById('n-in').textContent === '0' && !document.querySelector('.op-rail .op-ticked')`));
  ok('las herramientas de la bandeja no están en Recibidas', await js(`!document.getElementById('btn-add') && !document.getElementById('btn-sweep')`));
  ok('el encabezado dice qué vista es', (await js(`document.querySelector('#view .op-viewhead__title')?.textContent`)) === 'Received');
  ok('el botón de purga está apagado y dice por qué',
    await js(`(() => { const b = document.getElementById('btn-nuke'); return b.disabled && b.dataset.tip === 'Nothing to delete'; })()`));
  ok(`la ventana tiene el color de los tokens (${BG_MAIN})`, win.getBackgroundColor().toLowerCase().startsWith(BG_MAIN), win.getBackgroundColor());

  console.log('\n2. Una captura llega por la red');
  const drop = await request('POST', '/drop', PNG);
  ok('POST /drop la acepta', drop.status === 200, `${drop.status} ${drop.body}`);
  await sleep(900);
  ok('aparece una tarjeta en la galería', (await cards()) === 1);
  ok('el contador sube a 1', (await js(`document.getElementById('n-in').textContent`)) === '1');
  const toast = await rect('.op-toast');
  ok('el toast cae adentro de la ventana', dentro(toast), JSON.stringify(toast));
  ok('y lleva la miniatura en vez del ícono', await js(`!!document.querySelector('.op-toast .ub-toast-thumb')`));
  const card = await rect('#grid > .ub-card');
  ok('la tarjeta cae adentro de la vista', dentro(card), JSON.stringify(card));
  ok('la tarjeta es relleno de luz, sin blur propio', await js(`getComputedStyle(document.querySelector('#grid > .ub-card')).backdropFilter === 'none'`));
  ok('la purga se enciende', await js(`!document.getElementById('btn-nuke').disabled`));

  console.log('\n3. Menú contextual y visor');
  await js(`(() => { const c = document.querySelector('#grid > .ub-card'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })); })()`);
  await sleep(300);
  const menu = await rect('.op-menu');
  ok('el menú abre adentro de la ventana', dentro(menu), JSON.stringify(menu));
  ok('nace en el cursor', !!menu && Math.abs(menu.x - (card.x + 20)) < 12 && Math.abs(menu.y - (card.y + 20)) < 12, JSON.stringify({ menu, card }));
  ok('trae Copiar, Exportar y Eliminar', (await js(`[...document.querySelectorAll('.op-menu .op-menuitem')].map(b => b.textContent.trim()).join('|')`)) === 'Copy|Export|Delete');
  key('Escape');
  await sleep(400);
  ok('Escape lo cierra', !(await js(`!!document.querySelector('.op-menu')`)));

  await tap('#grid > .ub-card');
  await sleep(450);
  const lb = await rect('.ub-lightbox img');
  ok('el click abre el visor con la foto adentro de la ventana', dentro(lb), JSON.stringify(lb));
  key('Escape');
  await sleep(500);
  ok('Escape cierra el visor (y sale animado del DOM)', !(await js(`!!document.querySelector('.ub-lightbox')`)));

  console.log('\n4. Para el celu');
  await tap('.op-navitem[data-view="celu"]');
  await sleep(600);
  ok('el rail lleva a la bandeja vacía', await js(`!!document.querySelector('#view .ub-empty') && document.querySelector('.op-navitem.is-active').dataset.view === 'celu'`));
  ok('las herramientas de la bandeja aparecen', await js(`!!document.getElementById('btn-add') && !!document.getElementById('btn-sweep')`));
  ok('barrer está apagado y dice por qué', await js(`(() => { const b = document.getElementById('btn-sweep'); return b.disabled && /nothing downloaded yet/.test(b.dataset.tip); })()`));

  const archivo = path.join(DIR, 'notas de prueba ñ.txt');
  fs.writeFileSync(archivo, 'hola celu');
  app.emit('second-instance', {}, ['umbral.exe', archivo]);   // lo que hace «Enviar a → Umbral»
  await sleep(1000);
  ok('el archivo entra a la bandeja como ficha', (await cards()) === 1 && await js(`!!document.querySelector('#grid .ub-card--file .ub-file__name')`));
  ok('el nombre llega entero (con la ñ)', (await js(`document.querySelector('#grid .ub-file__name')?.textContent`)) === 'notas de prueba ñ.txt');
  ok('la píldora dice Esperando y el contador se enciende',
    await js(`document.querySelector('#grid .ub-pill').textContent.trim() === 'Waiting' && document.getElementById('n-out').classList.contains('is-hot')`));

  const bajada = await request('GET', `/out/file/${encodeURIComponent('notas de prueba ñ.txt')}?dl=1`);
  ok('el celu lo baja', bajada.status === 200 && bajada.body.toString() === 'hola celu', String(bajada.status));
  await sleep(900);
  const pill = await js(`(() => { const c = document.querySelector('#grid .ub-card'); const p = c?.querySelector(':scope > .ub-pill');
    const nuevo = p && [...p.childNodes].filter((n) => !(n.classList?.contains('op-swap-out'))).map((n) => n.textContent).join('').trim();
    return { clase: c?.classList.contains('is-delivered'), nuevo }; })()`);
  ok('la tarjeta pasa a bajada', pill.clase && pill.nuevo === 'Downloaded', JSON.stringify(pill));
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
  ok('el QR abre adentro de la ventana, arriba de su botón', dentro(qr) && qr.y + qr.h <= btnQr.y, JSON.stringify({ qr, btnQr }));
  ok('trae la imagen del código', await js(`!!document.querySelector('.ub-qr img[src^="data:image/png"]')`));

  // 0.4: la vinculación de la app del celu, de punta a punta por HTTP.
  const pedir = (code) => request('POST', '/pair', Buffer.from(JSON.stringify({ code, device: 'Humo' })), { sinLlave: true, type: 'application/json' });
  const codigo = async () => (await js(`document.querySelector('.ub-qr .ub-pair__code')?.textContent || ''`)).replace(/\D/g, '');
  ok('sin llave, el servidor no entrega la bandeja', (await request('GET', '/out', null, { sinLlave: true })).status === 401);
  const qrReposo = await rect('.ub-qr');
  const huecoReposo = await js(`(() => {
    const box = document.querySelector('.ub-qr .ub-qr__pair');
    const idle = box.querySelector('.ub-pair__idle').getBoundingClientRect();
    return Math.round((box.getBoundingClientRect().bottom - idle.bottom) * 10) / 10;
  })()`);
  await tap('.ub-qr [data-pair="start"]');
  await sleep(700);
  const cod = await codigo();
  ok('el botón muestra un código de 6 dígitos', /^\d{6}$/.test(cod), cod);
  ok('…con su vencimiento', /^Expires in [12]:\d\d$/.test(await js(`document.querySelector('.ub-qr .ub-pair__left')?.textContent.trim()`)));
  const qrAlto = await rect('.ub-qr');
  // El cartel no le guarda el lugar al código (dejaba un hueco debajo del
  // botón, oct 2026): crece hacia arriba, apoyado por abajo, y sigue adentro.
  ok('en reposo la celda mide el botón, sin hueco abajo', huecoReposo < 1, String(huecoReposo));
  ok('con el código el cartel crece hacia arriba y sigue adentro de la ventana', dentro(qrAlto) && qrAlto.h > qrReposo.h + 20
    && Math.abs((qrAlto.y + qrAlto.h) - (qrReposo.y + qrReposo.h)) < 0.5, JSON.stringify({ antes: qrReposo, despues: qrAlto }));
  const canje = await pedir(cod);
  ok('el celu canjea el código por la llave', canje.status === 200 && JSON.parse(canje.body).key === llave(), `${canje.status} ${canje.body}`);
  await sleep(800);
  ok('la app avisa que se vinculó', await js(`[...document.querySelectorAll('.op-toast')].some((t) => /Device paired/.test(t.textContent))`));
  ok('…y el cartel vuelve al botón con la confirmación',
    await js(`document.querySelector('.ub-qr .ub-pair__con').hidden && !document.querySelector('.ub-qr .ub-pair__idle').hidden
      && /device is paired/.test(document.querySelector('.ub-qr .ub-pair__nota').textContent)`));

  await tap('.ub-qr [data-pair="start"]');
  await sleep(700);
  const cod2 = await codigo();
  await tap('#view');
  await sleep(400);
  ok('un click afuera lo cierra', !(await js(`!!document.querySelector('.ub-qr')`)));
  ok('…y el código que mostraba deja de servir', /^\d{6}$/.test(cod2) && (await pedir(cod2)).status === 409, cod2);

  console.log('\n6. Purga');
  await tap('.op-navitem[data-view="recibidas"]');
  await sleep(600);
  ok('volver a Recibidas muestra la captura', (await cards()) === 1);
  await tap('#btn-nuke');
  await sleep(500);
  ok('pide confirmación con un modal propio', await js(`!!document.querySelector('.op-modal')`));
  ok('el foco arranca en Cancelar', await js(`document.activeElement?.textContent.trim() === 'Cancel'`));
  const modal = await rect('.op-modal');
  ok('el modal cae adentro de la ventana', dentro(modal), JSON.stringify(modal));
  key('Escape');
  await sleep(500);
  ok('Escape cancela y la captura sigue', (await cards()) === 1 && fs.readdirSync(path.join(DIR, 'inbox')).length === 1);
  await tap('#btn-nuke');
  await sleep(500);
  await tap('.op-modal .op-btn--danger-solid');
  await sleep(1200);
  ok('confirmar la borra de la galería y del disco', (await cards()) === 0 && fs.readdirSync(path.join(DIR, 'inbox')).length === 0);
  ok('y vuelve el vacío', await js(`!!document.querySelector('#view .ub-empty')`));

  console.log('\n6-ter. Un PDF del celu (0.5)');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const pdf = await request('POST', '/drop', PDF, { type: 'application/pdf', extra: { 'x-umbral-name': encodeURIComponent('Apunte de Tecnia ñ.pdf') } });
  ok('POST /drop acepta un PDF', pdf.status === 200, `${pdf.status} ${pdf.body}`);
  await sleep(900);
  ok('entra a Recibidas como ficha, con su nombre', (await cards()) === 1
    && (await js(`document.querySelector('#grid .ub-card--file .ub-file__name')?.textContent`)) === 'Apunte de Tecnia ñ.pdf');
  ok('la ficha dice PDF', (await js(`document.querySelector('#grid .ub-file__ext')?.textContent`)) === 'PDF');
  ok('el toast dice «Archivo recibido», sin miniatura',
    await js(`[...document.querySelectorAll('.op-toast')].some((t) => /File received/.test(t.textContent) && !t.querySelector('.ub-toast-thumb'))`));
  await js(`(() => { const c = document.querySelector('#grid > .ub-card'); const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })); })()`);
  await sleep(300);
  ok('su menú trae Abrir, Copiar, Exportar y Eliminar',
    (await js(`[...document.querySelectorAll('.op-menu .op-menuitem')].map(b => b.textContent.trim()).join('|')`)) === 'Open|Copy|Export|Delete');
  key('Escape');
  await sleep(400);
  await tap('#grid > .ub-card');
  await sleep(450);
  ok('el click no abre el visor: lo abre con su programa',
    !(await js(`!!document.querySelector('.ub-lightbox')`)) && (global.__umbralAbiertos || []).at(-1) === 'Apunte de Tecnia ñ.pdf',
    JSON.stringify(global.__umbralAbiertos));
  ok('el botón de la carpeta dice «lo recibido»', (await js(`document.getElementById('btn-folder').dataset.tip`)) === 'Open the Received folder');

  console.log('\n6-bis. La tarjeta de actualización');
  // Lo que manda updater.js: el humo no busca en GitHub, le pasa los estados.
  const estado = (s) => win.webContents.send('update:state', { current: '0.2.5', version: '0.3.0', name: 'Umbral 0.3.0 — entra a la familia Opal', bytes: 104857600, pct: 0, manual: false, ...s });
  estado({ phase: 'available' });
  await sleep(500);
  const upd = await rect('.ub-upd');
  ok('una versión nueva aparece abajo a la izquierda de la hoja, adentro de la ventana', dentro(upd) && upd.x > rail.x + rail.w && upd.x < rail.x + rail.w + 60, JSON.stringify({ upd, rail }));
  ok('dice qué trae y cuánto pesa', (await js(`document.querySelector('.ub-upd__sub').textContent`)) === 'Entra a la familia Opal · 100 MB');
  ok('con Descargar como primario', await js(`document.querySelector('.ub-upd .op-btn--primary')?.textContent === 'Download'`));
  /* Oct 2026, el arreglo del About de NTX: la tarjeta no cambia de alto ni de
     lugar entre fases, en ningún cuadro, y la cruz no se va: se apaga. */
  const muestras = async () => js(`(async () => {
    const el = document.querySelector('.ub-upd');
    const out = [];
    for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 25)); const r = el.getBoundingClientRect(); out.push([Math.round(r.top * 10) / 10, Math.round(r.height * 10) / 10]); }
    return out;
  })()`);
  estado({ phase: 'downloading', pct: 0.42 });
  const aBajando = await muestras();
  const cruzBajando = await js(`(() => { const x = document.querySelector('.ub-upd__x'); return { esta: !!x, op: +getComputedStyle(x).opacity, clic: getComputedStyle(x).pointerEvents }; })()`);
  ok('de disponible a bajando la tarjeta no cambia de alto ni de lugar en ningún cuadro',
    aBajando.every(([t, h]) => Math.abs(t - upd.y) < 0.6 && Math.abs(h - upd.h) < 0.6), JSON.stringify({ upd, aBajando }));
  ok('mientras baja la cruz está pero apagada', cruzBajando.esta && cruzBajando.op === 0 && cruzBajando.clic === 'none', JSON.stringify(cruzBajando));
  await sleep(200);
  ok('bajando lleva su barra', (await js(`getComputedStyle(document.querySelector('.ub-upd .op-meter__fill')).getPropertyValue('--op-pct').trim()`)) === '42.0%');
  estado({ phase: 'downloading', pct: 0.5 });
  /* El número corre (roll) y no destella: con valor() destellaba en cada aviso
     y, con varios por segundo, el % se prendía y apagaba sin parar. */
  const corre = await js(`(async () => {
    const sub = document.querySelector('.ub-upd__sub');
    const vistos = [];
    let destello = false;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      vistos.push(parseInt(sub.textContent, 10));
      destello = destello || sub.classList.contains('op-ticked');
    }
    return { vistos, destello };
  })()`);
  ok('el % corre hasta el nuevo, sin destello', !corre.destello && corre.vistos.some((n) => n > 42 && n < 50)
    && corre.vistos.every((n, i, a) => !i || n >= a[i - 1]), JSON.stringify(corre));
  await sleep(500);
  ok('y el número cambia en el lugar', (await js(`document.querySelector('.ub-upd__sub').textContent`)) === '50 %'
    && (await js(`document.querySelectorAll('.ub-upd').length`)) === 1);
  estado({ phase: 'ready' });
  const aLista = await muestras();
  ok('de bajando a lista tampoco', aLista.every(([t, h]) => Math.abs(t - upd.y) < 0.6 && Math.abs(h - upd.h) < 0.6), JSON.stringify({ upd, aLista }));
  await sleep(200);
  ok('lista: ofrece reiniciar', await js(`[...document.querySelectorAll('.ub-upd .op-btn')].some(b => b.textContent === 'Restart')`));
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
  const corridos = await js(`[...document.querySelectorAll('.op-iconbtn, .op-wincontrol')].map((b) => {
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
  document.querySelectorAll('.op-scroll, .op-main, [class*="scroll"]').forEach((s) => { s.scrollTop = 0; s.scrollLeft = 0; });
  // Las transiciones vuelven: sin esto quedaban apagadas para todo el resto
  // del humo, y el hover, el disabled y los anillos cambiaban de golpe (Fran
  // lo veía como botones que saltaban). Opal ya lo hacía.
  document.getElementById('aud-notr')?.remove();
  return out;
})(document)`;
  win.focus();
  win.webContents.focus();
  await sleep(150);
  ok('la ventana tiene el foco (si no, no hay anillos que medir)', await js('document.hasFocus()'));
  await request('POST', '/drop', PNG);
  await sleep(900);

  // Antes de la auditoría de anillos, que apaga las transiciones para medir.
  console.log('\n7-bis. Notepad');
  await tap('.op-navitem[data-view="notepad"]');
  await sleep(700);
  const b0 = await js(`(() => {
    const ta = document.getElementById('note'), r = ta.getBoundingClientRect();
    const titulo = document.querySelector('#view .op-viewhead__title').getBoundingClientRect();
    const hoja = document.getElementById('view').getBoundingClientRect();
    const foot = document.querySelector('.ub-note__foot').getBoundingClientRect();
    return { focus: document.activeElement === ta, h: r.height, left: r.left - hoja.left, seg: titulo.left - hoja.left, right: hoja.right - r.right,
      footBottom: hoja.bottom - foot.bottom, copyOff: document.getElementById('note-copy').disabled,
      sizeHidden: !document.getElementById('thumb-size'), nukeHidden: !document.getElementById('btn-nuke'),
      folderTip: document.getElementById('btn-folder').dataset.tip,
      info: document.getElementById('note-info').textContent };
  })()`);
  ok('el campo tiene el foco al entrar', b0.focus);
  ok('el campo llena la vista (alto > 400 px)', b0.h > 400, `alto ${b0.h}`);
  ok('arranca en la misma columna que su título', Math.abs(b0.left - b0.seg) < 1, `${b0.left} vs ${b0.seg}`);
  ok('la sangría derecha es la misma que la izquierda', Math.abs(b0.right - b0.left) < 1, `${b0.right} vs ${b0.left}`);
  ok('el pie queda dentro de la hoja', b0.footBottom >= 8, `${b0.footBottom} px`);
  ok('vacío: Copiar todo apagado y dice que lo ven el celu y CC', b0.copyOff && /syncs with your phone/.test(b0.info), b0.info);
  ok('sin miniaturas ni purga', b0.sizeHidden && b0.nukeHidden);
  ok('la carpeta queda, para mostrar el .txt', /notepad\.txt/.test(b0.folderTip), b0.folderTip);
  const fondo = () => js(`getComputedStyle(document.getElementById('note')).backgroundColor`);
  const conFoco = await fondo();
  await js(`document.getElementById('note').blur()`);
  await sleep(400);
  const sinFoco = await fondo();
  ok('el fondo es el mismo con foco y sin foco', conFoco === sinFoco, `${conFoco} vs ${sinFoco}`);
  await js(`document.getElementById('note').focus()`);

  const TXT = 'git push origin main\nhttps://ejemplo.com/ñandú';
  await js(`(() => { const ta = document.getElementById('note'); ta.value = ${JSON.stringify(TXT)};
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(450);
  const info = await js(`document.getElementById('note-info').textContent`);
  ok('cuenta caracteres y líneas', /2 lines/.test(info), info);
  // Una tecla más: el conteo cambia en su lugar, sin destello.
  await js(`(() => { const ta = document.getElementById('note'); ta.value += '!';
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(60);
  const tecla = await js(`(() => { const el = document.getElementById('note-info');
    return { ticked: el.classList.contains('op-ticked'), info: el.textContent }; })()`);
  ok('el conteo cambia sin destellar', !tecla.ticked && /2 lines/.test(tecla.info), JSON.stringify(tecla));
  await js(`(() => { const ta = document.getElementById('note'); ta.value = ${JSON.stringify(TXT)};
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(450);

  // El cursor de bloque: de luz con aureola, parado sobre la letra que tapa.
  const cursorEn = async (a, b = a) => {
    await js(`document.getElementById('note').setSelectionRange(${a}, ${b})`);
    await sleep(120);
    return js(`(() => { const ta = document.getElementById('note'), c = document.querySelector('.ub-cursor');
      const r = c.getBoundingClientRect(), t = ta.getBoundingClientRect(), antes = getComputedStyle(c, '::before');
      return { caret: getComputedStyle(ta).caretColor, x: r.left - t.left, y: r.top - t.top, w: r.width,
        letra: c.textContent, oculto: c.classList.contains('is-oculto'), quieto: c.classList.contains('is-quieto'),
        late: c.classList.contains('is-latiendo'), sombra: antes.boxShadow, fondo: antes.backgroundColor,
        pad: parseFloat(getComputedStyle(ta).paddingLeft), lh: parseFloat(getComputedStyle(ta).lineHeight) }; })()`);
  };
  const c0 = await cursorEn(0);
  ok('el cursor nativo es transparente', /rgba\(0, 0, 0, 0\)|transparent/.test(c0.caret), c0.caret);
  ok('el bloque arranca sobre la primera letra', c0.letra === 'g' && !c0.oculto && Math.abs(c0.x - c0.pad) < 1, JSON.stringify(c0));
  ok('parpadea con foco', c0.late && !c0.quieto, JSON.stringify(c0));
  ok('es de luz y con aureola', /240, 243, 247/.test(c0.fondo) && /240, 243, 247.*7px|7px.*240, 243, 247/.test(c0.sombra), `${c0.fondo} · ${c0.sombra}`);
  const c4 = await cursorEn(4);
  ok('cuatro letras más allá, cuatro anchos más allá', c4.letra === 'p' && Math.abs(c4.x - (c0.x + 4 * c0.w)) < 1.5, `${c4.x} vs ${c0.x + 4 * c0.w}`);
  const c21 = await cursorEn(21);
  ok('en el segundo renglón baja un renglón', c21.letra === 'h' && Math.abs(c21.y - c0.y - c0.lh) < 1 && Math.abs(c21.x - c0.x) < 1, JSON.stringify(c21));
  const cFin = await cursorEn(TXT.length);
  ok('al final no tapa ninguna letra', cFin.letra === '' && !cFin.oculto, JSON.stringify(cFin));
  const cSel = await cursorEn(0, 5);
  ok('con una selección el bloque se esconde', cSel.oculto);
  await js(`document.getElementById('note').blur()`);
  await sleep(120);
  const cBlur = await js(`document.querySelector('.ub-cursor').className`);
  ok('sin foco queda quieto', /is-quieto/.test(cBlur), cBlur);
  await js(`(() => { const ta = document.getElementById('note'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); })()`);

  // Los números de línea: uno por renglón escrito, a la altura de su renglón.
  const numeros = async (texto, pos) => {
    if (texto !== undefined) {
      await js(`(() => { const ta = document.getElementById('note'); ta.value = ${JSON.stringify(texto)};
        ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    if (pos !== undefined) await js(`document.getElementById('note').setSelectionRange(${pos}, ${pos})`);
    await sleep(150);
    return js(`(() => { const ta = document.getElementById('note'), t = ta.getBoundingClientRect();
      const ns = [...document.querySelectorAll('.ub-lineas__n')];
      const col = document.querySelector('.ub-lineas').getBoundingClientRect();
      return { n: ns.map((e) => e.textContent), y: ns.map((e) => e.getBoundingClientRect().top - t.top),
        actual: ns.findIndex((e) => e.classList.contains('is-actual')), colDer: col.right - t.left,
        pad: parseFloat(getComputedStyle(ta).paddingLeft), lh: parseFloat(getComputedStyle(ta).lineHeight) }; })()`);
  };
  const n0 = await numeros(undefined, 21);
  ok('un número por renglón', n0.n.join() === '1,2', n0.n.join());
  ok('cada número a la altura de su renglón', Math.abs(n0.y[0] - c0.y) < 1 && Math.abs(n0.y[1] - c21.y) < 1, `${n0.y} vs ${c0.y},${c21.y}`);
  ok('el del renglón del cursor se marca', n0.actual === 1, String(n0.actual));
  ok('la columna no pisa el texto', n0.colDer < n0.pad, `${n0.colDer} vs ${n0.pad}`);
  const largo = 'corto\n' + 'palabra '.repeat(120) + '\nfin';
  const n1 = await numeros(largo, 0);
  ok('un renglón que se parte lleva un solo número', n1.n.join() === '1,2,3' && n1.y[2] - n1.y[1] >= 2 * n1.lh - 1, JSON.stringify(n1.y));
  ok('el actual sigue al cursor', n1.actual === 0, String(n1.actual));
  const n2 = await numeros(Array.from({ length: 120 }, (_, i) => `l${i}`).join('\n'), 0);
  // Desde oct 2026 la columna nace con lugar para tres dígitos: al pasar los
  // 99 renglones el texto no se corre (antes saltaba 1ch a la derecha).
  ok('con 100 renglones o más, la columna no cambia y el texto no se corre', n2.n.length === 120 && n2.pad === n0.pad && n2.colDer < n2.pad, `${n2.pad} vs ${n0.pad}`);
  await js(`document.getElementById('note').scrollTop = 200`);
  await sleep(100);
  const n3 = await numeros();
  ok('los números acompañan el scroll', Math.abs((n2.y[0] - n3.y[0]) - 200) < 1, `${n2.y[0]} → ${n3.y[0]}`);
  await numeros(TXT, TXT.length);

  await tap('#note-copy');
  await sleep(250);
  ok('Copiar todo manda el texto entero', global.__umbralCopiado === TXT, JSON.stringify(global.__umbralCopiado));

  await tap('.op-navitem[data-view="celu"]');
  await sleep(600);
  await tap('.op-navitem[data-view="notepad"]');
  await sleep(600);
  ok('el texto sobrevive a cambiar de vista', (await js(`document.getElementById('note').value`)) === TXT);

  await tap('#note-clear');
  await sleep(70);
  const medio = await js(`(() => { const ta = document.getElementById('note');
    return { limpiando: ta.classList.contains('is-limpiando'), alfa: getComputedStyle(ta).color }; })()`);
  ok('al limpiar, el texto se funde (a mitad de camino no es ni opaco ni invisible)',
    medio.limpiando && /\/ 0\.\d|, 0\.\d+\)/.test(medio.alfa), medio.alfa);
  await sleep(700);   // con la máquina cargada, el temporizador de 180 ms llega tarde
  ok('Limpiar deja el campo vacío', (await js(`document.getElementById('note').value`)) === '');
  ok('el toast trae Deshacer', await tap('.op-toast__action'));
  await sleep(300);
  ok('Deshacer devuelve el texto', (await js(`document.getElementById('note').value`)) === TXT);

  // La letra: Ctrl + / Ctrl - / Ctrl 0, sin tocar el zoom de la ventana.
  const ctrl = (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
  };
  const letra = () => js(`(() => { const ta = document.getElementById('note');
    return { fs: getComputedStyle(ta).fontSize, info: document.getElementById('note-info').textContent }; })()`);
  ok('la letra arranca en 12 px', (await letra()).fs === '12px', (await letra()).fs);
  ctrl('Plus'); ctrl('Plus'); ctrl('Plus');
  await sleep(400);
  const l1 = await letra();
  ok('Ctrl + agranda de a un píxel', l1.fs === '15px', l1.fs);
  ok('y abajo dice el tamaño', /Font size 15 px/.test(l1.info), l1.info);
  ok('la ventana no se hizo zoom', win.webContents.getZoomLevel() === 0, String(win.webContents.getZoomLevel()));
  ctrl('-');
  await sleep(500);
  ok('Ctrl - achica', (await letra()).fs === '14px', (await letra()).fs);
  let guardada = null;
  for (let i = 0; i < 20 && guardada !== 14; i++) { await sleep(100); guardada = (await js(`window.opal.settings.get()`)).notepadLetra; }
  ok('queda guardada para la próxima', guardada === 14, String(guardada));
  await sleep(1800);
  ok('después vuelve el conteo', /2 lines/.test((await letra()).info), (await letra()).info);
  ctrl('0');
  await sleep(400);
  ok('Ctrl 0 vuelve a 12 px', (await letra()).fs === '12px', (await letra()).fs);
  ok('la ventana sigue sin zoom', win.webContents.getZoomLevel() === 0, String(win.webContents.getZoomLevel()));

  // Ctrl+K corta el renglón, como en nano; seguidos se juntan, y Ctrl+Z lo deshace.
  const valor = () => js(`document.getElementById('note').value`);
  await js(`(() => { const ta = document.getElementById('note'); ta.focus(); ta.value = 'uno\\ndos\\ntres';
    ta.dispatchEvent(new Event('input', { bubbles: true })); ta.setSelectionRange(5, 5); })()`);
  await sleep(100);
  ctrl('K');
  await sleep(150);
  ok('Ctrl+K saca el renglón del cursor', (await valor()) === 'uno\ntres', JSON.stringify(await valor()));
  ok('y lo deja en el portapapeles', global.__umbralCopiado === 'dos\n', JSON.stringify(global.__umbralCopiado));
  ctrl('K');
  await sleep(150);
  ok('el último renglón se lleva el salto de antes', (await valor()) === 'uno', JSON.stringify(await valor()));
  ok('dos Ctrl+K seguidos se juntan', global.__umbralCopiado === 'dos\ntres\n', JSON.stringify(global.__umbralCopiado));
  ok('abajo dice cuántas', /2 lines cut/.test(await js(`document.getElementById('note-info').textContent`)));
  ctrl('Z');
  await sleep(150);
  ok('Ctrl+Z la devuelve', (await valor()) === 'uno\ntres', JSON.stringify(await valor()));
  await js(`(() => { const ta = document.getElementById('note'); ta.setSelectionRange(1, 6); })()`);
  ctrl('K');
  await sleep(150);
  ok('con una selección corta todos los renglones que toca', (await valor()) === '' && global.__umbralCopiado === 'uno\ntres\n', JSON.stringify(global.__umbralCopiado));
  // Ctrl+F: busca sin mayúsculas ni tildes, marca la actual, Enter sigue y Esc la deja seleccionada.
  const BUSCA = 'Canción uno\nla cancion dos\notra CANCIÓN\n' + Array.from({ length: 80 }, (_, i) => `relleno ${i}`).join('\n') + '\nla última canción';
  await js(`(() => { const ta = document.getElementById('note'); ta.focus(); ta.value = ${JSON.stringify(BUSCA)};
    ta.dispatchEvent(new Event('input', { bubbles: true })); ta.setSelectionRange(0, 0); ta.scrollTop = 0; })()`);
  await sleep(150);
  ctrl('F');
  await sleep(300);
  const pulsar = (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const buscando = () => js(`(() => { const b = document.querySelector('.ub-buscar:not([data-state="closing"])');
    const tira = document.querySelector('.ub-hallazgos__tira:not([data-state="closing"])');
    const ms = tira ? [...tira.querySelectorAll('.ub-hallazgo')] : [];
    const act = ms.find((m) => m.classList.contains('is-actual'));
    const ta = document.getElementById('note');
    return { abierta: !!b, foco: document.activeElement?.className || '',
      n: b ? [...b.querySelectorAll('.ub-buscar__n > :not(.op-swap-out)')].map((e) => e.textContent).join('') || b.querySelector('.ub-buscar__n').textContent : '',
      marcas: ms.map((m) => m.textContent), actual: ms.indexOf(act), scroll: ta.scrollTop,
      actualY: act ? act.getBoundingClientRect().top - ta.getBoundingClientRect().top : null, alto: ta.clientHeight,
      tinta: act ? getComputedStyle(act).backgroundColor : '' }; })()`);
  const escribir = async (texto) => {
    await js(`(() => { const i = document.querySelector('.ub-buscar__q'); i.value = ${JSON.stringify(texto)};
      i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(450);
  };
  let f = await buscando();
  ok('Ctrl+F abre la barra con el foco adentro', f.abierta && /ub-buscar__q/.test(f.foco), JSON.stringify(f));
  await escribir('cancion');
  f = await buscando();
  ok('encuentra sin mayúsculas ni tildes', f.marcas.join('|') === 'Canción|cancion|CANCIÓN|canción', f.marcas.join('|'));
  ok('la actual es la primera desde el cursor', f.actual === 0 && f.n === '1 of 4', `${f.actual} · ${f.n}`);
  ok('la actual va en luz entera', /240, 243, 247/.test(f.tinta) && !/, 0\.\d/.test(f.tinta), f.tinta);
  // La marca cae sobre su palabra: la segunda («cancion» de «la cancion») empieza 3 letras adentro del renglón 2.
  const geo = await js(`(() => { const ta = document.getElementById('note'), t = ta.getBoundingClientRect(), cs = getComputedStyle(ta);
    const ms = [...document.querySelectorAll('.ub-hallazgos__tira:not([data-state]) .ub-hallazgo')].map((m) => m.getBoundingClientRect());
    return { x0: ms[0].left - t.left, x1: ms[1].left - t.left, y0: ms[0].top - t.top, y1: ms[1].top - t.top,
      pad: parseFloat(cs.paddingLeft), lh: parseFloat(cs.lineHeight), w: ms[0].width / 7 }; })()`);
  ok('cada marca cae sobre su palabra', Math.abs(geo.x0 - geo.pad) < 1 && Math.abs(geo.x1 - (geo.pad + 3 * geo.w)) < 1.5
    && Math.abs(geo.y1 - geo.y0 - geo.lh) < 1, JSON.stringify(geo));
  pulsar('Enter');
  await sleep(200);
  f = await buscando();
  ok('Enter va a la siguiente', f.actual === 1 && f.n === '2 of 4', `${f.actual} · ${f.n}`);
  pulsar('Enter', ['shift']);
  pulsar('Enter', ['shift']);
  await sleep(700);
  f = await buscando();
  ok('Shift+Enter vuelve, y de la primera da la vuelta a la última', f.actual === 3 && f.n === '4 of 4', `${f.actual} · ${f.n}`);
  ok('y el campo se corre para que se vea', f.scroll > 0 && f.actualY >= 0 && f.actualY < f.alto, JSON.stringify(f));
  pulsar('F3');
  await sleep(700);
  f = await buscando();
  ok('F3 sigue buscando', f.actual === 0, String(f.actual));
  await escribir('canciónx');
  f = await buscando();
  ok('sin nada: «Sin resultados» y las flechas apagadas', f.marcas.length === 0 && f.n === 'No results'
    && (await js(`[...document.querySelectorAll('.ub-buscar [data-ir]')].every((b) => b.disabled)`)), f.n);
  await escribir('dos');
  f = await buscando();
  ok('una sola', f.marcas.join() === 'dos' && f.n === '1 of 1', `${f.marcas} · ${f.n}`);
  const cortesB = await js(AUDITAR_ANILLOS);
  ok('ningún anillo de la barra se corta', cortesB.length === 0, '\n      ' + cortesB.join('\n      '));
  await js(`document.querySelector('.ub-buscar__q').focus()`);
  pulsar('Escape');
  await sleep(400);
  const cerrada = await js(`(() => { const ta = document.getElementById('note');
    return { barra: !!document.querySelector('.ub-buscar'), marcas: document.querySelectorAll('.ub-hallazgo').length,
      foco: document.activeElement === ta, sel: ta.value.slice(ta.selectionStart, ta.selectionEnd) }; })()`);
  ok('Esc cierra la barra y se lleva las marcas', !cerrada.barra && cerrada.marcas === 0, JSON.stringify(cerrada));
  ok('y deja seleccionada la que estaba marcada', cerrada.foco && cerrada.sel === 'dos', JSON.stringify(cerrada));
  ctrl('F');
  await sleep(300);
  ok('al abrir de nuevo, busca lo seleccionado', (await js(`document.querySelector('.ub-buscar__q').value`)) === 'dos');
  // Con la barra abierta, lo que se escribe en el campo mueve las marcas.
  await js(`(() => { const ta = document.getElementById('note'); ta.value = 'dos ' + ta.value;
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  ok('lo escrito en el campo se busca en vivo', (await buscando()).marcas.length === 2);
  await tap('[data-cerrar]');
  await sleep(400);
  ok('la cruz también cierra', !(await js(`!!document.querySelector('.ub-buscar')`)));

  await js(`(() => { const ta = document.getElementById('note'); ta.value = ${JSON.stringify(TXT)};
    ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1800);   // que se vaya el aviso del Ctrl+K

  // El .txt y el celu: lo de acá llega al disco y al servidor; lo del celu, al campo.
  const TXTF = path.join(DIR, 'notepad.txt');
  let enDisco = '';
  for (let i = 0; i < 30 && enDisco !== TXT; i++) { await sleep(100); try { enDisco = fs.readFileSync(TXTF, 'utf8'); } catch { /* todavía no */ } }
  ok('lo escrito queda en notepad.txt', enDisco === TXT, JSON.stringify(enDisco));
  const g = JSON.parse((await request('GET', '/notepad')).body.toString('utf8'));
  ok('el celu lo lee por GET /notepad', g.text === TXT, JSON.stringify(g));
  await js(`(() => { const ta = document.getElementById('note'); ta.focus(); ta.setSelectionRange(3, 3); })()`);
  const DEL_CELU = 'ok ' + TXT;
  const put = await request('PUT', '/notepad', Buffer.from(JSON.stringify({ text: DEL_CELU, base: g.hash })), { type: 'application/json' });
  ok('PUT del celu con la versión actual: 200', put.status === 200, String(put.status));
  await sleep(250);
  const r1 = await js(`(() => { const ta = document.getElementById('note');
    return { v: ta.value, sel: ta.selectionStart, remoto: ta.classList.contains('is-remoto'), info: document.getElementById('note-info').textContent }; })()`);
  ok('lo del celu entra en el campo sin tocar nada', r1.v === DEL_CELU, JSON.stringify(r1.v));
  ok('el cursor se corre con el texto que se agregó antes', r1.sel === 6, `cursor en ${r1.sel}`);
  ok('el canto avisa que vino de afuera', r1.remoto);
  ok('y abajo dice desde dónde', /on your phone/.test(r1.info), r1.info);
  const vieja = await request('PUT', '/notepad', Buffer.from(JSON.stringify({ text: 'pisado', base: g.hash })), { type: 'application/json' });
  ok('PUT con una versión vieja: 409 y no pisa', vieja.status === 409 && (await js(`document.getElementById('note').value`)) === DEL_CELU, String(vieja.status));

  // CC escribe con el mod: el .txt y, al lado, la marca con su hash. Antes,
  // que termine de guardarse lo del celu (400 ms): un guardado pendiente
  // escribe encima, y el mod lo detecta (ver S:\tools\Notepad).
  await sleep(700);
  const { hashOf, CC_MARK } = require(path.join(ROOT, 'notepad.js'));
  const DE_CC = 'nota de CC\n' + DEL_CELU;
  fs.writeFileSync(path.join(DIR, CC_MARK), hashOf(DE_CC));
  fs.writeFileSync(TXTF, DE_CC);
  let rcc = null;
  for (let i = 0; i < 40 && rcc?.v !== DE_CC; i++) {
    await sleep(100);
    rcc = await js(`(() => ({ v: document.getElementById('note').value, info: document.getElementById('note-info').textContent }))()`);
  }
  ok('lo que escribe CC entra en el campo', rcc?.v === DE_CC, JSON.stringify(rcc));
  ok('y abajo dice que fue CC', /by Claude Code/.test(rcc?.info), rcc?.info);

  for (const v of ['recibidas', 'celu', 'notepad']) {
    await tap(`.op-navitem[data-view="${v}"]`);
    await sleep(700);
    const cortes = await js(AUDITAR_ANILLOS);
    ok(`${v}: ningún anillo de foco se corta ni roza un canto`, cortes.length === 0, '\n      ' + cortes.join('\n      '));
  }

  // Ctrl 1, 2 y 3: cada vista, también con el foco adentro del Notepad.
  for (const [tecla, v] of [['1', 'recibidas'], ['2', 'celu'], ['3', 'notepad'], ['2', 'celu'], ['1', 'recibidas']]) {
    ctrl(tecla);
    await sleep(600);
    const vista = await js(`document.querySelector('.op-navitem.is-active')?.dataset.view`);
    ok(`Ctrl ${tecla} va a ${v}`, vista === v, String(vista));
  }
  ctrl('4');
  await sleep(300);
  ok('Ctrl 4 no hace nada', (await js(`document.querySelector('.op-navitem.is-active')?.dataset.view`)) === 'recibidas');

  // /notepad del mod corre `Umbral.exe --notepad`: la ventana va al Notepad.
  app.emit('second-instance', {}, ['umbral.exe', '--notepad']);
  await sleep(700);
  ok('--notepad abre la vista del Notepad', (await js(`document.querySelector('.op-navitem.is-active')?.dataset.view`)) === 'notepad');

  /* Casillas fijas (oct 2026): la carpeta está en el mismo píxel en las tres
     vistas, y lo que Recibidas y Para el celu comparten (el tamaño y la purga)
     también. Antes la carpeta cambiaba de punta al ir y volver del Notepad. */
  const casillas = {};
  for (const v of ['recibidas', 'celu', 'notepad']) {
    await tap(`.op-navitem[data-view="${v}"]`);
    await sleep(700);
    casillas[v] = await js(`(() => { const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10]; };
      return { carpeta: r('btn-folder'), tamano: r('thumb-size'), purga: r('btn-nuke') }; })()`);
  }
  const igual = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  ok('la carpeta queda en el mismo lugar en las tres vistas',
    igual(casillas.recibidas.carpeta, casillas.celu.carpeta) && igual(casillas.celu.carpeta, casillas.notepad.carpeta), JSON.stringify(casillas));
  ok('el tamaño y la purga, en el mismo lugar en Recibidas y Para el celu',
    igual(casillas.recibidas.tamano, casillas.celu.tamano) && igual(casillas.recibidas.purga, casillas.celu.purga), JSON.stringify(casillas));
  ok('…con el foco en el campo', await js(`document.activeElement?.id === 'note'`));

  console.log('\n8. Consola');
  ok('sin errores ni advertencias del renderer', errores.length === 0, '\n      ' + errores.join('\n      '));

  console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* el lock de Windows: queda en temp */ }
  app.exit(fail ? 1 : 0);
});
