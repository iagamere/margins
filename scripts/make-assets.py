"""Regenerates the app icon / splash PNGs in assets/ and public/icons/ (requires Pillow)."""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAGE_DEEP = (74, 86, 66)
CREAM = (246, 244, 239)
GOLD = (192, 161, 125)

def m_points(cx, cy, w, h):
    l, r, t, b = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    return [(l, b), (l, t), (cx, t + h * 0.58), (r, t), (r, b)]

def draw_mark(img, cx, cy, w, h, stroke, color, rule=None):
    d = ImageDraw.Draw(img)
    pts = m_points(cx, cy, w, h)
    d.line(pts, fill=color, width=stroke, joint="curve")
    for p in (pts[0], pts[-1], pts[1], pts[-2]):
        d.ellipse([p[0] - stroke / 2, p[1] - stroke / 2, p[0] + stroke / 2, p[1] + stroke / 2], fill=color)
    if rule:
        x1, x2 = cx - w / 2 - w * 0.28, cx + w / 2 + w * 0.28
        d.rectangle([x1 - 4, cy - h * 0.75, x1 + 4, cy + h * 0.75], fill=rule)
        d.rectangle([x2 - 4, cy - h * 0.75, x2 + 4, cy + h * 0.75], fill=rule)

def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)

# Full icon
S = 1024
icon = Image.new("RGB", (S, S), SAGE_DEEP)
draw_mark(icon, S / 2, S / 2, 380, 340, 78, CREAM, GOLD)
save(icon, "assets", "icon-only.png")
for size in (512, 192):
    save(icon.resize((size, size), Image.LANCZOS), "public", "icons", f"icon-{size}.png")

# Adaptive icon layers
fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_mark(fg, S / 2, S / 2, 250, 220, 52, CREAM, GOLD)
save(fg, "assets", "icon-foreground.png")
save(Image.new("RGB", (S, S), SAGE_DEEP), "assets", "icon-background.png")

# Splash screens
for name, bg, fgc, rule in (("splash.png", CREAM, SAGE_DEEP, GOLD), ("splash-dark.png", (25, 27, 25), (162, 174, 145), (192, 161, 125))):
    sp = Image.new("RGB", (2732, 2732), bg)
    draw_mark(sp, 1366, 1366, 240, 210, 50, fgc, rule)
    save(sp, "assets", name)
print("assets written")
