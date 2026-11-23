# 同梱グラフィックス

Philly フォルダを持たない利用者の為に、アプリへ同梱する画像。
実行ファイルに埋め込み(`src-tauri/src/assets.rs` の BUNDLED)、配布物には並べない。PCGL の全文とこのファイルだけは、配布物の `licenses` に入れる。
フォルダ構成は Philly と同じにしてあり、利用者の Philly フォルダに画像が無い時にここを探す。

## 出所とライセンス

| パス | 出所 | ライセンス |
|---|---|---|
| `chara/*.bmp`(`sushi_*`・`alnes_*`・`wphi_*` を除く) | phi-client-web の `assets/chara/*.png` を `tools/png2phibmp` で teal カラーキーの BMP に戻したもの | PCGL(Phi Charactor Graphics License)。全文は `PCGL.txt`(原本、cp932)と `PCGL.utf8.txt`(UTF-8 に変換した閲覧用) |
| `chara/sushi_*.bmp` | phi-client-web の `tools/sushi_gra/gen.py` で描き起こした絵 | MIT。PCGL の対象外 |
| `chara/alnes_*.bmp` | このリポジトリで描き起こした絵 (Alnes の世界の採取の場、羊、依頼の掲示板、台座の聖剣、駱駝、蠍) | MIT。PCGL の対象外 |
| `chara/wphi_sparkle.bmp` | WPHI で描いた絵 (魔法の演出の既定グラ。`tools/defaultAssets.py`) | MIT。PCGL の対象外 |
| `ui/src/pcglItems.png` (このフォルダの外) | phi-client-web の `assets/items/items.png` をそのまま複写。床に落ちている物の絵 | PCGL |
| `DefaultChip.bmp` | phi-client-web の `assets/chip/default.png` (汎用のマップチップ) を、左半分が絵・右半分がマスクの BMP に戻したもの。世界のマップチップが無い時に使う | PCGL |
| `wphi/log.css` | WPHI で書いたログのスタイルシート | MIT |
| `Config/unew.ini`、`Config/worlds.ini` | キャラグラとマップチップの取得元の一覧と、世界の一覧。Master NEO から頂いた物 | Master NEO から提供を受けた (2026-11-23 に作者が確認) |

Philly (PhillySrc) のパーツ (既定のスキン `Skins/Mine/` と超魔法メニューの `Config/MasterMagicMenu.xml`) は同梱しない。
利用者の Philly フォルダにあれば、スキンのマウスカーソルはそちらを読む。超魔法メニューは WPHI で起こした項目を出す (ui/src/masterMagic.ts)。

`chara/` と `DefaultChip.bmp` の画像は PCGL のグラフィックスパーツで、PCGL c項に従い、同梱するグラフィックスが PCGL 下にある事をここに明記する。
`sushi_*.bmp`、`alnes_*.bmp`、`wphi_*.bmp` は同じフォルダにあるが、PCGL b項の「適用範囲の明示」により PCGL の対象から外す。

## 作り直し方

```sh
cargo run --release -p png2phibmp -- ~/workspace/phi-client-web/assets/chara resources/phi/chara
```
