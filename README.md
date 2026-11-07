# WPHI

旧 Windows クライアント Philly を Tauri 2 で作り直した PHI のクライアント。
リポジトリ名は rust-philly のまま。
設計は [docs/01-design.md](docs/01-design.md)。

## 開発環境

Rust と Node は mise で入れる。
Linux では Tauri の前提パッケージ(`libwebkit2gtk-4.1-dev` など)も要る。

```sh
mise install
npm install
cargo test --workspace
npm test            # UI のテスト(キー操作の表)
npm run tauri dev   # アプリを起動する
```

GNOME(Wayland)と ibus の組み合わせでは、Wayland のままだと IME の変換候補がカーソルから離れた位置に出る。
この為 Linux では、`GDK_BACKEND` と `GTK_IM_MODULE` が未設定ならアプリが `x11` と `ibus` を選ぶ(`src-tauri/src/main.rs` の `prefer_x11_ime`)。
`GTK_IM_MODULE` は `XMODIFIERS` が ibus を指す時だけ設定する。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `crates/phi-proto` | 行分割、cp932 変換、受信行の解析、ログの HTML 化 |
| `src-tauri` | Tauri アプリ。レガシーサーバへの接続を持つ |
| `ui` | 窓の画面(React + TypeScript) |
| `tools/golden` | phi-client-web の Python パーサの出力を、`phi-proto` の比較テスト用に書き出す |
| `tools/png2phibmp` | phi-client-web の透過 PNG のキャラグラを Philly の BMP に戻す |
| `resources/phi` | 同梱グラフィックス。ライセンスは同フォルダの README |

## ライセンス

コードは MIT。
同梱グラフィックスのライセンスは [resources/phi/README.md](resources/phi/README.md) に従う。
