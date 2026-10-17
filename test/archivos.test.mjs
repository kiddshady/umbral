/* ═══════════════════════════════════════════════════════════════════════════
   Del celu a la PC entra cualquier archivo (0.5).

   Hasta la 0.4 /drop solo aceptaba imágenes (PNG, JPEG, GIF, WebP, mirando los
   bytes). Ahora entra todo: las imágenes siguen igual, con su nombre por la
   fecha, y lo demás llega con el nombre que trae, limpio para Windows. Acá se
   levanta el servidor de verdad en un puerto libre y se le pega por HTTP,
   como el celu, la página del navegador y HTTP Shortcuts.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createPairing } = require('../pairing.js');
const { createUmbralServer, cleanName } = require('../server.js');
const { createOutbox } = require('../outbox.js');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-archivos-'));
const inboxDir = path.join(DIR, 'inbox');
fs.mkdirSync(inboxDir);
const outbox = createOutbox(path.join(DIR, 'outbox'));
await outbox.load();

let saved = null;
const pairing = await createPairing({ load: async () => saved, save: async (k) => { saved = k; } });
const llegaron = [];
const { server } = await createUmbralServer({
  inboxDir, basePort: 0, outbox, pairing, thumb: async () => null, onFile: (n) => llegaron.push(n),
});
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { authorization: `Bearer ${pairing.llave()}` };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNgYGD4z8DAwMDAwMDAAAAEcQEBVtl8zQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

const crudo = (body, headers = {}) => fetch(base + '/drop', { method: 'POST', headers: { ...auth, ...headers }, body });
const formulario = (form) => fetch(base + '/drop', { method: 'POST', headers: auth, body: form });
const enDisco = (name) => fs.existsSync(path.join(inboxDir, name)) && fs.readFileSync(path.join(inboxDir, name));
const respuesta = async (r) => ({ status: r.status, ...(await r.json()) });

console.log('\n1. Las imágenes, como siempre');
{
  const r = await respuesta(await crudo(PNG, { 'content-type': 'image/png' }));
  ok('un PNG crudo entra', r.status === 200 && r.saved.length === 1, JSON.stringify(r));
  ok('con el nombre por la fecha (cap_…png)', /^cap_\d{4}-\d\d-\d\d_.+\.png$/.test(r.saved[0]), r.saved[0]);
  const conNombre = await respuesta(await crudo(PNG, { 'content-type': 'image/png', 'x-umbral-name': 'Screenshot_1.png' }));
  ok('aunque traiga nombre, la imagen sigue yendo por la fecha', conNombre.saved[0].startsWith('cap_'), conNombre.saved[0]);
}

console.log('\n2. Un PDF crudo, como lo manda la app y la página');
{
  const r = await respuesta(await crudo(PDF, { 'content-type': 'application/pdf', 'x-umbral-name': encodeURIComponent('Apunte de Tecnia — clase 3.pdf') }));
  ok('entra', r.status === 200, JSON.stringify(r));
  ok('con su nombre, tildes y raya incluidas', r.saved[0] === 'Apunte de Tecnia — clase 3.pdf', r.saved[0]);
  ok('y los bytes llegan enteros', enDisco(r.saved[0])?.equals(PDF));
  const otra = await respuesta(await crudo(PDF, { 'content-type': 'application/pdf', 'x-umbral-name': encodeURIComponent('Apunte de Tecnia — clase 3.pdf') }));
  ok('el mismo nombre otra vez no pisa: (2)', otra.saved[0] === 'Apunte de Tecnia — clase 3 (2).pdf', otra.saved[0]);
  const sin = await respuesta(await crudo(PDF, { 'content-type': 'application/pdf' }));
  ok('sin nombre, se llama por la fecha y la extensión sale del tipo', /^archivo_.+\.pdf$/.test(sin.saved[0]), sin.saved[0]);
  const raro = await respuesta(await crudo(Buffer.from('datos'), { 'content-type': 'application/x-cosa' }));
  ok('sin nombre ni tipo conocido, .bin', /^archivo_.+\.bin$/.test(raro.saved[0]), raro.saved[0]);
}

console.log('\n3. Multipart, como HTTP Shortcuts');
{
  const form = new FormData();
  form.append('files', new Blob([PDF], { type: 'application/pdf' }), 'Programa Biotecno.pdf');
  form.append('files', new Blob([PNG], { type: 'image/png' }), 'foto.png');
  form.append('nota', 'esto es un campo de texto, no un archivo');
  const r = await respuesta(await formulario(form));
  ok('entran el PDF y la imagen', r.status === 200 && r.saved.length === 2, JSON.stringify(r));
  ok('el PDF con su nombre', r.saved.includes('Programa Biotecno.pdf'));
  ok('la imagen por la fecha', r.saved.some((n) => n.startsWith('cap_') && n.endsWith('.png')));
  ok('el campo de texto no se guarda como archivo', !fs.readdirSync(inboxDir).some((n) => fs.readFileSync(path.join(inboxDir, n)).toString().includes('campo de texto')));
  ok('se avisa uno por uno lo que llegó', r.saved.every((n) => llegaron.includes(n)));

  const tildes = new FormData();
  tildes.append('files', new Blob([PDF], { type: 'application/pdf' }), 'Química Medicinal — ñ.pdf');
  const t = await respuesta(await formulario(tildes));
  ok('el nombre con tildes llega entero por multipart', t.saved[0] === 'Química Medicinal — ñ.pdf', t.saved[0]);
}

console.log('\n4. Nombres que vienen de afuera');
{
  const subir = async (n) => (await respuesta(await crudo(Buffer.from('x'), { 'x-umbral-name': encodeURIComponent(n) }))).saved[0];
  const escapa = await subir('../../afuera.txt');
  ok('una ruta con ../ queda adentro de la carpeta', escapa === 'afuera.txt' && fs.existsSync(path.join(inboxDir, 'afuera.txt')), escapa);
  ok('con barras de Windows también', (await subir('C:\\Windows\\win.ini')) === 'win.ini');
  ok('los caracteres prohibidos se cambian por _', (await subir('a<b>:c?.txt')) === 'a_b__c_.txt');
  ok('un nombre de dispositivo no se crea tal cual', (await subir('con.txt')) === '_con.txt');
  ok('el punto final que Windows se come, afuera', (await subir('nota.txt. ')) === 'nota.txt');
  ok('un nombre de solo puntos cae al de la fecha', /^archivo_/.test(await subir('...')));
}
ok('cleanName corta los nombres largos y conserva la extensión', (() => { const n = cleanName('x'.repeat(300) + '.pdf'); return n.length === 120 && n.endsWith('.pdf'); })());

console.log('\n5. Lo que no entra');
{
  const vacio = await crudo(Buffer.alloc(0), { 'content-type': 'application/pdf' });
  ok('un cuerpo vacío: 400', vacio.status === 400);
  const soloTexto = new FormData();
  soloTexto.append('nota', 'nada más que texto');
  ok('un formulario sin archivos: 400', (await formulario(soloTexto)).status === 400);
  const sinLlave = await fetch(base + '/drop', { method: 'POST', body: PDF });
  ok('sin la llave: 401', sinLlave.status === 401);
}

server.close();
fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
