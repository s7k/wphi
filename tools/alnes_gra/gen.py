"""Alnes の世界の採取の場と家畜のキャラグラ (96x160) を描く。

行 = 向き (後/右/前/左)、列 = [小0][小1][大0][大1] (小は 16x32、大は 32x32)。sushi_gra と同じ並び。
採取の場は動かない (phi.ed で Root の装備を持たせる) ので、向きで絵を変えず、コマ 1 は風で 1px 揺らす。
羊だけは右と左で横向き、後と前で縦向きの絵にする。

    python3 tools/alnes_gra/gen.py PNG出力先 [BMP出力先]

BMP 出力先を渡すと、8bit パレットの BMP (透過色 teal) も書く。resources/phi/chara に置くと WPHI に同梱される。
"""
import random
import sys
import zlib

from PIL import Image

TEAL = (0, 128, 128)
OL = (40, 30, 24)


def blank():
    return Image.new('RGBA', (32, 32), (0, 0, 0, 0))


def px(img, x, y, c):
    if 0 <= x < 32 and 0 <= y < 32:
        img.putpixel((x, y), c + (255,))


def ell(img, cx, cy, rx, ry, c, shade=None):
    """楕円を塗る。shade を渡すと右下を暗くする"""
    for y in range(32):
        for x in range(32):
            dx, dy = (x + .5 - cx) / rx, (y + .5 - cy) / ry
            if dx * dx + dy * dy <= 1:
                px(img, x, y, shade if shade and dx + dy > .7 else c)


def rect(img, x0, y0, x1, y1, c):
    for y in range(y0, y1):
        for x in range(x0, x1):
            px(img, x, y, c)


