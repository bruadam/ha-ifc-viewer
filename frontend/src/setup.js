// Setup wizard: set Home Assistant up from the model, in three steps.
//  1. Rooms   – IfcBuildingStorey → HA floor, IfcSpace → HA area (create, or match an existing one)
//  2. Devices – find the device elements in the model (lights, sensors, outlets …) and pair each with the
//               Home Assistant device that fits best: same room, compatible entities, similar name
//  3. Place   – Home Assistant devices still not on the model: drop them in their room, or pick an element
import { esc } from './viewer.js';
import { assign } from './assign.js';

// IFC class → which Home Assistant domains / device classes fit it.
// `pt`: PredefinedType → device classes (sensors mostly).
const RULES = {
  IfcLightFixture: { d: ['light', 'switch'] },
  IfcLamp: { d: ['light', 'switch'] },
  IfcSensor: { d: ['sensor', 'binary_sensor'], pt: {
    CO2SENSOR: ['carbon_dioxide'], TEMPERATURESENSOR: ['temperature'], HUMIDITYSENSOR: ['humidity'], MOVEMENTSENSOR: ['motion', 'occupancy', 'presence'],
    CONTACTSENSOR: ['door', 'window', 'opening', 'garage_door'], SMOKESENSOR: ['smoke'], LIGHTSENSOR: ['illuminance'], GASSENSOR: ['gas', 'carbon_monoxide'],
    MOISTURESENSOR: ['moisture'], FIRESENSOR: ['smoke', 'heat'], HEATSENSOR: ['temperature', 'heat'], PRESSURESENSOR: ['pressure', 'atmospheric_pressure'],
    SOUNDSENSOR: ['sound_pressure'], RADIATIONSENSOR: ['irradiance'], WINDSENSOR: ['wind_speed'], FLOWSENSOR: ['volume_flow_rate'], LEVELSENSOR: ['distance'],
    OCCUPANCYSENSOR: ['occupancy', 'presence', 'motion'], PRESENCESENSOR: ['presence', 'occupancy', 'motion'] } },
  IfcOutlet: { d: ['switch', 'sensor'], dc: ['outlet', 'power', 'energy'] },
  IfcSwitchingDevice: { d: ['switch', 'light', 'event', 'button', 'sensor'] },
  IfcElectricAppliance: { d: ['switch', 'sensor', 'binary_sensor', 'vacuum', 'climate', 'fan', 'humidifier', 'water_heater', 'media_player'] },
  IfcAudioVisualAppliance: { d: ['media_player', 'remote'] },
  IfcCommunicationsAppliance: { d: ['device_tracker', 'sensor', 'binary_sensor', 'update'] },
  IfcSpaceHeater: { d: ['climate', 'water_heater', 'switch', 'number'] },
  IfcUnitaryEquipment: { d: ['climate', 'fan', 'humidifier', 'switch', 'sensor'] },
  IfcBoiler: { d: ['water_heater', 'climate', 'sensor'] },
  IfcFan: { d: ['fan', 'switch'] },
  IfcAirTerminal: { d: ['fan', 'climate', 'sensor'] },
  IfcValve: { d: ['valve', 'switch'] },
  IfcDamper: { d: ['cover', 'valve'] },
  IfcActuator: { d: ['cover', 'switch', 'valve'] },
  IfcController: { d: ['climate', 'sensor', 'switch'] },
  IfcAlarm: { d: ['alarm_control_panel', 'siren', 'binary_sensor'] },
  IfcFlowMeter: { d: ['sensor'], dc: ['energy', 'power', 'water', 'gas', 'volume_flow_rate'] },
  IfcElectricDistributionBoard: { d: ['sensor', 'switch'], dc: ['energy', 'power', 'current', 'voltage'] },
  IfcShadingDevice: { d: ['cover'] },
  IfcDoor: { d: ['lock', 'binary_sensor', 'cover'], dc: ['door', 'opening', 'lock', 'garage_door', 'garage'], opt: true },
  IfcWindow: { d: ['binary_sensor', 'cover'], dc: ['window', 'opening', 'blind', 'shade', 'curtain', 'shutter'], opt: true },
};
const LABEL_DOMAINS = ['light', 'switch', 'climate', 'media_player', 'cover', 'fan', 'lock', 'sensor', 'binary_sensor'];
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]+/g, ' ').trim();
const tokens = (...ss) => new Set(ss.flatMap((s) => norm(s).split(' ')).filter((t) => t.length >= 3 && !/^\d+$/.test(t)));
// Room names across languages (IFC files are often in the architect's language, HA areas in another)
const ROOMS = {
  kitchen: 'kitchen køkken kokken kök kok küche kuche cuisine keuken cocina cucina kjøkken kjokken keittiö kuchnia',
  living: 'living livingroom lounge opholdsrum opholdsstue stue dagligstue wohnzimmer salon séjour sejour woonkamer vardagsrum soggiorno salotto olohuone',
  bedroom: 'bedroom soveværelse sovevaerelse soverum sovrum schlafzimmer chambre slaapkamer dormitorio makuuhuone sypialnia',
  bathroom: 'bathroom bath bad badeværelse badevaerelse badezimmer bain badkamer badrum baño bano bagno kylpyhuone łazienka lazienka',
  toilet: 'toilet wc toilette toalett gæstetoilet',
  hallway: 'hallway hall gang entré entre entrance flur diele couloir entrée gang hal corridor korridor pasillo ingresso eteinen',
  office: 'office study desk kontor arbejdsværelse arbeitszimmer büro buro bureau werkkamer arbetsrum oficina studio työhuone',
  dining: 'dining spisestue spiseplads esszimmer manger eetkamer matsal comedor',
  laundry: 'laundry utility vaskerum bryggers waschküche buanderie washok tvättstuga lavadero',
  balcony: 'balcony altan balkon balcon terrace terrasse terras',
  storage: 'storage depot pulterrum abstellraum cellier berging förråd trastero',
  garage: 'garage carport',
  children: 'kids children børneværelse kinderzimmer barnkammare',
};
const MOBILE = new Set(['device_tracker', 'person', 'notify']);
const TECHNICAL = /shaft|skakt|schacht|gaine|riser|void|installation|technical|teknik|technik|plenum|duct|kanal/i;
const ROOM_KEY = new Map(Object.entries(ROOMS).flatMap(([k, v]) => v.split(' ').map((w) => [w, k])));
const roomKey = (s) => { const n = norm(s); if (ROOM_KEY.has(n.replace(/ /g, ''))) return ROOM_KEY.get(n.replace(/ /g, '')); for (const w of n.split(' ')) if (ROOM_KEY.has(w)) return ROOM_KEY.get(w); return null; };
const sameName = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)))) return true;
  const kx = roomKey(a);
  return !!kx && kx === roomKey(b);
};

