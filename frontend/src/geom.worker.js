// Geometry off the main thread: the ifc-lite WASM engine runs here, so the panel (and Home Assistant around it)
// stays responsive while a model is built. Results are cached in IndexedDB, so opening the panel again skips
// the 10 MB engine entirely.
//
// in:  { type: 'get', key, prefix }          → out: { type: 'hit', meshes } | { type: 'miss' } (the engine starts warming up)
// in:  { type: 'build', key, prefix, buf }   → out: { type: 'done', meshes } | { type: 'error', message }
import { GeometryProcessor } from '@ifc-lite/geometry';

const SKIP = new Set(['IfcOpeningElement', 'IfcVirtualElement']);
const KEEP = ['expressId', 'ifcType', 'positions', 'normals', 'indices', 'color', 'origin'];
const MAX_MODELS = 6;

let engine = null;
function warm() {
  if (!engine) engine = (async () => { const p = new GeometryProcessor(); await p.init(); return p; })();
  engine.catch(() => { engine = null; });
  return engine;
}

// ------------------------------------------------------------ IndexedDB
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('ifc_viewer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('geometry');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function cacheGet(key) {
  try { return (await req((await db()).transaction('geometry').objectStore('geometry').get(key)))?.meshes || null; } catch { return null; }
}
async function cachePut(key, prefix, meshes) {
  try {
    const store = (await db()).transaction('geometry', 'readwrite').objectStore('geometry');
    const keys = await req(store.getAllKeys());
    // older versions of the same model go; beyond MAX_MODELS the least recently stored go
    for (const k of keys) if (k.startsWith(prefix) && k !== key) store.delete(k);
    const others = keys.filter((k) => !k.startsWith(prefix));
    if (others.length >= MAX_MODELS) {
      const ts = await Promise.all(others.map(async (k) => [k, (await req(store.get(k)))?.t || 0]));
      ts.sort((a, b) => a[1] - b[1]).slice(0, others.length - MAX_MODELS + 1).forEach(([k]) => store.delete(k));
    }
    store.put({ meshes, t: Date.now() }, key);
  } catch { /* private mode, quota: no cache */ }
}

// ------------------------------------------------------------ meshes: plain, compact, own buffers
const own = (a) => (a && a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a?.slice());
function lean(meshes) {
  const out = [];
  for (const m of meshes) {
    if (SKIP.has(m.ifcType) || !m.positions?.length) continue;
    const o = {};
    for (const k of KEEP) if (m[k] != null) o[k] = m[k];
    o.positions = own(m.positions); o.normals = own(m.normals); o.indices = own(m.indices);
    out.push(o);
  }
  return out;
}
const send = (msg, meshes) => {
  const buffers = new Set();
  for (const m of meshes) for (const k of ['positions', 'normals', 'indices']) if (m[k]) buffers.add(m[k].buffer);
  postMessage({ ...msg, meshes }, [...buffers]);
};

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'get') {
      const hit = await cacheGet(data.key);
      if (hit) return send({ type: 'hit', id: data.id }, hit);
      postMessage({ type: 'miss', id: data.id });
      warm();
    } else if (data.type === 'build') {
      const res = await (await warm()).process(data.buf);
      const meshes = lean(res.meshes);
      await cachePut(data.key, data.prefix, meshes); // structured clone: before the buffers are transferred
      send({ type: 'done', id: data.id }, meshes);
    }
  } catch (e) {
    postMessage({ type: 'error', id: data.id, message: e?.message || String(e) });
  }
};
