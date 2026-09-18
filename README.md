# Umbral

La puerta entre el teléfono y la PC, por la red local: las capturas del celu llegan a una galería en la PC, y los archivos que dejás en «Para el celu» se bajan desde el navegador del teléfono.

- La PC escucha en el puerto `4747`. El celu sube con `POST /drop` (imagen cruda o multipart) y baja desde `/#recibir`.
- Cerrar la ventana la esconde en el tray; el servidor sigue andando.
- Se actualiza sola desde los releases de este repo (no la versión portable).

```bash
npm install
npm start          # desarrollo (puerto 4748, datos en .devdata/)
npm run dist       # instalador + portable en dist/, sin publicar
npm run release    # publica el release en GitHub (necesita GH_TOKEN)
```

Kidd Shady · Umbrovex Systems — MIT
