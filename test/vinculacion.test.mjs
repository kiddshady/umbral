/* ═══════════════════════════════════════════════════════════════════════════
   La llave y la vinculación (0.4).

   Existe porque la laptop sale de casa: hasta la 0.3 el servidor no pedía
   nada, y en un Wi-Fi ajeno cualquiera de la red podía listar y bajarse la
   bandeja. Acá se levanta el servidor de verdad en un puerto libre y se le
   pega por HTTP, igual que el celu.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createPairing, MAX_FAILS } = require('../pairing.js');
const { createUmbralServer } = require('../server.js');
const { createOutbox } = require('../outbox.js');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'umbral-vinculo-'));
const inboxDir = path.join(DIR, 'inbox');
fs.mkdirSync(inboxDir);
const outbox = createOutbox(path.join(DIR, 'outbox'));
await outbox.load();
await outbox.addBuffer(Buffer.from('hola'), 'nota.txt');

let saved = null;
let t = 1_000_000;
const pairing = await createPairing({ load: async () => saved, save: async (k) => { saved = k; }, now: () => t });
const paired = [];
const { server } = await createUmbralServer({
  inboxDir, basePort: 0, outbox, pairing,
  thumb: async () => null, onPaired: (d) => paired.push(d),
});
const base = `http://127.0.0.1:${server.address().port}`;
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const pair = (code, device = 'test') => fetch(base + '/pair', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, device }),
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

console.log('\n1. La llave');
ok('se crea y se guarda la primera vez', typeof saved === 'string' && saved.length >= 32 && pairing.llave() === saved);
const reabierta = await createPairing({ load: async () => saved, save: async () => { throw new Error('no debería guardar'); } });
ok('al reabrir se usa la guardada', reabierta.llave() === saved);

console.log('\n2. Lo que queda abierto');
let r = await get('/ping');
let j = await r.json();
ok('/ping contesta sin llave', r.status === 200 && j.app === 'umbral' && j.auth === true);
ok('…y dice que no está vinculado, sin las direcciones de Tailscale', j.paired === false && !('tailnet' in j));
r = await get('/');
ok('la página del celu abre sin llave', r.status === 200);

console.log('\n3. Lo que pide la llave');
ok('/out sin llave → 401', (await get('/out')).status === 401);
ok('/out con una llave equivocada → 401', (await get('/out', 'x'.repeat(32))).status === 401);
ok('/out/file sin llave → 401', (await get('/out/file/nota.txt')).status === 401);
r = await fetch(base + '/drop', { method: 'POST', body: PNG });
ok('/drop sin llave → 401, y no guarda nada', r.status === 401 && fs.readdirSync(inboxDir).length === 0);
ok('/out con la llave → 200', (await get('/out', pairing.llave())).status === 200);
ok('?k= sirve para lo que pide el navegador solo', (await fetch(`${base}/out/file/nota.txt?k=${pairing.llave()}`)).status === 200);
j = await (await get('/ping', pairing.llave())).json();
ok('/ping con la llave dice vinculado y trae tailnet', j.paired === true && Array.isArray(j.tailnet));

console.log('\n4. El código');
r = await pair('123456');
ok('sin ventana abierta → 409', r.status === 409);
let { code } = pairing.start();
ok('el código tiene 6 dígitos', /^\d{6}$/.test(code));
const otro = code === '000000' ? '000001' : '000000';
ok('un código equivocado → 403', (await pair(otro)).status === 403);
r = await pair(code.slice(0, 3) + ' ' + code.slice(3));
j = await r.json();
ok('el correcto (con espacio en el medio) → la llave', r.status === 200 && j.key === pairing.llave() && j.name === os.hostname());
ok('avisa a la app quién se vinculó', paired.length === 1 && paired[0].device === 'test');
ok('es de un solo uso', (await pair(code)).status === 409);

({ code } = pairing.start());
t += 2 * 60 * 1000 + 1;
ok('vence a los 2 minutos', (await pair(code)).status === 409);

({ code } = pairing.start());
for (let i = 0; i < MAX_FAILS; i++) await pair(code === '999999' ? '999998' : '999999');
ok(`${MAX_FAILS} errores anulan el código, aunque después llegue el bueno`, (await pair(code)).status === 409);

console.log('\n5. Olvidar dispositivos');
const vieja = pairing.llave();
await pairing.revoke();
ok('cambia la llave y la guarda', pairing.llave() !== vieja && saved === pairing.llave());
ok('la vieja deja de servir', (await get('/out', vieja)).status === 401);
ok('la nueva sirve', (await get('/out', pairing.llave())).status === 200);

server.close();
fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n═══ ${pass} ok · ${fail} fallas ═══\n`);
process.exit(fail ? 1 : 0);
