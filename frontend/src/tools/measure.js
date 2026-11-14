// Measuring: distance (two clicks) and area (click the corners, then click the first point, double-click
// or press Enter). The pointer snaps to a vertex (green square) or an edge (orange) of the element under it,
// else to the face (blue). Results stay on the model until cleared; Backspace removes the last one.
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const VERTEX_PX = 12, EDGE_PX = 8;

export function createMeasure(ctx, cams, section) {
  const { THREE, renderer, world } = ctx;
  const group = new THREE.Group(); // in `world`, so results stay put when the model turns
  group.renderOrder = 20;
  world.add(group);
  let mode = null; // 'distance' | 'area' | null
  let pts = [];    // the measurement being made (model space)
  let live = null; // its preview objects
  const done = []; // finished: { objs: [...] }
  const ray = new THREE.Raycaster();

  // snap marker (screen-sized, always on top)
  const snapDot = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1e88e5, depthTest: false, sizeAttenuation: false }));
  snapDot.scale.set(0.014, 0.014, 1);
  snapDot.renderOrder = 30;
  snapDot.visible = false;
  world.add(snapDot);
  const SNAP_COLORS = { vertex: 0x43a047, edge: 0xfb8c00, face: 0x1e88e5 };

  const toModel = (p) => world.worldToLocal(p.clone());
  const toScreen = (p, r) => { // scene-space point → CSS pixels in the canvas
    const v = p.clone().project(cams.active());
    return new THREE.Vector2((v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height);
  };

  function snap(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
    ray.setFromCamera(new THREE.Vector2((m.x / r.width) * 2 - 1, -(m.y / r.height) * 2 + 1), cams.active());
    const visible = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    const hit = ray.intersectObjects(ctx.pickables(), false).find((h) => visible(h.object) && !section.isClipped(h.point));
    if (!hit) return null;
    const g = hit.object.geometry, pos = g.attributes.position;
    const tri = [hit.face.a, hit.face.b, hit.face.c].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld));
    const scr = tri.map((p) => toScreen(p, r));
    let best = null;
    tri.forEach((p, i) => { const d = scr[i].distanceTo(m); if (d < VERTEX_PX && (!best || d < best.d)) best = { d, p, kind: 'vertex' }; });
    if (!best) {
      for (let i = 0; i < 3; i++) {
        const a = tri[i], b = tri[(i + 1) % 3], sa = scr[i], sb = scr[(i + 1) % 3];
        const ab = sb.clone().sub(sa), t = THREE.MathUtils.clamp(m.clone().sub(sa).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
        const d = sa.clone().addScaledVector(ab, t).distanceTo(m);
        if (d < EDGE_PX && (!best || d < best.d)) best = { d, p: a.clone().lerp(b, t), kind: 'edge' };
      }
    }
    if (!best) best = { p: hit.point.clone(), kind: 'face' };
    return { p: toModel(best.p), kind: best.kind };
  }

  function label(text, at, cls = '') {
    const div = document.createElement('div');
    div.className = 'mlabel ' + cls;
    div.innerHTML = text;
    const o = new CSS2DObject(div);
    o.position.copy(at);
    return o;
  }
  const lineMat = () => new THREE.LineBasicMaterial({ color: 0xff3d00, depthTest: false, transparent: true });
  function dot(p) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3d00, depthTest: false, sizeAttenuation: false }));
    s.scale.set(0.009, 0.009, 1);
    s.position.copy(p);
    s.renderOrder = 25;
    return s;
  }
  const fmtLen = (m) => (m < 1 ? (m * 1000).toFixed(0) + ' mm' : m.toFixed(3) + ' m');

  function polygonArea(p) { // Newell normal: works for any planar-ish polygon in 3D
    const n = new THREE.Vector3();
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    return { area: n.length() / 2, normal: n.normalize() };
  }

  function build(points, closed, preview) {
    const objs = [];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(closed ? [...points, points[0]] : points), lineMat());
    line.renderOrder = 24;
    objs.push(line, ...points.map(dot));
    if (mode === 'distance' || (!closed && points.length === 2 && preview === 'distance')) {
      if (points.length === 2) {
        const [a, b] = points, d = b.clone().sub(a);
        objs.push(label(`<b>${fmtLen(d.length())}</b><small>Δx ${fmtLen(Math.abs(d.x))} · Δy ${fmtLen(Math.abs(d.z))} · Δz ${fmtLen(Math.abs(d.y))}</small>`, a.clone().lerp(b, 0.5)));
      }
    } else if (points.length >= 3) {
      const { area, normal } = polygonArea(points);
      let per = 0;
      for (let i = 0; i < points.length - (closed ? 0 : 1); i++) per += points[i].distanceTo(points[(i + 1) % points.length]);
      // filled polygon in its own plane
      const u = new THREE.Vector3().subVectors(points[1], points[0]).normalize(), v = new THREE.Vector3().crossVectors(normal, u);
      const flat = points.map((p) => new THREE.Vector2(p.clone().sub(points[0]).dot(u), p.clone().sub(points[0]).dot(v)));
      const tris = THREE.ShapeUtils.triangulateShape(flat, []);
      const g = new THREE.BufferGeometry().setFromPoints(points);
      g.setIndex(tris.flat());
      const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3d00, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthTest: false }));
      fill.renderOrder = 23;
      objs.push(fill);
      const c = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
      objs.push(label(`<b>${area.toFixed(2)} m²</b><small>perimeter ${fmtLen(per)}${closed ? '' : ' (open)'}</small>`, c, 'area'));
    }
    objs.forEach((o) => group.add(o));
    return objs;
  }
  const remove = (objs) => objs?.forEach((o) => { group.remove(o); o.geometry?.dispose?.(); if (o.element) o.element.remove(); });

  function preview(cursor) {
    remove(live);
    live = null;
    const p = cursor ? [...pts, cursor] : pts;
    if (p.length >= 2) live = build(p, false, mode);
    else if (p.length === 1) live = build(p, false, mode);
    ctx.redraw();
  }

  function finish(closed = true) {
    if (mode === 'area' && pts.length < 3) return;
    remove(live);
    live = null;
    done.push({ objs: build(pts, mode === 'area' && closed, null) });
    pts = [];
    ctx.onMeasureChange?.();
    ctx.redraw();
  }

  function onMove(e) {
    if (!mode || ctx.dragging) return;
    const s = snap(e);
    snapDot.visible = !!s;
    if (s) { snapDot.position.copy(s.p); snapDot.material.color.setHex(SNAP_COLORS[s.kind]); }
    renderer.domElement.style.cursor = s ? 'crosshair' : '';
    if (pts.length) preview(s?.p);
    else ctx.redraw();
  }
  let lastClick = 0;
  function onClick(e) { // returns true when the click was used
    if (!mode) return false;
    const s = snap(e);
    const now = performance.now();
    if (mode === 'area' && now - lastClick < 300 && pts.length >= 3) { finish(true); lastClick = 0; return true; }
    lastClick = now;
    if (!s) return true;
    if (mode === 'area' && pts.length >= 3) { // clicking the first point closes the outline
      const r = renderer.domElement.getBoundingClientRect();
      if (toScreen(world.localToWorld(pts[0].clone()), r).distanceTo(toScreen(world.localToWorld(s.p.clone()), r)) < VERTEX_PX) { finish(true); return true; }
    }
    pts.push(s.p);
    if (mode === 'distance' && pts.length === 2) finish();
    else preview(null);
    return true;
  }
  renderer.domElement.addEventListener('pointermove', onMove);

  function setMode(m) {
    mode = m;
    pts = [];
    remove(live);
    live = null;
    snapDot.visible = false;
    renderer.domElement.style.cursor = '';
    ctx.redraw();
  }
  return {
    setMode, onClick,
    get mode() { return mode; },
    get count() { return done.length; },
    key(e) {
      if (!mode) return false;
      if (e.key === 'Enter' && mode === 'area') { finish(true); return true; }
      if (e.key === 'Backspace') { if (pts.length) { pts.pop(); preview(null); } else if (done.length) { remove(done.pop().objs); ctx.onMeasureChange?.(); ctx.redraw(); } return true; }
      if (e.key === 'Escape' && pts.length) { pts = []; preview(null); return true; }
      return false;
    },
    clear() { done.forEach((d) => remove(d.objs)); done.length = 0; pts = []; remove(live); live = null; ctx.onMeasureChange?.(); ctx.redraw(); },
  };
}
