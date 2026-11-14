# IFC Viewer for Home Assistant

Your building's BIM model in the Home Assistant sidebar, with live entities on the elements they belong to.

Upload an IFC file, click a wall, a lamp, a sensor or a room, and link Home Assistant entities to it. Each linked element gets a marker with its live state; lights that are on glow on the model. Links are kept in Home Assistant (not in the IFC), so you can replace the model with a newer version and keep them.

The viewer is built on [ifc-lite](https://github.com/LTplus-AG/ifc-lite) (Rust/WASM geometry) and three.js, and works on phones and tablets.

## Features

**Home Assistant**
- **Link entities to elements** from the side panel: search by name, entity id, device or area. Entities in the selected element's room (HA area ↔ IfcSpace name) are suggested first.
- **Live markers** on every linked element: state with units in your language, coloured dot (on/off, light colour, unavailable).
- **Controls in the panel:** toggle lights, switches, fans and covers; tap an entity to open Home Assistant's more-info dialog.
- An **Entities** tab lists every link. The **Linked to Home Assistant** lens colours linked elements on the model.
- Links update live on every open device. `HomeAssistant_<name>` properties already in the IFC (value = entity id) are picked up too.
- Several models can be uploaded; each browser remembers which one it shows.

**Set up Home Assistant from the model** (**Set up** in the top bar; opens by itself for a new model)
1. **Rooms:** each IfcSpace becomes an HA area and each storey a floor. You can match existing ones instead; room names are matched across languages, e.g. *Køkken* ↔ *Kitchen*, *Opholdsrum* ↔ *Living Room*. Shafts and technical spaces are left out by default.
2. **Devices:** finds the device elements in the model (lights, sensors, outlets, appliances, speakers, heaters, vents…) and suggests the HA device that fits each one best. Scoring uses compatible entities (a light fixture wants a `light`; a CO₂ sensor's PredefinedType wants `device_class: carbon_dioxide`), the same room, and shared words or the device model in the element's name. Pairs are chosen for the best overall match, one device per element. Good matches are ticked; you can change any of them and move devices into their room's area.
3. **Place:** HA devices still not on the model can go into their room, all at once or one by one, or onto any element you pick.

**BIM tools** (in the spirit of the ifc-lite web viewer, press <kbd>?</kbd> for shortcuts)
- Model tree (spatial or by class) with search, hide, isolate and fit.
- Full IFC properties: attributes, material, type, groups and every property and quantity set.
- View cube, perspective ⇄ orthographic, standard views.
- Section plane and section box.
- Distance and area measuring with vertex, edge and face snapping.
- X-ray, and Lens colouring by class, material or any property, or your own rules.
- 2D floor plans cut at any height, exportable as SVG or DXF.
- Screenshots.

## Install

### HACS (custom repository)
1. HACS → ⋮ → **Custom repositories** → add `https://github.com/bruadam/ha-ifc-viewer`, category **Integration**.
2. Install **IFC Viewer** and restart Home Assistant.
3. **Settings → Devices & services → Add integration → IFC Viewer**.

### Manual
Copy `custom_components/ifc_viewer` into your `config/custom_components/`, restart, and add the integration as above.

## Use

1. Open **IFC** in the sidebar, then drop an `.ifc` file on the page or click **Choose an IFC file**. Only administrators can upload.
2. Click an element. In the **Home Assistant** box, type to find an entity and press <kbd>Enter</kbd>.
3. Optionally give the marker a label. The first linked entity's state is the one shown on the marker.

**Tips**
- To link a room-level sensor to the room itself, turn on **Rooms** or pick the room in the Model tree.
- **Roof** shows the roof and ceilings, which are hidden by default so you look into the rooms.
- **⋯ → Replace IFC file** uploads a new version of the model. Links are matched by GlobalId, so they stay as long as your authoring tool keeps GlobalIds stable.

Everyone with a Home Assistant login can view the models and use the controls. Only administrators can upload, rename, delete, or change links.

## How it works

| Part | Where |
|---|---|
| Uploaded IFC files | `config/ifc_viewer/<id>.ifc` |
| Models and links | `config/.storage/ifc_viewer.data`, keyed by model and IFC GlobalId; included in HA backups |
| Panel | `custom_components/ifc_viewer/frontend/`, served at `/ifc_viewer_static/` and shown in an iframe panel |
| API | websocket `ifc_viewer/get`, `ifc_viewer/subscribe`, `ifc_viewer/link/set`, `ifc_viewer/model/update`, `ifc_viewer/model/delete`; HTTP `POST /api/ifc_viewer/upload?name=…[&replace=<id>]`, `GET /api/ifc_viewer/model/<id>` |

The model never leaves your Home Assistant: geometry is computed in the browser.

## Development

```sh
cd frontend
npm install
npm run build     # → custom_components/ifc_viewer/frontend/
```

Then copy `custom_components/ifc_viewer` into a test instance and reload the integration. The panel URL carries a hash of the build, so browsers pick up the new version.

## License

MIT. The built panel bundles, unmodified, [ifc-lite](https://github.com/LTplus-AG/ifc-lite) (`@ifc-lite/geometry`, `drawing-2d`, `lens`; MPL-2.0) and [three.js](https://threejs.org) (MIT).
