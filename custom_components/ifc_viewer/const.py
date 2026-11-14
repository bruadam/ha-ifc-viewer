"""Constants for the IFC Viewer integration."""

DOMAIN = "ifc_viewer"
NAME = "IFC Viewer"

STORAGE_KEY = "ifc_viewer.data"
STORAGE_VERSION = 1

# where uploaded IFC files are kept, under the config directory
MODELS_DIR = "ifc_viewer"

PANEL_URL = "ifc-viewer"
PANEL_ELEMENT = "ifc-viewer-panel"
PANEL_TITLE = "IFC"
PANEL_ICON = "mdi:office-building-cog"

STATIC_URL = "/ifc_viewer_static"
API_UPLOAD = "/api/ifc_viewer/upload"
API_MODEL = "/api/ifc_viewer/model/{model_id}"

SIGNAL_UPDATED = "ifc_viewer_updated"
