// Navigation cube in the top-right corner: click a face, edge or corner to look from there (26 directions),
// drag it to orbit. Drawn into the main canvas (scissored corner) right after the scene, so it costs no
// second WebGL context; a transparent div on top takes the pointer.

const FACES = [ // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  { label: 'RIGHT', sub: 'E' }, { label: 'LEFT', sub: 'W' }, { label: 'TOP', sub: '' },
  { label: 'BOTTOM', sub: '' }, { label: 'FRONT', sub: 'S' }, { label: 'BACK', sub: 'N' },
];

export function createViewCube(ctx, cams) {
  const { THREE, renderer } = ctx;
  const SIZE = () => (ctx.view.clientWidth < 600 ? 66 : 110);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 20);
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(2, 4, 3);
  scene.add(dl);

  function faceTexture(f, hot) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = hot ? '#cfe9fb' : '#eef1f4';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#9aa6b2';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 246);
    g.fillStyle = hot ? '#0277bd' : '#37414b';
    g.font = '600 46px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(f.label, 128, f.sub ? 116 : 128);
    if (f.sub) { g.font = '500 30px -apple-system, "Segoe UI", Roboto, sans-serif'; g.fillStyle = '#7a8692'; g.fillText(f.sub, 128, 168); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const mats = FACES.map((f) => new THREE.MeshLambertMaterial({ map: faceTexture(f, false) }));
  const hotMaps = FACES.map((f) => faceTexture(f, true));
  const coldMaps = mats.map((m) => m.map);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mats);
  scene.add(cube);
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x8a96a2 })));
  // hover marker for edges and corners: a small blue box on the spot
  const marker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.7, depthTest: false }));
  marker.visible = false;
  scene.add(marker);
  // compass ring under the cube, N towards the model's north (back)
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.6, 48), new THREE.MeshBasicMaterial({ color: 0xa9b3bd, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.05;
  scene.add(ring);
  const nTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#e53935'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 32, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const north = new THREE.Sprite(new THREE.SpriteMaterial({ map: nTex, depthTest: false }));
  north.scale.set(0.5, 0.5, 1);
  north.position.set(0, -1.05, -1.78);
  scene.add(north);

  // DOM: pointer target + home and projection buttons under it
  const box = document.createElement('div');
  box.className = 'vc';
  box.innerHTML = '<div class="vc-hit" title="Click a face, edge or corner to look from there · drag to orbit"></div>'
    + '<div class="vc-btns"><button data-vc="home" title="Home view (H)">⌂</button><button data-vc="proj" title="Perspective / orthographic (O)">Persp</button></div>';
  document.body.append(box);
  const hit = box.querySelector('.vc-hit');
  const projBtn = box.querySelector('[data-vc="proj"]');
  cams.onChange((m) => { projBtn.textContent = m === 'ortho' ? 'Ortho' : 'Persp'; projBtn.classList.toggle('on', m === 'ortho'); });
  box.querySelector('[data-vc="home"]').onclick = () => ctx.home();
  projBtn.onclick = () => cams.toggleProjection();

  const ray = new THREE.Raycaster();
  let hover = null; // { dir: Vector3 (model space), face }
  function pick(e) {
    const r = hit.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, cam);
    const h = ray.intersectObject(cube, false)[0];
    if (!h) return null;
    const q = h.point.clone(); // cube spans -1…1: coordinates near ±1 pick that side (edge/corner within 0.35 of it)
    const dir = new THREE.Vector3(...['x', 'y', 'z'].map((k) => (Math.abs(q[k]) > 0.65 ? Math.sign(q[k]) : 0)));
    return { dir, face: Math.floor(h.faceIndex / 2) };
  }
  function setHover(hv) {
    const key = (x) => (x ? x.dir.toArray().join() : '');
    if (key(hv) === key(hover)) return;
    hover = hv;
    mats.forEach((m, i) => { m.map = coldMaps[i]; });
    marker.visible = false;
    if (hv) {
      const n = Math.abs(hv.dir.x) + Math.abs(hv.dir.y) + Math.abs(hv.dir.z);
      if (n === 1) mats[hv.face].map = hotMaps[hv.face];
      else {
        marker.visible = true;
        marker.position.copy(hv.dir);
        marker.scale.set(...['x', 'y', 'z'].map((k) => (hv.dir[k] ? 0.36 : 1.32)));
      }
    }
    ctx.redraw();
  }
  let drag = null;
  hit.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; hit.setPointerCapture(e.pointerId); });
  hit.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) { // orbit the main camera like OrbitControls would
        const c = cams.active(), t = ctx.controls.target, off = c.position.clone().sub(t);
        const s = new THREE.Spherical().setFromVector3(off);
        s.theta -= dx * 0.012; s.phi = THREE.MathUtils.clamp(s.phi - dy * 0.012, 0.01, ctx.controls.maxPolarAngle);
        c.position.copy(t).add(new THREE.Vector3().setFromSpherical(s));
        c.lookAt(t);
        ctx.controls.update();
        ctx.redraw();
        drag.x = e.clientX; drag.y = e.clientY;
      }
      return;
    }
    setHover(pick(e));
  });
  hit.addEventListener('pointerup', (e) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const p = pick(e);
    if (p) cams.animateTo(cams.toScene(p.dir));
  });
  hit.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

  const q = new THREE.Quaternion();
  function render() {
    const size = SIZE(), dpr = renderer.getPixelRatio();
    const W = renderer.domElement.width / dpr, H = renderer.domElement.height / dpr;
    // the cube turns with the camera, seen in the model's own frame (portrait screens turn `world`)
    const c = cams.active();
    q.copy(ctx.world.quaternion).invert().multiply(c.quaternion);
    cam.position.set(0, 0, 6).applyQuaternion(q);
    cam.quaternion.copy(q);
    const x = W - size - 12, y = H - size - 64; // top-right, under the toolbar (y from the bottom in GL)
    const planes = renderer.clippingPlanes;
    renderer.clippingPlanes = [];
    const ac = renderer.autoClear, tm = renderer.toneMapping;
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, size, size);
    renderer.setViewport(x, y, size, size);
    renderer.clearDepth();
    renderer.render(scene, cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.autoClear = ac;
    renderer.toneMapping = tm;
    renderer.clippingPlanes = planes;
    box.style.width = size + 'px';
    hit.style.height = size + 'px';
  }
  return { render, el: box };
}
