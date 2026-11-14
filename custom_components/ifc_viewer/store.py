"""Uploaded models and their element → entity links, kept in Home Assistant's .storage."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import shutil
from typing import Any
import uuid

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import MODELS_DIR, SIGNAL_UPDATED, STORAGE_KEY, STORAGE_VERSION


class ViewerStore:
    """Models: {id: {name, filename, size, uploaded}}; links: {model_id: {global_id: {entities, label}}};
    areas: {model_id: {space global_id: area_id}} (which Home Assistant area each IfcSpace is)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = {"models": {}, "links": {}, "areas": {}, "active": None}
        self.dir = Path(hass.config.path(MODELS_DIR))

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self.data = {"models": {}, "links": {}, "areas": {}, "active": None, **data}
        await self.hass.async_add_executor_job(self.dir.mkdir, 0o755, True, True)

    @callback
    def _changed(self) -> None:
        self._store.async_delay_save(lambda: self.data, 1)
        async_dispatcher_send(self.hass, SIGNAL_UPDATED, self.data)

    # ------------------------------------------------------------ models
    def path(self, model_id: str) -> Path | None:
        model = self.data["models"].get(model_id)
        return self.dir / model["filename"] if model else None

    def new_upload_path(self) -> tuple[str, Path]:
        model_id = uuid.uuid4().hex[:12]
        return model_id, self.dir / f"{model_id}.ifc"

    @callback
    def add_model(self, model_id: str, name: str, size: int) -> dict[str, Any]:
        model = {
            "id": model_id,
            "name": name,
            "filename": f"{model_id}.ifc",
            "size": size,
            "uploaded": datetime.now(UTC).isoformat(),
        }
        self.data["models"][model_id] = model
        self.data["links"].setdefault(model_id, {})
        self.data["active"] = model_id
        self._changed()
        return model

    @callback
    def update_model(self, model_id: str, name: str | None = None, active: bool | None = None) -> None:
        model = self.data["models"][model_id]
        if name:
            model["name"] = name
        if active:
            self.data["active"] = model_id
        self._changed()

    async def async_delete_model(self, model_id: str) -> None:
        path = self.path(model_id)
        self.data["models"].pop(model_id, None)
        self.data["links"].pop(model_id, None)
        self.data["areas"].pop(model_id, None)
        if self.data["active"] == model_id:
            self.data["active"] = next(iter(self.data["models"]), None)
        if path:
            await self.hass.async_add_executor_job(self._remove, path)
        self._changed()

    async def async_replace_file(self, model_id: str, tmp: Path, size: int) -> None:
        """A new version of a model's IFC: links stay (they are keyed by GlobalId)."""
        dest = self.path(model_id)
        await self.hass.async_add_executor_job(self._remove, dest)
        await self.hass.async_add_executor_job(shutil.move, tmp, dest)
        model = self.data["models"][model_id]
        model["size"] = size
        model["uploaded"] = datetime.now(UTC).isoformat()
        self._changed()

    @staticmethod
    def _remove(path: Path) -> None:
        """The model file and its gzipped copy (http.ensure_gzip)."""
        path.unlink(missing_ok=True)
        path.with_name(path.name + ".gz").unlink(missing_ok=True)

    # ------------------------------------------------------------ links
    @callback
    def set_link(self, model_id: str, global_id: str, entities: list[str], label: str | None, save: bool = True) -> None:
        links = self.data["links"].setdefault(model_id, {})
        if entities:
            links[global_id] = {"entities": list(dict.fromkeys(entities)), "label": label or ""}
        else:
            links.pop(global_id, None)
        if save:
            self._changed()

    @callback
    def set_links(self, model_id: str, items: list[dict[str, Any]]) -> None:
        for it in items:
            self.set_link(model_id, it["global_id"], it["entities"], it.get("label"), save=False)
        self._changed()

    @callback
    def set_areas(self, model_id: str, areas: dict[str, str | None]) -> None:
        cur = self.data["areas"].setdefault(model_id, {})
        for gid, area_id in areas.items():
            if area_id:
                cur[gid] = area_id
            else:
                cur.pop(gid, None)
        self._changed()
