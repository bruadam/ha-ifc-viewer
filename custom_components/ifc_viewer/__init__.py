"""IFC Viewer: a BIM model of your home in the sidebar, with Home Assistant entities linked to its elements."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .const import DOMAIN, PANEL_ELEMENT, PANEL_ICON, PANEL_TITLE, PANEL_URL, STATIC_URL
from .http import ModelView, UploadView
from .store import ViewerStore

FRONTEND_DIR = Path(__file__).parent / "frontend"
ENTRY_JS = "ifc-viewer-panel.js"

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Things that cannot be unregistered: websocket commands, HTTP views, the static files."""
    websocket.async_register(hass)
    hass.http.register_view(UploadView())
    hass.http.register_view(ModelView())
    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), True)])
    return True


def _version() -> str:
    """Changes whenever the built panel changes, so browsers fetch the new one."""
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text())
    entry = FRONTEND_DIR / ENTRY_JS
    digest = hashlib.sha1(entry.read_bytes()).hexdigest()[:8] if entry.exists() else "dev"
    return f"{manifest['version']}-{digest}"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = ViewerStore(hass)
    await store.async_load()
    hass.data[DOMAIN] = store
    version = await hass.async_add_executor_job(_version)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=entry.options.get("sidebar_title", PANEL_TITLE),
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/{ENTRY_JS}?v={version}",
        embed_iframe=True,  # own document: the viewer's styles and keyboard shortcuts stay out of HA's way
        require_admin=False,
        config={"version": version},
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, PANEL_URL)
    hass.data.pop(DOMAIN, None)
    return True
