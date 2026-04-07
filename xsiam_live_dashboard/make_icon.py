"""
make_icon.py
Generates the XSIAM Dashboard app icon (.icns) for macOS.
AltISec-branded shield with lock — navy + teal palette.

Usage:  python make_icon.py
Output: icon.icns, icon_256.png
"""
import os, io, struct, math

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow", "--quiet"])
    from PIL import Image, ImageDraw, ImageFont


# ── Palette ──────────────────────────────────────────────────────────────────
NAVY    = (13,  27,  42,  255)
NAVY2   = (27,  42,  74,  255)
TEAL    = (0,  107, 143, 255)
TEAL_LT = (0,  160, 200, 255)
WHITE   = (255, 255, 255, 255)
GOLD    = (240, 165,   0, 255)
TRANS   = (0, 0, 0, 0)


def shield_polygon(cx, cy, w, h):
    """Return polygon points for a shield: flat top, rounded corners, pointed bottom."""
    r = int(w * 0.15)
    l = cx - w // 2
    t = cy - h // 2
    r_ = cx + w // 2
    b = cy + h // 2
    # approximate rounded corners with extra points
    pts = []
    # top-left arc
    for a in range(180, 270, 15):
        pts.append((l + r + int(r * math.cos(math.radians(a))),
                    t + r + int(r * math.sin(math.radians(a)))))
    # top-right arc
    for a in range(270, 360, 15):
        pts.append((r_ - r + int(r * math.cos(math.radians(a))),
                    t + r  + int(r * math.sin(math.radians(a)))))
    # right side down to ~60% height, then taper to point
    mid_r_y = t + int(h * 0.62)
    pts.append((r_, mid_r_y))
    # bottom point
    pts.append((cx, b))
    # left side
    pts.append((l, mid_r_y))
    return pts


def make_frame(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), TRANS)
    draw = ImageDraw.Draw(img)

    pad  = max(4, int(size * 0.07))
    cx   = size // 2
    cy   = size // 2 + int(size * 0.02)   # very slight vertical offset downward

    sw = size - 2 * pad           # shield width
    sh = int(sw * 1.15)           # shield height
    sx = cx - sw // 2
    sy = cy - sh // 2

    pts = shield_polygon(cx, cy, sw, sh)

    # ── 1. Shadow / glow underneath ──────────────────────────────────────
    for i in range(5, 0, -1):
        glow = (0, 107, 143, 18 * i)
        g_pts = shield_polygon(cx, cy + i, sw + i*2, sh + i*2)
        draw.polygon(g_pts, fill=glow)

    # ── 2. Shield fill (navy2) ────────────────────────────────────────────
    draw.polygon(pts, fill=NAVY2)

    # ── 3. Top teal stripe ────────────────────────────────────────────────
    stripe_h = int(sh * 0.22)
    stripe_img = Image.new("RGBA", (size, size), TRANS)
    stripe_draw = ImageDraw.Draw(stripe_img)
    stripe_draw.rectangle([0, sy, size, sy + stripe_h], fill=TEAL)
    # mask the stripe to the shield shape
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    stripe_img.putalpha(mask)
    img = Image.alpha_composite(img, stripe_img)
    draw = ImageDraw.Draw(img)

    # ── 4. Shield outline ─────────────────────────────────────────────────
    lw = max(2, size // 48)
    draw.polygon(pts, outline=TEAL_LT, width=lw)

    # ── 5. Lock body ──────────────────────────────────────────────────────
    lk_w  = int(sw * 0.36)
    lk_h  = int(sh * 0.26)
    lk_cx = cx
    lk_cy = cy + int(sh * 0.10)
    lk_x  = lk_cx - lk_w // 2
    lk_y  = lk_cy - lk_h // 2
    lk_r  = int(lk_w * 0.18)

    draw.rounded_rectangle([lk_x, lk_y, lk_x + lk_w, lk_y + lk_h],
                            radius=lk_r, fill=WHITE)

    # Shackle (U-shape above body)
    shk_w    = int(lk_w * 0.50)
    shk_r    = shk_w // 2
    shk_cx   = lk_cx
    shk_bot  = lk_y + int(lk_h * 0.30)
    shk_top  = lk_y - int(lk_h * 0.55)
    shk_thick = max(2, size // 48)
    # Left leg
    draw.line([(shk_cx - shk_r, shk_bot), (shk_cx - shk_r, shk_top + shk_r)],
              fill=WHITE, width=shk_thick)
    # Right leg
    draw.line([(shk_cx + shk_r, shk_bot), (shk_cx + shk_r, shk_top + shk_r)],
              fill=WHITE, width=shk_thick)
    # Arc across top
    draw.arc([shk_cx - shk_r, shk_top, shk_cx + shk_r, shk_top + shk_r * 2],
             start=180, end=0, fill=WHITE, width=shk_thick)

    # Keyhole circle
    kh_r = max(2, int(lk_w * 0.09))
    kh_y = lk_y + int(lk_h * 0.36)
    draw.ellipse([lk_cx - kh_r, kh_y - kh_r, lk_cx + kh_r, kh_y + kh_r],
                 fill=NAVY2)

    # ── 6. "XSIAM" text in teal stripe ────────────────────────────────────
    if size >= 48:
        txt       = "XSIAM"
        font_size = max(7, int(stripe_h * 0.58))
        font      = None
        for fp in ["/System/Library/Fonts/HelveticaNeue.ttc",
                   "/System/Library/Fonts/Helvetica.ttc",
                   "/System/Library/Fonts/SFNSDisplay.ttf",
                   "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, font_size)
                    break
                except Exception:
                    pass
        if font is None:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), txt, font=font)
        tw   = bbox[2] - bbox[0]
        th   = bbox[3] - bbox[1]
        tx   = cx - tw // 2
        ty   = sy + (stripe_h - th) // 2 - bbox[1]
        draw.text((tx, ty), txt, fill=WHITE, font=font)

    return img


def build_icns(frames: dict, out_path: str):
    TYPE_MAP = {
        16: b"icp4", 32: b"icp5", 64: b"icp6",
        128: b"ic07", 256: b"ic08", 512: b"ic09", 1024: b"ic10",
    }
    chunks = []
    for size in sorted(frames):
        if size not in TYPE_MAP:
            continue
        buf = io.BytesIO()
        frames[size].save(buf, format="PNG")
        png = buf.getvalue()
        chunks.append(TYPE_MAP[size] + struct.pack(">I", 8 + len(png)) + png)

    total = 8 + sum(len(c) for c in chunks)
    with open(out_path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", total))
        for c in chunks:
            f.write(c)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    frames = {}
    for s in sizes:
        print(f"  {s}×{s}…", end=" ", flush=True)
        frames[s] = make_frame(s)
        print("✓")

    icns_path = os.path.join(here, "icon.icns")
    build_icns(frames, icns_path)
    print(f"\n✓  icon.icns  →  {icns_path}")

    png_path = os.path.join(here, "icon_256.png")
    frames[256].save(png_path)
    print(f"✓  icon_256.png  →  {png_path}")


if __name__ == "__main__":
    main()
