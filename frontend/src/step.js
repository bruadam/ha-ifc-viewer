// Minimal IFC (STEP) reader: names, GlobalIds, property sets and quantities.
// Geometry comes from ifc-lite; this only reads the metadata shown in the info panel.

function decode(s) {
  return s
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h) => {
      let o = '';
      for (let i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16));
      return o;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseArgs(s) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function val() {
    ws();
    const c = s[i];
    if (c === "'") {
      i++;
      let out = '';
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
          i++;
          break;
        }
        out += s[i++];
      }
      return decode(out);
    }
    if (c === '(') {
      i++;
      const arr = [];
      ws();
      if (s[i] === ')') { i++; return arr; }
      for (;;) {
        arr.push(val());
        ws();
        if (s[i] === ',') { i++; continue; }
        i++; // ')'
        break;
      }
      return arr;
    }
    if (c === '#') {
      i++;
      let n = '';
      while (/\d/.test(s[i])) n += s[i++];
      return { ref: +n };
    }
    if (c === '$' || c === '*') { i++; return null; }
    if (c === '.') {
      const j = s.indexOf('.', i + 1);
      const e = s.slice(i + 1, j);
      i = j + 1;
      return e === 'T' ? true : e === 'F' ? false : { enum: e };
    }
    if (/[A-Z]/.test(c)) { // typed value, e.g. IFCLABEL('x')
      while (/[A-Z0-9_]/.test(s[i])) i++;
      ws();
      i++; // '('
      const v = val();
      ws();
      i++; // ')'
      return v;
    }
    let n = '';
    while (i < s.length && /[-+0-9.eE]/.test(s[i])) n += s[i++];
    return parseFloat(n);
  }
  return val();
}

