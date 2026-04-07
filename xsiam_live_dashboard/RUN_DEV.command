#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RUN_DEV.command  —  XSIAM Dashboard  Development Launcher
# Double-click this file in Finder to start the dashboard in your browser.
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")"

# ── Find Python 3.11+ ────────────────────────────────────────────────────────
PYTHON=""
for candidate in \
    /Library/Frameworks/Python.framework/Versions/3.*/bin/python3 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    python3; do
    if command -v "$candidate" &>/dev/null 2>&1; then
        VER=$("$candidate" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
        if [ "$VER" -ge 9 ] 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ERROR: Python 3.9+ not found.                              ║"
    echo "║                                                              ║"
    echo "║  Please install Python from:                                 ║"
    echo "║  https://www.python.org/downloads/macos/                    ║"
    echo "║                                                              ║"
    echo "║  Then double-click RUN_DEV.command again.                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    read -n1 -r -p "Press any key to close..."
    exit 1
fi

PY_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        XSIAM Dashboard — Development Mode                   ║"
echo "║        AltISec Security  |  Python $PY_VER                      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Install dependencies if needed ───────────────────────────────────────────
echo "▶  Checking dependencies..."
"$PYTHON" -m pip install --quiet flask requests Pillow urllib3 werkzeug 2>/dev/null
echo "✓  Dependencies ready."
echo ""

# ── Launch ────────────────────────────────────────────────────────────────────
echo "▶  Starting XSIAM Dashboard..."
echo "   Browser will open automatically."
echo "   Press Ctrl+C here to stop the server."
echo ""

"$PYTHON" launcher.py