def outline(img):
    src = img.copy()
    for y in range(32):
        for x in range(32):
            if src.getpixel((x, y))[3] == 0 and any(
                    0 <= x + dx < 32 and 0 <= y + dy < 32 and src.getpixel((x + dx, y + dy))[3]
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px(img, x, y, OL)
    return img


def ground(img, c=(110, 84, 52)):
    """足元の土"""
    ell(img, 16, 28, 12, 3, c)


def wheat(f, rnd):
    img = blank()
    ground(img, (120, 96, 56))
    for i, x in enumerate(range(7, 26, 3)):
        sway = f if i % 2 else -f
        top = 7 + rnd.randint(0, 3)
        for y in range(top + 6, 28):
            px(img, x + (sway if y < 16 else 0), y, (150, 150, 60))
        for y in range(top, top + 7):   # 穂
            px(img, x + sway, y, (236, 196, 74))
            px(img, x + sway + (1 if y % 2 else -1), y, (214, 168, 52))
        px(img, x + sway, top - 1, (250, 226, 130))
    return outline(img)


def cabbage(f, rnd):
    img = blank()
    ground(img)
    ell(img, 16, 20, 10, 8, (96, 168, 72), (60, 124, 48))
    ell(img, 16, 19 - f, 7, 6, (150, 210, 110), (110, 180, 80))
    ell(img, 15, 18 - f, 3, 3, (200, 236, 160))
    for x in (8, 24):
        for y in range(16, 22):
            px(img, x, y, (70, 140, 52))
    return outline(img)


def carrot(f, rnd):
    img = blank()
    ground(img, (128, 92, 56))
    for cx in (10, 21):
        ell(img, cx, 25, 3, 3, (240, 128, 40), (200, 90, 24))
        for i in range(5):
            dx = (i - 2) * 2 + (f if i % 2 else 0)
            for y in range(12 + abs(i - 2) * 2, 23):
                px(img, cx + dx // 2, y, (70, 160, 60))
    return outline(img)


def herb(f, rnd):
    img = blank()
    ground(img, (96, 80, 50))
    for i in range(7):
        a = (i - 3) * 3 + (f if i % 2 else -f)
        top = 9 + abs(i - 3) * 2
        for y in range(top, 27):
            px(img, 16 + a * (27 - y) // 18, y, (60, 150, 70))
        ell(img, 16 + a * (27 - top) // 18, top + 1, 2, 3, (110, 200, 110), (60, 140, 70))
    for x, y in ((12, 13), (21, 12), (16, 9)):   # 白い花
        px(img, x + f, y, (250, 250, 240))
        px(img, x + f + 1, y, (240, 220, 120))
    return outline(img)


def beehive(f, rnd):
    img = blank()
    rect(img, 13, 22, 19, 29, (110, 80, 48))   # 台
    for i, (y, rx) in enumerate(((10, 6), (14, 8), (18, 9), (22, 8))):
        ell(img, 16, y, rx, 3, (230, 184, 90) if i % 2 == 0 else (206, 156, 70), (176, 124, 50))
    ell(img, 16, 20, 2, 2, (60, 40, 30))   # 入口
    for i in range(3):   # 蜂
        x = 6 + i * 10 + (f * 2 if i % 2 else -f * 2)
        y = 6 + (i * 7) % 9
        px(img, x, y, (250, 210, 40))
        px(img, x + 1, y, (40, 30, 20))
        px(img, x, y - 1, (230, 240, 255))
    return outline(img)


def ore(f, rnd):
    img = blank()
    ell(img, 16, 21, 12, 9, (120, 116, 112), (84, 80, 78))
    ell(img, 13, 17, 6, 5, (150, 146, 140), (110, 106, 102))
    for x, y in ((10, 19), (18, 15), (21, 23), (14, 25)):   # 鉱石
        c = (220, 140, 60) if (x + y) % 2 else (180, 190, 210)
        px(img, x, y, c)
        px(img, x + 1, y, c)
        px(img, x, y + 1, c)
    sx, sy = ((19, 14), (11, 20))[f]   # きらめき
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        px(img, sx + dx, sy + dy, (255, 255, 230))
    return outline(img)


def sheep(f, rnd, side):
    img = blank()
    bob = f
    if side:
        ell(img, 15, 18 - bob, 10, 7, (244, 242, 232), (214, 210, 198))   # 胴の毛
        for cx in (10, 13, 18, 21):
            for y in range(23, 29):
                px(img, cx, y, (70, 60, 56))
        ell(img, 25, 15 - bob, 4, 4, (90, 80, 76))   # 顔
        px(img, 26, 14 - bob, (250, 250, 250))
        ell(img, 22, 12 - bob, 2, 1, (70, 60, 56))   # 耳
        for x, y in ((9, 15), (13, 13), (18, 14), (12, 20)):
            px(img, x, y - bob, (255, 255, 255))
    else:
        ell(img, 16, 19 - bob, 9, 8, (244, 242, 232), (214, 210, 198))
        for cx in (12, 20):
            for y in range(25, 29):
                px(img, cx, y, (70, 60, 56))
        ell(img, 16, 15 - bob, 4, 4, (90, 80, 76))
        for x in (14, 18):
            px(img, x, 14 - bob, (250, 250, 250))
        ell(img, 10, 12 - bob, 2, 1, (70, 60, 56))
        ell(img, 22, 12 - bob, 2, 1, (70, 60, 56))
    return outline(img)


DRAW = {'wheat': wheat, 'cabbage': cabbage, 'carrot': carrot, 'herb': herb, 'beehive': beehive, 'ore': ore}


def tile(name, f, row):
    rnd = random.Random(zlib.crc32(name.encode()))   # 種を固定して、何度描いても同じ絵にする
    if name == 'sheep':
        img = sheep(f, rnd, row in (1, 3))
    else:
        img = DRAW[name](f, rnd)
    return img.transpose(Image.FLIP_LEFT_RIGHT) if row == 3 else img


def sprite(name):
    img = Image.new('RGBA', (96, 160), (0, 0, 0, 0))
    for row in range(4):
        for f in range(2):
            big = tile(name, f, row)
            img.alpha_composite(big, (32 + f * 32, row * 32))
            small = big.resize((16, 32), Image.NEAREST)
            img.alpha_composite(small, (f * 16, row * 32))
    return img


def to_bmp(img):
    """透過部分を teal で埋め、8bit パレットにする"""
    bg = Image.new('RGBA', img.size, TEAL + (255,))
    bg.alpha_composite(img)
    rgb = bg.convert('RGB')
    colors = rgb.getcolors(256)
    assert colors is not None, '256 色を超えた'
    pal = rgb.quantize(colors=len(colors), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    p = pal.getpalette()[:3 * len(colors)]
    pal.putpalette(p + [0] * (768 - len(p)))
    return pal


if __name__ == '__main__':
    out, out_bmp = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
    for name in list(DRAW) + ['sheep']:
        img = sprite(name)
        img.save(f'{out}/alnes_{name}.png')
        if out_bmp:
            to_bmp(img).save(f'{out_bmp}/alnes_{name}.bmp')
