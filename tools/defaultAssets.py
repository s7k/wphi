# WPHI で描いた既定の絵を作る。Philly のスキン (Skins/Mine) を同梱しない為の置き換え。
#   ui/src/floorItems.png             床に落ちている物の絵。itemIcons.png の絵を 32x32 の枠に並べる
#   resources/phi/chara/wphi_sparkle.bmp 魔法の演出の既定のキャラグラ。teal のカラーキー
# 既定のマップチップは PCGL の物 (resources/phi/DefaultChip.bmp) を使うので、ここでは作らない
# 使い方: python3 tools/defaultAssets.py (リポジトリの直下で)
import random

from PIL import Image, ImageDraw

TEAL = (0, 128, 128)


def floor_items():
    """item_no (0-7) ごとに 32x32 の枠 1 つ。絵は 16x16 で、枠の下寄りの真ん中に置く"""
    icons = Image.open("ui/src/itemIcons.png").convert("RGBA")
    # item_no → itemIcons.png の番号 (BagPanel.tsx の並び)。
    # 0 は使わない (アイテムの印が無い) が、Philly の並びに合わせて金貨を置く
    order = [19, 1, 11, 16, 14, 17, 20, 18]
    out = Image.new("RGBA", (32 * len(order), 32))
    for i, n in enumerate(order):
        out.alpha_composite(icons.crop((n * 16, 0, n * 16 + 16, 16)), (i * 32 + 8, 12))
    out.save("ui/src/floorItems.png")


def sparkle():
    """96x160 (32x32 を 3 列 5 段)。どのコマも小さな光の粒を散らす"""
    img = Image.new("RGB", (96, 160), TEAL)
    d = ImageDraw.Draw(img)
    r = random.Random(3)
    for _ in range(140):
        x, y = r.randrange(96), r.randrange(160)
        c = r.choice([(255, 240, 120), (180, 220, 255), (255, 255, 255)])
        if r.random() < 0.3:
            d.point([(x, y - 1), (x - 1, y), (x + 1, y), (x, y + 1)], fill=c)
        d.point((x, y), fill=c)
    img.save("resources/phi/chara/wphi_sparkle.bmp")


if __name__ == "__main__":
    floor_items()
    sparkle()
