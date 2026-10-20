#!/usr/bin/env python3
"""Watermark the CV's own images and return them as data URIs (called by cv_page.mjs build).

Any <img src="cv-img/<name>"> in _private/cv/index.html is read from _private/cv/cv-img/,
shrunk, stamped with the owner's name and embedded, so the picture exists only inside the
encrypted page and every copy of it carries the name.

Usage: python scripts/cv_images.py <out.json> <name> [<name> ...]
"""
import base64
import io
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_private", "cv", "cv-img")
MARK = "\u00a9 Carseus Lai"
MAX_W = 1100
FONTS = ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf")


def font(size):
    dirs = ("", os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"))
    for name in FONTS:
        for d in dirs:
            try:
                return ImageFont.truetype(os.path.join(d, name) if d else name, size)
            except OSError:
                pass
    return ImageFont.load_default(size)


def watermark(im):
    w, h = im.size
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))

    # Faint diagonal repeats, so cropping the corner label away still leaves the name.
    f = font(max(14, w // 30))
    box = ImageDraw.Draw(layer).textbbox((0, 0), MARK, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    tile = Image.new("RGBA", (tw + 8, th + 8), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((4 - box[0], 4 - box[1]), MARK, font=f, fill=(128, 128, 128, 46))
    tile = tile.rotate(28, expand=True, resample=Image.BICUBIC)
    step_x, step_y = int(tw * 1.9), int(th * 5.5)
    for row, y in enumerate(range(-tile.height, h + tile.height, step_y)):
        for x in range(-tile.width + (row % 2) * step_x // 2, w + tile.width, step_x):
            layer.alpha_composite(tile, (max(x, 0), max(y, 0)), (max(-x, 0), max(-y, 0)))

    # Readable label in the bottom-right corner.
    f = font(max(12, w // 48))
    d = ImageDraw.Draw(layer)
    box = d.textbbox((0, 0), MARK, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    pad, margin = max(4, th // 3), max(6, w // 120)
    x1, y1 = w - margin, h - margin
    x0, y0 = x1 - tw - 2 * pad, y1 - th - 2 * pad
    d.rounded_rectangle((x0, y0, x1, y1), radius=pad, fill=(20, 10, 28, 150))
    d.text((x0 + pad - box[0], y0 + pad - box[1]), MARK, font=f, fill=(255, 255, 255, 230))

    return Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")


def encode(im):
    """Smaller of a 256-colour PNG (screenshots) and a JPEG (photos)."""
    png, jpg = io.BytesIO(), io.BytesIO()
    im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(png, "PNG", optimize=True)
    im.save(jpg, "JPEG", quality=86, optimize=True, progressive=True)
    kind, buf = min((("png", png), ("jpeg", jpg)), key=lambda kv: kv[1].tell())
    return f"data:image/{kind};base64," + base64.b64encode(buf.getvalue()).decode()


def process(name):
    path = os.path.join(SRC, name)
    if not os.path.isfile(path):
        sys.exit(f"cv_images: missing _private/cv/cv-img/{name}")
    im = Image.open(path)
    im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
    if im.mode == "RGBA":  # flatten transparency onto white
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    if im.width > MAX_W:
        im = im.resize((MAX_W, math.ceil(im.height * MAX_W / im.width)), Image.LANCZOS)
    return encode(watermark(im))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = {n: process(n) for n in dict.fromkeys(sys.argv[2:])}
    with open(sys.argv[1], "w", encoding="utf-8") as fh:
        json.dump(out, fh)
