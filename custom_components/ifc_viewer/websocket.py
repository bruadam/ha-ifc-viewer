"""Websocket commands used by the panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_UPDATED
from .store import ViewerStore


def _public(data: dict[str, Any]) -> dict[str, Any]:
    return {"models": list(data["models"].values()), "active": data["active"], "links": data["links"], "areas": data.get("areas", {})}


def _store(hass: HomeAssistant, connection, msg) -> ViewerStore | None:
    store = hass.data.get(DOMAIN)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "IFC Viewer is not set up")
    return store


@callback
def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_get, ws_subscribe, ws_set_link, ws_set_links, ws_set_areas, ws_update_model, ws_delete_model):
        websocket_api.async_register_command(hass, cmd)


@websocket_api.websocket_command({vol.Required("type"): "ifc_viewer/get"})
@callback
def ws_get(hass, connection, msg):
    if store := _store(hass, connection, msg):
        connection.send_result(msg["id"], _public(store.data))


@websocket_api.websocket_command({vol.Required("type"): "ifc_viewer/subscribe"})
@callback
def ws_subscribe(hass, connection, msg):
    """Sends the whole state now and again after every change (links made on another device show up live)."""
    if not (store := _store(hass, connection, msg)):
        return

    @callback
    def forward(data):
        connection.send_message(websocket_api.event_message(msg["id"], _public(data)))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, forward)
    connection.send_result(msg["id"])
    forward(store.data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ifc_viewer/link/set",
        vol.Required("model_id"): str,
        vol.Required("global_id"): str,
        vol.Required("entities"): [cv.entity_id],
        vol.Optional("label"): vol.Any(str, None),
    }
)
@websocket_api.require_admin
@callback
def ws_set_link(hass, connection, msg):
    if not (store := _store(hass, connection, msg)):
        return
    if msg["model_id"] not in store.data["models"]:
        connection.send_error(msg["id"], "not_found", "Unknown model")
        return
    store.set_link(msg["model_id"], msg["global_id"], msg["entities"], msg.get("label"))
    connection.send_result(msg["id"])


LINK = vol.Schema(
    {vol.Required("global_id"): str, vol.Required("entities"): [cv.entity_id], vol.Optional("label"): vol.Any(str, None)}
)


@websocket_api.websocket_command(
    {vol.Required("type"): "ifc_viewer/link/set_many", vol.Required("model_id"): str, vol.Required("links"): [LINK]}
)
@websocket_api.require_admin
@callback
def ws_set_links(hass, connection, msg):
    """Several links in one save (the setup wizard's pairings)."""
    if not (store := _store(hass, connection, msg)):
        return
    if msg["model_id"] not in store.data["models"]:
        connection.send_error(msg["id"], "not_found", "Unknown model")
        return
    store.set_links(msg["model_id"], msg["links"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ifc_viewer/areas/set",
        vol.Required("model_id"): str,
        vol.Required("areas"): {str: vol.Any(str, None)},
    }
)
@websocket_api.require_admin
@callback
def ws_set_areas(hass, connection, msg):
    """Which Home Assistant area each IfcSpace is (GlobalId -> area_id; None removes)."""
    if not (store := _store(hass, connection, msg)):
        return
    if msg["model_id"] not in store.data["models"]:
        connection.send_error(msg["id"], "not_found", "Unknown model")
        return
    store.set_areas(msg["model_id"], msg["areas"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ifc_viewer/model/update",
        vol.Required("model_id"): str,
        vol.Optional("name"): str,
        vol.Optional("active"): bool,
    }
)
@callback
def ws_update_model(hass, connection, msg):
    """Renaming needs admin; choosing the model to show does not."""
    if not (store := _store(hass, connection, msg)):
        return
    if msg["model_id"] not in store.data["models"]:
        connection.send_error(msg["id"], "not_found", "Unknown model")
        return
    if msg.get("name") and not connection.user.is_admin:
        connection.send_error(msg["id"], "unauthorized", "Only administrators can rename models")
        return
    store.update_model(msg["model_id"], msg.get("name"), msg.get("active"))
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "ifc_viewer/model/delete", vol.Required("model_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete_model(hass, connection, msg):
    if not (store := _store(hass, connection, msg)):
        return
    await store.async_delete_model(msg["model_id"])
    connection.send_result(msg["id"])
