/* ═══════════════════════════════════════════════════════════════════════════
   El Borrador (0.7): un borrador.txt que comparten la PC, el celu y cualquier
   editor que lo abra.

   Primero el módulo solo (borrador.js): guarda, normaliza, reconoce lo que
   cambió afuera y no se confunde con lo que escribió él. Después el servidor
   de verdad en un puerto libre, como lo usa Umbral Mobile.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createBorrador, hashOf } = require('../borrador.js');
const { createPairing } = require('../pairing.js');
const { createUmbralServer } = require('../server.js');
const { createOutbox } = require('../outbox.js');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-borrador-'));
const FILE = path.join(DIR, 'borrador.txt');
const avisos = [];
const b = createBorrador(FILE, { delay: 40, interval: 100, onChange: (e, desde) => avisos.push({ ...e, desde }) });

console.log('\n1. Guardar');
{
  const e = await b.load();
  ok('sin archivo arranca vacío', e.text === '' && e.hash === hashOf(''));
  b.set('git status\nhttps://ñandú.com');
  ok('el cambio de la PC se avisa como de la PC', avisos.at(-1)?.desde === 'pc');
  await sleep(120);
  await b.flush();
  ok('llega al disco tal cual, en UTF-8', fs.readFileSync(FILE, 'utf8') === 'git status\nhttps://ñandú.com');
  ok('sin temporales colgados', fs.readdirSync(DIR).every((f) => !f.endsWith('.tmp')), fs.readdirSync(DIR).join(','));
  const antes = avisos.length;
  b.set('git status\nhttps://ñandú.com');
  ok('el mismo texto no es un cambio', avisos.length === antes);
  b.set('a\r\nb\rc');
  ok('CRLF y CR se vuelven \\n', b.get().text === 'a\nb\nc');
  ok('demasiado largo se rechaza', b.set('x'.repeat(1_000_001)).error === 'too-big');
}

console.log('\n2. Versiones');
{
  const { hash } = b.get();
  ok('con la versión actual, entra', b.set('uno', { base: hash }).ok);
  const r = b.set('dos', { base: hash });
  ok('con una versión vieja, conflicto con lo que hay', !r.ok && r.error === 'conflict' && r.text === 'uno', JSON.stringify(r));
  ok('y no se pisó nada', b.get().text === 'uno');
  ok('mandar lo mismo que ya hay nunca es conflicto', b.set('uno', { base: 'cualquiera' }).ok);
}

console.log('\n3. Lo que cambia afuera');
{
  await b.flush();
  await sleep(250);
  const antes = avisos.length;
  await sleep(300);
  ok('lo que escribió él mismo no vuelve como cambio ajeno', avisos.length === antes, JSON.stringify(avisos.slice(antes)));
  fs.writeFileSync(FILE, '﻿editado en Notepad++\r\nsegunda');
  let llego = null;
  for (let i = 0; i < 40 && !llego; i++) { await sleep(50); llego = avisos.slice(antes).find((a) => a.desde === 'archivo'); }
  ok('un editor de afuera entra solo', !!llego);
  ok('sin BOM y con \\n', llego?.text === 'editado en Notepad++\nsegunda', JSON.stringify(llego?.text));
  // Mientras hay un guardado pendiente, lo viejo del disco no pisa lo nuevo.
  const lento = createBorrador(FILE, { delay: 600, interval: 50 });
  await lento.load();
  lento.set('recién tipeado');
  fs.writeFileSync(FILE, 'algo viejo');
  await sleep(300);
  ok('con un guardado pendiente, el disco no le gana a lo tipeado', lento.get().text === 'recién tipeado');
  lento.close();
  ok('al cerrar, lo pendiente queda escrito', fs.readFileSync(FILE, 'utf8') === 'recién tipeado');
}
b.close();

console.log('\n4. Por el servidor, como Umbral Mobile');
{
  const FILE2 = path.join(DIR, 'srv.txt');
  const desdeCelu = [];
  const bs = createBorrador(FILE2, { delay: 20, interval: 0, onChange: (e, desde) => desdeCelu.push(desde) });
  await bs.load();
  bs.set('desde la PC');
  const inboxDir = path.join(DIR, 'inbox');
  fs.mkdirSync(inboxDir);
  const outbox = createOutbox(path.join(DIR, 'outbox'));
  await outbox.load();
  let llave = null;
  const pairing = await createPairing({ load: async () => llave, save: async (k) => { llave = k; } });
  const { server } = await createUmbralServer({ inboxDir, basePort: 0, outbox, pairing, thumb: async () => null, onFile: () => {}, borrador: bs });
  const base = `http://127.0.0.1:${server.address().port}/borrador`;
  const auth = { authorization: `Bearer ${pairing.llave()}` };
  const put = (body, h = auth) => fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });

  ok('sin llave, 401', (await fetch(base)).status === 401);
  const g = await (await fetch(base, { headers: auth })).json();
  ok('GET trae el texto y su versión', g.text === 'desde la PC' && g.hash === hashOf('desde la PC'), JSON.stringify(g));
  const p1 = await put({ text: 'desde el celu ñ', base: g.hash });
  const j1 = await p1.json();
  ok('PUT con la versión actual entra', p1.status === 200 && j1.hash === hashOf('desde el celu ñ'), JSON.stringify(j1));
  ok('la PC lo ve, avisado como del celu', bs.get().text === 'desde el celu ñ' && desdeCelu.at(-1) === 'celu');
  const p2 = await put({ text: 'otra cosa', base: g.hash });
  const j2 = await p2.json();
  ok('PUT con una versión vieja: 409 con lo que hay', p2.status === 409 && j2.text === 'desde el celu ñ', `${p2.status} ${JSON.stringify(j2)}`);
  const p3 = await put({ text: 'gana el último' });
  ok('PUT sin versión pisa (gana el último)', p3.status === 200 && bs.get().text === 'gana el último');
  ok('un cuerpo sin texto es 400', (await put({ nada: 1 })).status === 400);
  ok('sin llave no se escribe', (await put({ text: 'intruso' }, {})).status === 401 && bs.get().text === 'gana el último');
  await bs.flush();
  ok('y quedó en el disco', fs.readFileSync(FILE2, 'utf8') === 'gana el último');
  bs.close();
  server.close();
}

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* el lock de Windows */ }
process.exit(fail ? 1 : 0);
