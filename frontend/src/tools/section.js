// Section planes: one plane across X (east–west), Y (horizontal: a plan cut) or Z (north–south), or a
// section box (six planes). Planes are defined in model space and follow the portrait turn of `world`.
// Move them with the slider in the tool panel or by dragging the arrow on the plane.
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const AXES = { x: 0, y: 1, z: 2 };

export function createSection(ctx, cams) {
  const { THREE, renderer, scene, world, controls } = ctx;
  const st = { mode: 'off', axis: 'y', pos: 1.2, flip: false, box: null, showPlane: true };
  const planes = [];
  let modelBox = null;

  // a see-through plane at the cut, plus the drag handle
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x29b6f6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0288d1 });
  const helper = new THREE.Group();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  quad.renderOrder = 10;
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), edgeMat);
  helper.add(quad, frame);
  helper.visible = false;
  world.add(helper);
  const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0x0288d1);
  boxHelper.visible = false;
  world.add(boxHelper);

  const handle = new THREE.Object3D();
  world.add(handle);
  const tc = new TransformControls(cams.active(), renderer.domElement);
  tc.setMode('translate');
  tc.setSize(0.8);
  tc.attach(handle);
  const tcHelper = tc.getHelper();
  tcHelper.visible = false;
  tc.enabled = false;
  scene.add(tcHelper);
  cams.onChange(() => { tc.camera = cams.active(); });
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; ctx.dragging = e.value; });
  tc.addEventListener('objectChange', () => {
    if (st.mode === 'plane') { st.pos = handle.position.getComponent(AXES[st.axis]); }
    else if (st.mode === 'box' && st.dragSide) {
      const [ax, side] = st.dragSide;
      const v = handle.position.getComponent(AXES[ax]);
      st.box[side].setComponent(AXES[ax], side === 'min' ? Math.min(v, st.box.max.getComponent(AXES[ax]) - 0.05) : Math.max(v, st.box.min.getComponent(AXES[ax]) + 0.05));
    }
    apply();
    ctx.onSectionChange?.();
  });

  function range(axis) {
    const i = AXES[axis];
    return [modelBox.min.getComponent(i) - 0.05, modelBox.max.getComponent(i) + 0.05];
  }

  function apply() {
    world.updateMatrixWorld(true);
    const m = world.matrixWorld;
    planes.length = 0;
    if (st.mode === 'plane') {
      const n = new THREE.Vector3().setComponent(AXES[st.axis], st.flip ? 1 : -1); // keep the side below / west / north
      planes.push(new THREE.Plane(n, -n.getComponent(AXES[st.axis]) * st.pos).applyMatrix4(m));
      // helper plane across the model at the cut
      const size = modelBox.getSize(new THREE.Vector3()), c = modelBox.getCenter(new THREE.Vector3());
      helper.position.copy(c).setComponent(AXES[st.axis], st.pos);
      helper.rotation.set(0, 0, 0);
      if (st.axis === 'x') { helper.rotation.y = Math.PI / 2; helper.scale.set(size.z + 0.6, size.y + 0.6, 1); }
      if (st.axis === 'y') { helper.rotation.x = -Math.PI / 2; helper.scale.set(size.x + 0.6, size.z + 0.6, 1); }
      if (st.axis === 'z') helper.scale.set(size.x + 0.6, size.y + 0.6, 1);
      helper.visible = st.showPlane;
      boxHelper.visible = false;
      handle.position.copy(helper.position);
      tc.showX = st.axis === 'x'; tc.showY = st.axis === 'y'; tc.showZ = st.axis === 'z';
    } else if (st.mode === 'box') {
      for (const ax of ['x', 'y', 'z']) {
        const i = AXES[ax];
        const lo = new THREE.Vector3().setComponent(i, 1), hi = new THREE.Vector3().setComponent(i, -1);
        planes.push(new THREE.Plane(lo, -st.box.min.getComponent(i)).applyMatrix4(m));
        planes.push(new THREE.Plane(hi, st.box.max.getComponent(i)).applyMatrix4(m));
      }
      boxHelper.box.copy(st.box);
      boxHelper.visible = st.showPlane;
      helper.visible = false;
      const [ax, side] = st.dragSide || ['y', 'max'];
      handle.position.copy(st.box.getCenter(new THREE.Vector3())).setComponent(AXES[ax], st.box[side].getComponent(AXES[ax]));
      tc.showX = ax === 'x'; tc.showY = ax === 'y'; tc.showZ = ax === 'z';
    } else {
      helper.visible = boxHelper.visible = false;
    }
    const on = st.mode !== 'off';
    tc.enabled = on && st.showPlane;
    tcHelper.visible = on && st.showPlane;
    renderer.clippingPlanes = on ? planes.slice() : [];
    renderer.shadowMap.needsUpdate = true;
    ctx.redraw();
  }

  function setMode(mode, axis = st.axis) {
    modelBox = ctx.modelBox();
    if (mode === 'plane') {
      if (axis !== st.axis || st.mode !== 'plane') {
        const [lo, hi] = range(axis);
        st.pos = axis === 'y' ? Math.min(hi, modelBox.min.y + 1.2) : (lo + hi) / 2; // plans are cut at 1.2 m
      }
      st.axis = axis;
    }
    if (mode === 'box' && !st.box) {
      st.box = modelBox.clone().expandByScalar(0.05);
      st.box.max.y = Math.min(st.box.max.y, modelBox.min.y + 2.2); // open from above, like the default view
      st.dragSide = ['y', 'max'];
    }
    st.mode = mode;
    apply();
  }

  // labels (CSS) on the cut-away side are hidden too
  const wp = new THREE.Vector3();
  function hideClippedLabels() {
    const on = st.mode !== 'off';
    scene.traverse((o) => {
      if (!o.isCSS2DObject) return;
      let clipped = false;
      if (on) { o.getWorldPosition(wp); clipped = planes.some((p) => p.distanceToPoint(wp) < -0.02); }
      o.element.classList.toggle('clipped', clipped);
    });
  }
  const isClipped = (p) => st.mode !== 'off' && planes.some((pl) => pl.distanceToPoint(p) < 0);

  return {
    st, setMode, apply, range, hideClippedLabels, isClipped,
    setPos(v) { st.pos = v; apply(); },
    setFlip(v) { st.flip = v; apply(); },
    setShowPlane(v) { st.showPlane = v; apply(); },
    setBoxSide(ax, side, v) { st.box[side].setComponent(AXES[ax], v); st.dragSide = [ax, side]; apply(); },
    setDragSide(ax, side) { st.dragSide = [ax, side]; apply(); },
    resetBox() { st.box = null; setMode('box'); },
    get active() { return st.mode !== 'off'; },
    get dragging() { return tc.dragging; },
    get axisHovered() { return tc.axis != null; },
  };
}
