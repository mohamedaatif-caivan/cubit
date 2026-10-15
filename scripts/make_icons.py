"""Draw the Cubit icon (a rule over a keypad with a safety-orange = key) for the web app.

Same artwork as the desktop app's scripts/make_icon.py, laid out on a 100-unit grid inside the tile. Writes
public/icon.svg plus the PNG sizes browsers and phones ask for, including a full-bleed "maskable" icon for Android.

Run: python scripts/make_icons.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 1024
PUBLIC = Path(__file__).resolve().parent.parent / "public"
TILE = (31, 91, 216)  # #1F5BD8
WHITE = (255, 255, 255)
ORANGE = (245, 158, 11)  # #F59E0B
BROWN = (107, 53, 0)  # #6B3500, the = bars on the orange key


def shapes():
    """(x, y, w, h, radius, colour) on the 100-unit grid, drawn in order."""
    yield 18, 16, 64, 16, 3, WHITE  # the rule
    for i, x in enumerate(range(26, 75, 8)):  # graduations cut into its top edge, long every third
        yield x - 1.2, 16, 2.4, 10 if i % 3 == 0 else 6, 0, TILE
    yield 18, 40, 29, 19, 4, WHITE  # keypad
    yield 53, 40, 29, 19, 4, WHITE
    yield 18, 65, 29, 19, 4, WHITE
    yield 53, 65, 29, 19, 4, ORANGE  # the = key
    yield 60, 70, 15, 3, 1, BROWN
    yield 60, 76, 15, 3, 1, BROWN


def art(d: ImageDraw.ImageDraw, scale: float = 1.0) -> None:
    """The shapes on the tile, scaled about the centre (maskable icons need a safe zone)."""
    k = (S - 80) / 100

    def t(v):
        return S / 2 + (40 + v * k - S / 2) * scale

    for x, y, w, h, r, colour in shapes():
        d.rounded_rectangle((t(x), t(y), t(x + w), t(y + h)), radius=r * k * scale, fill=colour)


def rounded() -> Image.Image:
    icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=TILE)
    art(d)
    return icon


def full_bleed(scale: float) -> Image.Image:
    icon = Image.new("RGBA", (S, S), TILE)
    art(ImageDraw.Draw(icon), scale)
    return icon


def svg() -> str:
    def hexc(c):
        return "#%02x%02x%02x" % c

    def n(v):
        return f"{v:g}"

    parts = [
        f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}"' + (f' rx="{n(r)}"' if r else "") + f' fill="{hexc(c)}"/>'
        for x, y, w, h, r, c in shapes()
    ]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
        f'<rect x="40" y="40" width="944" height="944" rx="210" fill="{hexc(TILE)}"/>'
        f'<g transform="translate(40 40) scale(9.44)">{"".join(parts)}</g></svg>\n'
    )


def font(names, size):
    """The first of these fonts that exists (Windows fonts, then Pillow's default)."""
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def share_image() -> Image.Image:
    """1200x630 preview shown when the link is pasted into Teams, WhatsApp or a text message."""
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), (15, 26, 46))
    icon = rounded().resize((300, 300), Image.LANCZOS)
    img.paste(icon, (110, (h - 300) // 2), icon)
    d = ImageDraw.Draw(img)
    title = font(["segoeuib.ttf", "C:/Windows/Fonts/segoeuib.ttf", "DejaVuSans-Bold.ttf"], 112)
    body = font(["segoeui.ttf", "C:/Windows/Fonts/segoeui.ttf", "DejaVuSans.ttf"], 40)
    d.text((470, 190), "Cubit", font=title, fill=(231, 237, 246))
    d.text((474, 340), "Construction calculator", font=body, fill=(231, 237, 246))
    d.text((474, 395), "12' x 14'6\" + 40 sf  =  214 ft²", font=body, fill=(111, 157, 255))
    d.text((474, 450), "Feet, inches and metres. Works offline.", font=body, fill=(147, 163, 186))
    return img


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    (PUBLIC / "icon.svg").write_text(svg(), encoding="utf-8")
    tile = rounded()
    for n in (192, 512):
        tile.resize((n, n), Image.LANCZOS).save(PUBLIC / f"icon-{n}.png")
    full_bleed(0.78).resize((512, 512), Image.LANCZOS).save(PUBLIC / "icon-maskable-512.png")
    full_bleed(0.9).convert("RGB").resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")
    # A new file name whenever the wording changes: Teams and WhatsApp cache previews by image address.
    share_image().save(PUBLIC / "og-2.png", optimize=True)
    print(f"Wrote icons to {PUBLIC}")


if __name__ == "__main__":
    main()
