// Lens: colour (or hide / ghost) elements by rules, with @ifc-lite/lens doing the evaluation.
// Auto-colour lenses (class, material, zone, any property) use evaluateAutoColorLens directly;
// rule lenses (ifc-lite's presets and your own rules) are matched here: by class or by a property value.
import { BUILTIN_LENSES, evaluateLens, evaluateAutoColorLens, GHOST_COLOR, LENS_PALETTE } from '@ifc-lite/lens';

const OPS = ['=', '≠', 'contains', '>', '<', 'exists'];

export function createLens(ctx) {
  const { meta } = ctx;
  const ids = () => [...ctx.elements.values()].filter((el) => el.type !== 'IfcSpace').map((el) => el.id);
  const typeOf = (id) => ctx.elements.get(id)?.type;
  const provider = {
    getEntityCount: () => ids().length,
    forEachEntity: (cb) => ids().forEach((id) => cb(id, 'model')),
    getEntityType: typeOf,
    getPropertyValue: (id, ps, p) => meta.props(id)?.[ps]?.[p],
    getPropertySets: (id) => Object.entries(meta.props(id) || {}).map(([name, kv]) => ({ name, properties: Object.entries(kv).map(([n, value]) => ({ name: n, value })) })),
    getQuantityValue: (id, qs, q) => meta.props(id)?.[qs]?.[q],
    getEntityAttribute: (id, a) => (a === 'Name' ? meta.entity(id)?.name : meta.attrs(id)?.[a]),
    getMaterialNames: (id) => meta.materials(id),
    getMaterialName: (id) => meta.materials(id)[0],
    getEntityGroups: (id) => meta.groups(id).map((g) => ({ id: g.id, name: g.name, type: g.type })),
    getModelId: () => 'model',
    getModelName: () => ctx.modelName?.() || 'Model',
    getClassifications: () => [],
  };

  // rules here: { id, name, enabled, color, action, groups: [{ rules: [{ kind: 'ifcType', values } | { kind: 'property', pset, prop, op, value }] }] }
  function matches(r, id) {
    if (r.kind === 'ifcType') return r.values.includes(typeOf(id));
    if (r.kind === 'property') {
      const sets = r.pset ? [meta.props(id)?.[r.pset]].filter(Boolean) : Object.values(meta.props(id) || {});
      for (const set of sets) {
        if (!(r.prop in set)) continue;
        const v = set[r.prop], sv = String(v).toLowerCase(), want = String(r.value ?? '').toLowerCase();
        if (r.op === 'exists') return true;
        if (r.op === '=' && sv === want) return true;
        if (r.op === '≠' && sv !== want) return true;
        if (r.op === 'contains' && sv.includes(want)) return true;
        if (r.op === '>' && parseFloat(v) > parseFloat(r.value)) return true;
        if (r.op === '<' && parseFloat(v) < parseFloat(r.value)) return true;
      }
      return false;
    }
    if (r.kind === 'material') return meta.materials(id).some((m) => m.toLowerCase().includes(String(r.value).toLowerCase()));
    return false;
  }
  // Presets shown: ifc-lite's built-ins that make sense for one IFC file, plus a few for this flat.
  const lenses = [
    ...BUILTIN_LENSES.filter((l) => !['By Model', 'By Stage'].includes(l.name)),
    { id: 'lens-ha', name: 'Home Assistant devices', rules: [{ id: 'ha', name: 'Linked to Home Assistant', enabled: true, action: 'colorize', color: '#03A9F4', groups: [{ combinator: 'AND', rules: [{ kind: 'haprop' }] }] }] },
    { id: 'lens-mep', name: 'Building services', rules: [
      { id: 'duct', name: 'Ducts', enabled: true, action: 'colorize', color: '#8E24AA', groups: [{ rules: [{ kind: 'ifcType', values: ['IfcDuctSegment', 'IfcDuctFitting'] }] }] },
      { id: 'term', name: 'Air terminals', enabled: true, action: 'colorize', color: '#00ACC1', groups: [{ rules: [{ kind: 'ifcType', values: ['IfcAirTerminal'] }] }] },
      { id: 'elec', name: 'Lights, sensors, meters', enabled: true, action: 'colorize', color: '#FF8F00', groups: [{ rules: [{ kind: 'ifcType', values: ['IfcLightFixture', 'IfcSensor', 'IfcFlowMeter', 'IfcElectricAppliance', 'IfcAudioVisualAppliance'] }] }] },
      { id: 'san', name: 'Sanitary', enabled: true, action: 'colorize', color: '#43A047', groups: [{ rules: [{ kind: 'ifcType', values: ['IfcSanitaryTerminal'] }] }] },
    ] },
    { id: 'lens-prop', name: 'By property…', autoColor: { source: 'property', psetName: '', propertyName: '' }, custom: 'property' },
    { id: 'lens-custom', name: 'My rules', rules: [], custom: 'rules' },
  ];
  const haMatch = (id) => !!ctx.isLinked?.(id) || Object.values(meta.props(id) || {}).some((kv) => Object.keys(kv).some((k) => /^HomeAssistant/i.test(k)));
  const matchesAll = (r, id) => (r.kind === 'haprop' ? haMatch(id) : matches(r, id));

  let active = null, result = null, legend = [];
  function evaluate(lens) {
    if (lens.autoColor) {
      if (lens.autoColor.source === 'property' && !lens.autoColor.propertyName) return { colorMap: new Map(), hiddenIds: new Set(), legend: [] };
      const r = evaluateAutoColorLens(lens.autoColor, provider);
      return { ...r, legend: r.legend.map((e) => ({ ...e, ids: ids().filter((id) => sameRgba(r.colorMap.get(id), hexRgba(e.color))) })) };
    }
    const matched = new Map();
    for (const rule of lens.rules) {
      const set = new Set();
      if (rule.enabled !== false) for (const id of ids()) if ((rule.groups || []).some((g) => (g.combinator === 'OR' ? g.rules.some((r) => matchesAll(r, id)) : g.rules.every((r) => matchesAll(r, id))))) set.add(id);
      matched.set(rule.id, set);
    }
    const r = evaluateLens(lens, provider, matched);
    return { ...r, legend: lens.rules.map((rule) => ({ id: rule.id, name: rule.name, color: rule.color, action: rule.action, count: matched.get(rule.id)?.size || 0, ids: [...(matched.get(rule.id) || [])] })) };
  }
  const hexRgba = (h) => { const n = parseInt(h.slice(1, 7), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]; };
  const sameRgba = (a, b) => a && b && Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01;

  function activate(id) {
    active = id ? lenses.find((l) => l.id === id) : null;
    result = active ? evaluate(active) : null;
    legend = result?.legend || [];
    ctx.applyAppearance();
  }
  // colour per element: RGBA 0–1, 'ghost', or undefined (keep the real material)
  function colorOf(id) {
    if (!result) return undefined;
    const c = result.colorMap.get(id);
    if (!c || c === GHOST_COLOR || (c[3] != null && c[3] < 0.5 && sameRgba(c, GHOST_COLOR))) return 'ghost';
    return c;
  }
  const hidden = (id) => !!result?.hiddenIds?.has(id);

  // all property set / property names, for the "By property…" lens and the rule builder
  function propertyIndex() {
    const idx = new Map();
    for (const id of ids()) for (const [ps, kv] of Object.entries(meta.props(id) || {})) {
      const s = idx.get(ps) || idx.set(ps, new Set()).get(ps);
      Object.keys(kv).forEach((k) => s.add(k));
    }
    return idx;
  }
  const custom = () => lenses.find((l) => l.id === 'lens-custom');
  function addRule(r) {
    const L = custom();
    L.rules.push({ id: 'r' + Date.now(), name: r.name, enabled: true, action: r.action || 'colorize', color: r.color || LENS_PALETTE[L.rules.length % LENS_PALETTE.length], groups: [{ combinator: 'AND', rules: [r.cond] }] });
    activate('lens-custom');
  }
  function removeRule(rid) { const L = custom(); L.rules = L.rules.filter((r) => r.id !== rid); activate(active?.id === 'lens-custom' ? 'lens-custom' : active?.id); }
  function setProperty(pset, prop) { const L = lenses.find((l) => l.id === 'lens-prop'); L.autoColor = { source: 'property', psetName: pset, propertyName: prop }; activate('lens-prop'); }

  return {
    lenses, activate, colorOf, hidden, propertyIndex, addRule, removeRule, setProperty, OPS,
    get active() { return active; }, get legend() { return legend; },
  };
}
