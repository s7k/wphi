"""Alnes の世界の採取の場と家畜のキャラグラ (96x160) を描く。

行 = 向き (後/右/前/左)、列 = [小0][小1][大0][大1] (小は 16x32、大は 32x32)。sushi_gra と同じ並び。
同梱の PCGL のキャラグラ (1 枚に 80〜100 色、左上からの光、毛や葉の細かい凹凸) に絵柄を合わせる為、
形を楕円体や円柱の立体として置き、面の向きと光で材質ごとの階調 (10 段前後) から色を選び、肌理の凹凸を足す。
縁取りは単色にせず、隣の色を暗くした色で描く。

採取の場は動かない (phi.ed で Root の装備を持たせる) ので、向きで絵を変えず、コマ 1 は風で揺らす。
羊だけは右と左で横向き、後と前で縦向きの絵にする。

    python3 tools/alnes_gra/gen.py PNG出力先 [BMP出力先]

BMP 出力先を渡すと、8bit パレットの BMP (透過色 teal) も書く。resources/phi/chara に置くと WPHI に同梱される。
"""
import math
import sys
import zlib

from PIL import Image

TEAL = (0, 128, 128)
LIGHT = (-0.55, -0.65, 0.52)   # 左上手前からの光
_l = math.sqrt(sum(v * v for v in LIGHT))
LIGHT = tuple(v / _l for v in LIGHT)


def ramp(dark, mid, light, n=12):
    """暗い色から明るい色への階調。中間を通る 2 本の線で作る"""
    out = []
    for i in range(n):
        t = i / (n - 1)
        a, b, u = (dark, mid, t * 2) if t < .5 else (mid, light, t * 2 - 1)
        out.append(tuple(round(a[k] + (b[k] - a[k]) * u) for k in range(3)))
    return out


MAT = {
    'wool': ramp((112, 104, 96), (222, 218, 204), (255, 255, 248)),
    'face': ramp((30, 24, 24), (82, 70, 66), (150, 136, 126)),
    'hoof': ramp((24, 20, 20), (64, 56, 52), (120, 110, 100)),
    'soil': ramp((52, 34, 20), (112, 80, 48), (168, 128, 84)),
    'stalk': ramp((70, 72, 24), (150, 144, 58), (214, 206, 120)),
    'grain': ramp((120, 72, 16), (222, 168, 58), (255, 236, 150)),
    'leaf': ramp((22, 60, 22), (70, 146, 58), (176, 226, 126)),
    'cabbage': ramp((40, 90, 40), (128, 192, 96), (222, 248, 190)),
    'carrot': ramp((120, 40, 8), (232, 118, 34), (255, 196, 120)),
    'straw': ramp((96, 58, 18), (206, 154, 66), (255, 226, 146)),
    'hole': ramp((14, 8, 6), (40, 24, 16), (70, 46, 30)),
    'rock': ramp((46, 44, 48), (118, 114, 112), (196, 192, 184)),
    'ore': ramp((96, 40, 10), (214, 120, 46), (255, 210, 140)),
    'gem': ramp((40, 70, 120), (110, 160, 220), (230, 246, 255)),
    'petal': ramp((170, 160, 150), (240, 236, 226), (255, 255, 255)),
    'bee': ramp((60, 40, 0), (240, 190, 30), (255, 240, 140)),
    'wood': ramp((44, 28, 16), (104, 70, 40), (170, 126, 80)),
}


def h(x, y, seed):
    """座標と種から 0〜1 の擬似乱数 (肌理の凹凸に使う)"""
    return (zlib.crc32(f'{x},{y},{seed}'.encode()) & 0xffff) / 0xffff


