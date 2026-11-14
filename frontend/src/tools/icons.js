// 18 px line icons (Lucide-style strokes), inline so they follow the text colour.
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  tree: svg('<path d="M3 5h6M3 12h6M3 19h6"/><path d="M13 5h8M13 12h8M13 19h8"/>'),
  pointer: svg('<path d="m4 4 7 17 2.5-7.5L21 11z"/>'),
  ruler: svg('<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/><path d="m7.5 10.5 2-2M10.5 13.5l2-2M13.5 16.5l2-2"/>'),
  area: svg('<path d="M4 4h16v16H4z" stroke-dasharray="3 3"/><path d="M8 16 16 8"/><path d="M8 12l4-4M12 16l4-4"/>'),
  scissors: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
  box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A16 16 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>'),
  isolate: svg('<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>'),
  xray: svg('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" stroke-dasharray="2.5 2.5"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/>'),
  fit: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  plan: svg('<path d="M3 3h18v18H3z"/><path d="M3 12h7v9M14 3v7h7"/>'),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>'),
  help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
};
