#!/usr/bin/env python3
"""Clean centered 3D "1313 TAXI" splash logo (transparent square) for the
Android 12+ splash icon slot. Output: assets/splash-logo.png"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTFIT = os.path.join(ROOT, "node_modules/@expo-google-fonts/outfit/800ExtraBold/Outfit_800ExtraBold.ttf")
OUT = os.path.join(ROOT, "assets")

WHITE = (255, 255, 255, 255)
SS = 4
SIZE = 1024

def F(path, size):
    return ImageFont.truetype(path, int(size))

def text_silhouette(text, font, ls, color, canvas):
    """Render letter-spaced text in one flat color onto a transparent canvas of
    size `canvas` (W,H), horizontally centered, returns (img, baseline_top_y is 0)."""
    W, H = canvas
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + ls * (len(text) - 1)
    asc, desc = font.getmetrics()
    x = W / 2 - total / 2
    y = (H - (asc + desc)) / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=color)
        x += w + ls
    return img

def grad_fill(mask_alpha, top, bot):
    """Vertical gradient (top->bot RGBA) clipped to mask_alpha (L)."""
    W, H = mask_alpha.size
    grad = Image.new("RGBA", (W, H))
    gd = ImageDraw.Draw(grad)
    for y in range(H):
        t = y / max(1, H - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(4))
        gd.line([(0, y), (W, y)], fill=c)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask_alpha)
    return out

def make_3d_word(text, font, ls, W, H, depth_px,
                 face_top=(255,255,255,255), face_bot=(214,222,232,255),
                 side_top=(150,158,170,255), side_bot=(92,98,110,255)):
    """3D extruded wordmark on transparent (W,H). Light comes from top."""
    base = text_silhouette(text, font, ls, WHITE, (W, H))
    alpha = base.split()[3]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # extrusion: stack offset silhouettes down-right, dark->light by depth
    for k in range(depth_px, 0, -1):
        t = (depth_px - k) / max(1, depth_px - 1)
        col = tuple(int(side_bot[i] + (side_top[i] - side_bot[i]) * t) for i in range(4))
        sil = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sil.paste(Image.new("RGBA", (W, H), col), (0, 0), alpha)
        layer.alpha_composite(sil, (k, k))
    # face on top with vertical gloss gradient
    face = grad_fill(alpha, face_top, face_bot)
    layer.alpha_composite(face, (0, 0))
    # top highlight sliver
    hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hi.paste(Image.new("RGBA", (W, H), (255, 255, 255, 150)), (0, -max(2, depth_px//3)), alpha)
    hi_clip = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hi_clip.paste(hi, (0, 0), alpha)
    return layer

def main():
    S = SIZE * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    cx = S / 2
    # ---- soft drop shadow for the whole logo (built on a separate layer) ----
    shadow_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # "1313" — big 3D
    f1313 = F(OUTFIT, S * 0.34)
    word = make_3d_word("1313", f1313, S * 0.004, S, S, depth_px=int(S * 0.018))
    # position so the whole stack (checker + 1313 + TAXI) is vertically centered
    word_y = int(S * -0.06)
    # shadow = blurred dark silhouette of the face
    sil = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sil.paste(Image.new("RGBA", (S, S), (60, 6, 6, 160)),
              (0, 0), text_silhouette("1313", f1313, S*0.004, WHITE, (S, S)).split()[3])
    shadow_layer.alpha_composite(sil, (0, word_y + int(S*0.02)))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(S * 0.012))
    img.alpha_composite(shadow_layer)
    img.alpha_composite(word, (0, word_y))

    d = ImageDraw.Draw(img)

    # ---- taxi roof sign accent above 1313 (white pill + red 'TAXI' checker feel) ----
    # thin checker stripe under 1313
    sy = int(S * 0.27)
    cw = S * 0.40
    sq = cw / 12
    x0 = cx - cw/2
    for i in range(12):
        c = WHITE if i % 2 == 0 else (255, 255, 255, 70)
        d.rectangle([x0 + i*sq, sy, x0 + (i+1)*sq, sy + sq], fill=c)

    # ---- "TAXI" wordmark below ----
    fTAXI = F(OUTFIT, S * 0.135)
    taxi = make_3d_word("TAXI", fTAXI, S * 0.02, S, S, depth_px=int(S*0.008),
                        face_top=(255,255,255,255), face_bot=(235,240,247,255),
                        side_top=(170,176,186,255), side_bot=(120,126,138,255))
    img.alpha_composite(taxi, (0, int(S * 0.18)))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(OUT, "splash-logo.png")
    out.save(path)
    print("splash-logo ->", path, out.size)

main()
