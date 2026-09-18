// Umbral — renderer
// Dos vistas: Recibidas (teléfono → PC) y Para el celu (PC → teléfono).
// Entrada animada, FLIP en reflows, ctx menu propio, purga escalonada,
// QR, arrastrar y soltar, pegado con Ctrl+V, tooltips y toasts.

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fuerza reflow antes de agregar la clase: el elemento recién mostrado
  // (o recién montado) fija su estado base y la transición de entrada corre siempre.
  const reveal = (el, cls = 'show') => {
    void el.offsetHeight;
    el.classList.add(cls);
  };

  const gallery = $('#gallery');
  const outGrid = $('#outbox');
  const wrap = $('#gallery-wrap');
  const outWrap = $('#outbox-wrap');
  const emptyEl = $('#empty');
  const outEmptyEl = $('#out-empty');
  const addrEl = $('#addr');
  const slider = $('#thumb-size');
  const ctx = $('#ctx');
  const qrPop = $('#qr-pop');
  const lightbox = $('#lightbox');
  const seg = $('#seg');
  const outTools = $('#out-tools');
  const veil = $('#drop-veil');
  const filePick = $('#file-pick');

  let images = [];   // recibidas: { name, url, size, mtime } — más nueva primero
  let outItems = []; // para el celu: { name, url, size, mtime, image, delivered }
  let view = 'in';

  // ------------------------------------------------------------ íconos UI

  $('#tb-logo').innerHTML = icon('arch', 16);
  $('#win-min').innerHTML = icon('minus', 13, 1.6);
  $('#win-max').innerHTML = icon('square', 12, 1.6);
  $('#win-close').innerHTML = icon('x', 13, 1.6);
  $('#btn-qr').innerHTML = icon('qr', 16);
  $('#btn-folder').innerHTML = icon('folder', 16);
  $('#btn-nuke').innerHTML = nukeIcon(16);
  $('#btn-add').innerHTML = icon('plus', 16);
  $('#btn-sweep').innerHTML = icon('sweep', 16);
  $('#size-sm').innerHTML = icon('square', 9, 3.2);
  $('#size-lg').innerHTML = icon('square', 14, 2);
  $('#empty-arch').innerHTML = icon('arch', 92, 1.1);
  $('#out-empty-ico').innerHTML = icon('phoneDown', 84, 1.1);
  $('#drop-ico').innerHTML = icon('phoneDown', 44, 1.4);
  $('#chev').innerHTML = icon('chevron', 12, 2.4);

  // ------------------------------------------------------------ esc stack

  const escStack = [];
  const pushEsc = (fn) => escStack.push(fn);
  const dropEsc = (fn) => {
    const i = escStack.indexOf(fn);
    if (i !== -1) escStack.splice(i, 1);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') escStack[escStack.length - 1]?.();
  });

  // ------------------------------------------------------------ helpers

  const fmtTime = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} · ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  };
  const extOf = (n) => (n.includes('.') ? n.split('.').pop().slice(0, 5).toUpperCase() : 'ARCHIVO');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // FLIP: anima el reacomodo de las cards cuando algo entra o se va.
  function flip(grid, mutate) {
    const before = new Map([...grid.children].map((c) => [c, c.getBoundingClientRect()]));
    mutate();
    requestAnimationFrame(() => {
      for (const c of grid.children) {
        const f = before.get(c);
        if (!f) continue;
        const l = c.getBoundingClientRect();
        const dx = f.left - l.left;
        const dy = f.top - l.top;
        if (!dx && !dy) continue;
        c.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' }
        );
      }
    });
  }

  function enter(grid, card) {
    card.classList.add('entering');
    flip(grid, () => grid.prepend(card));
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('entering')));
  }

  async function leave(grid, card) {
    if (!card) return;
    card.classList.add('leaving');
    await wait(200);
    flip(grid, () => card.remove());
  }

  // entrada inicial escalonada
  function mountStaggered(grid, cards) {
    cards.forEach((card, i) => {
      card.classList.add('entering');
      card.style.transitionDelay = Math.min(i * 24, 500) + 'ms';
      grid.append(card);
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const c of cards) {
          c.classList.remove('entering');
          c.addEventListener('transitionend', () => { c.style.transitionDelay = ''; }, { once: true });
        }
      })
    );
  }

  async function purgeCards(grid) {
    const cards = [...grid.children];
    cards.forEach((c, i) => setTimeout(() => c.classList.add('leaving'), i * 22));
    await wait(cards.length * 22 + 240);
    grid.innerHTML = '';
  }

  const cardOf = (grid, name) => grid.querySelector(`[data-name="${CSS.escape(name)}"]`);

  // ------------------------------------------------------------ vistas

  function placeSegInd() {
    const btn = seg.querySelector('.seg-btn.on');
    const ind = seg.querySelector('.seg-ind');
    ind.style.width = btn.offsetWidth + 'px';
    ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  }

  function setView(v) {
    if (v === view) return;
    view = v;
    seg.dataset.on = v;
    for (const b of seg.querySelectorAll('.seg-btn')) b.classList.toggle('on', b.dataset.view === v);
    placeSegInd();
    wrap.classList.toggle('active', v === 'in');
    outWrap.classList.toggle('active', v === 'out');
    outTools.classList.toggle('show', v === 'out');
    $('#btn-nuke').dataset.tip = v === 'in' ? 'Purgar todo' : 'Vaciar la bandeja';
  }

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // ------------------------------------------------------------ recibidas

  function makeCard(img) {
    const fig = document.createElement('figure');
    fig.className = 'card';
    fig.dataset.name = img.name;
    fig.innerHTML = `
      <img src="${img.url}" alt="" loading="lazy">
      <figcaption class="card-time">${fmtTime(img.mtime)}</figcaption>`;
    // El mismo menú sirve para la miniatura y para la foto agrandada
    const menu = (x, y) => openCtx(x, y, [
      { act: 'copy', ico: 'copy', label: 'Copiar' },
      { act: 'del', ico: 'trash', label: 'Eliminar', danger: true },
    ], async (act) => {
      if (act === 'copy') {
        const res = await window.umbral.copyImage(img.name);
        toast(res.ok ? 'Copiada al portapapeles' : 'No se pudo copiar', { ok: res.ok });
      } else {
        closeLightbox();
        removeImage(img.name);
      }
    });
    fig.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY);
    });
    fig.addEventListener('click', () => openLightbox(img.url, menu));
    return fig;
  }

  function updateMeta() {
    const n = images.length;
    $('#n-in').textContent = n;
    emptyEl.classList.toggle('show', n === 0);

    const pending = outItems.filter((i) => !i.delivered).length;
    const nOut = $('#n-out');
    nOut.textContent = outItems.length;
    nOut.classList.toggle('hot', pending > 0);
    outEmptyEl.classList.toggle('show', outItems.length === 0);
    $('#btn-sweep').disabled = !outItems.some((i) => i.delivered);
    placeSegInd();
  }

  function addImage(img) {
    if (images.some((i) => i.name === img.name)) return;
    images.unshift(img);
    enter(gallery, makeCard(img));
    updateMeta();
  }

  async function removeImage(name) {
    images = images.filter((i) => i.name !== name);
    window.umbral.deleteImage(name);
    updateMeta();
    await leave(gallery, cardOf(gallery, name));
  }

  // ------------------------------------------------------------ para el celu

  function paintPill(card, item) {
    card.classList.toggle('delivered', !!item.delivered);
    card.querySelector('.pill').innerHTML = item.delivered
      ? `${icon('check', 11, 3)}<span>Bajada</span>`
      : '<span class="dot"></span><span>Esperando</span>';
  }

  function makeOutCard(item) {
    const fig = document.createElement('figure');
    fig.className = 'card out-card' + (item.image ? '' : ' file');
    fig.dataset.name = item.name;
    const menu = (x, y) => openCtx(x, y, [
      { act: 'rm', ico: 'remove', label: 'Quitar de la bandeja', danger: true },
    ], () => {
      closeLightbox();
      removeOut(item.name);
    });
    if (item.image) {
      fig.innerHTML = `<img class="card-img" src="${item.url}" alt="" loading="lazy">`;
      fig.addEventListener('click', () => openLightbox(item.url, menu));
    } else {
      fig.innerHTML = `<div class="file-tile">${icon('file', 34, 1.4)}<b></b><span class="file-name selectable"></span></div>`;
      fig.querySelector('b').textContent = extOf(item.name);
      fig.querySelector('.file-name').textContent = item.name;
    }
    fig.insertAdjacentHTML('beforeend', `<span class="pill"></span><figcaption class="card-time">${fmtTime(item.mtime)}</figcaption>`);
    paintPill(fig, item);
    fig.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY);
    });
    return fig;
  }

  function addOut(items, { focus = false } = {}) {
    let n = 0;
    for (const item of items) {
      if (outItems.some((i) => i.name === item.name)) continue;
      outItems.unshift(item);
      enter(outGrid, makeOutCard(item));
      n++;
    }
    updateMeta();
    if (n && (focus || view !== 'out')) setView('out');
    if (n) toast(`${plural(n, 'archivo esperando', 'archivos esperando')} al celu`);
  }

  async function removeOut(name) {
    outItems = outItems.filter((i) => i.name !== name);
    window.umbral.outbox.remove(name);
    updateMeta();
    await leave(outGrid, cardOf(outGrid, name));
  }

  window.umbral.outbox.onAdded((items, opts) => addOut(items, opts));

  window.umbral.outbox.onDelivered((item) => {
    const cur = outItems.find((i) => i.name === item.name);
    if (!cur) return;
    const first = !cur.delivered;
    cur.delivered = item.delivered;
    const card = cardOf(outGrid, item.name);
    if (card) paintPill(card, cur);
    updateMeta();
    if (first) toast(`Bajada en el celu: ${item.name}`, item.image ? { img: item.url } : {});
  });

  // agregar: botón, arrastrar y soltar, Ctrl+V

  async function addFiles(files) {
    if (!files.length) return;
    const added = await window.umbral.outbox.addFiles(files);
    if (!added.length) toast('Solo se pueden mandar archivos, no carpetas', { ok: false });
    addOut(added, { focus: true });
  }

  $('#btn-add').addEventListener('click', () => filePick.click());
  filePick.addEventListener('change', () => {
    const files = [...filePick.files];
    filePick.value = '';
    addFiles(files);
  });

  let dragDepth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (dragDepth++ === 0) {
      setView('out');
      veil.classList.add('show');
    }
  });
  document.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; veil.classList.remove('show'); }
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); // sin esto Electron navega al archivo soltado
    dragDepth = 0;
    veil.classList.remove('show');
    if (isFileDrag(e)) addFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.key.toLowerCase() === 'v')) return;
    if (e.target.closest?.('input[type="text"], textarea, [contenteditable]')) return;
    const res = await window.umbral.outbox.paste();
    if (res.ok) addOut(res.items, { focus: true });
    else toast('El portapapeles no tiene una imagen ni archivos', { ok: false });
  });

  $('#btn-sweep').addEventListener('click', async () => {
    const done = outItems.filter((i) => i.delivered);
    if (!done.length) return;
    for (const item of done) removeOut(item.name);
    toast(`${plural(done.length, 'archivo quitado', 'archivos quitados')}`);
  });

  // ------------------------------------------------------------ ctx menu

  let ctxHideTimer = 0;

  function openCtx(x, y, items, onPick) {
    closeCtx();
    clearTimeout(ctxHideTimer); // si no, el cierre de recién esconde este menú
    ctx.innerHTML = items.map((it) =>
      `<button class="ctx-item${it.danger ? ' ctx-danger' : ''}" data-act="${it.act}">${icon(it.ico, 15)}<span>${it.label}</span></button>`
    ).join('');
    ctx.hidden = false;
    const r = ctx.getBoundingClientRect();
    const px = Math.min(x, innerWidth - r.width - 8);
    const py = Math.min(y, innerHeight - r.height - 8);
    ctx.style.left = px + 'px';
    ctx.style.top = py + 'px';
    ctx.style.transformOrigin = `${x > px ? 'right' : 'left'} ${y > py ? 'bottom' : 'top'}`;
    reveal(ctx);

    ctx.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      closeCtx();
      onPick(act);
    };
    pushEsc(closeCtx);
  }

  function closeCtx() {
    if (ctx.hidden) return;
    dropEsc(closeCtx);
    ctx.classList.remove('show');
    ctxHideTimer = setTimeout(() => { ctx.hidden = true; }, 160);
  }

  // Si el click afuera solo vino a cerrar el menú, no tiene que cerrar
  // también el visor que está debajo
  let ctxDismissed = false;
  document.addEventListener('mousedown', (e) => {
    ctxDismissed = !ctx.hidden && ctx.classList.contains('show') && !ctx.contains(e.target);
    if (ctxDismissed) closeCtx();
    if (qrPop.classList.contains('show') && !qrPop.contains(e.target) && !$('#btn-qr').contains(e.target)) closeQr();
  });

  // ------------------------------------------------------------ lightbox

  let closeLightbox = () => {};

  function openLightbox(url, menu) {
    lightbox.innerHTML = `<img src="${url}" alt="">`;
    lightbox.hidden = false;
    reveal(lightbox);
    const close = () => {
      dropEsc(close);
      closeLightbox = () => {};
      lightbox.classList.remove('show');
      setTimeout(() => { lightbox.hidden = true; lightbox.innerHTML = ''; }, 260);
    };
    closeLightbox = close;
    lightbox.onclick = () => { if (!ctxDismissed) close(); };
    lightbox.oncontextmenu = (e) => {
      e.preventDefault();
      if (menu) menu(e.clientX, e.clientY);
    };
    pushEsc(close);
  }

  // ------------------------------------------------------------ QR pop

  let qrLoaded = false;

  async function openQr() {
    if (!qrLoaded) {
      $('#qr-img').src = await window.umbral.qr();
      qrLoaded = true;
    }
    qrPop.hidden = false;
    reveal(qrPop);
    pushEsc(closeQr);
  }

  function closeQr() {
    dropEsc(closeQr);
    qrPop.classList.remove('show');
    setTimeout(() => { qrPop.hidden = true; }, 220);
  }

  $('#btn-qr').addEventListener('click', () => {
    qrPop.classList.contains('show') ? closeQr() : openQr();
  });

  // ------------------------------------------------------------ purga

  function confirmPurge({ title, body, action }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-icon">${nukeIcon(24)}</div>
          <h3>${title}</h3>
          <p>${body}</p>
          <div class="modal-actions">
            <button class="btn" data-act="cancel">Cancelar</button>
            <button class="btn btn-danger" data-act="ok">${action}</button>
          </div>
        </div>`;
      $('#modal-root').append(overlay);
      reveal(overlay);
      const close = (val) => {
        dropEsc(escClose);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 260);
        resolve(val);
      };
      const escClose = () => close(false);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return close(false);
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act) close(act === 'ok');
      });
      pushEsc(escClose);
    });
  }

  $('#btn-nuke').addEventListener('click', async () => {
    if (view === 'in') {
      if (!images.length) return toast('No hay nada que purgar', { ok: false });
      const n = images.length;
      const go = await confirmPurge({
        title: 'Purga total',
        body: `Se van a eliminar <strong>${plural(n, 'captura', 'capturas')}</strong>.<br>No hay vuelta atrás.`,
        action: 'Purgar',
      });
      if (!go) return;
      await purgeCards(gallery);
      images = [];
      updateMeta();
      await window.umbral.clearAll();
      toast('Umbral despejado');
    } else {
      if (!outItems.length) return toast('La bandeja ya está vacía', { ok: false });
      const n = outItems.length;
      const go = await confirmPurge({
        title: 'Vaciar la bandeja',
        body: `Se van a quitar <strong>${plural(n, 'archivo', 'archivos')}</strong> y el celu deja de verlos.<br>Los originales en tu PC no se tocan.`,
        action: 'Vaciar',
      });
      if (!go) return;
      await purgeCards(outGrid);
      outItems = [];
      updateMeta();
      await window.umbral.outbox.clear();
      toast('Bandeja vacía');
    }
  });

  // ------------------------------------------------------------ toasts

  function toast(msg, { ok = true, img = null } = {}) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = img
      ? `<img src="${img}" alt=""><span></span>`
      : `<span class="toast-ico${ok ? '' : ' bad'}">${icon(ok ? 'check' : 'x', 14, 2.4)}</span><span></span>`;
    t.querySelector('span:last-child').textContent = msg;
    $('#toasts').append(t);
    reveal(t);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 260);
    }, 2600);
  }

  // ------------------------------------------------------------ actualización
  // Una tarjeta abajo a la izquierda (los toasts van a la derecha). Aparece
  // sola solo si hay algo que hacer; "al día" y errores, solo si lo pediste.

  const upd = $('#upd');
  let updDismissed = '';
  let updTimer = 0;

  const mb = (b) => b ? ` · ${Math.round(b / 1048576)} MB` : '';

  function updView(s) {
    switch (s.phase) {
      case 'available': return { ico: 'download', title: `${s.name} disponible`, sub: `Tenés la ${s.current}${mb(s.bytes)}`,
        acts: [['open', 'Ver novedades', 'btn'], ['download', 'Descargar', 'btn btn-accent']] };
      case 'downloading': return { ico: 'download', title: `Descargando la ${s.version}`, sub: `${Math.round(s.pct * 100)}%`, bar: s.pct, sticky: true };
      case 'ready': return { ico: 'check', cls: 'ok', title: `La ${s.version} está lista`, sub: 'Si no reiniciás ahora, se instala cuando salgas de Umbral.',
        acts: [['install', 'Reiniciar', 'btn btn-accent']] };
      case 'checking': return s.manual && { ico: 'refresh', cls: 'spin', title: 'Buscando actualizaciones', sub: 'Consultando GitHub' };
      case 'current': return s.manual && { ico: 'check', cls: 'ok', title: 'Estás al día', sub: `Umbral ${s.current}`, auto: 3200 };
      case 'error': return s.manual && { ico: 'x', cls: 'bad', title: 'No se pudo buscar', sub: s.error };
      case 'unsupported': return s.manual && { ico: 'x', cls: 'bad', title: 'Sin actualización automática', sub: s.reason };
      default: return null;
    }
  }

  function hideUpd() {
    clearTimeout(updTimer);
    if (upd.hidden) return;
    upd.classList.remove('show');
    updTimer = setTimeout(() => { upd.hidden = true; }, 260);
  }

  function renderUpd(s) {
    const v = updView(s);
    const key = `${s.phase}:${s.version || ''}`;
    if (!v || updDismissed === key) return hideUpd();

    // Mientras baja solo cambian el número y la barra: no rearmar la tarjeta
    if (v.bar != null && upd.dataset.key === key && upd.classList.contains('show')) {
      upd.querySelector('.upd-txt span').textContent = v.sub;
      upd.querySelector('.upd-bar').style.setProperty('--p', v.bar);
      return;
    }
    upd.dataset.key = key;
    upd.innerHTML = `
      <div class="upd-head">
        <span class="upd-ico ${v.cls || ''}">${icon(v.ico, 16, 2.2)}</span>
        <div class="upd-txt"><b></b><span class="selectable"></span></div>
        ${v.sticky ? '' : `<button class="icon-btn upd-x" data-upd="close" aria-label="Cerrar">${icon('x', 14)}</button>`}
      </div>
      ${v.bar != null ? '<div class="upd-bar"><i></i></div>' : ''}
      ${v.acts ? `<div class="upd-acts">${v.acts.map(([a, l, c]) => `<button class="${c}" data-upd="${a}">${l}</button>`).join('')}</div>` : ''}`;
    upd.querySelector('b').textContent = v.title;
    upd.querySelector('.upd-txt span').textContent = v.sub;
    if (v.bar != null) upd.querySelector('.upd-bar').style.setProperty('--p', v.bar);

    clearTimeout(updTimer);
    if (!upd.classList.contains('show')) { upd.hidden = false; reveal(upd); }
    if (v.auto) updTimer = setTimeout(() => { updDismissed = key; hideUpd(); }, v.auto);
  }

  upd.addEventListener('click', (e) => {
    const act = e.target.closest('[data-upd]')?.dataset.upd;
    if (!act) return;
    if (act === 'close') { updDismissed = upd.dataset.key; hideUpd(); }
    else window.umbral.update[act]();
  });

  window.umbral.update.onState((s) => {
    if (s.manual) updDismissed = ''; // si lo pediste, se muestra aunque lo hayas cerrado antes
    renderUpd(s);
  });
  window.umbral.update.state().then(renderUpd);

  // ------------------------------------------------------------ slider

  const savedThumb = localStorage.getItem('umbral.thumb') || '220';
  slider.value = savedThumb;
  document.documentElement.style.setProperty('--thumb', savedThumb + 'px');
  slider.addEventListener('input', () => {
    document.documentElement.style.setProperty('--thumb', slider.value + 'px');
    localStorage.setItem('umbral.thumb', slider.value);
  });

  // ------------------------------------------------------------ fades del scroll

  function wireScrollFade(el) {
    const update = () => {
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      el.classList.toggle('fade-top', !atTop);
      el.classList.toggle('fade-bottom', !atBottom);
    };
    el.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(el);
    new ResizeObserver(update).observe(el.firstElementChild);
    update();
  }
  wireScrollFade(wrap);
  wireScrollFade(outWrap);

  // ------------------------------------------------------------ tooltips

  const tip = document.createElement('div');
  tip.className = 'u-tip';
  document.body.append(tip);

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tip.textContent = t.dataset.tip;
    const r = t.getBoundingClientRect();
    tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 6)) + 'px';
    tip.style.top = r.bottom + 7 + 'px';
    tip.classList.add('show');
    t.addEventListener('mouseleave', () => tip.classList.remove('show'), { once: true });
    t.addEventListener('mousedown', () => tip.classList.remove('show'), { once: true });
  });

  // ------------------------------------------------------------ ventana

  $('#win-min').addEventListener('click', () => window.umbral.win.minimize());
  $('#win-max').addEventListener('click', () => window.umbral.win.maximize());
  $('#win-close').addEventListener('click', () => window.umbral.win.close());
  window.umbral.win.onMaximized((v) => {
    $('#win-max').innerHTML = icon(v ? 'restore' : 'square', 12, 1.6);
  });

  // ------------------------------------------------------------ carpeta

  $('#btn-folder').addEventListener('click', () => window.umbral.openInbox(view === 'out' ? 'outbox' : 'inbox'));

  // ------------------------------------------------------------ init

  window.umbral.onNewImage((img) => {
    addImage(img);
    toast('Captura recibida', { img: img.url });
  });

  (async () => {
    const info = await window.umbral.serverInfo();
    addrEl.textContent = info.url;
    $('#empty-addr').textContent = info.url;
    $('#out-empty-addr').textContent = info.url;

    [images, outItems] = await Promise.all([window.umbral.listImages(), window.umbral.outbox.list()]);
    mountStaggered(gallery, images.map(makeCard));
    mountStaggered(outGrid, outItems.map(makeOutCard));
    updateMeta();
    // la píldora arranca en su lugar, sin deslizarse desde x=0
    const ind = seg.querySelector('.seg-ind');
    ind.style.transition = 'none';
    placeSegInd();
    void ind.offsetWidth;
    ind.style.transition = '';

    window.umbral.ready(); // recién ahora puede llegar lo de "Enviar a"
  })();
})();
