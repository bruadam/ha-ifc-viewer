// BIM tools for the IFC viewer, in the spirit of the ifc-lite web viewer:
// model tree + search, properties (in main.js's panel), hide / isolate / show all, x-ray, fit,
// a view cube with standard views and perspective ⇄ orthographic, section planes and box, distance
// and area measuring, Lens colouring and a generated 2D floor plan. Shortcuts: press ? in the viewer.
import css from './tools.css?inline';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
import { createCameraTools } from './camera.js';
import { createViewCube } from './viewcube.js';
import { createSection } from './section.js';
import { createMeasure } from './measure.js';
import { createLens } from './lens.js';
import { createPlan } from './plan.js';
import { ICON } from './icons.js';

export function createTools(ctx) {
  const { THREE, meta, esc } = ctx;
  const bodyBefore = new Set(document.body.children); // for destroy(): what this call adds to the page
  const st = { hidden: new Set(), isolate: null, xray: false, tool: 'select', dock: false, tab: 'tree', search: '', open: new Set() };
  ctx.dragging = false;

  const cams = createCameraTools(ctx);
  const cube = createViewCube({ ...ctx, home: () => home() }, cams);
  const section = createSection(ctx, cams);
  const measure = createMeasure(ctx, cams, section);
  const lens = createLens({ ...ctx, applyAppearance: () => applyAppearance() });
  const plan = createPlan({ ...ctx, isVisible: (id) => isShown(id), selectId: (id) => { ctx.selectId(id); }, onPlanToggle: (on) => { setBtn('plan2d', on); } });
  ctx.onMeasureChange = () => renderToolPanel();
  ctx.onSectionChange = () => syncSectionInputs();

  // ------------------------------------------------------------- visibility
  const elementIds = () => [...ctx.elements.values()].filter((el) => el.type !== 'IfcSpace').map((el) => el.id);
  // ids under a tree node: the element itself and everything contained / aggregated below it
  function subtree(id, out = new Set()) {
    if (ctx.elements.has(id) && ctx.elements.get(id).type !== 'IfcSpace') out.add(id);
    if (meta.entity(id)?.type === 'IFCSPACE') inSpace(id).forEach((i) => out.add(i));
    for (const c of meta.children(id)) subtree(c, out);
    return out;
  }
  // Elements here belong to the storey, not to rooms: a room's contents are what lies inside its volume
  // (element centre within the room's box, 15 cm slack), plus the walls, doors and windows that bound it.
  function inSpace(id) {
    const sp = ctx.elements.get(id);
    if (!sp) return [];
    const was = sp.group.visible;
    sp.group.visible = true;
    const box = new THREE.Box3().setFromObject(sp.group).expandByScalar(0.15);
    sp.group.visible = was;
    const out = [];
    for (const el of ctx.elements.values()) {
      if (el.type === 'IfcSpace') continue;
      const b = new THREE.Box3().setFromObject(el.group);
      const bounding = ['IfcWall', 'IfcDoor', 'IfcWindow', 'IfcSlab', 'IfcCovering'].includes(el.type) && b.intersectsBox(box);
      if (bounding || box.containsPoint(b.getCenter(new THREE.Vector3()))) out.push(el.id);
    }
    return out;
  }
  const userHidden = (id) => st.hidden.has(id) || (st.isolate && !st.isolate.has(id)) || lens.hidden(id);
  const isShown = (id) => { const el = ctx.elements.get(id); return !!el && el.group.visible; };
  function changed() { ctx.applyFilters(); applyAppearance(); renderTree(); updateButtons(); }
  function hide(ids) { ids.forEach((i) => st.hidden.add(i)); if (st.isolate) ids.forEach((i) => st.isolate.delete(i)); changed(); }
  function isolate(ids) { st.isolate = new Set(ids); st.hidden.clear(); changed(); fitIds(ids); }
  function showAll() { st.hidden.clear(); st.isolate = null; changed(); }
  function toggleXray(v = !st.xray) { st.xray = v; applyAppearance(); updateButtons(); }

  // ------------------------------------------------------------- appearance (x-ray + Lens colours)
  const ghost = new THREE.MeshBasicMaterial({ color: 0x9aa7b4, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
  const lensGhost = new THREE.MeshLambertMaterial({ color: 0xb0b8c0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  function meshesOf(el) { const out = []; el.group.traverse((o) => { if (o.isMesh && !o.isSprite) out.push(o); }); return out; }
  function applyAppearance() {
    const sel = new Set(ctx.selectedIds());
    for (const el of ctx.elements.values()) {
      if (el.type === 'IfcSpace') continue;
      const lc = lens.colorOf(el.id);
      for (const m of meshesOf(el)) {
        if (m.userData.toolsSkip) continue;
        m.userData.origMat ??= m.material;
        let mat = m.userData.origMat;
        if (st.xray && !sel.has(el.id)) mat = ghost;
        else if (lc === 'ghost') mat = sel.has(el.id) ? mat : lensGhost;
        else if (lc) {
          m.userData.lensMat ??= new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
          m.userData.lensMat.color.setRGB(lc[0], lc[1], lc[2], THREE.SRGBColorSpace);
          mat = m.userData.lensMat;
        }
        if (m.material !== mat) m.material = mat;
      }
    }
    for (const e of ctx.extras()) for (const m of e.meshes || []) { // the viewer's own additions (tiles, heating loops …)
      m.userData.origMat ??= m.material;
      const mat = st.xray || lens.active ? ghost : m.userData.origMat;
      if (m.material !== mat) m.material = mat;
    }
    ctx.refreshHighlight();
    ctx.renderer.shadowMap.needsUpdate = true;
    ctx.redraw();
  }

  // ------------------------------------------------------------- camera helpers
  function boxOf(ids) {
    const b = new THREE.Box3();
    for (const id of ids) { const el = ctx.elements.get(id); if (el) b.union(new THREE.Box3().setFromObject(el.group)); }
    return b;
  }
  function fitIds(ids) { if (ids?.size || ids?.length) cams.fitBox(boxOf(ids)); }
  function fitSelection() {
    const ids = ctx.selectedIds();
    if (ids.length) {
      const el = ctx.elements.get(ids[0]);
      const b = el?.type === 'IfcSpace' ? new THREE.Box3().setFromObject(el.group) : boxOf(ids);
      if (el?.type === 'IfcSpace') { const p = el.group.visible; el.group.visible = true; b.setFromObject(el.group); el.group.visible = p; }
      cams.fitBox(b);
    } else cams.fitBox(new THREE.Box3().copy(ctx.modelBox()).applyMatrix4(ctx.world.matrixWorld));
  }
  function home() { cams.setProjection(cams.mode); ctx.setView('3d'); }

  // ------------------------------------------------------------- screenshot
  function screenshot() {
    const r = ctx.renderer;
    r.render(ctx.scene, cams.active());
    r.domElement.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${ctx.modelName?.() || 'model'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
    ctx.redraw();
  }

  // ------------------------------------------------------------- toolbar
  const TOOLS = [
    ['dock', 'Model tree & Lens (T)', ICON.tree],
    '|',
    ['select', 'Select (Esc)', ICON.pointer],
    ['distance', 'Measure distance (M)', ICON.ruler],
    ['area', 'Measure area (A)', ICON.area],
    ['section', 'Section plane (S)', ICON.scissors],
    ['box', 'Section box (B)', ICON.box],
    '|',
    ['hide', 'Hide selected (H)', ICON.eyeOff],
    ['isolate', 'Isolate selected (I)', ICON.isolate],
    ['showall', 'Show all (U)', ICON.eye],
    ['xray', 'X-ray (X)', ICON.xray],
    ['fit', 'Fit selection / model (F)', ICON.fit],
    '|',
    ['plan2d', '2D floor plan (P)', ICON.plan],
    ['shot', 'Screenshot (PNG)', ICON.camera],
    ['help', 'Shortcuts (?)', ICON.help],
  ];
  const bar = document.createElement('div');
  bar.className = 'tbar';
  bar.innerHTML = TOOLS.map((t) => (t === '|' ? '<span class="tsep"></span>' : `<button data-tool="${t[0]}" title="${esc(t[1])}" aria-label="${esc(t[1])}">${t[2]}</button>`)).join('');
  document.body.append(bar);
  const setBtn = (k, on) => bar.querySelector(`[data-tool="${k}"]`)?.classList.toggle('on', !!on);
  function updateButtons() {
    for (const k of ['select', 'distance', 'area']) setBtn(k, st.tool === k);
    setBtn('section', section.st.mode === 'plane');
    setBtn('box', section.st.mode === 'box');
    setBtn('xray', st.xray);
    setBtn('dock', st.dock);
    setBtn('showall', false);
    bar.querySelector('[data-tool="showall"]').classList.toggle('attn', !!(st.hidden.size || st.isolate));
    const hasSel = ctx.selectedIds().length > 0;
    for (const k of ['hide', 'isolate']) bar.querySelector(`[data-tool="${k}"]`).disabled = !hasSel;
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) act(b.dataset.tool);
  });
  function setTool(t) {
    st.tool = t;
    measure.setMode(t === 'distance' || t === 'area' ? t : null);
    renderToolPanel();
    updateButtons();
  }
  function act(k) {
    const sel = ctx.selectedIds();
    switch (k) {
      case 'dock': toggleDock(); break;
      case 'select': setTool('select'); break;
      case 'distance': case 'area': setTool(st.tool === k ? 'select' : k); break;
      case 'section': section.setMode(section.st.mode === 'plane' ? 'off' : 'plane'); renderToolPanel(); updateButtons(); break;
      case 'box': section.setMode(section.st.mode === 'box' ? 'off' : 'box'); renderToolPanel(); updateButtons(); break;
      case 'hide': if (sel.length) { hide(sel); ctx.selectId(null); } break;
      case 'isolate': if (sel.length) isolate(sel); break;
      case 'showall': showAll(); break;
      case 'xray': toggleXray(); break;
      case 'fit': fitSelection(); break;
      case 'plan2d': plan.toggle(); break;
      case 'shot': screenshot(); break;
      case 'help': help.classList.toggle('show'); break;
      default:
    }
  }

  // ------------------------------------------------------------- contextual tool panel (section / measure)
  const tpanel = document.createElement('div');
  tpanel.className = 'tpanel';
  document.body.append(tpanel);
  function renderToolPanel() {
    let h = '';
    if (section.st.mode === 'plane') {
      const [lo, hi] = section.range(section.st.axis);
      h += `<div class="tp-h">${ICON.scissors}<b>Section plane</b><button data-sx="off" class="x" title="Remove the section">×</button></div>
        <div class="seg">${[['x', 'X · E–W'], ['y', 'Horizontal'], ['z', 'Z · N–S']].map(([a, l]) => `<button data-sa="${a}" class="${section.st.axis === a ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="tp-row"><input type="range" data-sp min="${lo.toFixed(2)}" max="${hi.toFixed(2)}" step="0.01" value="${section.st.pos.toFixed(2)}"><span class="num" data-spv>${(section.st.pos - (section.st.axis === 'y' ? ctx.modelBox().min.y : 0)).toFixed(2)} m</span></div>
        <div class="tp-row"><label><input type="checkbox" data-sflip ${section.st.flip ? 'checked' : ''}> Flip side</label><label><input type="checkbox" data-sshow ${section.st.showPlane ? 'checked' : ''}> Show plane</label></div>
        <div class="note">Drag the arrow on the plane, or the slider.${section.st.axis === 'y' ? ' Height above the floor.' : ''}</div>`;
    } else if (section.st.mode === 'box') {
      h += `<div class="tp-h">${ICON.box}<b>Section box</b><button data-sx="off" class="x" title="Remove the section box">×</button></div>`;
      const b = section.st.box, mb = ctx.modelBox();
      for (const [a, l] of [['x', 'X (E–W)'], ['z', 'Z (N–S)'], ['y', 'Height']]) {
        const lo = mb.min[a] - 0.05, hi = mb.max[a] + 0.05;
        h += `<div class="tp-row box"><span class="lbl">${l}</span><input type="range" data-bx="${a}" data-bs="min" min="${lo}" max="${hi}" step="0.01" value="${b.min[a]}"><input type="range" data-bx="${a}" data-bs="max" min="${lo}" max="${hi}" step="0.01" value="${b.max[a]}"></div>`;
      }
      h += `<div class="tp-row"><label><input type="checkbox" data-sshow ${section.st.showPlane ? 'checked' : ''}> Show box</label><button data-sx="reset">Reset</button></div>`;
    }
    if (st.tool === 'distance' || st.tool === 'area') {
      h += `<div class="tp-h">${st.tool === 'area' ? ICON.area : ICON.ruler}<b>${st.tool === 'area' ? 'Measure area' : 'Measure distance'}</b><button data-mx="done" class="x" title="Stop measuring">×</button></div>
        <div class="note">${st.tool === 'area' ? 'Click the corners; click the first point, double-click or press Enter to close.' : 'Click two points.'} Snaps to <span style="color:#43a047">■ corners</span>, <span style="color:#fb8c00">■ edges</span>, <span style="color:#1e88e5">■ faces</span>. Backspace undoes.</div>
        <div class="tp-row"><span class="note">${measure.count} measurement${measure.count === 1 ? '' : 's'}</span><button data-mx="clear" ${measure.count ? '' : 'disabled'}>Clear all</button></div>`;
    }
    tpanel.innerHTML = h;
    tpanel.classList.toggle('show', !!h);
  }
  function syncSectionInputs() {
    const sp = tpanel.querySelector('[data-sp]');
    if (sp) { sp.value = section.st.pos; tpanel.querySelector('[data-spv]').textContent = `${(section.st.pos - (section.st.axis === 'y' ? ctx.modelBox().min.y : 0)).toFixed(2)} m`; }
    tpanel.querySelectorAll('[data-bx]').forEach((i) => { i.value = section.st.box[i.dataset.bs][i.dataset.bx]; });
  }
  tpanel.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-sp]')) { section.setPos(+t.value); syncSectionInputs(); }
    if (t.matches('[data-bx]')) section.setBoxSide(t.dataset.bx, t.dataset.bs, +t.value);
  });
  tpanel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-sflip]')) section.setFlip(t.checked);
    if (t.matches('[data-sshow]')) section.setShowPlane(t.checked);
  });
  tpanel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.sa) { section.setMode('plane', t.dataset.sa); renderToolPanel(); }
    if (t.dataset.sx === 'off') { section.setMode('off'); renderToolPanel(); updateButtons(); }
    if (t.dataset.sx === 'reset') { section.resetBox(); renderToolPanel(); }
    if (t.dataset.mx === 'done') setTool('select');
    if (t.dataset.mx === 'clear') { measure.clear(); renderToolPanel(); }
  });

  // ------------------------------------------------------------- dock: model tree + Lens
  const dock = document.createElement('div');
  dock.className = 'dock';
  dock.innerHTML = `<div class="dock-tabs"><button data-tab="tree" class="on">Model</button><button data-tab="lens">Lens</button>${(ctx.dockTabs || []).map((t) => `<button data-tab="${t.id}">${esc(t.title)}</button>`).join('')}<button class="x" data-close aria-label="Close">×</button></div>
    <div class="dock-body"></div>`;
  document.body.append(dock);
  const dbody = dock.querySelector('.dock-body');
  function toggleDock(v = !st.dock) {
    st.dock = v;
    dock.classList.toggle('show', v);
    document.documentElement.classList.toggle('dock-open', v);
    if (v) renderDock();
    updateButtons();
  }
  dock.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-close]');
    if (!t) return;
    if (t.dataset.close != null) return toggleDock(false);
    st.tab = t.dataset.tab;
    dock.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    renderDock();
  });
  function renderDock() {
    if (!st.dock) return;
    const extra = (ctx.dockTabs || []).find((t) => t.id === st.tab);
    if (extra) extra.render(dbody);
    else if (st.tab === 'tree') renderTreeTab(); else renderLensTab();
  }

  // ---- tree
  const label = (e) => {
    const a = e.type === 'IFCSPACE' && e.longName ? `${e.longName} <span class="note">${esc(e.name)}</span>` : esc(e.name || '');
    return a || `<span class="note">${esc(ctx.typeLabel(e.type))}</span>`;
  };
  const treeIcon = (t) => ({ IFCPROJECT: '▣', IFCSITE: '◍', IFCBUILDING: '⌂', IFCBUILDINGSTOREY: '≡', IFCSPACE: '▢' }[t] || '');
  function renderTreeTab() {
    dbody.innerHTML = `<div class="tree-tools"><input type="search" class="tsearch" placeholder="Search name, class, GlobalId…" value="${esc(st.search)}">
      <div class="seg small"><button data-tg="spatial" class="${st.group !== 'class' ? 'on' : ''}">Spatial</button><button data-tg="class" class="${st.group === 'class' ? 'on' : ''}">By class</button></div></div>
      <div class="tree" role="tree"></div><div class="tree-foot note"></div>`;
    renderTree();
    const inp = dbody.querySelector('.tsearch');
    inp.addEventListener('input', () => { st.search = inp.value; renderTree(); });
  }
  const openOf = (id, depth) => (st.search.trim() ? true : depth < 4 ? !st.open.has('x' + id) : st.open.has(id));
  function nodeVisible(id) { const ids = subtree(id); if (!ids.size) return null; return [...ids].some((i) => !userHidden(i)); }
  function renderTree() {
    const tree = dbody.querySelector('.tree');
    if (!tree || st.tab !== 'tree') return;
    const sel = new Set(ctx.selectedIds());
    const q = st.search.trim().toLowerCase();
    const matchesQ = (id) => { const e = meta.entity(id); if (!e) return false; return !q || [e.name, e.longName, e.type, ctx.typeLabel(e.type), e.globalId].some((s) => String(s || '').toLowerCase().includes(q)); };
    const visibleUnder = (id) => matchesQ(id) || meta.children(id).some(visibleUnder);
    let h = '', count = 0;
    const row = (id, depth, kids, text, extra = '') => {
      const e = meta.entity(id), open = openOf(id, depth);
      const vis = nodeVisible(id);
      count++;
      return `<div class="tn ${sel.has(id) ? 'sel' : ''}" data-id="${id}" style="--d:${depth}" role="treeitem">`
        + `<span class="tw">${kids ? (open ? '▾' : '▸') : ''}</span><span class="ti">${treeIcon(e?.type)}</span>`
        + `<span class="tl">${text}</span>${extra}`
        + (vis == null ? '' : `<button class="te ${vis ? '' : 'off'}" data-eye="${id}" title="${vis ? 'Hide' : 'Show'}">${vis ? ICON.eye : ICON.eyeOff}</button>`)
        + '</div>';
    };
    if (st.group === 'class') {
      const by = new Map();
      for (const id of elementIds()) { const t = ctx.elements.get(id).type; (by.get(t) || by.set(t, []).get(t)).push(id); }
      for (const [t, ids] of [...by].sort((a, b) => ctx.typeLabel(a[0]).localeCompare(ctx.typeLabel(b[0])))) {
        const shown = ids.filter(matchesQ);
        if (!shown.length) continue;
        const key = 'c:' + t, open = q || st.open.has(key);
        const vis = ids.some((i) => !userHidden(i));
        h += `<div class="tn grp" data-cls="${esc(t)}" style="--d:0"><span class="tw">${open ? '▾' : '▸'}</span><span class="tl"><b>${esc(ctx.typeLabel(t))}</b> <span class="note">${esc(t)} · ${ids.length}</span></span><button class="te ${vis ? '' : 'off'}" data-eyecls="${esc(t)}" title="${vis ? 'Hide' : 'Show'}">${vis ? ICON.eye : ICON.eyeOff}</button></div>`;
        if (open) for (const id of shown) h += row(id, 1, false, label(meta.entity(id)));
      }
    } else {
      const walk = (id, depth) => {
        if (!visibleUnder(id)) return;
        const e = meta.entity(id), kids = meta.children(id).filter((c) => meta.entity(c)?.globalId);
        const extra = kids.length ? ` <span class="note">${kids.length}</span>` : '';
        h += row(id, depth, kids.length > 0, label(e), extra);
        if (kids.length && openOf(id, depth)) {
          const sorted = kids.sort((a, b) => { const ea = meta.entity(a), eb = meta.entity(b); const sa = ea.type === 'IFCSPACE' ? 0 : 1, sb = eb.type === 'IFCSPACE' ? 0 : 1; return sa - sb || ctx.typeLabel(ea.type).localeCompare(ctx.typeLabel(eb.type)) || String(ea.name).localeCompare(String(eb.name)); });
          sorted.forEach((c) => walk(c, depth + 1));
        }
      };
      const root = meta.root();
      if (root) walk(root, 0);
    }
    tree.innerHTML = h || '<div class="note" style="padding:8px">Nothing matches.</div>';
    const foot = dbody.querySelector('.tree-foot');
    const hiddenN = elementIds().filter(userHidden).length;
    foot.innerHTML = `${elementIds().length} elements${hiddenN ? ` · ${hiddenN} hidden · <a href="#" data-showall>show all</a>` : ''} · double-click to fit`;
    tree.querySelector('.tn.sel')?.scrollIntoView({ block: 'nearest' });
  }
  dock.addEventListener('click', (e) => {
    if (e.target.closest('[data-showall]')) { e.preventDefault(); return showAll(); }
    const tg = e.target.closest('[data-tg]');
    if (tg) { st.group = tg.dataset.tg; return renderTreeTab(); }
    const eye = e.target.closest('[data-eye],[data-eyecls]');
    if (eye) {
      e.stopPropagation();
      const ids = eye.dataset.eye ? [...subtree(+eye.dataset.eye)] : elementIds().filter((i) => ctx.elements.get(i).type === eye.dataset.eyecls);
      const anyShown = ids.some((i) => !userHidden(i));
      if (anyShown) hide(ids); else { ids.forEach((i) => st.hidden.delete(i)); if (st.isolate) ids.forEach((i) => st.isolate.add(i)); changed(); }
      return;
    }
    const n = e.target.closest('.tn');
    if (!n) return;
    if (n.dataset.cls) { const key = 'c:' + n.dataset.cls; st.open.has(key) ? st.open.delete(key) : st.open.add(key); return renderTree(); }
    const id = +n.dataset.id;
    if (e.target.closest('.tw')) { // expand / collapse (levels shown by default collapse with an 'x' mark)
      const depth = +getComputedStyle(n).getPropertyValue('--d');
      if (depth < 4 && !st.search) { st.open.has('x' + id) ? st.open.delete('x' + id) : st.open.add('x' + id); } else { st.open.has(id) ? st.open.delete(id) : st.open.add(id); }
      return renderTree();
    }
    if (ctx.elements.has(id)) ctx.selectId(id);
    else { // a storey / building: select nothing, isolate on double-click
      ctx.selectId(null);
      n.classList.add('sel');
    }
  });
  dock.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.tn[data-id]');
    if (!n) return;
    const id = +n.dataset.id;
    const ids = subtree(id);
    if (ctx.elements.has(id) && ctx.elements.get(id).type !== 'IfcSpace') fitIds([id]);
    else if (ids.size) fitIds(ids);
  });
  dock.addEventListener('contextmenu', (e) => { // right-click a node: isolate it (and everything inside)
    const n = e.target.closest('.tn[data-id]');
    if (!n) return;
    e.preventDefault();
    const ids = subtree(+n.dataset.id);
    if (ids.size) isolate([...ids]);
  });

  // ---- lens
  function renderLensTab() {
    const L = lens.active;
    let h = '<div class="lens-list">' + lens.lenses.map((l) => `<button data-lens="${l.id}" class="${L?.id === l.id ? 'on' : ''}">${esc(l.name)}</button>`).join('') + '</div>';
    if (L) {
      if (L.custom === 'property') {
        const idx = lens.propertyIndex();
        const cur = L.autoColor;
        h += `<div class="tp-row"><select data-lp>${['<option value="">Choose a property…</option>', ...[...idx].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([ps, props]) => [...props].sort().map((p) => `<option value="${esc(ps + '\u0000' + p)}" ${cur.psetName === ps && cur.propertyName === p ? 'selected' : ''}>${esc(ps)} · ${esc(p)}</option>`))].join('')}</select></div>`;
      }
      if (L.custom === 'rules') {
        const idx = lens.propertyIndex();
        const classes = [...new Set(elementIds().map((i) => ctx.elements.get(i).type))].sort();
        h += `<div class="rule-add"><select data-rk><option value="class">Class is</option><option value="prop">Property</option><option value="mat">Material contains</option></select>
          <select data-rc>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
          <select data-rp hidden>${[...idx].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([ps, props]) => [...props].sort().map((p) => `<option value="${esc(ps + '\u0000' + p)}">${esc(ps)} · ${esc(p)}</option>`)).join('')}</select>
          <select data-ro hidden>${lens.OPS.map((o) => `<option>${esc(o)}</option>`).join('')}</select>
          <input data-rv placeholder="value" hidden>
          <select data-ra><option value="colorize">Colour</option><option value="transparent">Ghost</option><option value="hide">Hide</option></select>
          <input type="color" data-rcol value="#e53935"><button data-radd>Add</button></div>`;
      }
      const leg = lens.legend;
      if (leg.length) {
        h += '<div class="legend-list">' + leg.map((e) => `<div class="lg" data-lgids="${(e.ids || []).join(',')}" title="Click: select · double-click: isolate"><span class="sw" style="background:${esc(e.color || '#999')}${e.action === 'transparent' ? ';opacity:.3' : ''}"></span><span class="tl">${esc(e.name)}</span><span class="note">${e.action === 'hide' ? 'hidden · ' : ''}${e.count}</span>${L.custom === 'rules' ? `<button class="x" data-rdel="${esc(e.id)}">×</button>` : ''}</div>`).join('') + '</div>';
        h += '<div class="note">Everything else is ghosted. Click an entry to select those elements, double-click to isolate them.</div>';
      } else if (L.custom === 'rules') h += '<div class="note">Add rules above: each colours, ghosts or hides the elements it matches. Later rules win.</div>';
      else if (!(L.custom === 'property' && !L.autoColor.propertyName)) h += '<div class="note">No element matches this lens in this model.</div>';
      h += '<div class="tp-row"><button data-lens="">Turn Lens off</button></div>';
    } else h += '<div class="note">Colour the model by class, material, zone or any property, or with your own rules. Powered by @ifc-lite/lens.</div>';
    dbody.innerHTML = h;
  }
  dock.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lens],[data-radd],[data-rdel],.lg');
    if (!b) return;
    if (b.dataset.lens != null) { lens.activate(b.dataset.lens || null); ctx.applyFilters(); updateButtons(); return renderLensTab(); }
    if (b.dataset.rdel) { e.stopPropagation(); lens.removeRule(b.dataset.rdel); ctx.applyFilters(); return renderLensTab(); }
    if (b.dataset.radd != null) {
      const q = (s) => dbody.querySelector(s);
      const kind = q('[data-rk]').value;
      let cond, name;
      if (kind === 'class') { cond = { kind: 'ifcType', values: [q('[data-rc]').value] }; name = ctx.typeLabel(q('[data-rc]').value); }
      else if (kind === 'mat') { cond = { kind: 'material', value: q('[data-rv]').value }; name = 'Material ~ ' + q('[data-rv]').value; }
      else { const [pset, prop] = q('[data-rp]').value.split('\u0000'); cond = { kind: 'property', pset, prop, op: q('[data-ro]').value, value: q('[data-rv]').value }; name = `${prop} ${q('[data-ro]').value} ${q('[data-ro]').value === 'exists' ? '' : q('[data-rv]').value}`; }
      lens.addRule({ name, cond, action: q('[data-ra]').value, color: q('[data-rcol]').value });
      ctx.applyFilters();
      return renderLensTab();
    }
    if (b.classList.contains('lg')) { const ids = b.dataset.lgids.split(',').filter(Boolean).map(Number); if (ids.length) ctx.selectId(ids[0]); }
  });
  dock.addEventListener('dblclick', (e) => {
    const b = e.target.closest('.lg');
    if (b) { const ids = b.dataset.lgids.split(',').filter(Boolean).map(Number); if (ids.length) isolate(ids); }
  });
  dock.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-lp]')) { const [ps, p] = t.value.split('\u0000'); if (p) { lens.setProperty(ps, p); ctx.applyFilters(); renderLensTab(); } }
    if (t.matches('[data-rk]')) {
      const k = t.value, q = (s) => dbody.querySelector(s);
      q('[data-rc]').hidden = k !== 'class'; q('[data-rp]').hidden = k !== 'prop'; q('[data-ro]').hidden = k !== 'prop'; q('[data-rv]').hidden = k === 'class';
    }
  });

  // ------------------------------------------------------------- help
  const help = document.createElement('div');
  help.className = 'help';
  help.innerHTML = `<div class="tp-h"><b>Keyboard shortcuts</b><button class="x" data-hclose>×</button></div><div class="keys">${[
    ['Esc', 'Cancel tool / clear selection'], ['T', 'Model tree & Lens'], ['M / A', 'Measure distance / area'], ['S / B', 'Section plane / box'],
    ['H', 'Hide selected'], ['I', 'Isolate selected'], ['U', 'Show all'], ['X', 'X-ray'], ['F', 'Fit selection (or model)'],
    ['O', 'Perspective ⇄ orthographic'], ['0', 'Home view'], ['1–6', 'Top, front, right, back, left, bottom'], ['7', 'Isometric'],
    ['P', '2D floor plan'], ['Backspace', 'Undo last measuring point'], ['?', 'This help'],
    ['Right-click tree', 'Isolate that branch'],
  ].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>`;
  document.body.append(help);
  help.addEventListener('click', (e) => { if (e.target.closest('[data-hclose]')) help.classList.remove('show'); });

  const onKey = (e) => {
    if (e.target.closest?.('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (measure.key(e)) { e.preventDefault(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = { t: 'dock', m: 'distance', a: 'area', s: 'section', b: 'box', h: 'hide', i: 'isolate', u: 'showall', x: 'xray', f: 'fit', p: 'plan2d', '?': 'help' };
    if (map[k]) { e.preventDefault(); return act(map[k]); }
    const views = { 1: 'top', 2: 'front', 3: 'right', 4: 'back', 5: 'left', 6: 'bottom', 7: 'iso' };
    if (views[k]) return cams.standardView(views[k]);
    if (k === '0' || k === 'Home') return home();
    if (k === 'o') return cams.toggleProjection();
    if (k === 'Escape') {
      if (help.classList.contains('show')) return help.classList.remove('show');
      if (plan.open_) return plan.close();
      if (st.tool !== 'select') return setTool('select');
      ctx.selectId(null);
    }
  };
  window.addEventListener('keydown', onKey);
  const added = [...document.body.children].filter((n) => !bodyBefore.has(n));

  updateButtons();
  function openDock(tab) {
    if (tab) { st.tab = tab; dock.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab)); }
    toggleDock(true);
  }
  return {
    cams, openDock, renderDock, applyAppearance, fitIds, isolate, showAll, section, measure, lens, plan,
    userHidden, isolating: () => !!st.isolate,
    // main.js hooks
    onPick(e) { return measure.onClick(e) || ctx.dragging || section.dragging; },
    onSelect() { if (st.xray) applyAppearance(); renderTree(); updateButtons(); },
    beforeRender(now) { cams.tick(now); section.hideClippedLabels(); },
    afterRender() { cube.render(); },
    onResize: (w, h) => cams.onResize(w, h),
    syncFromPersp: () => cams.syncFromPersp(),
    get busy() { return !!measure.mode; },
    destroy() { window.removeEventListener('keydown', onKey); added.forEach((n) => n.remove()); document.documentElement.classList.remove('dock-open'); },
  };
}
