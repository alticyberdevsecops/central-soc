"""
launcher.py
Entry point for the XSIAM Dashboard desktop application.

Startup logic:
  1. If a bundled _default_config.json exists in the app bundle (placed there
     by the build script from the admin's saved config), copy it to the user's
     config location on first run — end users never see the setup page.
  2. If no config exists at all, open the setup page so an admin can configure.
  3. Once configured, open the dashboard directly.

Port is read from the saved config (default 5001, configurable on setup page).
"""
import sys
import os
import shutil
import threading
import time
import socket
import webbrowser
import json

# ── PyInstaller bundle path fix ───────────────────────────────────────────────
if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS          # temp extraction dir when bundled
    APP_DIR  = os.path.dirname(sys.executable)  # .app/Contents/MacOS or dist\
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    APP_DIR  = BASE_DIR

sys.path.insert(0, BASE_DIR)
os.chdir(BASE_DIR)

# ── Imports ───────────────────────────────────────────────────────────────────
from app import app as flask_app
from config_manager import is_configured, get_port, save_config, get_config_path, DEFAULT_PORT

# Path where the build script places the pre-configured credentials
BUNDLED_CONFIG = os.path.join(BASE_DIR, "_default_config.json")


def _bootstrap_config():
    """
    If the admin bundled credentials into the app at build time, and no user
    config exists yet, copy the bundled config to the user config location.
    This means end users never see the setup page.
    """
    if is_configured():
        return  # already set up — nothing to do

    if os.path.exists(BUNDLED_CONFIG):
        try:
            with open(BUNDLED_CONFIG, "r") as f:
                cfg = json.load(f)
            # Write to user config location
            dest = get_config_path()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w") as f:
                json.dump(cfg, f, indent=2)
            print("[XSIAM Dashboard] Pre-configured credentials loaded.")
        except Exception as e:
            print(f"[XSIAM Dashboard] Could not load bundled config: {e}")


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_for_server(port: int, timeout: int = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def run_flask(port: int) -> None:
    flask_app.run(
        host="127.0.0.1",
        port=port,
        debug=False,
        use_reloader=False,
        threaded=True,
    )


def main():
    # Step 1 — auto-configure from bundled credentials if present
    _bootstrap_config()

    # Step 2 — determine port
    desired_port = get_port()
    if is_port_in_use(desired_port):
        actual_port = find_free_port()
        print(f"[XSIAM Dashboard] Port {desired_port} busy — using {actual_port}.")
    else:
        actual_port = desired_port

    # Step 3 — start Flask
    server_thread = threading.Thread(target=run_flask, args=(actual_port,), daemon=True)
    server_thread.start()
    print(f"[XSIAM Dashboard] Starting on http://127.0.0.1:{actual_port} …")

    if not wait_for_server(actual_port):
        print("[XSIAM Dashboard] ERROR: server failed to start in 30 seconds.")
        sys.exit(1)

    print("[XSIAM Dashboard] Ready.")

    # Step 4 — open browser at CISO dashboard or setup page
    url = (f"http://127.0.0.1:{actual_port}/ciso"
           if is_configured()
           else f"http://127.0.0.1:{actual_port}/setup")
    webbrowser.open(url)

    try:
        server_thread.join()
    except KeyboardInterrupt:
        print("\n[XSIAM Dashboard] Shutting down.")
        sys.exit(0)


if __name__ == "__main__":
    main()
