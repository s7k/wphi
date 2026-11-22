# WPHI で描いた既定の絵を作る。Philly のスキン (Skins/Mine) を同梱しない為の置き換え。
#   resources/phi/chara/wphi_sparkle.bmp 魔法の演出の既定のキャラグラ。teal のカラーキー
# 既定のマップチップと床の物の絵は PCGL の物 (resources/phi/DefaultChip.bmp、ui/src/pcglItems.png) を使うので、ここでは作らない
# 使い方: python3 tools/defaultAssets.py (リポジトリの直下で)
import random

from PIL import Image, ImageDraw

TEAL = (0, 128, 128)


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
    sparkle()
