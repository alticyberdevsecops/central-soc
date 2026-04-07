#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BUILD_MAC.command
# Double-click this file in Finder to build the XSIAM Dashboard app.
# No Terminal knowledge required.
# ─────────────────────────────────────────────────────────────────────────────

# Move to the folder containing this script
cd "$(dirname "$0")"

clear
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        XSIAM Dashboard — Mac App Builder                    ║"
echo "║        AltISec Security  |  Apple Silicon Edition           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Check for Python ──────────────────────────────────────────────────────────
PYTHON=""
for candidate in \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
    /opt/homebrew/bin/python3 \
    python3; do
    if command -v "$candidate" &>/dev/null 2>&1; then
        VER=$("$candidate" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
        if [ "$VER" -ge 11 ] 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌  Python 3.11 or later was not found on this Mac."
    echo ""
    echo "  Please install Python first:"
    echo "  1. Open this link in Safari:  https://www.python.org/downloads/macos/"
    echo "  2. Download the latest 'macOS installer' (.pkg file)"
    echo "  3. Double-click the .pkg and follow the install steps"
    echo "  4. Come back and double-click BUILD_MAC.command again"
    echo ""
    echo "Press any key to close…"
    read -n1 -s
    exit 1
fi

PY_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
echo "✓  Python $PY_VER detected"
echo ""
echo "Starting build — this will take 3–5 minutes."
echo "Do not close this window until you see the 'Build Complete' message."
echo ""
echo "──────────────────────────────────────────────────────────────"
echo ""

# ── Run the main build script ─────────────────────────────────────────────────
bash "$(dirname "$0")/build_mac.sh"

BUILD_STATUS=$?

echo ""
echo "──────────────────────────────────────────────────────────────"

if [ $BUILD_STATUS -eq 0 ]; then
    echo ""
    echo "✅  Build complete!"
    echo ""
    echo "Your installer is ready at:"
    echo "   $(dirname "$0")/dist/XSIAM_Dashboard_1.0.0.dmg"
    echo ""
    echo "Double-click the .dmg file to install."
    echo ""

    # Open the dist folder in Finder automatically
    open "$(dirname "$0")/dist/" 2>/dev/null || true
else
    echo ""
    echo "❌  Build failed. Please scroll up to see the error message."
    echo "    Share the error text with your administrator for support."
    echo ""
fi

echo "Press any key to close this window…"
read -n1 -s
