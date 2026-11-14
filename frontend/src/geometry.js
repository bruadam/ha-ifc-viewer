// Main-thread side of geom.worker.js. meshes(key, prefix, bytes) asks the worker's cache first; on a miss the
// worker starts the engine while the model is still downloading (`bytes` is a promise), then builds it.
let worker = null;
let seq = 0;
const waiting = new Map();

function start() {
  if (worker) return worker;
  worker = new Worker(new URL('./geom.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { waiting.get(data.id)?.(data); };
  worker.onerror = (e) => { for (const f of waiting.values()) f({ type: 'error', message: e.message || 'Geometry worker failed' }); };
  return worker;
}
function ask(msg, transfer) {
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, (d) => { waiting.delete(id); resolve(d); });
    start().postMessage({ ...msg, id }, transfer || []);
  });
}

export const preload = start;

/** → { meshes, cached } */
export async function meshes(key, prefix, bytes, onBuild) {
  const got = await ask({ type: 'get', key });
  if (got.type === 'hit') return { meshes: got.meshes, cached: true };
  if (got.type === 'error') throw new Error(got.message);
  const buf = (await bytes).slice(); // a copy: the page keeps the original for the properties
  onBuild?.();
  const res = await ask({ type: 'build', key, prefix, buf }, [buf.buffer]);
  if (res.type === 'error') throw new Error(res.message);
  return { meshes: res.meshes, cached: false };
}
