// The panel's app: talks to the integration (models, links), loads the chosen model into the viewer,
// draws a marker on every linked element with its live state, and edits the links in the side panel.
import css from './style.css?inline';
import { createViewer, esc } from './viewer.js';
import { createSetup } from './setup.js';

const TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'cover', 'media_player', 'climate', 'humidifier', 'siren', 'valve', 'automation', 'script']);
const ON_STATES = new Set(['on', 'open', 'opening', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'home', 'unlocked']);
const BAD = new Set(['unavailable', 'unknown']);
const LOCAL_KEY = 'ifc_viewer.model';

export class App {
  constructor(el, hass) {
    this.el = el;          // the <ifc-viewer-panel> element
    this.hass = hass;
    this.data = null;      // { models, active, links }
    this.viewer = null;
    this.loaded = null;    // { id, uploaded } of the model in the viewer
    this.loading = false;
    this.lastStates = new Map();
    this.query = '';
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.insertAdjacentHTML('beforeend', `
      <div class="bar">
        <button class="ibtn menu" data-a="menu" title="Menu" hidden><svg viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
        <div class="title"><select class="models" aria-label="Model"></select></div>
        <div class="btns">
          <button data-a="markers" class="on" title="Show the linked entities on the model">Entities</button>
          <button data-a="spaces" title="Show the rooms (IfcSpace)">Rooms</button>
          <button data-a="roof" title="Show the roof and ceilings">Roof</button>
        </div>
        <div class="btns admin" hidden>
          <button data-a="setup" title="Create areas from the rooms and pair devices with the model">Set up</button>
          <button data-a="upload" title="Upload an IFC model">Upload</button>
          <button data-a="more" title="Model options">⋯</button>
        </div>
        <div class="menu-pop" hidden>
          <button data-a="upload" class="m-upload">Upload a new model</button>
          <button data-a="rename">Rename model</button>
          <button data-a="replace">Replace IFC file (keeps links)</button>
          <button data-a="delete" class="danger">Delete model</button>
        </div>
      </div>
      <div id="view"></div>
      <div id="panel"></div>
      <div id="status"></div>
      <div id="empty" hidden></div>
      <input type="file" id="file" accept=".ifc" hidden>`);
    this.$ = (s) => document.querySelector(s);
    this.bind();
    this.setup = createSetup(this);
    this.applyTheme();
    this.subscribe();
  }

  get admin() { return !!this.hass.user?.is_admin; }

  // ------------------------------------------------------------ Home Assistant
  setHass(hass) {
    this.hass = hass;
    this.applyTheme();
    if (!this.viewer) return;
    // only redraw when an entity we show changed
    let changed = hass.formatEntityState !== this.lastFmt || hass.entities !== this.lastReg || hass.locale !== this.lastLocale;
    this.lastFmt = hass.formatEntityState; this.lastReg = hass.entities; this.lastLocale = hass.locale;
    if (!changed) for (const eid of this.shownEntities()) {
      if (this.lastStates.get(eid) !== hass.states[eid]) { changed = true; break; }
    }
    if (changed) { this.renderMarkers(); if (this.viewer.selected != null) this.renderPanel(true); }
  }
  updateSetupButton() { this.$('[data-a="setup"]').classList.toggle('attn', !!this.viewer && this.setup.pending()); }
  setNarrow(n) { this.$('[data-a="menu"]').hidden = !n; }

  applyTheme() {
    const dark = !!this.hass.themes?.darkMode;
    document.documentElement.classList.toggle('dark', dark);
    try { // HA's primary colour as the accent
      const fe = window.frameElement;
      const c = fe && getComputedStyle(fe).getPropertyValue('--primary-color').trim();
      if (c) document.documentElement.style.setProperty('--accent', c);
    } catch { /* not in an iframe */ }
  }

  async subscribe() {
    try {
      this.unsub = await this.hass.connection.subscribeMessage((d) => this.onData(d), { type: 'ifc_viewer/subscribe' });
    } catch (e) {
      this.status('Could not reach the IFC Viewer integration: ' + (e.message || e.code || e));
    }
  }

