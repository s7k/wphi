#!/usr/bin/env python3
"""キャラグラを横一列に並べた確認用の画像を作る。

    python3 lineup.py out.png [--large] [--scale 4] CHARA_DIR name[:row] ...

name は chara フォルダの BMP の名前(拡張子なし)か、BMP のパス。
row は 0=後ろ 1=右 2=正面 3=左(既定 2)。動物は 1、物は 2 で並べると比べやすい。
--large で 32x32 の版(列2)を並べる。既定は 16x32 の版(列0)。
"""
import os, sys
from PIL import Image

KEY = (0, 128, 128)


def main(argv):
    out = argv[0]; argv = argv[1:]
    large = "--large" in argv
    argv = [a for a in argv if a != "--large"]
    scale = 4
    if "--scale" in argv:
        i = argv.index("--scale"); scale = int(argv[i + 1]); del argv[i:i + 2]
    base, items = argv[0], argv[1:]
    cw = 32 if large else 16
    step = cw + 3
    img = Image.new("RGB", (len(items) * step + 5, 40), KEY)
    for i, it in enumerate(items):
        name, _, row = it.partition(":")
        path = name if name.endswith(".bmp") else os.path.join(base, name + ".bmp")
        r = int(row or 2)
        sx = 32 if large else 0
        cell = Image.open(path).convert("RGB").crop((sx, r * 32, sx + cw, r * 32 + 32))
        img.paste(cell, (4 + i * step, 4))
    img.resize((img.width * scale, img.height * scale), Image.NEAREST).save(out)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1:])
