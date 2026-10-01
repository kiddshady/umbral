// Umbral — pipeline de íconos (patrón Thunder)
// design/*.svg (masters) → build/icon.ico + build/tray.ico + build/icon.png + assets/favicon.ico
// Uso: npm run icons

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const design = (f) => path.join(root, 'design', f);
const build = (f) => path.join(root, 'build', f);
const assets = (f) => path.join(root, 'assets', f);

// density: sharp rasteriza el SVG a su tamaño intrínseco; para renders más
// grandes que el master hay que subir el DPI o sale borroso.
function render(svgFile, size, intrinsic) {
  const density = Math.ceil((72 * size) / intrinsic) + 8;
  return sharp(design(svgFile), { density }).resize(size, size).png().toBuffer();
}

await mkdir(build(''), { recursive: true });
await mkdir(assets(''), { recursive: true });

// --- icon.ico: master con glow para grandes, variante simple para chicos ---
const BIG = [256, 128, 64, 48];
const SMALL = [32, 24, 16];

const appPngs = [
  ...(await Promise.all(BIG.map((s) => render('icon.svg', s, 1024)))),
  ...(await Promise.all(SMALL.map((s) => render('icon-small.svg', s, 1024)))),
];
await writeFile(build('icon.ico'), await pngToIco(appPngs));
console.log('build/icon.ico  ←', [...BIG, ...SMALL].join(', '));

// --- tray.ico: 32 (hidpi) + 16 → assets/ (runtime; build/ no entra al paquete) ---
const trayIco = await pngToIco(await Promise.all([32, 16].map((s) => render('tray.svg', s, 16))));
await writeFile(build('tray.ico'), trayIco);
await writeFile(assets('tray.ico'), trayIco);
console.log('build+assets/tray.ico  ← 32, 16');

// --- master PNG 512 (ventana, ruta /icon del server) → assets/ ---
const png512 = await render('icon.svg', 512, 1024);
await writeFile(build('icon.png'), png512);
await writeFile(assets('icon.png'), png512);
console.log('build+assets/icon.png  ← 512');

// --- favicon.ico (ruta /favicon.ico del server) → assets/ ---
// Toda de la variante simple: en una pestaña se ve a 16 px aunque la pantalla
// pida 32 o 48 píxeles reales, y a ese tamaño el glow se vuelve mancha.
const FAVICON = [48, 32, 24, 16];
const favIco = await pngToIco(await Promise.all(FAVICON.map((s) => render('icon-small.svg', s, 1024))));
await writeFile(assets('favicon.ico'), favIco);
console.log('assets/favicon.ico  ←', FAVICON.join(', '));
