#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_mac.sh  —  XSIAM Dashboard  macOS Build (Apple Silicon / arm64)
# Produces:  dist/XSIAM Dashboard.app  +  dist/XSIAM_Dashboard_1.0.0.dmg
#
# Requirements on the build Mac (one-time setup):
#   1. Install Python 3.11+ from https://python.org  (standard .pkg installer)
#   2. Run this script — it installs everything else automatically
#
# The resulting .dmg requires NOTHING on end-user Macs.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_NAME="XSIAM Dashboard"
BUNDLE_ID="in.altisec.xsiam-dashboard"
VERSION="1.0.0"
ARCH="arm64"                          # Apple Silicon only
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR="$SCRIPT_DIR/build"
APP_PATH="$DIST_DIR/${APP_NAME}.app"
DMG_PATH="$DIST_DIR/XSIAM_Dashboard_${VERSION}.dmg"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; RESET='\033[0m'
info()  { echo -e "${CYAN}▶  $*${RESET}"; }
ok()    { echo -e "${GREEN}✓  $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠  $*${RESET}"; }
err()   { echo -e "${RED}✗  $*${RESET}"; exit 1; }
banner(){ echo -e "\n${GREEN}══════════════════════════════════════════════════════${RESET}"; echo -e "${GREEN}  $*${RESET}"; echo -e "${GREEN}══════════════════════════════════════════════════════${RESET}\n"; }

# ── Preflight ─────────────────────────────────────────────────────────────────
banner "XSIAM Dashboard — macOS Build"
info "Target architecture: Apple Silicon (arm64)"

# Verify we are on Apple Silicon
MACHINE=$(uname -m)
if [ "$MACHINE" != "arm64" ]; then
    err "This build script targets Apple Silicon (arm64). Detected: $MACHINE"
fi

