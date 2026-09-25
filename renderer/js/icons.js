// Umbral — set de íconos SVG propios (cero glifos unicode, cero emojis)
// icon(name, size) → string SVG que se tiñe con currentColor.

const ICON_PATHS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v.01M14 20h.01M17.5 17.5h.01M20 20v.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  export: '<path d="M12 3v11"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<rect x="4" y="8" width="12" height="12" rx="1.5"/><path d="M8.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5"/>',
  arch: '<path d="M5.5 20.5v-9a6.5 6.5 0 0 1 13 0v9"/><path d="M12 11v9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sweep: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.6 2.6 5-5.4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  file: '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
  phoneDown: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M12 7.5v7"/><path d="m9 11.5 3 3 3-3"/>',
  remove: '<path d="M5 12h14"/><circle cx="12" cy="12" r="9"/>',
};

function icon(name, size = 16, strokeWidth = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// Radiación (trefoil) — el botón nuclear. Este va con fill, no stroke.
function nukeIcon(size = 16) {
  const wedge = 'M9.9 8.36 L7.5 4.21 A9 9 0 0 1 16.5 4.21 L14.1 8.36 A4.2 4.2 0 0 0 9.9 8.36 Z';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="${wedge}"/>
    <path d="${wedge}" transform="rotate(120 12 12)"/>
    <path d="${wedge}" transform="rotate(240 12 12)"/>
    <circle cx="12" cy="12" r="2.1"/>
  </svg>`;
}
