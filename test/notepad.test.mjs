/* ═══════════════════════════════════════════════════════════════════════════
   El Notepad (0.7; hasta la 0.12, el Borrador): un notepad.txt que comparten
   la PC, el celu, CC y cualquier editor que lo abra.

   Primero el módulo solo (notepad.js): guarda, normaliza, reconoce lo que
   cambió afuera (y si fue CC) y no se confunde con lo que escribió él.
   Después la migración desde borrador.txt, y el servidor de verdad en un
   puerto libre, como lo usa Umbral Mobile, con /borrador de alias.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createNotepad, migrate, hashOf, CC_MARK } = require('../notepad.js');
const { createPairing } = require('../pairing.js');
const { createUmbralServer } = require('../server.js');
const { createOutbox } = require('../outbox.js');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-notepad-'));
const FILE = path.join(DIR, 'notepad.txt');
const avisos = [];
const b = createNotepad(FILE, { delay: 40, interval: 100, onChange: (e, desde) => avisos.push({ ...e, desde }) });

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
  const lento = createNotepad(FILE, { delay: 600, interval: 50 });
  await lento.load();
  lento.set('recién tipeado');
  fs.writeFileSync(FILE, 'algo viejo');
  await sleep(300);
  ok('con un guardado pendiente, el disco no le gana a lo tipeado', lento.get().text === 'recién tipeado');
  lento.close();
  ok('al cerrar, lo pendiente queda escrito', fs.readFileSync(FILE, 'utf8') === 'recién tipeado');
}
{
  // CC escribe el .txt y deja su marca con el hash: el cambio llega como suyo.
  const antes = avisos.length;
  const deCC = 'anotado por CC';
  fs.writeFileSync(path.join(DIR, CC_MARK), hashOf(deCC));
  fs.writeFileSync(FILE, deCC);
  let llego = null;
  for (let i = 0; i < 40 && !llego; i++) { await sleep(50); llego = avisos.slice(antes).find((a) => a.text === deCC); }
  ok('lo que escribe CC llega como de CC', llego?.desde === 'cc', JSON.stringify(llego));
  // Una marca vieja (de otro texto) no hace pasar por CC a un editor.
  fs.writeFileSync(FILE, 'editado a mano');
  llego = null;
  for (let i = 0; i < 40 && !llego; i++) { await sleep(50); llego = avisos.slice(antes).find((a) => a.text === 'editado a mano'); }
  ok('con la marca de otro texto, es del archivo', llego?.desde === 'archivo', JSON.stringify(llego));
}
b.close();

console.log('\n4. De borrador.txt a notepad.txt');
{
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-migra-'));
  fs.writeFileSync(path.join(D, 'borrador.txt'), 'lo de antes');
  const f = await migrate(D);
  ok('el borrador.txt pasa a llamarse notepad.txt', f === path.join(D, 'notepad.txt')
    && fs.readFileSync(f, 'utf8') === 'lo de antes' && !fs.existsSync(path.join(D, 'borrador.txt')));
  fs.writeFileSync(path.join(D, 'borrador.txt'), 'uno viejo que reapareció');
  await migrate(D);
  ok('con un notepad.txt ya hecho, no se pisa', fs.readFileSync(f, 'utf8') === 'lo de antes');
  const E = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-migra-'));
  ok('sin nada, la ruta y ningún archivo', (await migrate(E)) === path.join(E, 'notepad.txt') && fs.readdirSync(E).length === 0);
  fs.rmSync(D, { recursive: true, force: true });
  fs.rmSync(E, { recursive: true, force: true });
}

console.log('\n5. Por el servidor, como Umbral Mobile');
{
  const FILE2 = path.join(DIR, 'srv.txt');
  const desdeCelu = [];
  const bs = createNotepad(FILE2, { delay: 20, interval: 0, onChange: (e, desde) => desdeCelu.push(desde) });
  await bs.load();
  bs.set('desde la PC');
  const inboxDir = path.join(DIR, 'inbox');
  fs.mkdirSync(inboxDir);
  const outbox = createOutbox(path.join(DIR, 'outbox'));
  await outbox.load();
  let llave = null;
  const pairing = await createPairing({ load: async () => llave, save: async (k) => { llave = k; } });
  const { server } = await createUmbralServer({ inboxDir, basePort: 0, outbox, pairing, thumb: async () => null, onFile: () => {}, notepad: bs });
  const base = `http://127.0.0.1:${server.address().port}/notepad`;
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
  // Umbral Mobile 0.4 todavía pide /borrador: es el mismo texto.
  const viejo = base.replace(/\/notepad$/, '/borrador');
  const gv = await (await fetch(viejo, { headers: auth })).json();
  ok('/borrador sigue andando y da el mismo texto', gv.text === 'gana el último' && gv.hash === bs.get().hash, JSON.stringify(gv));
  const pv = await fetch(viejo, { method: 'PUT', headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ text: 'desde un celu viejo', base: gv.hash }) });
  ok('y también escribe', pv.status === 200 && bs.get().text === 'desde un celu viejo');
  bs.set('gana el último');
  await bs.flush();
  ok('y quedó en el disco', fs.readFileSync(FILE2, 'utf8') === 'gana el último');
  bs.close();
  server.close();
}

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* el lock de Windows */ }
process.exit(fail ? 1 : 0);
