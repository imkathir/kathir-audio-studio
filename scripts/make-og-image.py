#!/usr/bin/env python3
"""Render the kathirStudio social-share image (1200x630) with Pillow."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
MONTSERRAT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONTSERRAT_MED = "/usr/lib/R/library/grDevices/fonts/Montserrat/static/Montserrat-Medium.ttf"

BG_TOP = (11, 16, 22)
BG_BOTTOM = (23, 30, 40)
ACCENT = (129, 140, 248)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)

# --- background ---------------------------------------------------------------
img = Image.new("RGB", (W, H), BG_TOP)
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    d.line(
        [(0, y), (W, y)],
        fill=(
            int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        ),
    )

# indigo glow (top-left) + teal glow (bottom-right)
glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
gd.ellipse([-300, -420, 640, 320], fill=90)
gd.ellipse([760, 420, 1500, 900], fill=40)
glow = glow.filter(ImageFilter.GaussianBlur(190))
img = Image.composite(Image.new("RGB", (W, H), (79, 70, 229)), img, glow)
d = ImageDraw.Draw(img)


def font(path, size):
    return ImageFont.truetype(path, size)


def text_width(draw, s, f):
    box = draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0]


# --- wordmark -----------------------------------------------------------------
f_word = font(MONTSERRAT_BOLD, 86)
x, y = 70, 108
w1 = text_width(d, "kathir", f_word)
d.text((x, y), "kathir", font=f_word, fill=WHITE)
d.text((x + w1, y), "Studio", font=f_word, fill=ACCENT)

# --- headline -----------------------------------------------------------------
f_head = font(MONTSERRAT_BOLD, 46)
d.text((70, 226), "Free Text to Voice Converter", font=f_head, fill=(226, 232, 240))

f_sub = font(MONTSERRAT_MED, 25)
d.text(
    (70, 296),
    "Convert any text into studio-quality speech in 9 audio formats",
    font=f_sub,
    fill=MUTED,
)

# --- waveform -----------------------------------------------------------------
cx, base_y, bar_w, gap = 90, 430, 10, 8
heights = [26, 48, 72, 44, 96, 60, 118, 84, 52, 100, 66, 38, 78, 110, 58, 88, 42, 70, 34, 54]
for i, h in enumerate(heights):
    bx = cx + i * (bar_w + gap)
    top = base_y - h
    color = ACCENT if i % 3 else (165, 180, 252)
    d.rounded_rectangle([bx, top, bx + bar_w, base_y], radius=bar_w // 2, fill=color)

# --- format chips -------------------------------------------------------------
f_chip = font(MONTSERRAT_BOLD, 19)
chips = ["MP3", "M4A", "M4R", "WAV", "FLAC", "OGG", "OPUS", "AIFF", "CAF"]
x = 70
for label in chips:
    tw = text_width(d, label, f_chip)
    w = tw + 26
    d.rounded_rectangle([x, 498, x + w, 538], radius=10, fill=(31, 41, 55), outline=(71, 85, 105), width=1)
    d.text((x + 13, 507), label, font=f_chip, fill=(203, 213, 225))
    x += w + 10

# --- footer -------------------------------------------------------------------
f_foot = font(MONTSERRAT_MED, 22)
d.text(
    (70, 570),
    "100% free  -  no signup  -  unlimited length  -  runs right in your browser",
    font=f_foot,
    fill=(120, 135, 155),
)

img.save("/home/user/kathir-audio-studio/public/og-image.png", "PNG", optimize=True)
print("wrote public/og-image.png", img.size)
