"""HTTP endpoints: upload an IFC (streamed to disk, so large files work) and download one to the viewer."""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import API_MODEL, API_UPLOAD, DOMAIN
from .store import ViewerStore

MAX_SIZE = 1024 * 1024 * 1024  # 1 GB


def _store(hass: HomeAssistant) -> ViewerStore | None:
    return hass.data.get(DOMAIN)


class UploadView(HomeAssistantView):
    """POST the raw IFC file as the body: ?name=<file name>[&replace=<model id>]. Admins only."""

    url = API_UPLOAD
    name = "api:ifc_viewer:upload"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app["hass"]
        if not request["hass_user"].is_admin:
            return self.json_message("Only administrators can upload models", HTTPStatus.FORBIDDEN)
        store = _store(hass)
        if store is None:
            return self.json_message("IFC Viewer is not set up", HTTPStatus.SERVICE_UNAVAILABLE)
        name = (request.query.get("name") or "model.ifc").strip()[:200]
        replace = request.query.get("replace")
        if replace and replace not in store.data["models"]:
            return self.json_message("Unknown model", HTTPStatus.NOT_FOUND)

        model_id, dest = store.new_upload_path()
        tmp = dest.with_suffix(".part")
        size = 0
        head = b""
        f = await hass.async_add_executor_job(tmp.open, "wb")
        try:
            async for chunk in request.content.iter_chunked(1 << 20):
                if len(head) < 64:
                    head += chunk[:64]
                size += len(chunk)
                if size > MAX_SIZE:
                    raise ValueError("The file is larger than 1 GB")
                await hass.async_add_executor_job(f.write, chunk)
            if b"ISO-10303-21" not in head:
                raise ValueError("This is not an IFC file (STEP header missing)")
        except ValueError as err:
            await hass.async_add_executor_job(f.close)
            await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
            return self.json_message(str(err), HTTPStatus.BAD_REQUEST)
        await hass.async_add_executor_job(f.close)

        if replace:
            await store.async_replace_file(replace, tmp, size)
            return self.json(store.data["models"][replace])
        await hass.async_add_executor_job(Path.rename, tmp, dest)
        return self.json(store.add_model(model_id, Path(name).stem or name, size))


class ModelView(HomeAssistantView):
    """GET a model's IFC file."""

    url = API_MODEL
    name = "api:ifc_viewer:model"
    requires_auth = True

    async def get(self, request: web.Request, model_id: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app["hass"]
        store = _store(hass)
        path = store.path(model_id) if store else None
        if path is None or not await hass.async_add_executor_job(path.exists):
            return self.json_message("Unknown model", HTTPStatus.NOT_FOUND)
        return web.FileResponse(path, headers={"Cache-Control": "no-cache", "Content-Type": "application/octet-stream"})
