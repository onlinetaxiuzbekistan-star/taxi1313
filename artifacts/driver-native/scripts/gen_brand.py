#!/usr/bin/env python3
"""Generate 1313 TAXI app icon + splash from brand styling (red #DC2626 + white)."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTFIT = os.path.join(ROOT, "node_modules/@expo-google-fonts/outfit/800ExtraBold/Outfit_800ExtraBold.ttf")
DMBOLD = os.path.join(ROOT, "node_modules/@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf")
OUT = os.path.join(ROOT, "assets")

RED = (220, 38, 38, 255)        # #DC2626 brand
RED_HI = (242, 74, 66, 255)     # lighter (gradient center / 3D)
RED_LO = (176, 26, 26, 255)     # darker (gradient edge / shadow)
WHITE = (255, 255, 255, 255)
SHADOW = (120, 10, 10, 130)
SS = 4  # supersample factor

def F(path, size):
    return ImageFont.truetype(path, int(size))

def ctext(d, cx, y, text, font, fill, ls=0):
    # centered text by midpoint x; returns (w,h)
    if ls:
        # manual letter spacing
        widths = [d.textlength(ch, font=font) for ch in text]
        total = sum(widths) + ls * (len(text) - 1)
        x = cx - total / 2
        asc, desc = font.getmetrics()
        for ch, w in zip(text, widths):
            d.text((x, y), ch, font=font, fill=fill)
            x += w + ls
        return total, asc + desc
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]; h = bbox[3] - bbox[1]
    d.text((cx - w / 2 - bbox[0], y - bbox[1]), text, font=font, fill=fill)
    return w, h

def draw_car(d, cx, cy, w, body=WHITE, win=RED, wheel=RED, hub=WHITE, shadow=False):
    """Clean side-view sedan silhouette centered at (cx,cy), total width w."""
    h = w * 0.50
    x0 = cx - w / 2
    y0 = cy - h / 2
    def P(fx, fy):
        return (x0 + fx * w, y0 + fy * h)
    if shadow:
        sr = [P(0.04, 0.80)[0], P(0.04, 0.80)[1], P(0.96, 0.96)[0], P(0.96, 0.96)[1]]
        d.ellipse(sr, fill=SHADOW)
    # main body silhouette
    body_pts = [
        P(0.015, 0.66), P(0.02, 0.50), P(0.12, 0.46), P(0.23, 0.34),
        P(0.34, 0.20), P(0.46, 0.165), P(0.60, 0.165), P(0.71, 0.21),
        P(0.81, 0.34), P(0.93, 0.45), P(0.985, 0.52), P(0.985, 0.66),
    ]
    d.polygon(body_pts, fill=body)
    # skirt to wheels line
    d.rectangle([P(0.05, 0.62)[0], P(0.05, 0.62)[1], P(0.95, 0.80)[0], P(0.80, 0.80)[1]], fill=body)
    # windows (two, separated by B-pillar)
    d.polygon([P(0.355, 0.31), P(0.45, 0.235), P(0.535, 0.235), P(0.535, 0.31)], fill=win)
    d.polygon([P(0.565, 0.31), P(0.565, 0.235), P(0.66, 0.235), P(0.72, 0.31)], fill=win)
    # wheels (tire = body color ring, opening = wheel color, hub small)
    r = w * 0.092
    for fx in (0.265, 0.745):
        wx, wy = P(fx, 0.80)
        d.ellipse([wx - r, wy - r, wx + r, wy + r], fill=body)         # tire
        d.ellipse([wx - r*0.66, wy - r*0.66, wx + r*0.66, wy + r*0.66], fill=wheel)  # rim opening
        d.ellipse([wx - r*0.22, wy - r*0.22, wx + r*0.22, wy + r*0.22], fill=hub)    # hub cap

def draw_taxi_sign(d, cx, cy, w, color=WHITE):
    """Little taxi roof sign (rounded box) used in the wordmark."""
    h = w * 0.42
    d.rounded_rectangle([cx - w/2, cy - h/2, cx + w/2, cy + h/2], radius=h*0.28, fill=color)


# ---------------------------------------------------------------- ICON
def make_icon(path, size=1024, foreground_only=False, content_scale=1.0):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not foreground_only:
        # red rounded square with subtle radial 3D
        d.rounded_rectangle([0, 0, S, S], radius=int(S*0.22), fill=RED)
        hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(hi).ellipse([-S*0.2, -S*0.55, S*1.2, S*0.6], fill=(255, 255, 255, 26))
        img = Image.alpha_composite(img, hi)
        d = ImageDraw.Draw(img)
    # Draw the logo onto its own layer then scale into the safe zone (adaptive
    # masks clip to ~66%, so the foreground is rendered smaller + centered).
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cx = S / 2
    ctext(ld, cx, S * 0.235, "1313", F(OUTFIT, S * 0.30), WHITE)
    draw_car(ld, cx, S * 0.62, S * 0.50, body=WHITE, win=RED if not foreground_only else (0,0,0,0), wheel=RED if not foreground_only else (0,0,0,0), hub=WHITE)
    ctext(ld, cx, S * 0.74, "TAXI", F(OUTFIT, S * 0.115), WHITE, ls=S*0.012)
    if content_scale != 1.0:
        ns = int(S * content_scale)
        layer = layer.resize((ns, ns), Image.LANCZOS)
        off = (S - ns) // 2
        tmp = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tmp.paste(layer, (off, off), layer)
        layer = tmp
    img = Image.alpha_composite(img, layer)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print("icon ->", path)

# ---------------------------------------------------------------- SPLASH
def make_splash(path, w=1284, h=2778):
    W, H = w*SS, h*SS
    img = Image.new("RGBA", (W, H), RED)
    # radial 3D gradient (lighter center)
    grad = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(grad)
    maxr = (W**2 + H**2) ** 0.5 / 1.7
    cx, cy = W/2, H*0.42
    steps = 60
    for i in range(steps, 0, -1):
        rr = maxr * i / steps
        v = int(70 * (1 - i/steps))  # 0 center .. up to 70 edge
        gd.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=v)
    dark = Image.new("RGBA", (W, H), RED_LO)
    img = Image.composite(dark, img, grad)
    d = ImageDraw.Draw(img)

    # ---- logo block (centered upper-middle) ----
    # "1313"
    f1313 = F(OUTFIT, W * 0.30)
    ctext(d, W/2, H*0.205, "1313", f1313, WHITE)
    # "TAXI"
    fTAXI = F(OUTFIT, W * 0.115)
    ctext(d, W/2, H*0.305, "TAXI", fTAXI, WHITE, ls=W*0.014)
    # thin divider
    d.rounded_rectangle([W*0.30, H*0.365, W*0.70, H*0.368], radius=H*0.002, fill=(255,255,255,150))

    # ---- car silhouette (with shadow for 3D depth) ----
    draw_car(d, W/2, H*0.50, W*0.74, body=WHITE, win=RED, wheel=RED, hub=WHITE, shadow=True)

    # ---- tagline ----
    fTag = F(DMBOLD, W * 0.052)
    ctext(d, W/2, H*0.605, "TEZ · SIFATLI · XAVFSIZ", fTag, (255,255,255,235), ls=W*0.004)

    # ---- HAYDOVCHI pill ----
    fHd = F(OUTFIT, W * 0.058)
    txt = "HAYDOVCHI"
    tw = sum(d.textlength(c, font=fHd) for c in txt) + (W*0.006)*(len(txt)-1)
    pad_x, pad_y = W*0.05, W*0.028
    bx0, bx1 = W/2 - tw/2 - pad_x, W/2 + tw/2 + pad_x
    by0 = H*0.665
    by1 = by0 + (fHd.getmetrics()[0]+fHd.getmetrics()[1]) + pad_y*1.2
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=(by1-by0)/2, fill=(255,255,255,255))
    ctext(d, W/2, by0 + pad_y*0.6, txt, fHd, RED, ls=W*0.006)

    img = img.resize((w, h), Image.LANCZOS)
    img.convert("RGB").save(path)
    print("splash ->", path)


make_icon(os.path.join(OUT, "icon.png"))
# Adaptive foreground: transparent, logo scaled into the safe zone (~72%).
make_icon(os.path.join(OUT, "adaptive-icon.png"), foreground_only=True, content_scale=0.72)
make_icon(os.path.join(OUT, "android-icon-foreground.png"), foreground_only=True, content_scale=0.72)
make_splash(os.path.join(OUT, "splash.png"))
make_splash(os.path.join(OUT, "splash-icon.png"))
print("done")
