"""配置図(素材の記号を塗り分けた 16x32 / 32x32 の文字グリッド)を描くヘルパー。

座標は 32 マスの設計用の座標で書き、16x32 の版は同じ設計を kx, ky で縮めて描く。
地面は y=30.5(その下の 1px は輪郭の為に空ける)。左右の 1px も輪郭の為に空ける。

    from sprite_map import SpriteMap
    m = SpriteMap(32)                 # 32x32 の版
    s = SpriteMap(16, 0.5, 0.7)       # 16x32 の版(横 1/2、縦 0.7 倍)
    m.ell(16, 20, 8, 6, "W")          # 楕円(ang で回転)
    m.limb([(8, 21), (6, 26), (6, 31)], "L", hoof="H")   # 関節つきの脚
    m.leaf((16, 30), -30, 12, 4, 2, "k", rib="r", sep="kl")  # 先の尖った葉
    rows = m.rows()                   # material_shade.py の mat.json の cells に入れる
"""
import math

GROUND = 30.5


def bez(p0, p1, p2, t):
    return ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])


class SpriteMap:
    def __init__(s, w, kx=1.0, ky=1.0):
        s.w, s.kx, s.ky = w, kx, ky
        s.g = [["."] * w for _ in range(32)]

    # 設計座標 -> セルの座標
    def X(s, x): return s.w / 2 + (x - 16) * s.kx
    def Y(s, y): return GROUND - (GROUND - y) * s.ky

    def put(s, x, y, ch, only=None):
        """セルの座標で1画素置く。only を渡すと、その記号の上にだけ置く。"""
        x, y = int(x), int(y)
        if 1 <= x < s.w - 1 and 0 <= y < 31 and (only is None or s.g[y][x] in only):
            s.g[y][x] = ch

    def get(s, x, y):
        return s.g[y][x] if 0 <= x < s.w and 0 <= y < 32 else "."

    def ell(s, cx, cy, rx, ry, ch, ang=0.0, only=None, ymax=None):
        """塗りつぶした楕円。ang は度。ymax より下は塗らない(地面から出た部分だけ描く時)。"""
        cx, cy = s.X(cx), s.Y(cy); rx, ry = max(0.6, rx * s.kx), max(0.6, ry * s.ky)
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        for y in range(32):
            if ymax is not None and y + .5 > s.Y(ymax): continue
            for x in range(s.w):
                dx, dy = x + .5 - cx, y + .5 - cy
                u, v = dx * ca + dy * sa, -dx * sa + dy * ca
                if (u / rx) ** 2 + (v / ry) ** 2 <= 1: s.put(x, y, ch, only)

    def poly(s, pts, ch, only=None):
        """塗りつぶした多角形(岩の面、板など)。"""
        P = [(s.X(x), s.Y(y)) for x, y in pts]
        for y in range(32):
            yc = y + .5; xs = []
            for (x0, y0), (x1, y1) in zip(P, P[1:] + P[:1]):
                if (y0 <= yc < y1) or (y1 <= yc < y0):
                    xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            hit = False
            for a, b in zip(xs[::2], xs[1::2]):
                for x in range(s.w):
                    if a <= x + .5 < b: s.put(x, y, ch, only); hit = True
            if not hit and len(xs) >= 2:
                s.put((xs[0] + xs[1]) / 2, y, ch, only)     # 細すぎる形も1画素は残す

    def rect(s, x0, y0, x1, y1, ch, only=None):
        s.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], ch, only)

    def line(s, pts, ch, only=None):
        """1px の折れ線(茎、割れ目、縫い目など)。"""
        P = [(s.X(x), s.Y(y)) for x, y in pts]
        for (x0, y0), (x1, y1) in zip(P, P[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
            for i in range(n + 1):
                t = i / n; s.put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ch, only)

    def limb(s, pts, ch, wd=2, hoof=None):
        """関節を通る脚。走査線ごとに wd 画素の帯を置くので、斜めでもギザギザが乱れない。"""
        P = [(s.X(x), s.Y(y)) for x, y in pts]
        last = None
        for (x0, y0), (x1, y1) in zip(P, P[1:]):
            for yy in range(int(y0), int(round(y1))):
                t = (yy + .5 - y0) / (y1 - y0) if y1 != y0 else 0
                x = x0 + (x1 - x0) * max(0, min(1, t))
                for k in range(wd): s.put(int(x - wd / 2 + .5) + k, yy, ch)
                last = (int(x - wd / 2 + .5), yy)
        if last and hoof:
            for k in range(wd): s.put(last[0] + k, last[1], hoof)

    def _rim(s, before, ch, sep):
        """今描いた形が、前に描いた sep の記号に重なった縁を q にする(葉と葉の境目の影)。"""
        mine = {(x, y) for y in range(32) for x in range(s.w) if s.g[y][x] == ch and before[y][x] != ch}
        for x, y in mine:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, y + dy)
                if q not in mine and 0 <= q[0] < s.w and 0 <= q[1] < 32 and before[q[1]][q[0]] in sep:
                    s.g[y][x] = "q"; break

    def blob(s, cx, cy, rx, ry, ch, ang=0.0, sep=None):
        """楕円 + 重なりの境目の影(キャベツの葉、苔の塊など)。"""
        before = [r[:] for r in s.g]
        s.ell(cx, cy, rx, ry, ch, ang)
        if sep: s._rim(before, ch, sep)

    def leaf(s, base, ang, length, width, droop, ch, rib=None, sep=None, comb=False):
        """付け根から弧を描いて伸びる、先の尖った葉。droop で先を垂らす。
        comb=True で縁を櫛のように刻む(ヤシの葉)。rib で葉脈を通す。"""
        a = math.radians(ang)
        tip = (base[0] + math.sin(a) * length, base[1] - math.cos(a) * length + droop)
        ctrl = (base[0] + math.sin(a) * length * 0.55, base[1] - math.cos(a) * length * 0.8)
        n = max(10, int(length * 1.6 * s.kx)) if comb else 14
        L, R, M = [], [], []
        for i in range(n + 1):
            t = i / n
            p = bez(base, ctrl, tip, t); p2 = bez(base, ctrl, tip, min(1, t + .03))
            dx, dy = p2[0] - p[0], p2[1] - p[1]; d = math.hypot(dx, dy) or 1
            nx, ny = -dy / d, dx / d
            hw = width / 2 * (math.sin(math.pi * min(1, t * 1.1)) ** 0.7 if t < .88 else max(0, (1 - t) * 3))
            if comb: hw *= 1.0 if i % 2 else 0.35
            L.append((p[0] + nx * hw, p[1] + ny * hw)); R.append((p[0] - nx * hw, p[1] - ny * hw)); M.append(p)
        before = [r[:] for r in s.g]
        s.poly(L + R[::-1], ch)
        if sep: s._rim(before, ch, sep)
        if rib: s.line(M[2:-3], rib)
        return tip

    def rows(s):
        return ["".join(r) for r in s.g]
