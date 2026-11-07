# rust-philly

旧 Windows クライアント Philly を Tauri 2 で作り直すクライアント。
設計は [docs/01-design.md](docs/01-design.md)。

## 開発環境

Rust は mise で入れる。

```sh
mise install
cargo test
```

## 構成

| ディレクトリ | 内容 |
|---|---|
| `crates/phi-proto` | 行分割、cp932 変換、受信行の解析 |
| `tools/golden` | phi-client-web の Python パーサの出力を、`phi-proto` の比較テスト用に書き出す |
| `tools/png2phibmp` | phi-client-web の透過 PNG のキャラグラを Philly の BMP に戻す |
| `resources/phi` | 同梱グラフィックス。ライセンスは同フォルダの README |

## ライセンス

コードは MIT。
同梱グラフィックスのライセンスは [resources/phi/README.md](resources/phi/README.md) に従う。