# Find Python 3 — prefer python.org install over system stub
PYTHON=""
for candidate in /Library/Frameworks/Python.framework/Versions/3.*/bin/python3 \
                 /usr/local/bin/python3 /opt/homebrew/bin/python3 python3; do
    if command -v "$candidate" &>/dev/null 2>&1; then
        VER=$("$candidate" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
        if [ "$VER" -ge 11 ] 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo ""
    err "Python 3.11+ not found.

  Please install Python from:  https://www.python.org/downloads/macos/
  Download the macOS installer (.pkg), double-click it, and follow the prompts.
  Then run this script again."
fi

PY_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
ok "Python $PY_VER found at: $PYTHON"

# ── Install Python dependencies ───────────────────────────────────────────────
info "Installing build dependencies (this may take a minute)…"
"$PYTHON" -m pip install --quiet --upgrade \
    pyinstaller \
    flask \
    requests \
    Pillow \
    urllib3 \
    werkzeug
ok "Dependencies ready."

# ── Generate icon ──────────────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/icon.icns" ]; then
    info "Generating app icon…"
    "$PYTHON" "$SCRIPT_DIR/make_icon.py"
else
    ok "icon.icns present."
fi

# ── Write PyInstaller spec ────────────────────────────────────────────────────
info "Generating PyInstaller spec…"
SPEC_FILE="$SCRIPT_DIR/xsiam_dashboard_mac.spec"

cat > "$SPEC_FILE" << SPEC
# xsiam_dashboard_mac.spec  (auto-generated — do not edit manually)
from PyInstaller.building.build_main import Analysis, PYZ, EXE, BUNDLE, COLLECT

a = Analysis(
    ['launcher.py'],
    pathex=['${SCRIPT_DIR}'],
    binaries=[],
    datas=[
        ('config_manager.py', '.'),
        ('app.py', '.'),
    ],
    hiddenimports=[
        'flask',
        'flask.templating',
        'flask.json',
        'flask.logging',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.middleware.proxy_fix',
        'werkzeug.security',
        'requests',
        'requests.adapters',
        'urllib3',
        'urllib3.util',
        'json',
        'threading',
        'webbrowser',
        'socket',
        'config_manager',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'numpy', 'pandas',
        'scipy', 'PIL', 'PyQt5', 'wx',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='XSIAM Dashboard',
    debug=False,
    strip=True,
    upx=False,
    console=False,
    target_arch='arm64',
    icon='${SCRIPT_DIR}/icon.icns',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=True,
    upx=False,
    name='XSIAM Dashboard',
)

app = BUNDLE(
    coll,
    name='XSIAM Dashboard.app',
    icon='${SCRIPT_DIR}/icon.icns',
    bundle_identifier='${BUNDLE_ID}',
    version='${VERSION}',
    info_plist={
        'CFBundleName':               'XSIAM Dashboard',
        'CFBundleDisplayName':        'XSIAM Dashboard',
        'CFBundleShortVersionString': '${VERSION}',
        'CFBundleVersion':            '${VERSION}',
        'CFBundleIdentifier':         '${BUNDLE_ID}',
        'CFBundleExecutable':         'XSIAM Dashboard',
        'NSHighResolutionCapable':    True,
        'NSHumanReadableCopyright':   'Copyright 2025 AltISec. All rights reserved.',
        'LSUIElement':                False,
        'LSMinimumSystemVersion':     '12.0',
        'NSAppTransportSecurity': {
            'NSAllowsLocalNetworking': True,
        },
    },
)
SPEC

# ── Run PyInstaller ───────────────────────────────────────────────────────────
info "Running PyInstaller (bundling Python + Flask + all dependencies)…"
info "This takes 2–4 minutes — please wait…"

rm -rf "$BUILD_DIR" "$DIST_DIR"

"$PYTHON" -m PyInstaller --noconfirm --log-level WARN "$SPEC_FILE"

[ -d "$APP_PATH" ] || err "PyInstaller did not produce the .app bundle. Check output above."
ok "App bundle created: $APP_PATH"

# ── Bundle admin credentials into the app (so end users skip setup page) ──────
CONFIG_SRC="$HOME/.config/xsiam-dashboard/config.json"
CONFIG_DEST="$APP_PATH/Contents/MacOS/_internal/_default_config.json"

# Also try the PyInstaller one-dir layout
[ -d "$APP_PATH/Contents/MacOS/_internal" ] || CONFIG_DEST="$APP_PATH/Contents/MacOS/_default_config.json"

if [ -f "$CONFIG_SRC" ]; then
    cp "$CONFIG_SRC" "$CONFIG_DEST"
    ok "Credentials bundled into app — end users will skip the setup page."
    warn "The API key is embedded in the .app bundle."
    warn "Use a read-only Viewer API key. Do not distribute the DMG publicly."
else
    warn "No saved credentials found at: $CONFIG_SRC"
    warn "End users WILL see the setup page on first launch."
    warn "To pre-configure: run  python3 launcher.py  first, complete setup,"
    warn "then re-run this build script to bundle the credentials."
fi

# ── Ad-hoc code signing (REQUIRED for Apple Silicon Gatekeeper) ───────────────
info "Signing app bundle (ad-hoc)…"
# codesign is part of macOS base system — available without developer tools
if command -v codesign &>/dev/null; then
    # Sign all binaries inside the bundle first, then the bundle itself
    find "$APP_PATH/Contents/MacOS" -type f -perm +111 | while read -r binary; do
        codesign --force --sign - "$binary" 2>/dev/null || true
    done
    find "$APP_PATH/Contents/Frameworks" -name "*.dylib" -o -name "*.so" 2>/dev/null | while read -r lib; do
        codesign --force --sign - "$lib" 2>/dev/null || true
    done
    # Sign the bundle itself with deep flag
    codesign --force --deep --sign - "$APP_PATH"
    ok "App bundle signed (ad-hoc). Gatekeeper will accept this."
else
    warn "codesign not found — skipping signature."
    warn "Users may see a Gatekeeper warning on first launch."
    warn "Fix: right-click the app → Open → Open"
fi

# ── Remove quarantine from the build output ───────────────────────────────────
xattr -cr "$APP_PATH" 2>/dev/null || true

# ── Build DMG ─────────────────────────────────────────────────────────────────
info "Creating DMG installer…"

STAGING="$SCRIPT_DIR/_dmg_staging"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -r "$APP_PATH" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

hdiutil create \
    -volname "XSIAM Dashboard" \
    -srcfolder "$STAGING" \
    -ov -format UDZO \
    -imagekey zlib-level=9 \
    "$DMG_PATH"

rm -rf "$STAGING"

[ -f "$DMG_PATH" ] || err "DMG creation failed."
ok "DMG created: $DMG_PATH"

# ── Clean up build artifacts ──────────────────────────────────────────────────
rm -rf "$BUILD_DIR" "$SPEC_FILE" "$SCRIPT_DIR/__pycache__"
ok "Build directory cleaned."

# ── Done ──────────────────────────────────────────────────────────────────────
DMG_SIZE=$(du -sh "$DMG_PATH" | cut -f1)
banner "Build Complete!"
echo "  App:  $APP_PATH"
echo "  DMG:  $DMG_PATH  ($DMG_SIZE)"
echo ""
echo "  ── Installing ──────────────────────────────────────────────────────────"
echo "  1. Open:  $DMG_PATH"
echo "  2. Drag 'XSIAM Dashboard' → Applications"
echo "  3. Eject the DMG"
echo "  4. Launch from Applications — browser opens automatically"
echo ""
echo "  ── Distributing ────────────────────────────────────────────────────────"
echo "  Share the DMG file with your team."
echo "  End users need nothing pre-installed — just drag and launch."
echo ""
