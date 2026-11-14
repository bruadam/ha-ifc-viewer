// One loaded IFC model: three.js scene, camera, picking and selection, entity markers, and the BIM tools
// (tools/). createViewer() builds it into `root`; destroy() removes all of it again (switching models).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { typeLabel } from './step.js';
import { createTools } from './tools/index.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SKIP = new Set(['IfcOpeningElement', 'IfcVirtualElement']);
const HIGHLIGHT = new THREE.Color(0x03a9f4);

// meta: parseIfc() of the file; meshes: from the geometry worker (geometry.js)
export async function createViewer({ root, meta, meshes, name, hooks }) {
  const stage = document.createElement('div');
  stage.className = 'stage';
  root.append(stage);

  // ------------------------------------------------------------ model

  // ------------------------------------------------------------ scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0); // the page background shows through
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = false;
  stage.append(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  stage.append(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-4, 10, 6);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.6));

  const world = new THREE.Group();
  scene.add(world);
  const markerGroup = new THREE.Group();
  world.add(markerGroup);

  const perspCam = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
  let camera = perspCam;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;

  let dirty = true;
  const redraw = () => { dirty = true; };
  const ui = { spaces: false, markers: true, roof: false };

  const elements = new Map(); // expressId -> { id, type, group, meshes, box }
  for (const m of meshes) {
    if (SKIP.has(m.ifcType)) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    if (m.normals?.length) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const [r, gr, b, a] = m.color;
    const space = m.ifcType === 'IfcSpace';
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(r, gr, b, THREE.SRGBColorSpace),
      transparent: a < 1 || space, opacity: space ? 0.18 : a, depthWrite: !(a < 1 || space),
      side: THREE.DoubleSide, roughness: 0.8, metalness: 0,
    });
    const mesh = new THREE.Mesh(g, mat);
    if (m.origin) mesh.position.set(m.origin[0], m.origin[1], m.origin[2]);
    mesh.userData.id = m.expressId;
    if (space) mesh.renderOrder = 2;
    let el = elements.get(m.expressId);
    if (!el) {
      el = { id: m.expressId, type: m.ifcType, group: new THREE.Group(), meshes: [] };
      elements.set(m.expressId, el);
      world.add(el.group);
    }
    el.group.add(mesh);
    el.meshes.push(mesh);
  }
  if (!elements.size) throw new Error('No geometry found in this IFC file');
  world.updateMatrixWorld(true);
  const modelBox = new THREE.Box3();
  for (const el of elements.values()) {
    el.box = new THREE.Box3().setFromObject(el.group);
    if (el.type !== 'IfcSpace') modelBox.union(el.box);
  }
  if (modelBox.isEmpty()) for (const el of elements.values()) modelBox.union(el.box);
  // Roof and ceilings: hidden by default so you look down into the rooms (the "Roof" toggle shows them).
  // IfcRoof, roof slabs, ceiling coverings, and slabs lying entirely in the top metre of the model.
  const predefined = (id) => (/\.([A-Z_]+)\.\s*\)\s*;?\s*$/.exec(meta.entity(id)?.raw || '') || [])[1] || '';
  for (const el of elements.values()) {
    el.roof = el.type === 'IfcRoof' || (el.type === 'IfcSlab' && (predefined(el.id) === 'ROOF' || el.box.min.y > modelBox.max.y - 1.0))
      || (el.type === 'IfcCovering' && predefined(el.id) === 'CEILING');
  }
  const radius = modelBox.getBoundingSphere(new THREE.Sphere()).radius || 10;
  perspCam.near = Math.max(0.01, radius / 800);
  perspCam.far = radius * 60;
  controls.maxDistance = radius * 8;

  const byGlobalId = new Map();
  for (const id of elements.keys()) { const g = meta.entity(id)?.globalId; if (g) byGlobalId.set(g, id); }
  const spaces = [...elements.values()].filter((el) => el.type === 'IfcSpace');
  const roomCache = new Map();
  function roomOf(id) { // the IfcSpace an element sits in (its centre inside the room's box)
    if (roomCache.has(id)) return roomCache.get(id);
    const el = elements.get(id);
    let out = null;
    if (el?.type === 'IfcSpace') out = el;
    else if (el) {
      const c = el.box.getCenter(new THREE.Vector3());
      out = spaces.find((s) => s.box.clone().expandByScalar(0.05).containsPoint(c)) || null;
    }
    roomCache.set(id, out);
    return out;
  }

  // ------------------------------------------------------------ view + resize
  // Distance at which every corner of the model box is in view, looking along -dir (tighter than the bounding
  // sphere, which leaves a narrow model tiny on a phone held upright).
  function fitDistance(c, dir) {
    const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, perspCam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const tanV = Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2)) * (1 - inset / Math.max(1, root.clientHeight)) * 0.84; // room for the top bar and toolbar
    const tanH = Math.tan(THREE.MathUtils.degToRad(perspCam.fov / 2)) * perspCam.aspect * 0.9;
    let d = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? modelBox.max.x : modelBox.min.x, i & 2 ? modelBox.max.y : modelBox.min.y, i & 4 ? modelBox.max.z : modelBox.min.z).sub(c);
      const z = p.dot(dir); // towards the camera
      d = Math.max(d, z + Math.abs(p.dot(right)) / tanH, z + Math.abs(p.dot(up)) / tanV);
    }
    return Math.max(d, radius * 0.5);
  }
  function setView() {
    const c = modelBox.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(-0.8, 0.95, 1).normalize();
    const fit = fitDistance(c, dir);
    controls.target.copy(c);
    perspCam.position.copy(c).addScaledVector(dir, fit);
    perspCam.lookAt(c);
    tools?.syncFromPersp();
    controls.update();
    redraw();
  }
  let tools = null;
  let inset = 0; // px at the bottom covered by a sheet (phone): the view centre moves up by half of it
  function applyInset(w, h) {
    for (const cam of new Set([perspCam, camera])) {
      if (inset) cam.setViewOffset(w, h, 0, inset / 2, w, h); else cam.clearViewOffset();
    }
  }
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    perspCam.aspect = w / h;
    applyInset(w, h);
    perspCam.updateProjectionMatrix();
    tools?.onResize(w, h);
    if (camera !== perspCam) { applyInset(w, h); camera.updateProjectionMatrix(); }
    document.documentElement.classList.toggle('narrow', w < 600);
    redraw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // ------------------------------------------------------------ selection
  let selected = null;
  const glowOf = (m) => m.userData.glow || null;
  function setHighlight(id, on) {
    for (const m of elements.get(id)?.meshes || []) {
      const mat = m.material;
      if (!mat.emissive) continue;
      if (on) { mat.emissive.copy(HIGHLIGHT); mat.emissiveIntensity = 0.45; } else applyGlow(m);
    }
  }
  function applyGlow(m) {
    const mat = m.material;
    if (!mat.emissive) return;
    const g = glowOf(m);
    if (g) { mat.emissive.copy(g); mat.emissiveIntensity = 0.8; } else { mat.emissive.setRGB(0, 0, 0); mat.emissiveIntensity = 1; }
  }
  function select(id) {
    if (selected != null) setHighlight(selected, false);
    selected = id != null && elements.has(id) ? id : null;
    if (selected != null) setHighlight(selected, true);
    applyFilters();
    for (const [mid, mk] of markers) mk.obj.element.classList.toggle('sel', mid === selected);
    hooks.onSelect?.(selected);
    tools?.onSelect();
    redraw();
  }
  const selectedIds = () => (selected != null ? [selected] : []);
  function refreshHighlight() {
    for (const el of elements.values()) for (const m of el.meshes) applyGlow(m);
    if (selected != null) setHighlight(selected, true);
  }

  function applyFilters() {
    for (const el of elements.values()) {
      const hidden = tools?.userHidden(el.id);
      el.group.visible = el.type === 'IfcSpace' ? (ui.spaces || el.id === selected) && !hidden : !hidden && (ui.roof || !el.roof || el.id === selected);
    }
    for (const [id, mk] of markers) mk.obj.visible = ui.markers && !tools?.userHidden(id);
    renderer.shadowMap.needsUpdate = true;
    redraw();
  }

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    if (tools?.onPick(e)) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const visible = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    const pick = [...elements.values()].flatMap((el) => el.meshes);
    const hit = ray.intersectObjects(pick, false).find((h) => visible(h.object) && !tools?.section.isClipped(h.point));
    select(hit ? hit.object.userData.id : null);
  });

  // ------------------------------------------------------------ markers (one per linked element)
  const markers = new Map(); // id -> { obj, key }
  function anchor(id) {
    const el = elements.get(id);
    const b = el.box, c = b.getCenter(new THREE.Vector3());
    if (el.type === 'IfcSpace') c.y = b.min.y + Math.min(1.4, (b.max.y - b.min.y) / 2);
    return world.worldToLocal(c);
  }
  // items: [{ id, html, cls, title, glow: '#rrggbb' | null }]
  function setMarkers(items) {
    const keep = new Set();
    for (const it of items) {
      if (!elements.has(it.id)) continue;
      keep.add(it.id);
      let mk = markers.get(it.id);
      if (!mk) {
        const div = document.createElement('div');
        div.addEventListener('pointerdown', (e) => e.stopPropagation());
        div.addEventListener('click', (e) => { e.stopPropagation(); select(it.id); });
        const obj = new CSS2DObject(div);
        obj.position.copy(anchor(it.id));
        markerGroup.add(obj);
        mk = { obj, key: '' };
        markers.set(it.id, mk);
      }
      const key = it.html + '|' + it.cls + '|' + it.glow;
      if (mk.key !== key) {
        mk.key = key;
        mk.obj.element.className = 'marker ' + (it.cls || '') + (it.id === selected ? ' sel' : '');
        mk.obj.element.innerHTML = it.html;
        mk.obj.element.title = it.title || '';
        for (const m of elements.get(it.id).meshes) { m.userData.glow = it.glow ? new THREE.Color(it.glow) : null; }
        refreshHighlight();
      }
    }
    for (const [id, mk] of markers) {
      if (keep.has(id)) continue;
      markerGroup.remove(mk.obj);
      mk.obj.element.remove();
      for (const m of elements.get(id)?.meshes || []) m.userData.glow = null;
      markers.delete(id);
      refreshHighlight();
    }
    applyFilters();
  }

  // ------------------------------------------------------------ BIM tools
  tools = createTools({
    THREE, scene, world, renderer, controls, view: root, labels, meta, elements, esc, typeLabel,
    meshes: meshes.filter((m) => !SKIP.has(m.ifcType)), extras: () => [], modelBox: () => modelBox,
    camera: () => camera, setCamera: (c) => { camera = c; controls.object = c; resize(); redraw(); },
    pickables: () => [...elements.values()].flatMap((el) => (el.type === 'IfcSpace' ? [] : el.meshes)),
    selectId: (id) => select(id), selectedIds, refreshHighlight, applyFilters, redraw, setView: () => setView(),
    modelName: () => name, isLinked: (id) => markers.has(id), dockTabs: hooks.dockTabs || [],
  });
  setView();
  applyFilters();
  controls.addEventListener('change', redraw);

  renderer.setAnimationLoop((t) => {
    const moving = controls.update();
    if (!dirty && !moving) return;
    dirty = false;
    tools.beforeRender(t);
    renderer.render(scene, camera);
    labels.render(scene, camera);
    tools.afterRender();
  });

  function setOption(k, v) { ui[k] = v; applyFilters(); }
  // Pan (keeping the zoom) so an element is in the visible part of the screen, e.g. above the phone's sheet.
  function reveal(id) {
    const el = elements.get(id);
    if (!el) return;
    const c = el.box.getCenter(new THREE.Vector3());
    const p = c.clone().project(camera);
    const h = root.clientHeight, y = ((1 - p.y) / 2) * h;
    if (Math.abs(p.x) < 0.85 && y > 70 && y < h - inset - 30 && p.z < 1) return;
    tools.cams.animateTo(camera.position.clone().sub(controls.target), { target: c });
  }
  function setInset(px) {
    px = Math.max(0, Math.round(px));
    if (px === inset) return;
    inset = px;
    resize();
  }

  return {
    meta, elements, byGlobalId, tools, roomOf, select, setMarkers, setOption, setInset, reveal, redraw,
    get selected() { return selected; },
    options: ui,
    entityName: (id) => meta.entity(id)?.name || typeLabel(elements.get(id)?.type || ''),
    typeLabel,
    fit: (id) => tools.fitIds([id]),
    destroy() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      tools.destroy();
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose?.()); });
      pmrem.dispose();
      renderer.dispose();
      stage.remove();
    },
  };
}
