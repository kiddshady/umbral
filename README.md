# Umbral

La puerta entre el teléfono y la PC, por la red local: lo que mandás desde el celu (imágenes, PDF, cualquier archivo) llega a Recibidas en la PC, y los archivos que dejás en «Para el celu» se bajan desde el teléfono.

- La PC escucha en el puerto `4747`. El celu sube con `POST /drop` (el archivo crudo con su nombre en `X-Umbral-Name`, o multipart) y baja desde `/#recibir`. Las imágenes se reconocen por los bytes y se guardan por la fecha; lo demás, con el nombre que trae. Hasta la 0.4 solo entraban imágenes.
- **Notepad** (hasta la 0.12, Borrador): un texto de paso para copiar y pegar (un comando, un link, unas palabras) y para dejarle notas a CC. Se guarda solo en un `notepad.txt` junto a lo recibido (el `borrador.txt` de antes se renombra solo al arrancar), y es el mismo que ve Umbral Mobile: el celu lo lee y lo escribe con `GET`/`PUT /notepad` (con la versión de la que partió; si en el medio cambió, 409; `/borrador` sigue andando para Umbral Mobile 0.4). CC lo lee y lo escribe con las herramientas del mod de [`S:\tools\Notepad`](../Notepad), que deja al lado un `notepad.cc` con el hash de lo que escribió: así abajo dice «Cambió desde CC» y no «desde el archivo». Si alguien edita el `.txt` con otro programa, el cambio entra solo. `Umbral.exe --notepad` (lo que corre `/notepad` en Claude Code) trae la ventana y va al Notepad. La letra se agranda y se achica con `Ctrl +` / `Ctrl -` (o `Ctrl` + rueda), `Ctrl 0` la vuelve a 12 px, y queda guardada. El cursor es un bloque de luz con aureola que parpadea, como el de NTX. Tiene números de línea como Notepad++, y `Ctrl+K` corta el renglón del cursor como en nano: varios seguidos se juntan en el portapapeles y `Ctrl+Z` lo deshace. `Ctrl+F` busca en el texto sin distinguir mayúsculas ni tildes: resalta todo lo que encuentra, `Enter` y `Shift+Enter` (o `F3` y `Shift+F3`) van a la siguiente y a la anterior, y `Esc` cierra dejando seleccionada la que estaba marcada.
- `Ctrl+Shift+U` trae Umbral desde cualquier lado; si ya está al frente, la esconde.
- `Ctrl 1`, `Ctrl 2` y `Ctrl 3` van a Recibidas, Para el celu y Notepad, en el orden del rail (también con el teclado numérico).
- Cerrar la ventana la esconde en el tray; el servidor sigue andando.
- En Android también está [Umbral Mobile](../UmbralMobile): encuentra a la PC sola y aparece en el menú Compartir.
- Se actualiza sola desde los releases de este repo (no la versión portable).
- La interfaz está hecha sobre [Opal](../Opal), la plantilla de vidrio (desde la 0.13; hasta la 0.12 fue [Onyx](../Onyx), en violeta): acromática, con el shell de hojas que flotan sobre la niebla (el rail, la vista) y la ley del énfasis (lo importante es un pozo con el canto vivo, nada se rellena de acento). Las hojas y los módulos `op-` son del framework (no se renombran) y lo propio de Umbral vive en `renderer/css/umbral.css` y `renderer/js/app.js`, con prefijo `ub-`. Al `Toast` de Opal se le trajo de Onyx el botón de acción (`action`, el Deshacer de Limpiar). Lo que flota (menú, toast) tiene el tono de las tarjetas que tapa: las bases (`--op-flota-base` 95 %, `--op-flota-toast-base` 90 %) se midieron a píxel. El color se cambia con `node tools/retint.mjs`, nunca a mano.

```bash
npm install
npm start          # desarrollo (puerto 4748, datos en .devdata/)
npm test           # tokens, escritura atómica, formato, vinculación, archivos que llegan y el Notepad
npm run smoke      # arranca el main real con datos temporales y recorre la app
npm run dist       # instalador + portable en dist/, sin publicar
npm run release    # publica el release en GitHub (necesita GH_TOKEN)
```

Kidd Shady · Umbrovex Systems — MIT
