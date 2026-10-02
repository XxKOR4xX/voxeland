"""PNG (16x16) -> cadena base36 del formato de texturas de VOXELAND.

Replica exactamente game.js: getPixels() (decodificador) y el bucle de
initTextures() que hace setPixel(n, j >> 2 & 15, j >> 6, ...).

Uso:
    python tools/png2b36.py --test        # round-trip contra texturas de game.js
    python tools/png2b36.py --emit        # imprime los 13 literales para pegar
"""

import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GAME_JS = ROOT / "game.js"
PNG_DIR = ROOT / "png" / "grass"

ALPH = "0123456789abcdefghijklmnopqrstuvwxyz"


def b36(n, width=1):
    s = ""
    while True:
        s = ALPH[n % 36] + s
        n //= 36
        if n == 0:
            break
    return s.zfill(width)


# ---------------------------------------------------------------- decodificar
def get_pixels(s):
    """Port exacto de game.js:6268 (getPixels)."""
    d_count = 0
    while s[4 + d_count] == "0":
        d_count += 1
    ccount = int(s[4 + d_count:4 + d_count + d_count + 1], 36)
    colors = []
    for i in range(ccount):
        num = int(s[5 + 2 * d_count + i * 7:5 + 2 * d_count + i * 7 + 7], 36)
        colors.append([(num >> 24) & 255, (num >> 16) & 255,
                       (num >> 8) & 255, num & 255])
    start = 5 + 2 * d_count + ccount * 7
    pixels = []
    for ch in s[start:]:
        pixels.extend(colors[int(ch, 36)])
    return pixels


# ------------------------------------------------------------------- codificar
def encode(pix):
    """pix: lista plana RGBA (256 píxeles, orden fila-major). -> str base36.

    El formato solo admite 1 char base36 por píxel => <= 36 colores en total.
    """
    assert len(pix) == 256 * 4, len(pix)
    colors = []
    index = {}
    idx = []
    for j in range(0, len(pix), 4):
        rgba = (pix[j], pix[j + 1], pix[j + 2], pix[j + 3])
        if rgba not in index:
            if len(colors) >= 36:
                raise ValueError("mas de 36 colores: cuantiza antes de codificar")
            index[rgba] = len(colors)
            colors.append(rgba)
        idx.append(index[rgba])

    ccount = len(colors)
    if ccount < 36:
        header = b36(ccount)          # dCount = 0
    else:
        header = "0" + b36(ccount, 2)  # dCount = 1
    body = "".join(
        b36((r << 24) | (g << 16) | (b << 8) | a, 7) for (r, g, b, a) in colors
    )
    return "0g0g" + header + body + "".join(ALPH[i] for i in idx)


# ------------------------------------------------------------- png -> base36
def png_to_b36(path):
    im = Image.open(path).convert("RGBA")
    if im.size != (16, 16):
        raise ValueError("%s no es 16x16: %s" % (path, im.size))
    data = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") \
        else list(im.getdata())

    has_alpha0 = any(p[3] == 0 for p in data)
    limit = 36 - (1 if has_alpha0 else 0)
    uniq = {p for p in data if p[3] != 0}
    if len(uniq) > limit:
        rgb = Image.new("RGB", (16, 16))
        rgb.putdata([(p[0], p[1], p[2]) for p in data])
        pal = rgb.quantize(colors=limit, method=Image.Quantize.MEDIANCUT)
        palette = pal.getpalette()
        data = [
            (0, 0, 0, 0) if p[3] == 0 else
            (palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], 255)
            for p, i in zip(data, pal.getdata())
        ]

    out = []
    for p in data:
        if p[3] == 0:
            out.extend((0, 0, 0, 0))
        else:
            out.extend((p[0], p[1], p[2], p[3]))
    return encode(out)


# ----------------------------------------------------------------------- test
def test_roundtrip():
    src = GAME_JS.read_text(encoding="utf-8")
    block = src.split("let textures = {", 1)[1].split("\n\t}", 1)[0]
    found = re.findall(r'(\w+):\s*"([0-9a-z]{200,})"', block)
    if len(found) < 5:
        print("no se encontraron texturas en game.js")
        return False
    ok = True
    for name, s in found[:8]:
        pix = get_pixels(s)
        # El orden de la paleta puede diferir: lo que importa son los píxeles.
        same = get_pixels(encode(pix)) == pix
        ok = ok and same
        print("  %-20s %s (%d px, %d colores)" %
              (name, "OK " if same else "FALLO", len(pix) // 4,
               len({tuple(pix[i:i + 4]) for i in range(0, len(pix), 4)})))
    # Y el camino completo PNG -> str -> pix
    for f in sorted(PNG_DIR.glob("*.png")):
        s = png_to_b36(f)
        pix = get_pixels(s)
        assert len(pix) == 1024, f
        print("  %-28s -> %d chars, %d colores" %
              (f.name, len(s), len(set(tuple(pix[i:i + 4]) for i in range(0, 1024, 4)))))
    return ok


NAMES = {
    "grass.png": "grassPlant",
    "grass2.png": "grassPlant2",
    "grass3.png": "grassPlant3",
    "grass4.png": "grassPlant4",
    "tall_grass_bottom.png": "tallGrassBottom",
    "tall_grass_bottom2.png": "tallGrassBottom2",
    "tall_grass_bottom3.png": "tallGrassBottom3",
    "tall_grass_bottom4.png": "tallGrassBottom4",
    "tall_grass_top.png": "tallGrassTop",
    "tall_grass_top2.png": "tallGrassTop2",
    "tall_grass_top3.png": "tallGrassTop3",
    "tall_grass_top4.png": "tallGrassTop4",
}


def emit():
    for fname, name in NAMES.items():
        s = png_to_b36(PNG_DIR / fname)
        print('    %s: "%s",' % (name, s))


if __name__ == "__main__":
    if "--test" in sys.argv:
        sys.exit(0 if test_roundtrip() else 1)
    if "--emit" in sys.argv:
        emit()
    else:
        print(__doc__)
