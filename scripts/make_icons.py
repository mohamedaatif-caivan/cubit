"""Draw the Cubit icon (a carpenter's square on a blueprint tile) for the web app.

Same artwork as the desktop app's scripts/make_icon.py. Writes public/icon.svg plus the PNG sizes
browsers and phones ask for, including a full-bleed "maskable" icon for Android.

Run: python scripts/make_icons.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
PUBLIC = Path(__file__).resolve().parent.parent / "public"
TOP, BOTTOM = (37, 99, 235), (23, 52, 140)  # blueprint blue gradient


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient() -> Image.Image:
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = (*lerp(TOP, BOTTOM, (x * 0.35 + y) / (S * 1.35)), 255)
    return img


def square(d: ImageDraw.ImageDraw, scale: float = 1.0) -> None:
    """The carpenter's square, scaled about the centre (maskable icons need a safe zone)."""
    def t(v):
        return S / 2 + (v - S / 2) * scale

    white = (255, 255, 255, 255)
    blue = (*BOTTOM, 255)
    x0, y0, x1, y1, w = 250, 230, 790, 770, 118
    r = 26 * scale
    d.rounded_rectangle((t(x0), t(y0), t(x0 + w), t(y1)), radius=r, fill=white)
    d.rounded_rectangle((t(x0), t(y1 - w), t(x1), t(y1)), radius=r, fill=white)
    for i in range(1, 9):
        length = 58 if i % 4 == 0 else 34
        y = y1 - w - i * 52
        if y > y0 + 30:
            d.rectangle((t(x0 + w - length), t(y - 7), t(x0 + w), t(y + 7)), fill=blue)
        x = x0 + w + i * 52
        if x < x1 - 30:
            d.rectangle((t(x - 7), t(y1 - w), t(x + 7), t(y1 - w + length)), fill=blue)


def rounded() -> Image.Image:
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=255)
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    icon.paste(gradient(), (0, 0), mask)
    square(ImageDraw.Draw(icon))
    return icon


def full_bleed(scale: float) -> Image.Image:
    icon = gradient()
    square(ImageDraw.Draw(icon), scale)
    return icon


def svg() -> str:
    x0, y0, x1, y1, w = 250, 230, 790, 770, 118
    ticks = []
    for i in range(1, 9):
        length = 58 if i % 4 == 0 else 34
        y = y1 - w - i * 52
        if y > y0 + 30:
            ticks.append(f'<rect x="{x0 + w - length}" y="{y - 7}" width="{length}" height="14"/>')
        x = x0 + w + i * 52
        if x < x1 - 30:
            ticks.append(f'<rect x="{x - 7}" y="{y1 - w}" width="14" height="{length}"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0.26" y2="1">'
        '<stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#17348c"/></linearGradient></defs>'
        '<rect x="40" y="40" width="944" height="944" rx="210" fill="url(#g)"/>'
        f'<g fill="#fff"><rect x="{x0}" y="{y0}" width="{w}" height="{y1 - y0}" rx="26"/>'
        f'<rect x="{x0}" y="{y1 - w}" width="{x1 - x0}" height="{w}" rx="26"/></g>'
        f'<g fill="#17348c">{"".join(ticks)}</g></svg>\n'
    )


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    (PUBLIC / "icon.svg").write_text(svg(), encoding="utf-8")
    art = rounded()
    for n in (192, 512):
        art.resize((n, n), Image.LANCZOS).save(PUBLIC / f"icon-{n}.png")
    full_bleed(0.78).resize((512, 512), Image.LANCZOS).save(PUBLIC / "icon-maskable-512.png")
    full_bleed(0.9).convert("RGB").resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")
    print(f"Wrote icons to {PUBLIC}")


if __name__ == "__main__":
    main()
