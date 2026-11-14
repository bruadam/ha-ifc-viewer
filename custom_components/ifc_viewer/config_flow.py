"""Config flow: one click, no settings (models are uploaded in the panel)."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow

from .const import DOMAIN, NAME


class IfcViewerConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title=NAME, data={})
        return self.async_show_form(step_id="user")
