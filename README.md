# Umbral

La puerta entre el teléfono y la PC, por la red local: lo que mandás desde el celu (imágenes, PDF, cualquier archivo) llega a Recibidas en la PC, y los archivos que dejás en «Para el celu» se bajan desde el teléfono.

- La PC escucha en el puerto `4747`. El celu sube con `POST /drop` (el archivo crudo con su nombre en `X-Umbral-Name`, o multipart) y baja desde `/#recibir`. Las imágenes se reconocen por los bytes y se guardan por la fecha; lo demás, con el nombre que trae. Hasta la 0.4 solo entraban imágenes.
- **Borrador**: un texto de paso para copiar y pegar (un comando, un link, unas palabras). Se guarda solo en un `borrador.txt` junto a lo recibido, y es el mismo que ve Umbral Mobile: el celu lo lee y lo escribe con `GET`/`PUT /borrador` (con la versión de la que partió; si en el medio cambió, 409). Si alguien edita el `.txt` con otro programa, el cambio entra solo. La letra se agranda y se achica con `Ctrl +` / `Ctrl -` (o `Ctrl` + rueda), `Ctrl 0` la vuelve a 12 px, y queda guardada. El cursor es un bloque violeta con aureola que parpadea, como el de NTX.
- `Ctrl+Shift+U` trae Umbral desde cualquier lado; si ya está al frente, la esconde.
- `Ctrl 1`, `Ctrl 2` y `Ctrl 3` van a Recibidas, Para el celu y Borrador (también con el teclado numérico).
- Cerrar la ventana la esconde en el tray; el servidor sigue andando.
- En Android también está [Umbral Mobile](../UmbralMobile): encuentra a la PC sola y aparece en el menú Compartir.
- Se actualiza sola desde los releases de este repo (no la versión portable).
- La interfaz está hecha sobre [Onyx](../Onyx), la plantilla de apps de escritorio: las hojas y los módulos `ox-` son del framework (no se renombran) y lo propio de Umbral vive en `renderer/css/umbral.css` y `renderer/js/app.js`, con prefijo `ub-`. El color se cambia con `node tools/retint.mjs`, nunca a mano.

```bash
npm install
npm start          # desarrollo (puerto 4748, datos en .devdata/)
npm test           # tokens, escritura atómica, formato, vinculación, archivos que llegan y el Borrador
npm run smoke      # arranca el main real con datos temporales y recorre la app
npm run dist       # instalador + portable en dist/, sin publicar
npm run release    # publica el release en GitHub (necesita GH_TOKEN)
```

Kidd Shady · Umbrovex Systems — MIT
