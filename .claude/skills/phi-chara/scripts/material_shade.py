#!/usr/bin/env python3
"""Material map -> shaded pixel grid (spec.json for pixel_sheet.py build).

  python3 material_shade.py mat.json spec.json

mat.json:
{
  "outline": "000000",              # drawn OUTSIDE the material (transparent px 4-adjacent to material)
  "light": [-0.6, -0.8],            # light direction (top-left)
  "materials": {
    "W": {"ramp": ["5a544c", ..., "f8f5ee"], "texture": "fleece", "underside": true},
    "F": {"ramp": ["231d1f", ..., "73686b"]},
    "L": {"ramp": ["2a2325", "4a4044", "6c6266"], "thin": true},   # thin part: lit left / dark right
    "E": {"color": "f2b40a"}                                         # flat colour (eyes, accents)
    # optional "group": letters with the same group shade as one volume (default: the letter itself)
    # optional "bias": shift brightness (-1..1), e.g. hooves -0.5, shadow patches -0.6
  },
  "cells": {"0,1": ["....", ...]},  # same cell keys/sizes as pixel_sheet.py, '.' = transparent
  "mirror": {"0,3": "0,1"}          # optional: cell = horizontal mirror of another cell
}
Keep 1px of transparency around the material so the outline fits inside the cell.
"""
import json, sys


def pick(ramp, v):
    return ramp[max(0, min(len(ramp) - 1, int(round(v * (len(ramp) - 1)))))]


def regions(g, grp):
    h, w = len(g), len(g[0]); seen = set(); out = []
    for y in range(h):
        for x in range(w):
            if g[y][x] == "." or (x, y) in seen: continue
            k = grp(g[y][x]); st = [(x, y)]; seen.add((x, y)); pts = []
            while st:
                a, b = st.pop(); pts.append((a, b))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    p, q = a + dx, b + dy
                    if 0 <= p < w and 0 <= q < h and (p, q) not in seen and g[q][p] != "." and grp(g[q][p]) == k:
                        seen.add((p, q)); st.append((p, q))
            out.append(pts)
    return out


def shade(g, mats, light, outline):
    LX, LY = light
    h, w = len(g), len(g[0])
    col = [[None] * w for _ in range(h)]
    grp = lambda c: mats[c].get("group", c)
    for pts in regions(g, grp):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; S = set(pts)
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        rx, ry = max(1.5, (max(xs) - min(xs) + 1) / 2), max(1.5, (max(ys) - min(ys) + 1) / 2)
        for x, y in pts:
            m = mats[g[y][x]]
            if "color" in m: col[y][x] = m["color"]; continue
            ramp = m["ramp"]
            if m.get("thin"):
                v = 0.8 if (x - 1, y) not in S else 0.35
            else:
                nx, ny = (x + .5 - cx) / rx, (y + .5 - cy) / ry
                gr, rim = m.get("gradient", 0.5), m.get("rim", 1.0)          # flat planes: gradient ~0.15
                v = 0.62 + gr * (nx * LX + ny * LY)                       # volume facing the light
                if (x + 1, y) not in S or (x, y + 1) not in S: v -= 0.16 * rim  # core shadow, lower-right rim
                if (x - 1, y) not in S or (x, y - 1) not in S: v += 0.08 * rim  # rim light, upper-left
                if m.get("underside") and y >= max(ys) - 2: v -= 0.18
                if m.get("texture") == "fleece":
                    if (x + 2 * y) % 4 == 0: v += 0.12
                    if (3 * x + y) % 5 == 0: v -= 0.16
                    if (5 * x + 3 * y) % 7 == 0: v -= 0.10
                elif m.get("texture") == "rock":                          # granular stone
                    if (7 * x + 3 * y) % 11 == 0: v -= 0.14
                    if (3 * x + 5 * y) % 7 == 0: v += 0.08
                elif m.get("texture") == "fur":
                    if (x + y) % 3 == 0: v -= 0.08
            v += m.get("bias", 0)
            col[y][x] = pick(ramp, v)
    for y in range(h):
        for x in range(w):
            if g[y][x] == "." and any(0 <= x + dx < w and 0 <= y + dy < h and g[y + dy][x + dx] != "."
                                      for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                col[y][x] = outline
    return col


def main(src, dst):
    spec = json.load(open(src))
    mats, light, outline = spec["materials"], spec.get("light", [-0.6, -0.8]), spec.get("outline", "000000")
    cells = dict(spec["cells"])
    for k, srck in spec.get("mirror", {}).items():
        cells[k] = [r[::-1] for r in cells[srck]]
    syms = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+-/:;<=>?@^_~"
    pal, rev, out = {}, {}, {}
    for k, rows in cells.items():
        c = shade([list(r) for r in rows], mats, light, outline)
        res = []
        for row in c:
            s = ""
            for hx in row:
                if hx is None: s += "."; continue
                if hx not in rev: rev[hx] = syms[len(rev)]; pal[rev[hx]] = hx
                s += rev[hx]
            res.append(s)
        out[k] = res
    json.dump({"key": "008080", "palette": pal, "cells": out}, open(dst, "w"))
    print(f"wrote {dst}: {len(out)} cells, {len(pal)} colors")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