export function createSetup(app) {
  const el = document.createElement('div');
  el.className = 'setup';
  el.innerHTML = `<div class="setup-h"><b>Set up Home Assistant from the model</b><button class="x" data-s="close" aria-label="Close">×</button></div>
    <div class="seg setup-tabs"><button data-step="rooms">1 · Rooms</button><button data-step="devices">2 · Devices</button><button data-step="place">3 · Place</button></div>
    <div class="setup-body"></div><div class="setup-foot"></div>`;
  document.body.append(el);
  const body = el.querySelector('.setup-body'), foot = el.querySelector('.setup-foot');
  let step = 'rooms', busy = false, opts = { openings: false };
  let roomsDraft = null, devDraft = null;

  const hass = () => app.hass;
  const v = () => app.viewer;
  const ws = (msg) => hass().callWS(msg);
  const areaMap = () => app.data?.areas?.[app.loaded?.id] || {};

  // ------------------------------------------------------------ model facts
  function storeys() {
    const { meta } = v(), out = [];
    const walk = (id, n = 0) => {
      if (n > 12) return;
      const e = meta.entity(id);
      if (e?.type === 'IFCBUILDINGSTOREY') out.push({ id, gid: e.globalId, name: e.longName || e.name || 'Storey', elev: meta.attrs(id).Elevation ?? 0 });
      meta.children(id).forEach((c) => walk(c, n + 1));
    };
    if (meta.root()) walk(meta.root());
    return out.sort((a, b) => a.elev - b.elev);
  }
  function spaces() {
    const { meta, elements } = v();
    return [...elements.values()].filter((x) => x.type === 'IfcSpace').map((x) => {
      const e = meta.entity(x.id);
      return { id: x.id, gid: e.globalId, name: e.longName || e.name || 'Room', code: e.longName && e.name !== e.longName ? e.name : '', storey: meta.storeyOf(x.id) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  // the HA area of an element: its room's mapped area, else an area with the room's name
  function areaOf(id) {
    const room = v().roomOf(id);
    if (!room) return null;
    const e = v().meta.entity(room.id);
    const mapped = areaMap()[e.globalId];
    if (mapped && hass().areas?.[mapped]) return mapped;
    return Object.values(hass().areas || {}).find((a) => sameName(a.name, e.longName) || sameName(a.name, e.name))?.area_id || null;
  }

  // ------------------------------------------------------------ Home Assistant facts
  function entitiesOf(deviceId) {
    return Object.values(hass().entities || {}).filter((x) => x.device_id === deviceId && !x.entity_category && !x.hidden && hass().states[x.entity_id]).map((x) => x.entity_id);
  }
  function haDevices() {
    return Object.values(hass().devices || {}).filter((d) => d.entry_type !== 'service' && !d.disabled_by).map((d) => {
      const ents = entitiesOf(d.id);
      const main = ents.find((x) => !GENERIC.has(x.split('.')[0])) || ents[0];
      const label = hass().states[main]?.attributes.friendly_name || '';
      const devName = d.name_by_user || d.name || d.model || d.id;
      return {
        id: d.id, name: label && norm(label) !== norm(devName) && label.length < 48 ? label : devName, devName, model: d.model || '', manufacturer: d.manufacturer || '', area: d.area_id || null, ents,
        domains: new Set(ents.map((x) => x.split('.')[0])),
        classes: new Set(ents.map((x) => hass().states[x]?.attributes.device_class).filter(Boolean)),
      };
    }).filter((d) => d.ents.length && [...d.domains].some((x) => !MOBILE.has(x))); // phones and trackers move around: not placed
  }
  const linkedEntities = () => new Set([...app.linkedElements().values()].flatMap((l) => l.all));
  const areaName = (a) => hass().areas?.[a]?.name || '';

  // ------------------------------------------------------------ step 1: rooms
  function buildRooms() {
    const floors = Object.values(hass().floors || {}), areas = Object.values(hass().areas || {});
    const map = areaMap();
    const sps = spaces(), sts = storeys();
    const rows = sps.map((p) => {
      const mapped = map[p.gid] && hass().areas?.[map[p.gid]] ? map[p.gid] : null;
      const match = mapped || areas.find((a) => sameName(a.name, p.name) || (p.code && sameName(a.name, p.code)))?.area_id;
      // shafts, voids and installation spaces are not rooms anyone needs as an area: off unless already linked
      const sp = v().elements.get(p.id), b = sp?.box, floorArea = b ? (b.max.x - b.min.x) * (b.max.z - b.min.z) : 99;
      const technical = TECHNICAL.test(`${p.name} ${p.code}`) || floorArea < 1.5;
      return { ...p, on: !!mapped || !!match || !technical, newName: p.name, target: match || '+', mapped: !!mapped, technical };
    });
    const withRooms = sts.filter((s) => sps.some((p) => p.storey === s.id));
    const st = sts.map((s) => {
      const mine = rows.filter((p) => p.storey === s.id);
      // the floor of the areas its rooms already match, a floor with the storey's name, or the only floor there is
      const matchedFloor = mine.map((p) => hass().areas?.[p.target]?.floor_id).find(Boolean);
      const byName = floors.find((f) => sameName(f.name, s.name));
      const only = withRooms.length === 1 && floors.length === 1 ? floors[0].floor_id : null;
      return { ...s, level: withRooms.indexOf(s), floor: matchedFloor || byName?.floor_id || only || (mine.length ? '+' : ''), count: mine.length };
    });
    // the same area for two rooms is allowed (an open kitchen-living room), but a new name twice is not
    return { storeys: st, rows };
  }
  function renderRooms() {
    roomsDraft ??= buildRooms();
    const d = roomsDraft, floors = Object.values(hass().floors || {}), areas = Object.values(hass().areas || {}).sort((a, b) => a.name.localeCompare(b.name));
    if (!d.rows.length) {
      body.innerHTML = '<p class="note">This model has no rooms (IfcSpace). Rooms let the viewer suggest the right entities, and Home Assistant areas can be created from them. Export the IFC with spaces to use this step.</p>';
      foot.innerHTML = '<button data-step="devices" class="primary">Next: devices →</button>';
      return;
    }
    const opt = (val, label, cur) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(label)}</option>`;
    let h = `<p class="note">Each room (IfcSpace) becomes a Home Assistant area, each storey a floor. Pick an existing one to match instead of creating a new one.</p>`;
    const groups = [...d.storeys.filter((s) => s.count), { id: null, name: 'Without storey', gid: '', count: d.rows.filter((r) => !r.storey).length }].filter((s) => s.count);
    for (const s of groups) {
      h += `<div class="sgroup"><div class="srow storey"><span class="sname">≡ ${esc(s.name)}</span>${s.id != null ? `<select data-floor="${s.id}" title="Home Assistant floor">${opt('+', `+ New floor “${s.name}”`, s.floor)}${floors.map((f) => opt(f.floor_id, f.name, s.floor)).join('')}${opt('', 'No floor', s.floor)}</select>` : ''}</div>`;
      for (const r of d.rows.filter((x) => x.storey === s.id)) {
        h += `<div class="srow space ${r.on ? '' : 'off'}" data-room="${r.id}">
          <input type="checkbox" data-on ${r.on ? 'checked' : ''} title="Include">
          <span class="sname" data-goto="${r.id}" title="Show on the model">${esc(r.name)}${r.code ? ` <span class="note">${esc(r.code)}</span>` : ''}${r.technical ? ' <span class="tag" title="Looks like a shaft or technical space">technical</span>' : ''}</span>
          <select data-target title="Home Assistant area">${opt('+', '+ New area', r.target)}${areas.map((a) => opt(a.area_id, a.name, r.target)).join('')}</select>
          ${r.target === '+' ? `<input data-name value="${esc(r.newName)}" placeholder="Area name">` : `<span class="tag ${r.mapped ? 'ok' : ''}">${r.mapped ? 'linked' : 'match'}</span>`}
        </div>`;
      }
      h += '</div>';
    }
    body.innerHTML = h;
    const n = d.rows.filter((r) => r.on), nNew = n.filter((r) => r.target === '+').length, nFloors = d.storeys.filter((s) => s.floor === '+' && d.rows.some((r) => r.on && r.storey === s.id)).length;
    foot.innerHTML = `<span class="note">${n.length} rooms: ${nNew} new area${nNew === 1 ? '' : 's'}, ${n.length - nNew} matched${nFloors ? `, ${nFloors} new floor${nFloors === 1 ? '' : 's'}` : ''}</span>
      <button data-s="apply-rooms" class="primary" ${n.length && !busy ? '' : 'disabled'}>${busy ? 'Working…' : 'Create & link areas'}</button>`;
  }
  async function applyRooms() {
    const d = roomsDraft;
    busy = true; render();
    const log = [];
    try {
      const floorOf = new Map();
      for (const s of d.storeys) {
        if (!d.rows.some((r) => r.on && r.storey === s.id)) continue;
        if (s.floor === '+') {
          const existing = Object.values(hass().floors || {}).find((f) => norm(f.name) === norm(s.name));
          const f = existing || await ws({ type: 'config/floor_registry/create', name: s.name, level: s.level });
          floorOf.set(s.id, f.floor_id);
          if (!existing) log.push(`floor “${s.name}” created`);
        } else floorOf.set(s.id, s.floor || null);
      }
      const map = {};
      for (const r of d.rows.filter((x) => x.on)) {
        const floor = floorOf.get(r.storey) || null;
        let areaId = r.target;
        if (areaId === '+') {
          const name = (r.newName || r.name).trim();
          const existing = Object.values(hass().areas || {}).find((a) => norm(a.name) === norm(name));
          if (existing) areaId = existing.area_id;
          else { areaId = (await ws({ type: 'config/area_registry/create', name, ...(floor ? { floor_id: floor } : {}) })).area_id; log.push(`area “${name}” created`); }
        }
        const a = hass().areas?.[areaId];
        if (floor && a && !a.floor_id) await ws({ type: 'config/area_registry/update', area_id: areaId, floor_id: floor });
        map[r.gid] = areaId;
      }
      await ws({ type: 'ifc_viewer/areas/set', model_id: app.loaded.id, areas: map });
      log.push(`${Object.keys(map).length} rooms linked to areas`);
      app.status('Rooms: ' + log.join(', '));
      roomsDraft = null; devDraft = null;
      step = 'devices';
    } catch (e) {
      app.status('Could not create the areas: ' + (e.message || e.code));
    }
    busy = false;
    setTimeout(render, 400); // the registries reach `hass` a moment later
  }

  // ------------------------------------------------------------ step 2: devices
  const GENERIC = new Set(['sensor', 'binary_sensor', 'switch', 'number', 'button', 'event', 'update', 'device_tracker']);
  function score(elId, dev, rule) {
    const { meta } = v();
    const fit = rule.d.filter((x) => dev.domains.has(x));
    if (!fit.length) return 0;
    // a specific domain (light for a light fixture) is strong evidence; a sensor or switch alone is not
    const strong = fit.some((x) => !GENERIC.has(x)) || rule.d.every((x) => GENERIC.has(x));
    let s = strong ? 30 : 5;
    const pt = meta.attrs(elId).PredefinedType;
    const want = [...(rule.pt?.[pt] || []), ...(rule.dc || [])];
    const classOk = want.length && want.some((c) => dev.classes.has(c));
    if (classOk) s += strong ? 20 : 45;
    else if (want.length && rule.opt) return 0; // doors / windows only with a matching sensor or lock
    const area = areaOf(elId);
    if (area && dev.area === area) s += 40;
    else if (area && dev.area && dev.area !== area) s -= 10;
    const e = meta.entity(elId), t = meta.typeObject(elId);
    const a = tokens(e?.name, e?.longName, meta.attrs(elId).ObjectType, t?.name, meta.attrs(elId).Description);
    const b = tokens(dev.name, dev.devName, dev.model, dev.manufacturer);
    let shared = 0;
    for (const x of a) if (b.has(x)) shared++;
    if (!strong && !classOk && !shared) return 0; // only a generic sensor / switch, nothing else in common: no match
    s += Math.min(45, shared * 15);
    const model = norm(dev.model), text = norm([e?.name, e?.longName, meta.attrs(elId).ObjectType, t?.name].join(' '));
    if (model.length >= 4 && text.includes(model)) s += 20; // "HomePod mini" in the element's name
    return s;
  }
  function buildDevices() {
    const view = v(), linked = linkedEntities();
    const devs = haDevices();
    const free = devs.filter((d) => !d.ents.some((x) => linked.has(x)));
    const els = [...view.elements.values()].filter((x) => RULES[x.type] && (!RULES[x.type].opt || opts.openings));
    const already = new Set(app.linkedElements().keys());
    const rows = els.map((x) => {
      const rule = RULES[x.type];
      const cands = free.map((d) => ({ d, s: score(x.id, d, rule) })).filter((c) => c.s >= 30).sort((a, b) => b.s - a.s);
      return { id: x.id, type: x.type, rule, cands, linked: already.has(x.id), area: areaOf(x.id), pick: null, on: false, move: false };
    });
    // one device per element, best pairs first
    // One device per element, the pairing with the highest total score (optimal assignment; greedy
    // would give the speaker in the right room what the speaker with the right model name fits better).
    const open = rows.filter((r) => !r.linked && r.cands.length);
    const devIds = [...new Set(open.flatMap((r) => r.cands.map((c) => c.d.id)))];
    const pick = assign(open.map((r) => devIds.map((id) => r.cands.find((c) => c.d.id === id)?.s || 0)));
    open.forEach((r, i) => {
      const j = pick[i], c = j >= 0 && r.cands.find((x) => x.d.id === devIds[j]);
      if (c && c.s >= 30) { r.pick = c.d.id; r.score = c.s; r.on = c.s >= 70; r.move = !!(r.area && !c.d.area); }
    });
    rows.sort((a, b) => (a.linked - b.linked) || (b.score || 0) - (a.score || 0) || view.typeLabel(a.type).localeCompare(view.typeLabel(b.type)));
    return { rows, devs: new Map(devs.map((d) => [d.id, d])), freeCount: free.length };
  }
  function renderDevices() {
    devDraft ??= buildDevices();
    const d = devDraft, view = v();
    const todo = d.rows.filter((r) => !r.linked);
    const byClass = {};
    for (const r of d.rows) byClass[view.typeLabel(r.type)] = (byClass[view.typeLabel(r.type)] || 0) + 1;
    let h = `<div class="scan"><b>${d.rows.length}</b> device element${d.rows.length === 1 ? '' : 's'} in the model${d.rows.length ? ': ' + Object.entries(byClass).map(([k, n]) => `${n} ${esc(k.toLowerCase())}`).join(', ') : ''}.<br>
      <b>${d.freeCount}</b> Home Assistant device${d.freeCount === 1 ? '' : 's'} not on the model yet · <b>${todo.filter((r) => r.pick).length}</b> suggested pair${todo.filter((r) => r.pick).length === 1 ? '' : 's'}.
      <label class="opt"><input type="checkbox" data-openings ${opts.openings ? 'checked' : ''}> Include doors and windows (contact sensors, locks, blinds)</label></div>`;
    if (!d.rows.length) h += '<p class="note">No lights, sensors, outlets or other devices are modelled. Use step 3 to place your Home Assistant devices in their rooms instead.</p>';
    for (const r of d.rows) {
      const e = view.meta.entity(r.id), room = view.roomOf(r.id), roomE = room && view.meta.entity(room.id);
      const dev = r.pick && d.devs.get(r.pick);
      const conf = r.score >= 70 ? 'high' : r.score >= 50 ? 'med' : 'low';
      h += `<div class="drow ${r.linked ? 'done' : ''} ${r.on ? 'on' : ''}" data-row="${r.id}">
        ${r.linked ? '<span class="tag ok">linked</span>' : `<input type="checkbox" data-on ${r.on ? 'checked' : ''} ${r.pick ? '' : 'disabled'}>`}
        <div class="dl" data-goto="${r.id}" title="Show on the model"><b>${esc(e?.name || view.typeLabel(r.type))}</b><small>${esc(view.typeLabel(r.type))}${roomE ? ' · ' + esc(roomE.longName || roomE.name) : ''}${r.area ? ' · area ' + esc(areaName(r.area)) : ''}</small></div>
        ${r.linked ? `<span class="note">${esc(app.linkedElements().get(r.id)?.all.map((x) => app.name(x)).slice(0, 2).join(', '))}</span>` : `
        <div class="dr">
          <select data-dev>${'<option value="">— no device —</option>' + r.cands.slice(0, 12).map((c) => `<option value="${c.d.id}" ${c.d.id === r.pick ? 'selected' : ''}>${esc(c.d.name)}${c.d.model && norm(c.d.model) !== norm(c.d.name) ? ` (${esc(c.d.model)})` : ''}${c.d.area ? ' · ' + esc(areaName(c.d.area)) : ''}</option>`).join('')}${r.cands.length ? '' : '<option disabled>no compatible device found</option>'}</select>
          ${dev ? `<span class="conf ${conf}" title="Match score ${r.score}">${{ high: 'good match', med: 'possible', low: 'weak' }[conf]}</span>` : ''}
          ${dev && r.area && dev.area !== r.area ? `<label class="mv"><input type="checkbox" data-move ${r.move ? 'checked' : ''}> move to ${esc(areaName(r.area))}${dev.area ? ` (now ${esc(areaName(dev.area))})` : ''}</label>` : ''}
        </div>`}
      </div>`;
    }
    body.innerHTML = h;
    const n = todo.filter((r) => r.on && r.pick).length;
    foot.innerHTML = `<button data-s="select-good">Select good matches</button><span class="grow"></span>
      <button data-s="apply-devices" class="primary" ${n && !busy ? '' : 'disabled'}>${busy ? 'Working…' : `Pair ${n} device${n === 1 ? '' : 's'}`}</button>`;
  }
  // the device's entities, the ones that fit the element first (the first one is shown on the marker)
  function orderedEntities(dev, rule) {
    const fits = (x) => rule?.d.includes(x.split('.')[0]);
    const rank = (x) => (fits(x) ? 0 : 10) + Math.max(0, LABEL_DOMAINS.indexOf(x.split('.')[0]));
    return [...dev.ents].sort((a, b) => rank(a) - rank(b));
  }
  async function applyDevices() {
    const d = devDraft, view = v();
    const sel = d.rows.filter((r) => !r.linked && r.on && r.pick);
    busy = true; render();
    try {
      const links = sel.map((r) => { const dev = d.devs.get(r.pick); return { global_id: view.meta.entity(r.id).globalId, entities: orderedEntities(dev, r.rule), label: dev.name }; });
      await ws({ type: 'ifc_viewer/link/set_many', model_id: app.loaded.id, links });
      let moved = 0;
      for (const r of sel) if (r.move && r.area) { await ws({ type: 'config/device_registry/update', device_id: r.pick, area_id: r.area }); moved++; }
      app.status(`Paired ${links.length} device${links.length === 1 ? '' : 's'}${moved ? `, moved ${moved} to their room's area` : ''}`);
      devDraft = null;
    } catch (e) {
      app.status('Could not pair: ' + (e.message || e.code));
    }
    busy = false;
    setTimeout(render, 400);
  }

  // ------------------------------------------------------------ step 3: place the rest
  function roomForArea(areaId) {
    const map = areaMap(), view = v();
    for (const [gid, a] of Object.entries(map)) if (a === areaId && view.byGlobalId.get(gid) != null) return view.byGlobalId.get(gid);
    for (const s of spaces()) if (sameName(areaName(areaId), s.name)) return s.id;
    return null;
  }
  function renderPlace() {
    const linked = linkedEntities();
    const free = haDevices().filter((d) => !d.ents.some((x) => linked.has(x)));
    const sps = spaces();
    const groups = new Map();
    for (const dv of free) { const k = dv.area || ''; (groups.get(k) || groups.set(k, []).get(k)).push(dv); }
    const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || areaName(a).localeCompare(areaName(b)));
    const auto = free.filter((dv) => dv.area && roomForArea(dv.area) != null);
    let h = `<p class="note">Home Assistant devices not on the model yet. <b>Pick</b> an element for one (a lamp, a wall, a room), or put it in its room: the room shows the device's live state.</p>`;
    if (app.pick) h += `<div class="picking">Click the element for <b>${esc(app.pick.label)}</b> on the model … <button data-s="cancel-pick">Cancel</button></div>`;
    if (!free.length) h += '<p class="note">Every Home Assistant device is on the model. 🎉</p>';
    for (const k of keys) {
      const room = k ? roomForArea(k) : null;
      h += `<div class="sgroup"><div class="srow storey"><span class="sname">${k ? esc(areaName(k)) : 'No area'}</span>${room != null ? '<span class="tag ok">room in model</span>' : ''}</div>`;
      for (const dv of groups.get(k).sort((a, b) => a.name.localeCompare(b.name))) {
        h += `<div class="prow" data-dev="${dv.id}"><div class="dl"><b>${esc(dv.name)}</b><small>${esc([dv.manufacturer, dv.model].filter(Boolean).join(' '))} · ${dv.ents.length} entit${dv.ents.length === 1 ? 'y' : 'ies'}</small></div>
          <button data-s="pick">Pick</button>
          <select data-room><option value="">Put in room…</option>${sps.map((s) => `<option value="${s.id}" ${s.id === room ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <button data-s="to-room" ${sps.length ? '' : 'disabled'}>Place</button></div>`;
      }
      h += '</div>';
    }
    body.innerHTML = h;
    foot.innerHTML = `<span class="note">${free.length} device${free.length === 1 ? '' : 's'} left</span>
      <button data-s="all-rooms" class="primary" ${auto.length && !busy ? '' : 'disabled'} title="Each device with an area goes into the room linked to that area">Put ${auto.length} in their rooms</button>`;
  }
  async function placeDevice(devId, elId, { move = true } = {}) {
    const dv = haDevices().find((x) => x.id === devId), view = v();
    if (!dv || elId == null) return;
    const rule = RULES[view.elements.get(elId)?.type];
    const gid = view.meta.entity(elId).globalId;
    const cur = app.links()[gid]?.entities || [];
    await ws({ type: 'ifc_viewer/link/set', model_id: app.loaded.id, global_id: gid, entities: [...cur, ...orderedEntities(dv, rule)], label: cur.length ? app.links()[gid].label : dv.name });
    const area = view.elements.get(elId).type === 'IfcSpace' ? areaMap()[gid] : areaOf(elId);
    if (move && area && !dv.area) await ws({ type: 'config/device_registry/update', device_id: dv.id, area_id: area });
  }
  async function placeAll() {
    const linked = linkedEntities(), view = v();
    const free = haDevices().filter((d) => !d.ents.some((x) => linked.has(x)) && d.area && roomForArea(d.area) != null);
    busy = true; render();
    try {
      const byRoom = new Map();
      for (const dv of free) { const r = roomForArea(dv.area); (byRoom.get(r) || byRoom.set(r, []).get(r)).push(dv); }
      const links = [...byRoom].map(([r, devs]) => {
        const gid = view.meta.entity(r).globalId, cur = app.links()[gid];
        return { global_id: gid, entities: [...(cur?.entities || []), ...devs.flatMap((dv) => orderedEntities(dv))], label: cur?.label || '' };
      });
      await ws({ type: 'ifc_viewer/link/set_many', model_id: app.loaded.id, links });
      app.status(`Placed ${free.length} devices in ${links.length} rooms`);
    } catch (e) { app.status('Could not place: ' + (e.message || e.code)); }
    busy = false;
    setTimeout(render, 400);
  }

  // ------------------------------------------------------------ shell
  function render() {
    if (!el.classList.contains('show') || !v()) return;
    el.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('on', b.dataset.step === step));
    if (step === 'rooms') renderRooms(); else if (step === 'devices') renderDevices(); else renderPlace();
  }
  function goto(id) { const view = v(); if (!view) return; view.select(id); view.fit(id); }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-s],[data-step],[data-goto]');
    if (!t || busy) return;
    if (t.dataset.step) { step = t.dataset.step; return render(); }
    if (t.dataset.goto) return goto(+t.dataset.goto);
    const s = t.dataset.s;
    if (s === 'close') return close();
    if (s === 'apply-rooms') return applyRooms();
    if (s === 'apply-devices') return applyDevices();
    if (s === 'select-good') { devDraft.rows.forEach((r) => { if (!r.linked && r.pick) r.on = r.score >= 70; }); return render(); }
    if (s === 'all-rooms') return placeAll();
    if (s === 'cancel-pick') { app.pick = null; return render(); }
    const row = t.closest('[data-dev]');
    if (s === 'pick' && row) {
      const devId = row.dataset.dev, dv = haDevices().find((x) => x.id === devId);
      app.pick = { label: dv?.name || 'device', cb: async (id) => { app.pick = null; await placeDevice(devId, id); app.status(`${dv?.name} placed on ${v().entityName(id)}`); setTimeout(render, 400); } };
      return render();
    }
    if (s === 'to-room' && row) {
      const r = +row.querySelector('[data-room]').value;
      if (!r) return app.status('Choose a room first');
      busy = true;
      try { await placeDevice(row.dataset.dev, r); } catch (err) { app.status('Could not place: ' + (err.message || err.code)); }
      busy = false;
      return setTimeout(render, 400);
    }
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-openings]')) { opts.openings = t.checked; devDraft = null; return render(); }
    const room = t.closest('[data-room]:not(select)'), drow = t.closest('[data-row]');
    if (room && roomsDraft) {
      const r = roomsDraft.rows.find((x) => x.id === +room.dataset.room);
      if (t.matches('[data-on]')) r.on = t.checked;
      if (t.matches('[data-target]')) r.target = t.value;
      if (t.matches('[data-name]')) r.newName = t.value;
      return render();
    }
    if (t.matches('[data-floor]') && roomsDraft) { roomsDraft.storeys.find((s) => s.id === +t.dataset.floor).floor = t.value; return render(); }
    if (drow && devDraft) {
      const r = devDraft.rows.find((x) => x.id === +drow.dataset.row);
      if (t.matches('[data-on]')) r.on = t.checked;
      if (t.matches('[data-move]')) r.move = t.checked;
      if (t.matches('[data-dev]')) {
        // a device chosen by hand moves away from any other element it was suggested for
        if (t.value) devDraft.rows.forEach((o) => { if (o !== r && o.pick === t.value) { o.pick = null; o.on = false; } });
        r.pick = t.value || null;
        const c = r.cands.find((x) => x.d.id === r.pick);
        r.score = c?.s || 0; r.on = !!r.pick; r.move = !!(r.area && c && !c.d.area);
      }
      return render();
    }
  });

  function open(s) {
    if (s) step = s;
    roomsDraft = null; devDraft = null;
    el.classList.add('show');
    document.documentElement.classList.add('setup-open');
    render();
  }
  function close() { el.classList.remove('show'); document.documentElement.classList.remove('setup-open'); app.pick = null; }
  return {
    open, close,
    get isOpen() { return el.classList.contains('show'); },
    refresh() { if (!busy && step === 'place') render(); },
    // anything set up yet? (the bar's Set up button is highlighted when not)
    pending: () => !Object.keys(areaMap()).length && !Object.keys(app.links()).length,
  };
}
