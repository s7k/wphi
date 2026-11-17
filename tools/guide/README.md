# 利用者ガイドの画像

https://s7k.github.io/wphi/guide/ の画像を撮る道具。
Tauri の代わりに架空の返事を返して、WPHI の main 窓をヘッドレスの Chrome で動かす。

- `src-tauri/examples/guide_server.rs`: 架空のサーバの行を phi-proto のパーサに通したイベントと、同梱の画像を返す
- `shot.tsx`: Tauri のコマンドとイベントを差し替えて App を出すページ
- `shoot.mjs`: 接続から看板・検索・設定までを順に操作して撮る

名前・発言・世界は全部架空の物にしてある。
画像は同梱の分(`resources/phi`)だけを使う。出所を確かめていない絵をガイドに載せない為。

## 撮り直し方

```sh
cargo run --example guide_server --manifest-path src-tauri/Cargo.toml &
npx vite --config tools/guide/vite.config.ts &
node tools/guide/shoot.mjs ../s7k.github.io/wphi/guide/images
```

モダンの画面(modern.png)は、地図を大きく返す guide_server で別に撮る。

```sh
GUIDE_VIEW="33 25" cargo run --example guide_server --manifest-path src-tauri/Cargo.toml &
npx vite --config tools/guide/vite.config.ts &
node tools/guide/shoot.mjs ../s7k.github.io/wphi/guide/images modern
```

Chrome は `~/.cache/puppeteer` の chrome-headless-shell 131 を使う。
別の Chrome を使う時は、環境変数 `CHROME` に実行ファイルを指定する。
