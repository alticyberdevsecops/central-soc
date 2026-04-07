"""
config_manager.py
Handles loading and saving XSIAM credentials + port from a persistent config file.
Fallback to config.py for development convenience.
"""
import os
import json
import platform

CONFIG_FILE_NAME = "config.json"
DEFAULT_PORT     = 5001


def get_config_dir() -> str:
    """Return the OS-appropriate config directory and ensure it exists."""
    system = platform.system()
    if system == "Darwin":
        base = os.path.expanduser("~/.config/xsiam-dashboard")
    elif system == "Windows":
        base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "xsiam-dashboard")
    else:
        base = os.path.expanduser("~/.config/xsiam-dashboard")
    os.makedirs(base, exist_ok=True)
    return base


def get_config_path() -> str:
    return os.path.join(get_config_dir(), CONFIG_FILE_NAME)


def is_configured() -> bool:
    """Return True if a valid config file exists with all required fields."""
    path = get_config_path()
    if not os.path.exists(path):
        return False
    try:
        cfg = load_config()
        return bool(
            cfg.get("XSIAM_TENANT_URL") and
            cfg.get("XSIAM_API_KEY") and
            cfg.get("XSIAM_API_KEY_ID")
        )
    except Exception:
        return False


def load_config() -> dict:
    """
    Load config from file. Falls back to config.py if file doesn't exist.
    Returns dict with keys:
        XSIAM_TENANT_URL, XSIAM_API_KEY, XSIAM_API_KEY_ID, PORT
    """
    path = get_config_path()
    if os.path.exists(path):
        with open(path, "r") as f:
            data = json.load(f)
        # Ensure PORT key always exists with a sensible default
        if "PORT" not in data:
            data["PORT"] = DEFAULT_PORT
        return data

    # Fallback: try importing config.py (dev mode)
    try:
        import config as cfg_module
        return {
            "XSIAM_TENANT_URL": getattr(cfg_module, "XSIAM_TENANT_URL", ""),
            "XSIAM_API_KEY":    getattr(cfg_module, "XSIAM_API_KEY", ""),
            "XSIAM_API_KEY_ID": str(getattr(cfg_module, "XSIAM_API_KEY_ID", "")),
            "PORT":             getattr(cfg_module, "PORT", DEFAULT_PORT),
        }
    except ImportError:
        return {"PORT": DEFAULT_PORT}


def save_config(tenant_url: str, api_key: str, api_key_id: str,
                port: int = DEFAULT_PORT) -> None:
    """Persist credentials + port to the config file."""
    # Validate port
    try:
        port = int(port)
        if not (1024 <= port <= 65535):
            port = DEFAULT_PORT
    except (TypeError, ValueError):
        port = DEFAULT_PORT

    data = {
        "XSIAM_TENANT_URL": tenant_url.strip().rstrip("/"),
        "XSIAM_API_KEY":    api_key.strip(),
        "XSIAM_API_KEY_ID": str(api_key_id).strip(),
        "PORT":             port,
    }
    path = get_config_path()
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def get_port() -> int:
    """Return the configured port, or the default if not set."""
    try:
        return int(load_config().get("PORT", DEFAULT_PORT))
    except Exception:
        return DEFAULT_PORT


def delete_config() -> None:
    """Remove saved config (reset to unconfigured state)."""
    path = get_config_path()
    if os.path.exists(path):
        os.remove(path)
