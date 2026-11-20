#!/usr/bin/env python3
"""Pixel-art sheet tool (96x160 BMP, key #008080).

  python3 pixel_sheet.py build   spec.json out.bmp     -> out.bmp + out_preview.png (x8, grid)
  python3 pixel_sheet.py measure sheet.bmp [character|animal]  -> per-cell metrics vs reference targets
  python3 pixel_sheet.py compare a.bmp b.bmp out.png   -> side-by-side x6

spec.json: {"key":"008080","palette":{"k":"0c0808",...},"cells":{"col,row":[rows...],"face":[...],"sign":[...]}}
cols 0-1 = 16x32, cols 2-3 = 32x32, rows 0-3; face = 64x32 @ (0,128), sign = 32x32 @ (64,128). '.' = key.
"""
import json, sys
from PIL import Image

COL_X, COL_W = [0, 16, 32, 64], [16, 16, 32, 32]
SPECIAL = {"face": (0, 128, 64, 32), "sign": (64, 128, 32, 32)}
KEY = (0, 128, 128)
# character targets: hand-drawn d_fallen.bmp; animal targets: t_cat*/t_bhorse/t_cockatrice (pure-black outline)
TARGET = {"fill16": 75, "edgeL": 20, "darkL": 30, "accent_sat": 0.9}
ANIMAL_EDGE_L = 5


def hx(s):
    s = s.lstrip("#"); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def cell_box(k):
    if k in SPECIAL:
        return SPECIAL[k]
    c, r = map(int, k.split(",")); return COL_X[c], r * 32, COL_W[c], 32


def build(spec_path, out):
    spec = json.load(open(spec_path))
    key = hx(spec.get("key", "008080"))
    pal = {k: hx(v) for k, v in spec["palette"].items()}
    for ch, c in pal.items():
        if sum(abs(a - b) for a, b in zip(c, key)) < 90:
            print(f"WARN palette '{ch}' is too close to the key color")
    im = Image.new("RGB", (96, 160), key); px = im.load()
    for k, rows in spec["cells"].items():
        x0, y0, w, h = cell_box(k)
        assert len(rows) == h, f"cell {k}: {len(rows)} rows, expected {h}"
        for y, row in enumerate(rows):
            assert len(row) == w, f"cell {k} row {y}: len {len(row)}, expected {w}"
            for x, ch in enumerate(row):
                if ch != ".":
                    px[x0 + x, y0 + y] = pal[ch]
    im.save(out)
    prev = im.resize((768, 1280), Image.NEAREST); pp = prev.load()
    for a in range(0, 768, 8):
        for b in range(1280):
            r, g, bl = pp[a, b]; pp[a, b] = (int(r * .85), int(g * .85), int(bl * .85))
    for b in range(0, 1280, 8):
        for a in range(768):
            r, g, bl = pp[a, b]; pp[a, b] = (int(r * .85), int(g * .85), int(bl * .85))
    prev.save(out.rsplit(".", 1)[0] + "_preview.png")
    print("wrote", out)
    measure(out, spec.get("kind", "character"))


def measure(path, kind="character"):
    im = Image.open(path).convert("RGB"); px = im.load()
    issues = []
    frames = {}
    for r in range(4):
        for c in range(4):
            x0, y0, w, h = COL_X[c], r * 32, COL_W[c], 32
            frames[(c, r)] = im.crop((x0, y0, x0 + w, y0 + h)).tobytes()
            edge, inner, sat, ys, cols = [], [], [], [], set()
            for y in range(y0, y0 + h):
                for x in range(x0, x0 + w):
                    p = px[x, y]
                    if p == KEY:
                        continue
                    cols.add(p); ys.append(y - y0)
                    e = any(not (x0 <= x + dx < x0 + w and y0 <= y + dy < y0 + h) or px[x + dx, y + dy] == KEY
                            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                    (edge if e else inner).append(lum(p))
                    mx, mn = max(p), min(p); sat.append((mx - mn) / mx if mx else 0)
            if not ys:
                continue
            fill = len(ys) * 100 // (w * h)
            eL = sum(edge) / len(edge)
            light_edge = sum(v > 110 for v in edge)
            inner.sort(); dark = inner[len(inner) // 20] if inner else 0
            acc = sorted(sat)[len(sat) * 19 // 20]
            print(f"[{c},{r}] {w}x{h} fill={fill}% top={min(ys)} colors={len(cols)} "
                  f"edgeL={eL:.0f} light_edge={light_edge} darkL={dark:.0f} accent_sat={acc:.2f}")
            if kind == "animal":
                if eL > ANIMAL_EDGE_L: issues.append(f"[{c},{r}] outline not pure black (edgeL {eL:.0f} > {ANIMAL_EDGE_L})")
                if light_edge: issues.append(f"[{c},{r}] {light_edge} light pixels on the silhouette edge (outline gap)")
            elif c == 0:
                if fill < TARGET["fill16"]: issues.append(f"[{c},{r}] fill {fill}% < {TARGET['fill16']}% (16x32 character-sized)")
                if eL > TARGET["edgeL"]: issues.append(f"[{c},{r}] outline too light (edgeL {eL:.0f} > {TARGET['edgeL']})")
                if light_edge: issues.append(f"[{c},{r}] {light_edge} light pixels on the silhouette edge (outline gap)")
                if dark > TARGET["darkL"]: issues.append(f"[{c},{r}] darkest shadows only reach L{dark:.0f} (> {TARGET['darkL']})")
                if acc < TARGET["accent_sat"]: issues.append(f"[{c},{r}] no saturated accent (sat {acc:.2f} < {TARGET['accent_sat']})")
    for r in range(4):
        if frames[(0, r)] == frames[(1, r)]:
            issues.append(f"row {r}: frames 0 and 1 are identical")
    for r in range(1, 4):
        if frames[(0, r)] == frames[(0, 0)]:
            issues.append(f"row {r} is an exact copy of row 0")
    print("\n".join(["ISSUES:"] + issues) if issues else "no issues")
    if kind == "character":
        print("(character targets; use 'animal' for animals/objects - their size follows the scale table instead)")


def compare(a, b, out):
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB"); s = 6
    im = Image.new("RGB", ((ia.width + ib.width + 8) * s, max(ia.height, ib.height) * s), (40, 40, 40))
    im.paste(ia.resize((ia.width * s, ia.height * s), Image.NEAREST), (0, 0))
    im.paste(ib.resize((ib.width * s, ib.height * s), Image.NEAREST), ((ia.width + 8) * s, 0))
    im.save(out); print("wrote", out)


if __name__ == "__main__":
    a = sys.argv
    {"build": lambda: build(a[2], a[3]), "measure": lambda: measure(a[2], a[3] if len(a) > 3 else "character"),
     "compare": lambda: compare(a[2], a[3], a[4])}[a[1]]()