export function parseIfc(text) {
  const ents = new Map();
  const re = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*(\([\s\S]*?\));\s*$/gm;
  let m;
  while ((m = re.exec(text))) ents.set(+m[1], { id: +m[1], type: m[2], raw: m[3] });
  const args = (e) => (e.args ??= parseArgs(e.raw));
  const get = (r) => (r && r.ref ? ents.get(r.ref) : null);

  const byGlobalId = new Map();
  const props = new Map(); // expressId -> { psetName: { key: value } }
  for (const e of ents.values()) {
    if (!/^\('[0-9A-Za-z_$]{22}'/.test(e.raw)) continue;   // rooted entities: start with a GlobalId
    if (/^IFC(REL|PROPERTYSET|ELEMENTQUANTITY)/.test(e.type)) continue;
    const a = args(e);
    e.globalId = a[0];
    e.name = a[2] || '';
    e.description = a[3] || '';
    if (e.type === 'IFCSPACE') e.longName = a[7] || '';
    byGlobalId.set(e.globalId, e);
  }
  for (const e of ents.values()) {
    if (e.type !== 'IFCRELDEFINESBYPROPERTIES') continue;
    const a = args(e);
    const def = get(a[5]);
    if (!def) continue;
    const da = args(def);
    const out = {};
    if (def.type === 'IFCPROPERTYSET') {
      for (const r of da[4] || []) {
        const p = get(r);
        if (p && p.type === 'IFCPROPERTYSINGLEVALUE') { const pa = args(p); out[pa[0]] = pa[2]; }
      }
    } else if (def.type === 'IFCELEMENTQUANTITY') {
      for (const r of da[5] || []) {
        const q = get(r);
        if (q) { const qa = args(q); out[qa[0]] = qa[3]; }
      }
    } else continue;
    for (const target of a[4] || []) {
      const t = props.get(target.ref) || {};
      t[da[2]] = out;
      props.set(target.ref, t);
    }
  }
  // Relations for the model tree, Lens and the properties panel: spatial decomposition (aggregates),
  // containment in storeys/spaces, materials, type objects and groups/zones.
  const children = new Map(); // parent expressId -> [child expressIds]
  const parent = new Map();   // child -> parent
  const materials = new Map(); // element -> [material names]
  const typeOf = new Map();   // element -> type object id
  const groups = new Map();   // element -> [group ids]
  const addChild = (p, c) => { if (!c || parent.has(c)) return; (children.get(p) || children.set(p, []).get(p)).push(c); parent.set(c, p); };
  const materialNames = (m, depth = 0) => {
    if (!m || depth > 4) return [];
    const a = args(m);
    switch (m.type) {
      case 'IFCMATERIAL': return [a[0]].filter(Boolean);
      case 'IFCMATERIALLAYERSETUSAGE': return materialNames(get(a[0]), depth + 1);
      case 'IFCMATERIALLAYERSET': return (a[0] || []).flatMap((r) => materialNames(get(r), depth + 1));
      case 'IFCMATERIALLAYER': return materialNames(get(a[0]), depth + 1);
      case 'IFCMATERIALLIST': return (a[0] || []).flatMap((r) => materialNames(get(r), depth + 1));
      case 'IFCMATERIALCONSTITUENTSET': return (a[2] || []).flatMap((r) => materialNames(get(r), depth + 1));
      case 'IFCMATERIALCONSTITUENT': return materialNames(get(a[2]), depth + 1);
      case 'IFCMATERIALPROFILESETUSAGE': return materialNames(get(a[0]), depth + 1);
      case 'IFCMATERIALPROFILESET': return (a[2] || []).flatMap((r) => materialNames(get(r), depth + 1));
      case 'IFCMATERIALPROFILE': return materialNames(get(a[2]), depth + 1);
      default: return [];
    }
  };
  for (const e of ents.values()) {
    if (!e.type.startsWith('IFCREL')) continue;
    if (e.type === 'IFCRELAGGREGATES') { const a = args(e); for (const c of a[5] || []) addChild(a[4]?.ref, c.ref); }
    else if (e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') { const a = args(e); for (const c of a[4] || []) addChild(a[5]?.ref, c.ref); }
    else if (e.type === 'IFCRELNESTS') { const a = args(e); for (const c of a[5] || []) addChild(a[4]?.ref, c.ref); }
    else if (e.type === 'IFCRELASSOCIATESMATERIAL') {
      const a = args(e), names = [...new Set(materialNames(get(a[5])))];
      for (const t of a[4] || []) materials.set(t.ref, [...new Set([...(materials.get(t.ref) || []), ...names])]);
    } else if (e.type === 'IFCRELDEFINESBYTYPE') { const a = args(e); for (const t of a[4] || []) typeOf.set(t.ref, a[5]?.ref); }
    else if (e.type === 'IFCRELASSIGNSTOGROUP') { const a = args(e); for (const t of a[4] || []) (groups.get(t.ref) || groups.set(t.ref, []).get(t.ref)).push(a[6]?.ref); }
  }
  const project = [...ents.values()].find((e) => e.type === 'IFCPROJECT');
  const storeyOf = (id) => { for (let p = parent.get(id), n = 0; p && n < 20; p = parent.get(p), n++) if (ents.get(p)?.type === 'IFCBUILDINGSTOREY') return p; return null; };
  return {
    entity: (id) => ents.get(id),
    byGlobalId: (g) => byGlobalId.get(g),
    props: (id) => props.get(id) || {},
    root: () => project?.id ?? null,
    children: (id) => children.get(id) || [],
    parent: (id) => parent.get(id) ?? null,
    storeyOf,
    materials: (id) => materials.get(id) || (typeOf.has(id) ? materials.get(typeOf.get(id)) || [] : []),
    typeObject: (id) => (typeOf.has(id) ? ents.get(typeOf.get(id)) : null),
    groups: (id) => (groups.get(id) || []).map((g) => ents.get(g)).filter(Boolean),
    attrs: (id) => { // the IfcRoot attributes most viewers show; ObjectType/Tag/PredefinedType where the schema has them
      const e = ents.get(id);
      if (!e?.globalId) return {};
      const a = args(e), out = { Name: a[2] || '', Description: a[3] || '' };
      if (typeof a[4] === 'string') out.ObjectType = a[4];
      if (e.type === 'IFCSPACE' || e.type === 'IFCBUILDINGSTOREY' || e.type === 'IFCBUILDING' || e.type === 'IFCSITE') out.LongName = a[7] || '';
      if (e.type === 'IFCBUILDINGSTOREY' && typeof a[9] === 'number') out.Elevation = a[9];
      if (typeof a[7] === 'string' && !out.LongName) out.Tag = a[7];
      const last = a[a.length - 1];
      if (last && last.enum) out.PredefinedType = last.enum;
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== '' && v != null));
    },
  };
}

const TYPE_NAMES = {
  IFCSPACE: 'Room', IFCZONE: 'Zone', IFCWALL: 'Wall', IFCSLAB: 'Slab', IFCDOOR: 'Door', IFCWINDOW: 'Window',
  IFCFURNITURE: 'Furniture', IFCSENSOR: 'Sensor', IFCLIGHTFIXTURE: 'Light fixture',
  IFCAUDIOVISUALAPPLIANCE: 'Audio-visual appliance', IFCSANITARYTERMINAL: 'Sanitary terminal',
  IFCFLOWMETER: 'Energy meter', IFCCOVERING: 'Ceiling', IFCRAILING: 'Railing', IFCBUILDINGELEMENTPROXY: 'Element',
  IFCAIRTERMINAL: 'Air terminal', IFCDUCTSEGMENT: 'Duct', IFCELECTRICAPPLIANCE: 'Appliance', IFCVIRTUALELEMENT: 'Visualisation',
  IFCDISTRIBUTIONSYSTEM: 'System',
};
export const typeLabel = (t) => TYPE_NAMES[t.toUpperCase()] || t.replace(/^IFC/i, '');
