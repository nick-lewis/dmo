import json
import re

from django.conf import settings


MAIN_PANEL_APP_REGISTRY_PATH = (
    settings.BASE_DIR / "frontend" / "src" / "mainPanelAppRegistry.json"
)


def load_main_panel_app_registry():
    try:
        raw_apps = json.loads(MAIN_PANEL_APP_REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(raw_apps, list):
        return []

    apps = []
    for raw_app in raw_apps:
        if not isinstance(raw_app, dict):
            continue
        app_id = str(raw_app.get("id", "") or "").strip()
        if not app_id:
            continue
        apps.append(
            {
                "configFields": raw_app.get("configFields", []),
                "defaultConfig": raw_app.get("defaultConfig", {}),
                "defaultView": str(raw_app.get("defaultView", "") or "").strip(),
                "id": app_id,
                "label": str(raw_app.get("label", "") or "").strip() or app_id,
                "views": raw_app.get("views", []),
            }
        )
    return apps


MAIN_PANEL_APP_REGISTRY = load_main_panel_app_registry()
REGISTERED_MAIN_PANEL_APP_IDS = {
    app["id"]
    for app in MAIN_PANEL_APP_REGISTRY
}


def normalized_interactive_config(value):
    return value if isinstance(value, dict) else {}


def normalize_interactive_id(value):
    return str(value or "").strip()


def interactive_id_error(interactive_id):
    if not interactive_id:
        return "Interactive id is required."
    if len(interactive_id) > 80:
        return "Interactive id is too long."
    if not re.fullmatch(r"[A-Za-z0-9_-]+", interactive_id):
        return "Interactive id can only contain letters, numbers, dashes, and underscores."
    if interactive_id not in REGISTERED_MAIN_PANEL_APP_IDS:
        return "Main-panel app is not registered."
    return ""
