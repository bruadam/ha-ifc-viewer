// <ifc-viewer-panel>: Home Assistant loads this module in the panel's iframe and sets hass / narrow / panel on it.
import { App } from './app.js';

class IfcViewerPanel extends HTMLElement {
  set hass(h) {
    this._hass = h;
    if (this._app) this._app.setHass(h);
    else if (h) { this._app = new App(this, h); this._app.setNarrow(!!this._narrow); }
  }
  get hass() { return this._hass; }
  set narrow(n) { this._narrow = n; this._app?.setNarrow(!!n); }
  set panel(p) { this._panel = p; }
  set route(r) { this._route = r; }
}
if (!customElements.get('ifc-viewer-panel')) customElements.define('ifc-viewer-panel', IfcViewerPanel);
