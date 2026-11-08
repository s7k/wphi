# 同梱グラフィックス

Philly フォルダを持たない利用者の為に、アプリへ同梱する画像。
実行ファイルに埋め込み(`src-tauri/src/assets.rs` の BUNDLED)、配布物には並べない。PCGL の全文とこのファイルだけは、配布物の `licenses` に入れる。
フォルダ構成は Philly と同じにしてあり、利用者の Philly フォルダに画像が無い時にここを探す。

## 出所とライセンス

| パス | 出所 | ライセンス |
|---|---|---|
| `chara/*.bmp`(`sushi_*.bmp` を除く) | phi-client-web の `assets/chara/*.png` を `tools/png2phibmp` で teal カラーキーの BMP に戻したもの | PCGL(Phi Charactor Graphics License)。全文は `PCGL.txt`(原本、cp932)と `PCGL.utf8.txt`(UTF-8 に変換した閲覧用) |
| `chara/sushi_*.bmp` | phi-client-web の `tools/sushi_gra/gen.py` で描き起こした絵 | MIT。PCGL の対象外 |
| `Config/MasterMagicMenu.xml` | Philly(PhillySrc)の `Config/MasterMagicMenu.xml` をそのまま複写(超魔法メニュー。#83) | Philly のパーツ。同梱してよい事をリポジトリ管理者が確認済み(2026-11-09) |
| `Skins/Mine/` | Philly(PhillySrc)の既定スキンを複写。LANU 系のキャラグラ5つと使わなくなった w_j_rakshasa.bmp は消し、`chara/Index.txt` の既定グラを PCGL のキャラグラ(`chara/`)に付け替えた | Philly のパーツ。再利用してよい事をリポジトリ管理者が確認済み(2026-11-07) |

`chara/` の画像は PCGL のグラフィックスパーツで、PCGL c項に従い、同梱するグラフィックスが PCGL 下にある事をここに明記する。
`sushi_*.bmp` は同じフォルダにあるが、PCGL b項の「適用範囲の明示」により PCGL の対象から外す。

## 作り直し方

```sh
cargo run --release -p png2phibmp -- ~/workspace/phi-client-web/assets/chara resources/phi/chara
```
