// Umbral — vinculación
// Desde la 0.4 el servidor pide una llave: la laptop sale de casa, y en un
// Wi-Fi ajeno cualquiera de la red podía listar y bajarse la bandeja.
//
// · La llave es una sola por PC y se guarda en disco. Viaja en cada pedido
//   (Authorization: Bearer <llave>, o ?k= en lo que el navegador pide solo,
//   como el src de una miniatura).
// · Para que un teléfono la consiga, la PC muestra un código de 6 dígitos que
//   vale 2 minutos y un solo uso: el teléfono lo manda a POST /pair y recibe la
//   llave. Cinco errores seguidos lo anulan, así que no se puede adivinar.
// · El QR de la app lleva la llave en el fragmento (#k=…): el navegador del
//   celu la lee y nunca llega a ningún servidor.
// · «Olvidar dispositivos» cambia la llave: todo lo vinculado queda afuera.

const crypto = require('crypto');

const CODE_MS = 2 * 60 * 1000;
const MAX_FAILS = 5;

const newKey = () => crypto.randomBytes(24).toString('base64url');

function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * `load()` devuelve la llave guardada (o null) y `save(key)` la persiste.
 * `now` es inyectable para los tests.
 */
async function createPairing({ load, save, now = Date.now }) {
  let key = await load().catch(() => null);
  if (!key) { key = newKey(); await save(key); }

  let code = null; // { value, expires, fails }

  return {
    llave: () => key,

    /** ¿La llave que trajo el pedido es la de esta PC? */
    check: (candidate) => same(candidate, key),

    /** Abre una ventana de vinculación y devuelve el código a mostrar. */
    start() {
      code = { value: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expires: now() + CODE_MS, fails: 0 };
      return { code: code.value, expires: code.expires };
    },

    cancel() { code = null; },

    /** El código del teléfono → la llave, o el motivo por el que no. */
    redeem(value) {
      if (!code || now() > code.expires) { code = null; return { ok: false, error: 'no-pairing' }; }
      if (!same(String(value || '').replace(/\D/g, ''), code.value)) {
        if (++code.fails >= MAX_FAILS) code = null;
        return { ok: false, error: 'bad-code' };
      }
      code = null; // un solo uso
      return { ok: true, key };
    },

    /** Cambia la llave: los dispositivos vinculados tienen que volver a vincularse. */
    async revoke() {
      key = newKey();
      code = null;
      await save(key);
      return key;
    },
  };
}

module.exports = { createPairing, CODE_MS, MAX_FAILS };