class Canvas:
    def __init__(self):
        self.c = {}   # (x, y) -> (色, z, 材質)

    def plot(self, x, y, z, mat, shade, bump=0.0, seed=0):
        if not (0 <= x < 32 and 0 <= y < 32):
            return
        if (x, y) in self.c and self.c[(x, y)][1] > z:
            return
        r = MAT[mat]
        s = shade + (h(x, y, seed) - .5) * bump
        i = max(0, min(len(r) - 1, round(s * (len(r) - 1))))
        self.c[(x, y)] = (r[i], z, mat)

    def ellipsoid(self, cx, cy, rx, ry, mat, z0=0, rz=None, bump=.18, seed=0, wave=0.0):
        """正面から見た楕円体。wave で毛の様な丸い凹凸を足す"""
        rz = rz or min(rx, ry)
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx, dy = (x + .5 - cx) / rx, (y + .5 - cy) / ry
                d = dx * dx + dy * dy
                if d > 1:
                    continue
                nz = math.sqrt(1 - d)
                if wave:
                    nz += wave * (math.sin(x * 2.1 + seed) * math.sin(y * 2.3 + seed * .7))
                n = (dx, dy, max(nz, .05))
                ln = math.sqrt(sum(v * v for v in n))
                lam = sum(a * b for a, b in zip(n, LIGHT)) / ln
                self.plot(x, y, z0 + nz * rz, mat, .18 + .82 * max(0, lam), bump, seed)

    def line(self, x0, y0, x1, y1, mat, z0=0, w=1, seed=0, tone=None):
        """円柱に見える線 (茎や脚)。左側を明るく、右側を暗くする"""
        steps = int(max(abs(x1 - x0), abs(y1 - y0), 1) * 3)
        for i in range(steps + 1):
            t = i / steps
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            for k in range(w):
                xx = int(x) + k
                side = (k + .5) / w
                s = tone if tone is not None else .85 - .55 * side
                self.plot(xx, int(y), z0 + 1 - side, mat, s, .12, seed)

    def image(self):
        img = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
        for (x, y), (col, z, m) in self.c.items():
            img.putpixel((x, y), col + (255,))
        # 奥と手前の境目に影を落とす (手前の物の縁の外側を暗くする)
        for (x, y), (col, z, m) in list(self.c.items()):
            for dx, dy in ((1, 0), (0, 1)):
                o = self.c.get((x - dx, y - dy))
                if o and o[1] > z + 2.5:
                    img.putpixel((x, y), tuple(round(v * .72) for v in col) + (255,))
        return selout(img)


def selout(img):
    """透明なマスに接する色を、隣の色を暗くした縁取りにする (黒一色にしない)"""
    src = img.copy()
    for y in range(32):
        for x in range(32):
            if src.getpixel((x, y))[3]:
                continue
            nb = [src.getpixel((x + dx, y + dy)) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                  if 0 <= x + dx < 32 and 0 <= y + dy < 32 and src.getpixel((x + dx, y + dy))[3]]
            if nb:
                r, g, b, _ = nb[0]
                img.putpixel((x, y), (round(r * .32 + 8), round(g * .28 + 6), round(b * .28 + 6), 255))
    return img


def ground(cv, mat='soil', w=11):
    cv.ellipsoid(16, 27.5, w, 3, mat, z0=-6, rz=2, bump=.35, seed=7)


def wheat(f):
    cv = Canvas()
    ground(cv)
    for i in range(7):
        x = 7 + i * 3 + (h(i, 0, 1) - .5) * 2
        top = 4 + h(i, 1, 1) * 6
        sway = (1 if i % 2 else -1) * f * .9
        z = 2 + (i % 3) * 2
        cv.line(x, 27, x + sway * .6, top + 8, 'stalk', z0=z, seed=i, tone=.55 + .3 * h(i, 2, 1))
        if i % 2:   # 茎の途中の葉
            cv.line(x, 22, x + 3, 17 + h(i, 3, 1) * 3, 'leaf', z0=z, seed=i, tone=.6)
        cv.ellipsoid(x + sway, top + 4, 1.4, 4.2, 'grain', z0=z + 1, rz=1.5, bump=.45, seed=i * 3, wave=.25)   # 穂
        for k in range(3):   # 芒 (のぎ)
            cv.plot(int(x + sway) - 1 + k, int(top) - 1 - (k == 1), z + 3, 'stalk', .95)
    return cv.image()


def cabbage(f):
    cv = Canvas()
    ground(cv)
    for i in range(7):   # 外葉を円く並べる
        a = math.pi * (.85 + i * .22)
        cv.ellipsoid(16 + math.cos(a) * 8, 21 + math.sin(a) * 3.5 + 2, 4.2, 3.4, 'leaf', z0=i * .3, bump=.3, seed=i, wave=.1)
    cv.ellipsoid(16, 18 - f * .5, 7.5, 6.5, 'cabbage', z0=4, bump=.2, seed=11, wave=.1)
    for i in range(4):   # 結球を包む葉の重なり
        a = math.pi * (1.1 + i * .3)
        cv.ellipsoid(16 + math.cos(a) * 3.5, 17 + math.sin(a) * 2.5 - f * .5, 4.2, 3.6, 'cabbage', z0=7 + i * .4, bump=.18, seed=20 + i)
    cv.ellipsoid(15, 15 - f * .5, 3, 2.6, 'cabbage', z0=11, bump=.12, seed=30)
    return cv.image()