  onData(d) {
    this.data = d;
    this.renderModels();
    const id = this.currentId();
    const m = d.models.find((x) => x.id === id);
    if (!m) { this.unload(); return this.showEmpty(); }
    this.$('#empty').hidden = true;
    if (!this.loaded || this.loaded.id !== m.id || this.loaded.uploaded !== m.uploaded) this.load(m);
    else { this.updateSetupButton(); this.setup.refresh(); this.renderMarkers(); this.viewer?.tools.lens.active && this.viewer.tools.lens.activate(this.viewer.tools.lens.active.id); this.renderPanel(true); this.renderEntitiesTab(); }
  }

  currentId() {
    let id = null;
    try { id = localStorage.getItem(LOCAL_KEY); } catch { /* private mode */ }
    if (!this.data.models.some((m) => m.id === id)) id = this.data.active || this.data.models[0]?.id || null;
    return id;
  }

  async load(m) {
    if (this.loading) { this.pending = m; return; }
    this.loading = true;
    this.unload();
    this.status(`Downloading ${m.name}…`, true);
    try {
      const r = await this.hass.fetchWithAuth(`/api/ifc_viewer/model/${m.id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      this.viewer = await createViewer({
        root: this.$('#view'), buf, name: m.name,
        hooks: {
          progress: (t) => this.status(t, true),
          onSelect: (id) => {
            if (this.pick && id != null) { const p = this.pick; this.pick = null; p.cb(id); }
            this.query = ''; this.renderPanel();
          },
          dockTabs: [{ id: 'ha', title: 'Entities', render: (body) => { this.entitiesBody = body; this.renderEntitiesTab(); } }],
        },
      });
      this.loaded = { id: m.id, uploaded: m.uploaded };
      this.viewer.setOption('markers', this.$('[data-a="markers"]').classList.contains('on'));
      this.viewer.setOption('spaces', this.$('[data-a="spaces"]').classList.contains('on'));
      this.viewer.setOption('roof', this.$('[data-a="roof"]').classList.contains('on'));
      this.renderMarkers();
      this.status(`${m.name} · ${this.viewer.elements.size} elements · ${Object.keys(this.links()).length} linked`);
      this.updateSetupButton();
      let seen = true;
      try { seen = !!localStorage.getItem('ifc_viewer.setup.' + m.id); localStorage.setItem('ifc_viewer.setup.' + m.id, '1'); } catch { /* private mode */ }
      if (this.admin && !seen && this.setup.pending()) this.setup.open('rooms');
    } catch (e) {
      console.error(e);
      this.unload();
      this.status(`Could not load ${m.name}: ${e.message}`);
    }
    this.loading = false;
    if (this.pending) { const p = this.pending; this.pending = null; this.onData(this.data); if (p.id !== this.loaded?.id) this.load(p); }
  }
  unload() {
    this.setup?.close();
    this.viewer?.destroy();
    this.viewer = null;
    this.loaded = null;
    this.renderPanel();
  }

  // ------------------------------------------------------------ links
  links() { return this.data?.links?.[this.loaded?.id] || {}; }
  // every element with entities: stored links, plus HomeAssistant_* properties in the IFC
  linkedElements() {
    const v = this.viewer, out = new Map();
    if (!v) return out;
    for (const id of v.elements.keys()) {
      const fromIfc = [];
      for (const kv of Object.values(v.meta.props(id) || {}))
        for (const [k, val] of Object.entries(kv))
          if (/^HomeAssistant/i.test(k) && /^[a-z_]+\.\w+$/.test(String(val))) fromIfc.push(String(val));
      if (fromIfc.length) out.set(id, { stored: [], fromIfc, label: '' });
    }
    for (const [gid, link] of Object.entries(this.links())) {
      const id = v.byGlobalId.get(gid);
      if (id == null) continue;
      const cur = out.get(id) || { fromIfc: [] };
      out.set(id, { ...cur, stored: link.entities, label: link.label || '' });
    }
    for (const l of out.values()) l.all = [...new Set([...l.stored, ...l.fromIfc])];
    return out;
  }
  shownEntities() { return [...this.linkedElements().values()].flatMap((l) => l.all); }

  async saveLink(id, entities, label) {
    const gid = this.viewer.meta.entity(id)?.globalId;
    if (!gid) return;
    try {
      await this.hass.callWS({ type: 'ifc_viewer/link/set', model_id: this.loaded.id, global_id: gid, entities, label: label ?? this.links()[gid]?.label ?? '' });
    } catch (e) {
      this.status('Could not save: ' + (e.message || e.code));
    }
  }

  // ------------------------------------------------------------ state helpers
  name(eid) { return this.hass.states[eid]?.attributes.friendly_name || eid; }
  fmt(eid) {
    const s = this.hass.states[eid];
    if (!s) return 'not found';
    try { if (this.hass.formatEntityState) return this.hass.formatEntityState(s); } catch { /* older HA */ }
    const u = s.attributes.unit_of_measurement;
    return s.state + (u ? ' ' + u : '');
  }
  color(eid) { // marker dot / element glow
    const s = this.hass.states[eid];
    if (!s || BAD.has(s.state)) return null;
    const domain = eid.split('.')[0];
    if (domain === 'light' && s.state === 'on') {
      const c = s.attributes.rgb_color;
      return c ? `rgb(${c.join(',')})` : '#ffc107';
    }
    if (domain === 'binary_sensor') return s.state === 'on' ? '#ff7043' : '#9e9e9e';
    if (ON_STATES.has(s.state)) return '#ffc107';
    if (s.state === 'off' || s.state === 'closed' || s.state === 'idle' || s.state === 'paused' || s.state === 'standby') return '#9e9e9e';
    return 'var(--accent)';
  }

  renderMarkers() {
    const v = this.viewer;
    if (!v) return;
    const items = [];
    this.lastStates.clear();
    for (const [id, l] of this.linkedElements()) {
      if (!l.all.length) continue;
      l.all.forEach((e) => this.lastStates.set(e, this.hass.states[e]));
      const main = l.all[0], s = this.hass.states[main];
      const bad = !s || BAD.has(s.state);
      const col = this.color(main);
      const label = l.label || (l.all.length === 1 ? this.name(main) : v.entityName(id));
      const domain = main.split('.')[0];
      const value = ['sensor', 'input_number', 'number', 'climate', 'weather', 'media_player', 'cover'].includes(domain) || l.all.length > 1 ? this.fmt(main) : '';
      const glow = domain === 'light' && s?.state === 'on' ? (s.attributes.rgb_color ? '#' + s.attributes.rgb_color.map((x) => x.toString(16).padStart(2, '0')).join('') : '#ffd27a') : null;
      items.push({
        id, glow,
        cls: bad ? 'na' : '',
        title: l.all.map((e) => `${this.name(e)}: ${this.fmt(e)}`).join('\n'),
        html: `<span class="dot" style="background:${col || 'transparent'}"></span><span>${esc(label)}${value ? ` <b>${esc(value)}</b>` : ''}${l.all.length > 1 ? ` <span class="more">+${l.all.length - 1}</span>` : ''}</span>`,
      });
    }
    v.setMarkers(items);
  }

  // ------------------------------------------------------------ side panel
  renderPanel(keepInput = false) {
    const panel = this.$('#panel');
    const v = this.viewer, id = v?.selected;
    if (id == null || !v) { panel.classList.remove('show'); panel.innerHTML = ''; return; }
    if (keepInput && panel.contains(document.activeElement) && document.activeElement.matches('input')) return this.renderEntityRows();
    const e = v.meta.entity(id);
    const room = v.roomOf(id), roomEnt = room && room.id !== id ? v.meta.entity(room.id) : null;
    const l = this.linkedElements().get(id) || { stored: [], fromIfc: [], all: [], label: '' };
    panel.innerHTML = `<button class="close" data-a="close" aria-label="Close">×</button>
      <h2>${esc(e?.longName || e?.name || v.entityName(id))}</h2>
      <div class="sub"><span class="badge">${esc(v.elements.get(id).type)}</span>${esc(v.typeLabel(e?.type || ''))}${roomEnt ? ` · ${esc(roomEnt.longName || roomEnt.name)}` : ''}</div>
      <section class="ha">
        <div class="ha-h"><svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h14v-8h3L12 3zm0 4.7 5 4.5V18H7v-5.8l5-4.5z"/></svg>Home Assistant</div>
        <div class="ents"></div>
        ${this.admin ? `<div class="ent-add"><input type="search" class="eq" placeholder="Link an entity… (name, id or area)" autocomplete="off" value="${esc(this.query)}"><div class="sugg"></div></div>
          <label class="lbl-row" ${l.stored.length ? '' : 'hidden'}>Marker label <input class="elabel" placeholder="${esc(l.all.length === 1 ? this.name(l.all[0]) : v.entityName(id))}" value="${esc(l.label)}"></label>` : ''}
      </section>
      <details class="ifc"><summary>IFC properties</summary><div class="ifc-body"></div></details>
      <div class="actions"><button data-a="fit">Zoom to</button><button data-a="isolate">Isolate</button><button data-a="copy-gid">Copy GlobalId</button></div>`;
    this.renderEntityRows();
    panel.classList.add('show');
    panel.querySelector('details.ifc').addEventListener('toggle', (ev) => { if (ev.target.open) ev.target.querySelector('.ifc-body').innerHTML = propsHtml(v, id); }, { once: true });
  }
  renderEntityRows() {
    const v = this.viewer, id = v?.selected;
    const box = this.$('#panel .ents');
    if (!box || id == null) return;
    const l = this.linkedElements().get(id) || { stored: [], fromIfc: [], all: [] };
    if (!l.all.length) { box.innerHTML = `<div class="note">${this.admin ? 'No entities linked yet. Search below to add one.' : 'No entities linked to this element.'}</div>`; return; }
    box.innerHTML = l.all.map((eid) => {
      const s = this.hass.states[eid], domain = eid.split('.')[0];
      const fromIfc = l.fromIfc.includes(eid) && !l.stored.includes(eid);
      return `<div class="ent ${!s || BAD.has(s.state) ? 'na' : ''}" data-eid="${esc(eid)}">
        <span class="dot" style="background:${this.color(eid) || 'transparent'}"></span>
        <button class="en" data-a="more-info" title="Open in Home Assistant"><b>${esc(this.name(eid))}</b><small>${esc(eid)}${fromIfc ? ' · from the IFC' : ''}</small></button>
        <span class="ev">${esc(this.fmt(eid))}</span>
        ${TOGGLE.has(domain) && s && !BAD.has(s.state) ? `<button class="tgl ${ON_STATES.has(s.state) ? 'on' : ''}" data-a="toggle" title="Toggle" role="switch" aria-checked="${ON_STATES.has(s.state)}"><i></i></button>` : ''}
        ${this.admin && !fromIfc ? '<button class="x" data-a="unlink" title="Unlink">×</button>' : ''}
      </div>`;
    }).join('');
  }

  // entity search: name, id, area and device; entities in the element's room first
  suggestions(q) {
    const v = this.viewer, id = v.selected;
    const linked = new Set(this.linkedElements().get(id)?.all || []);
    const room = v.roomOf(id), roomEnt = room && v.meta.entity(room.id);
    const roomNames = [roomEnt?.longName, roomEnt?.name].filter(Boolean).map((s) => s.toLowerCase());
    const roomArea = roomEnt && this.data.areas?.[this.loaded.id]?.[roomEnt.globalId];
    const reg = this.hass.entities || {}, devs = this.hass.devices || {}, areas = this.hass.areas || {};
    const areaIdOf = (eid) => { const r = reg[eid]; return r?.area_id || devs[r?.device_id]?.area_id || null; };
    const areaOf = (eid) => { const a = areaIdOf(eid); return a ? areas[a]?.name || '' : ''; };
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const eid of Object.keys(this.hass.states)) {
      if (linked.has(eid)) continue;
      const area = areaOf(eid), name = this.name(eid);
      const hay = `${eid} ${name} ${area} ${devs[reg[eid]?.device_id]?.name || ''}`.toLowerCase();
      const inRoom = roomArea ? areaIdOf(eid) === roomArea : area && roomNames.some((r) => r.includes(area.toLowerCase()) || area.toLowerCase().includes(r));
      if (words.length ? !words.every((w) => hay.includes(w)) : !inRoom) continue;
      let score = inRoom ? 10 : 0;
      if (words.length && name.toLowerCase().startsWith(words[0])) score += 5;
      const tokens = new Set(`${eid} ${name}`.toLowerCase().split(/[^a-z0-9æøåäöü]+/));
      score += words.filter((w) => tokens.has(w)).length * 3; // whole-word matches ("lamp 4" → …_4) rank first
      if (reg[eid]?.hidden || reg[eid]?.entity_category) score -= 8;
      out.push({ eid, name, area, score });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { list: out.slice(0, 30), inRoom: !words.length };
  }
  renderSuggestions() {
    const box = this.$('#panel .sugg');
    if (!box) return;
    const inp = this.$('#panel .eq');
    if (document.activeElement !== inp) { box.innerHTML = ''; return; }
    const { list, inRoom } = this.suggestions(this.query);
    this.sugg = list;
    this.suggIdx = Math.min(this.suggIdx || 0, list.length - 1);
    if (!list.length) { box.innerHTML = `<div class="note">${inRoom ? 'Type to search all entities.' : 'No entity matches.'}</div>`; return; }
    box.innerHTML = (inRoom ? '<div class="note">In this room:</div>' : '') + list.map((s, i) => `<button class="sg ${i === this.suggIdx ? 'act' : ''}" data-add="${esc(s.eid)}"><b>${esc(s.name)}</b><small>${esc(s.eid)}${s.area ? ' · ' + esc(s.area) : ''}</small><span>${esc(this.fmt(s.eid))}</span></button>`).join('');
  }
  async addEntity(eid) {
    const v = this.viewer, id = v.selected;
    const gid = v.meta.entity(id)?.globalId;
    const cur = this.links()[gid]?.entities || [];
    this.query = '';
    await this.saveLink(id, [...cur, eid]);
    this.$('#panel .eq')?.focus();
  }

  // ------------------------------------------------------------ "Entities" tab in the dock: every link
  renderEntitiesTab() {
    const body = this.entitiesBody, v = this.viewer;
    if (!body || !body.isConnected || !v || !body.closest('.dock.show')) return;
    if (!body.parentNode.querySelector('[data-tab="ha"].on')) return;
    const rows = [...this.linkedElements()].map(([id, l]) => ({ id, l, name: l.label || v.entityName(id) })).sort((a, b) => a.name.localeCompare(b.name));
    body.innerHTML = rows.length
      ? `<div class="links-list">${rows.map(({ id, l, name }) => `<div class="lk" data-lk="${id}"><div class="lk-h"><b>${esc(name)}</b><span class="note">${esc(v.typeLabel(v.meta.entity(id)?.type || ''))}</span></div>${l.all.map((eid) => `<div class="lk-e"><span class="dot" style="background:${this.color(eid) || 'transparent'}"></span><span>${esc(this.name(eid))}</span><span class="ev">${esc(this.fmt(eid))}</span></div>`).join('')}</div>`).join('')}</div><div class="note">Click to select, double-click to zoom.</div>`
      : `<div class="note" style="padding:8px">Nothing is linked yet. ${this.admin ? 'Click an element (or a room in the Model tab) and add entities in its panel.' : ''}</div>`;
  }

  // ------------------------------------------------------------ models
  renderModels() {
    const sel = this.$('.models');
    const id = this.currentId();
    sel.innerHTML = this.data.models.map((m) => `<option value="${esc(m.id)}" ${m.id === id ? 'selected' : ''}>${esc(m.name)}</option>`).join('') || '<option>No model</option>';
    sel.disabled = this.data.models.length < 2;
    this.$('.btns.admin').hidden = !this.admin;
    this.$('[data-a="more"]').hidden = !this.data.models.length;
  }
  showEmpty() {
    const box = this.$('#empty');
    box.hidden = false;
    box.innerHTML = this.admin
      ? `<div class="drop"><svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3zM5 9.6l6 3.3v6.6l-6-3.3V9.6zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z"/></svg>
          <h2>Add your building</h2><p>Drop an IFC file here, or</p><button data-a="upload">Choose an IFC file</button>
          <p class="note">The file is stored in Home Assistant (config/ifc_viewer). Link entities to its elements afterwards.</p></div>`
      : '<div class="drop"><h2>No model yet</h2><p class="note">An administrator can upload an IFC model here.</p></div>';
    this.status('');
  }
  async upload(file, replace) {
    if (!file) return;
    this.status(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`, true);
    try {
      const q = new URLSearchParams({ name: file.name });
      if (replace) q.set('replace', replace);
      const r = await this.hass.fetchWithAuth(`/api/ifc_viewer/upload?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      try { localStorage.setItem(LOCAL_KEY, j.id); } catch { /* private mode */ }
      this.status(`Uploaded ${j.name}`);
    } catch (e) {
      this.status('Upload failed: ' + e.message);
    }
  }

  status(t, busy = false) {
    const s = this.$('#status');
    s.textContent = t;
    s.classList.toggle('busy', busy);
    s.hidden = !t;
  }

  // ------------------------------------------------------------ events
  bind() {
    const file = this.$('#file');
    let replaceId = null;
    file.addEventListener('change', () => { this.upload(file.files[0], replaceId); file.value = ''; replaceId = null; });
    document.addEventListener('dragover', (e) => { if (this.admin) { e.preventDefault(); document.documentElement.classList.add('dragging'); } });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.documentElement.classList.remove('dragging'); });
    document.addEventListener('drop', (e) => {
      document.documentElement.classList.remove('dragging');
      if (!this.admin) return;
      e.preventDefault();
      const f = [...(e.dataTransfer?.files || [])].find((x) => /\.ifc$/i.test(x.name));
      if (f) this.upload(f); else this.status('Drop an .ifc file');
    });
    this.$('.models').addEventListener('change', (e) => {
      try { localStorage.setItem(LOCAL_KEY, e.target.value); } catch { /* private mode */ }
      this.onData(this.data);
    });
    const pop = this.$('.menu-pop');
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-pop,[data-a="more"]')) pop.hidden = true; });

    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a],[data-add],.lk');
      if (!b) return;
      const a = b.dataset.a, v = this.viewer, id = v?.selected;
      if (b.dataset.add) { e.preventDefault(); return this.addEntity(b.dataset.add); }
      if (b.classList.contains('lk')) return v?.select(+b.dataset.lk);
      const eid = b.closest('[data-eid]')?.dataset.eid;
      switch (a) {
        case 'menu': this.el.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true })); break;
        case 'markers': case 'spaces': case 'roof': b.classList.toggle('on'); v?.setOption(a, b.classList.contains('on')); break;
        case 'setup': if (this.viewer) this.setup.isOpen ? this.setup.close() : this.setup.open(); break;
        case 'upload': pop.hidden = true; replaceId = null; file.click(); break;
        case 'more': pop.hidden = !pop.hidden; break;
        case 'rename': { pop.hidden = true; const m = this.data.models.find((x) => x.id === this.loaded?.id); const n = m && prompt('Model name', m.name); if (n) await this.hass.callWS({ type: 'ifc_viewer/model/update', model_id: m.id, name: n }); break; }
        case 'replace': pop.hidden = true; replaceId = this.loaded?.id; if (replaceId) file.click(); break;
        case 'delete': { pop.hidden = true; const m = this.data.models.find((x) => x.id === this.loaded?.id); if (m && confirm(`Delete "${m.name}" and its ${Object.keys(this.links()).length} links?`)) await this.hass.callWS({ type: 'ifc_viewer/model/delete', model_id: m.id }); break; }
        case 'close': v?.select(null); break;
        case 'fit': v?.fit(id); break;
        case 'isolate': if (id != null) v.tools.isolate([id]); break;
        case 'copy-gid': navigator.clipboard?.writeText(v.meta.entity(id)?.globalId || ''); this.status('GlobalId copied'); break;
        case 'more-info': window.frameElement?.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: eid }, bubbles: true, composed: true })); break;
        case 'toggle': this.hass.callService('homeassistant', 'toggle', { entity_id: eid }); break;
        case 'unlink': {
          const gid = v.meta.entity(id)?.globalId;
          await this.saveLink(id, (this.links()[gid]?.entities || []).filter((x) => x !== eid));
          break;
        }
        default:
      }
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.pick) { this.pick = null; this.setup.refresh(); this.status('Picking cancelled'); } }, true);
    document.addEventListener('dblclick', (e) => { const lk = e.target.closest('.lk'); if (lk) this.viewer?.fit(+lk.dataset.lk); });
    // entity search box
    document.addEventListener('input', (e) => {
      if (e.target.matches('#panel .eq')) { this.query = e.target.value; this.suggIdx = 0; this.renderSuggestions(); }
    });
    document.addEventListener('focusin', (e) => { if (e.target.matches('#panel .eq')) this.renderSuggestions(); });
    document.addEventListener('focusout', (e) => { if (e.target.matches('#panel .eq')) setTimeout(() => this.renderSuggestions(), 150); });
    document.addEventListener('keydown', (e) => {
      if (!e.target.matches?.('#panel .eq')) return;
      const n = this.sugg?.length || 0;
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.suggIdx = (this.suggIdx + 1) % n; this.renderSuggestions(); }
      if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.suggIdx = (this.suggIdx - 1 + n) % n; this.renderSuggestions(); }
      if (e.key === 'Enter' && n) { e.preventDefault(); this.addEntity(this.sugg[this.suggIdx].eid); }
      if (e.key === 'Escape') { e.target.blur(); }
    });
    document.addEventListener('change', (e) => {
      if (!e.target.matches('#panel .elabel')) return;
      const id = this.viewer?.selected, gid = this.viewer?.meta.entity(id)?.globalId;
      if (gid && this.links()[gid]) this.saveLink(id, this.links()[gid].entities, e.target.value.trim());
    });
  }
}

// IFC data as ifc-lite's properties panel shows it: attributes and relations, then each property set.
function propsHtml(v, id) {
  const { meta } = v;
  const e = meta.entity(id), attrs = meta.attrs(id), ps = meta.props(id) || {};
  const storey = meta.storeyOf(id);
  const mats = meta.materials(id), typeObj = meta.typeObject(id), groups = meta.groups(id);
  const val = (x) => (typeof x === 'number' ? +x.toFixed(3) : typeof x === 'boolean' ? (x ? 'Yes' : 'No') : x?.enum ?? x);
  let h = '<div class="props-attrs">';
  h += `<div>GlobalId</div><div><code>${esc(e.globalId)}</code></div><div>Express ID</div><div>#${e.id}</div>`;
  for (const [k, x] of Object.entries(attrs)) h += `<div>${esc(k)}</div><div>${esc(val(x))}</div>`;
  if (storey) h += `<div>Storey</div><div>${esc(meta.entity(storey)?.name || '')}</div>`;
  if (mats.length) h += `<div>Material</div><div>${mats.map(esc).join('<br>')}</div>`;
  if (typeObj) h += `<div>Type</div><div>${esc(typeObj.name || v.typeLabel(typeObj.type))}</div>`;
  if (groups.length) h += `<div>Groups</div><div>${groups.map((g) => esc(g.name || g.type)).join(', ')}</div>`;
  h += '</div>';
  for (const [name, kv] of Object.entries(ps)) {
    h += `<details class="pset"><summary>${esc(name)} <span class="note">${Object.keys(kv).length}</span></summary><div class="rows">`;
    for (const [k, x] of Object.entries(kv)) h += `<div>${esc(k)}</div><div>${esc(val(x))}</div>`;
    h += '</div></details>';
  }
  if (!Object.keys(ps).length) h += '<div class="note">No property sets.</div>';
  return h;
}
