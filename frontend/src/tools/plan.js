// 2D floor plan from @ifc-lite/drawing-2d: the model cut at a height (default 1.2 m above the floor),
// cut elements hatched, everything below drawn in projection. Shown full-screen with pan and zoom;
// clicking an element in the plan selects it in 3D. Download as SVG or DXF.
import { generateFloorPlan, exportToSVG, exportToDXF } from '@ifc-lite/drawing-2d';

export function createPlan(ctx) {
  const overlay = document.createElement('div');
  overlay.className = 'plan2d';
  overlay.innerHTML = `
    <div class="plan2d-bar">
      <b>Floor plan</b>
      <label>Cut at <input type="range" class="pz" min="0.2" max="2.4" step="0.05" value="1.2"> <span class="pzv">1.20 m</span></label>
      <label><input type="checkbox" class="pvis" checked> Only visible elements</label>
      <label><input type="checkbox" class="phatch" checked> Hatching</label>
      <span class="pstat note"></span>
      <span class="grow"></span>
      <button data-p="fit" title="Fit">Fit</button>
      <button data-p="svg">⬇ SVG</button><button data-p="dxf">⬇ DXF</button>
      <button data-p="close" class="x" aria-label="Close">×</button>
    </div>
    <div class="plan2d-stage"><div class="plan2d-svg"></div></div>`;
  document.body.append(overlay);
  const $ = (s) => overlay.querySelector(s);
  const stage = $('.plan2d-stage'), holder = $('.plan2d-svg');
  let drawing = null, svgText = '', view = { x: 0, y: 0, k: 1 }, busy = false;

  function meshes() {
    const vis = $('.pvis').checked;
    return ctx.meshes.filter((m) => !['IfcSpace', 'IfcOpeningElement', 'IfcVirtualElement'].includes(m.ifcType)
      && (!vis || ctx.isVisible(m.expressId)));
  }

  async function generate() {
    if (busy) return;
    busy = true;
    $('.pstat').textContent = 'drawing…';
    try {
      const floor = ctx.modelBox().min.y;
      const z = floor + +$('.pz').value;
      drawing = await generateFloorPlan(meshes(), z, { includeHiddenLines: false, includeProjection: true, includeEdges: true, mergeLines: true, useGPU: false });
      svgText = exportToSVG(drawing, { showHatching: $('.phatch').checked, showHiddenLines: false, showTitleBlock: false, padding: 10, backgroundColor: 'transparent', title: 'Floor plan', scale: { name: '1:50', factor: 50 } });
      holder.innerHTML = svgText;
      tagElements();
      $('.pstat').textContent = `${drawing.stats?.cutLineCount ?? drawing.lines.length} cut lines · ${drawing.cutPolygons.length} cut areas`;
      fit();
    } catch (e) {
      console.error(e);
      $('.pstat').textContent = 'could not draw: ' + e.message;
    }
    busy = false;
  }

  // The exporter tags every line and polygon with data-entity-id: a click finds its element from that.
  function tagElements() {
    const svg = holder.querySelector('svg');
    if (!svg) return;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = '100%'; svg.style.height = '100%';
    try { // frame the drawing itself (the exporter's sheet is much larger): union of the elements' screen boxes
      const inv = svg.getScreenCTM().inverse(), pt = svg.createSVGPoint();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of svg.querySelectorAll('[data-entity-id]')) {
        const r = n.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        for (const [cx, cy] of [[r.left, r.top], [r.right, r.bottom]]) {
          pt.x = cx; pt.y = cy;
          const q = pt.matrixTransform(inv);
          x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
        }
      }
      if (x1 > x0) { const m = Math.max(x1 - x0, y1 - y0) * 0.04; svg.setAttribute('viewBox', `${x0 - m} ${y0 - m} ${x1 - x0 + 2 * m} ${y1 - y0 + 2 * m}`); }
    } catch { /* not rendered yet */ }
    svg.querySelectorAll('[data-entity-id]').forEach((n) => n.classList.add('pick'));
  }
  function entityAt(e) {
    let n = e.target;
    for (; n && n !== holder; n = n.parentNode) {
      const id = n.getAttribute?.('data-entity-id');
      if (id != null && !isNaN(+id)) return +id;
    }
    return null;
  }
  function applyView() { holder.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; }
  function fit() { view = { x: 0, y: 0, k: 1 }; applyView(); }
  let pan = null;
  stage.addEventListener('pointerdown', (e) => { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (Math.hypot(dx, dy) > 4) pan.moved = true;
    view.x = pan.vx + dx; view.y = pan.vy + dy; applyView();
  });
  stage.addEventListener('pointerup', (e) => {
    const was = pan?.moved;
    pan = null;
    if (was) return;
    const id = entityAt(e);
    if (id != null && ctx.elements.has(id)) {
      holder.querySelectorAll('.sel').forEach((n) => n.classList.remove('sel'));
      holder.querySelectorAll(`[data-entity-id="${id}"]`).forEach((n) => n.classList.add('sel'));
      ctx.selectId(id);
    }
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(20, Math.max(0.3, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - ((mx - view.x) * k) / view.k; view.y = my - ((my - view.y) * k) / view.k; view.k = k;
    applyView();
  }, { passive: false });

  const download = (text, name, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  overlay.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    if (b.dataset.p === 'close') close();
    if (b.dataset.p === 'fit') fit();
    if (b.dataset.p === 'svg' && svgText) download(exportToSVG(drawing, { showHatching: $('.phatch').checked, showTitleBlock: true, title: 'Floor plan', projectName: ctx.modelName?.() || 'Model', scale: { name: '1:50', factor: 50 } }), 'floor-plan.svg', 'image/svg+xml');
    if (b.dataset.p === 'dxf' && drawing) download(exportToDXF(drawing, {}), 'floor-plan.dxf', 'application/dxf');
  });
  $('.pz').addEventListener('input', (e) => { $('.pzv').textContent = (+e.target.value).toFixed(2) + ' m'; });
  $('.pz').addEventListener('change', generate);
  $('.pvis').addEventListener('change', generate);
  $('.phatch').addEventListener('change', generate);

  function open() { overlay.classList.add('show'); ctx.onPlanToggle?.(true); generate(); }
  function close() { overlay.classList.remove('show'); ctx.onPlanToggle?.(false); }
  return { open, close, toggle: () => (overlay.classList.contains('show') ? close() : open()), get open_() { return overlay.classList.contains('show'); } };
}
