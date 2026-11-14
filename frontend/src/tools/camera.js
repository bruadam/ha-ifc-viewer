// Camera tools: perspective ⇄ orthographic, animated standard views (top, front, iso …) and fit to selection.
// The perspective camera from main.js stays the "master": setView() still positions it, and the orthographic
// camera is derived from it (same direction, same visible height at the orbit target).

const POLAR_DEFAULT = Math.PI / 2 - 0.03; // main.js: don't orbit below the floor …
const POLAR_FREE = Math.PI;               // … except after choosing a view from below

export function createCameraTools(ctx) {
  const { THREE, controls } = ctx;
  const persp = ctx.camera();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.02, 600);
  let mode = 'persp';
  let anim = null;
  const listeners = new Set();

  const active = () => (mode === 'ortho' ? ortho : persp);
  const visibleHeight = (cam) => (cam.isOrthographicCamera
    ? (cam.top - cam.bottom) / cam.zoom
    : 2 * cam.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));

  function frameOrtho(height) {
    const aspect = persp.aspect || 1;
    ortho.left = (-height * aspect) / 2; ortho.right = (height * aspect) / 2;
    ortho.top = height / 2; ortho.bottom = -height / 2;
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
  }
  // Ortho sits far back along the same direction so nothing is behind its near plane; zoom does the framing.
  function placeOrtho(dir) {
    ortho.position.copy(controls.target).addScaledVector(dir, 80);
    ortho.up.copy(persp.up);
    ortho.lookAt(controls.target);
  }
  function syncFromPersp() { // after main.js moved the perspective camera (3D / Plan buttons)
    if (mode !== 'ortho') return;
    const dir = persp.position.clone().sub(controls.target).normalize();
    frameOrtho(visibleHeight(persp));
    placeOrtho(dir);
  }

  function setProjection(m) {
    if (m === mode) return;
    const dir = active().position.clone().sub(controls.target).normalize();
    const h = visibleHeight(active());
    if (m === 'ortho') {
      frameOrtho(h);
      placeOrtho(dir);
    } else {
      const dist = h / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)));
      persp.position.copy(controls.target).addScaledVector(dir, dist);
      persp.lookAt(controls.target);
    }
    mode = m;
    ctx.setCamera(active());
    controls.update();
    listeners.forEach((f) => f(mode));
    ctx.redraw();
  }

  function onResize(w, h) {
    if (mode !== 'ortho') return;
    const height = ortho.top - ortho.bottom;
    ortho.left = (-height * (w / h)) / 2; ortho.right = (height * (w / h)) / 2;
    ortho.updateProjectionMatrix();
  }

  // Animate the camera round the orbit target to look along -dir (dir: from target to camera, scene space),
  // optionally re-targeting and re-framing (fit).
  function animateTo(dir, { target = null, height = null, ms = 450 } = {}) {
    const cam = active();
    const t0 = controls.target.clone(), t1 = target ? target.clone() : t0.clone();
    const d0 = cam.position.clone().sub(t0).normalize();
    let d1 = dir.clone().normalize();
    // straight up/down would leave OrbitControls without a heading: tilt a hair towards the front
    if (Math.abs(d1.y) > 0.9999) d1 = new THREE.Vector3(0, Math.sign(d1.y), 0.002).normalize();
    controls.maxPolarAngle = d1.y < -0.05 ? POLAR_FREE : (controls.maxPolarAngle > POLAR_DEFAULT && d1.y >= 0 ? POLAR_DEFAULT : controls.maxPolarAngle);
    const h0 = visibleHeight(cam), h1 = height ?? h0;
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromUnitVectors(d0, d1);
    const start = performance.now();
    anim = (now) => {
      const k = Math.min(1, (now - start) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const d = d0.clone().applyQuaternion(q0.clone().slerp(q1, e));
      const tgt = t0.clone().lerp(t1, e), hh = h0 + (h1 - h0) * e;
      controls.target.copy(tgt);
      if (cam.isOrthographicCamera) {
        cam.position.copy(tgt).addScaledVector(d, 80);
        cam.zoom = (cam.top - cam.bottom) / hh;
        cam.updateProjectionMatrix();
      } else {
        cam.position.copy(tgt).addScaledVector(d, hh / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
      }
      cam.lookAt(tgt);
      controls.update();
      ctx.redraw();
      if (k >= 1) anim = null;
    };
  }
  function tick(now) { if (anim) anim(now); return !!anim; }

  // Model-space direction (before the portrait turn of `world`) → scene space
  const toScene = (v) => v.clone().applyQuaternion(ctx.world.quaternion);

  function viewDir(name) { // from the target towards the camera, model space; front = from the south
    return {
      top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0],
      iso: [1, 1, 1], 'iso-sw': [-1, 1, 1], 'iso-nw': [-1, 1, -1], 'iso-ne': [1, 1, -1],
    }[name];
  }
  function standardView(name) {
    const v = viewDir(name);
    if (v) animateTo(toScene(new THREE.Vector3(...v)));
  }

  function fitBox(box, pad = 1.25) {
    if (!box || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const cam = active();
    const dir = cam.position.clone().sub(controls.target).normalize();
    const aspect = persp.aspect || 1;
    const h = (2 * sphere.radius * pad) / Math.min(1, aspect);
    animateTo(dir, { target: sphere.center, height: Math.max(h, 0.6) });
  }

  return {
    setProjection, toggleProjection: () => setProjection(mode === 'ortho' ? 'persp' : 'ortho'),
    get mode() { return mode; }, active, onResize, syncFromPersp, animateTo, standardView, fitBox, tick, toScene,
    onChange: (f) => listeners.add(f),
  };
}