def carrot(f):
    cv = Canvas()
    ground(cv, w=12)
    for j, cx in enumerate((10.5, 21.5)):
        cv.ellipsoid(cx, 24.5, 3.2, 2.4, 'carrot', z0=0, bump=.2, seed=j)
        for i in range(5):
            a = (i - 2) * .38 + (f * .12 if i % 2 else -f * .12)
            ln = 8 + h(i, j, 3) * 5
            x1, y1 = cx + math.sin(a) * ln * .6, 23 - math.cos(a) * ln
            cv.line(cx, 23, x1, y1, 'leaf', z0=3 + i * .2, seed=i, tone=.5)
            for k in range(4):   # 細かく割れた葉を、茎の左右に互い違いに付ける
                t = .35 + k * .17
                px, py = cx + (x1 - cx) * t, 23 + (y1 - 23) * t
                side = 1.1 if k % 2 else -1.1
                cv.ellipsoid(px + side, py - .4, .9, 1.1, 'leaf', z0=4 + i * .2, rz=1, bump=.35, seed=i * 7 + k)
            cv.ellipsoid(x1, y1, .9, 1.2, 'leaf', z0=5, rz=1, bump=.3, seed=i + 40)
    return cv.image()


def herb(f):
    cv = Canvas()
    ground(cv, w=10)
    for i in range(9):
        a = (i - 4) * .33 + (f * .12 if i % 2 else -f * .12)
        ln = 10 + h(i, 0, 5) * 6
        x1, y1 = 16 + math.sin(a) * ln * .7, 26 - math.cos(a) * ln
        cv.line(16, 26, x1, y1, 'leaf', z0=1 + i % 3, seed=i)
        cv.ellipsoid(x1, y1 + 1, 1.8, 2.6, 'leaf', z0=3 + i % 3, bump=.3, seed=i)
        mx, my = (16 + x1) / 2, (26 + y1) / 2
        cv.ellipsoid(mx + (1.5 if a > 0 else -1.5), my, 1.6, 1.1, 'leaf', z0=2, rz=1, bump=.3, seed=i + 20)
    for k, (x, y) in enumerate(((11, 11), (21, 10), (16, 7))):   # 白い小花
        cv.ellipsoid(x + f * .6, y, 1.3, 1.1, 'petal', z0=9, rz=1, bump=.1, seed=k)
        cv.plot(x, y, 10, 'grain', .8)
    return cv.image()


def beehive(f):
    cv = Canvas()
    cv.line(13, 23, 13, 30, 'wood', z0=0, w=2)
    cv.line(18, 23, 18, 30, 'wood', z0=0, w=2)
    cv.ellipsoid(16, 24, 8, 2, 'wood', z0=1, rz=1, bump=.3, seed=3)   # 台
    for i, (y, rx) in enumerate(((8.5, 4.2), (11.5, 6.6), (14.8, 8.2), (18.2, 8.8), (21.2, 8.2))):
        cv.ellipsoid(16, y, rx, 2.2, 'straw', z0=2 + i * .5, rz=3, bump=.4, seed=i)   # 藁を巻いた段
    cv.ellipsoid(16, 6.5, 2.4, 1.6, 'straw', z0=3, rz=1, bump=.3, seed=9)
    cv.ellipsoid(16, 19.5, 2.2, 1.6, 'hole', z0=9, rz=1, bump=.1)   # 入口
    for i in range(4):   # 蜂
        x = 5 + i * 7.5 + (2 if (i + f) % 2 else -1)
        y = 5 + (i * 5) % 11 + f
        cv.ellipsoid(x, y, 1.2, .9, 'bee', z0=20, rz=1, bump=.1, seed=i)
        cv.plot(int(x), int(y - 1), 21, 'petal', .9)
    return cv.image()


def ore(f):
    cv = Canvas()
    ground(cv, 'rock', 12)
    cv.ellipsoid(16, 20, 12, 9, 'rock', z0=0, bump=.32, seed=1, wave=.08)
    cv.ellipsoid(12, 15, 7, 6, 'rock', z0=3, bump=.3, seed=2)
    cv.ellipsoid(21, 17, 5, 4.5, 'rock', z0=2, bump=.3, seed=3)
    for i, (x, y) in enumerate(((9, 18), (17, 13), (22, 21), (14, 24), (12, 12))):   # 鉱石の粒
        cv.ellipsoid(x, y, 1.6, 1.3, 'ore' if i % 2 == 0 else 'gem', z0=12, rz=1.5, bump=.15, seed=i)
    sx, sy = ((18, 12), (10, 17))[f]   # きらめき
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        cv.plot(sx + dx, sy + dy, 30, 'petal', 1.0)
    return cv.image()


def sheep(f, side):
    cv = Canvas()
    bob = f * .6
    if side:
        for x in (10, 13.5, 18.5, 21.5):   # 脚
            cv.line(x, 22, x, 29, 'hoof', z0=0, w=2)
        cv.ellipsoid(15, 18 - bob, 10, 7, 'wool', z0=4, bump=.22, seed=1, wave=.18)
        cv.ellipsoid(24.5, 14.5 - bob, 3.6, 3.4, 'face', z0=9, bump=.12, seed=2)
        cv.ellipsoid(22.5, 12 - bob, 2.2, 1.1, 'face', z0=8, rz=1, bump=.1, seed=3)
        cv.ellipsoid(21.5, 13 - bob, 2.5, 3, 'wool', z0=8, bump=.2, seed=4, wave=.2)   # 頭の毛
        cv.plot(26, 14 - round(bob), 13, 'petal', .9)
    else:
        for x in (12, 18.5):
            cv.line(x, 23, x, 29, 'hoof', z0=0, w=2)
        cv.ellipsoid(16, 19 - bob, 9, 8, 'wool', z0=4, bump=.22, seed=1, wave=.18)
        cv.ellipsoid(16, 14.5 - bob, 3.8, 4, 'face', z0=11, bump=.12, seed=2)
        cv.ellipsoid(10.5, 12.5 - bob, 2.4, 1.2, 'face', z0=9, rz=1, seed=3)
        cv.ellipsoid(21.5, 12.5 - bob, 2.4, 1.2, 'face', z0=9, rz=1, seed=4)
        cv.ellipsoid(16, 10.5 - bob, 3.4, 2, 'wool', z0=12, bump=.2, seed=5, wave=.2)
        for x in (14, 18):
            cv.plot(x, 14 - round(bob), 16, 'petal', .9)
    return cv.image()


DRAW = {'wheat': wheat, 'cabbage': cabbage, 'carrot': carrot, 'herb': herb, 'beehive': beehive, 'ore': ore}


def tile(name, f, row):
    img = sheep(f, row in (1, 3)) if name == 'sheep' else DRAW[name](f)
    return img.transpose(Image.FLIP_LEFT_RIGHT) if row == 3 else img


def sprite(name):
    img = Image.new('RGBA', (96, 160), (0, 0, 0, 0))
    for row in range(4):
        for f in range(2):
            big = tile(name, f, row)
            img.alpha_composite(big, (32 + f * 32, row * 32))
            small = big.resize((16, 32), Image.BOX)
            a = small.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
            small.putalpha(a)
            img.alpha_composite(small, (f * 16, row * 32))
    return img


def to_bmp(img):
    """透過部分を teal で埋め、8bit パレットにする (256 色を超えたら減色する)"""
    bg = Image.new('RGBA', img.size, TEAL + (255,))
    bg.alpha_composite(img)
    rgb = bg.convert('RGB')
    colors = rgb.getcolors(65536)
    n = min(len(colors), 256)
    pal = rgb.quantize(colors=n, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    p = pal.getpalette()[:3 * n]
    pal.putpalette(p + [0] * (768 - len(p)))
    return pal


if __name__ == '__main__':
    out, out_bmp = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
    for name in list(DRAW) + ['sheep']:
        img = sprite(name)
        img.save(f'{out}/alnes_{name}.png')
        if out_bmp:
            to_bmp(img).save(f'{out_bmp}/alnes_{name}.bmp')
