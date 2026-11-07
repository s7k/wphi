# GPUI への移行の検討

issue #45 の調査の結果。
2026-11-08 時点で公開されている情報と、このリポジトリのコードを読んで書いた。
推測は推測と書いてある。

## 結論

Tauri のまま続け、GPUI へは移らない。

issue の前提(ラグの原因は WebView の互換の問題)は確かめていない。
一方で、押しっぱなし移動の詰まりに関わる処理(JS のタイマーと窓をまたぐ転送)は、Tauri のままでも Rust 側へ移せる。
GPUI は、配布の主な対象である Windows で、今の WebView2 より不確かな所が多い。

- crates.io の `gpui` は 0.2.2(2025-10-22)で止まっていて、Zed の main は破壊的な変更を続けている。README も「pre-1.0 で、版の間で破壊的変更がよくある」としている
- Windows への対応は 2025-10 からで、日本語 IME の未解決の issue が 2026 年にも残っている
- ログの選択とコピー、タグ付きのログの描画を自作する事になる

## GPUI の現状

- ライセンスは Apache-2.0(0.1.0 は MIT)
- Zed の main は `gpui_platform`、`gpui_windows`、`gpui_linux`、`gpui_wgpu`、`gpui_macos` などに分かれている
- Windows は DirectX 11 と DirectWrite で描く。Zed の Windows 版の安定版は 2025-10-15
- Zed 以外の目立つ利用例は Longbridge Pro(株取引のアプリ)。同じ会社の gpui-component(0.9.0)に仮想リスト、Markdown・HTML の描画、wry の WebView の要素がある
- ドキュメントは README と examples が中心

crates.io 版と main 版の差は1年分あり、外部の利用者は git 依存で追うことになる(推測)。

出典: [crates.io](https://crates.io/api/v1/crates/gpui)、[gpui の README](https://github.com/zed-industries/zed/tree/main/crates/gpui)、[Zed for Windows is here](https://zed.dev/blog/zed-for-windows-is-here)、[gpui-component](https://github.com/longbridge/gpui-component)

## GPUI の日本語 IME

Zed の issue で見つかった物。

| OS | 直った物 | 2026 年に残っている物 |
|---|---|---|
| Windows | MS-IME・ATOK・Google 日本語入力の切り替えと未確定文字の表示(#40321 #40592 #40638 #42201 #39362) | TSF の `GetTextExt` が未確定文字の範囲にキャレットと同じ矩形を返す(#59636)、候補窓が未確定文字に重なる(#64850) |
| Linux | fcitx5-mozc の確定の Enter が改行になる(#35537)、Wayland で fcitx5 が効かない(#37235) | X11 で `XIMClientError` の後に IME が戻らない(#60578) |
| macOS | | Google 日本語入力で入力中に落ちる(#64687) |

gpui 付属の入力欄の例は、未確定文字の選択位置がずれ、コピーで panic する(#64389)。
WPHI の入力欄はこの例か gpui-component の Input を元に作る事になり、未解決の不具合を自分で踏む可能性が高い(推測)。
今の WebKitGTK の回避策と同じ種類の手間が、別の所で出る。

出典: [Zed の issue](https://github.com/zed-industries/zed/issues?q=IME+Japanese)

## GPUI のログ・画像・窓

- `StyledText` は範囲ごとに色とフォントを変えられ、`InteractiveText` は範囲ごとのクリックを扱える
- `list` と `uniform_list` は見えている範囲だけを描く
- 静的なテキストの選択とコピーは無い
- `ImageFormat` は BMP に対応している。複数の窓は `App::open_window` で開く

今のログは tag_to_html の HTML を innerHTML に入れている。
GPUI ではタグを解析して要素の木にする処理と、選択とコピーを自作する事になる(推測)。

## 他の候補

| 候補 | IME | リッチテキスト | 成熟度 |
|---|---|---|---|
| Tauri 2 | WebView に任せる。WebView2 は Chrome と同じ | HTML がそのまま使え、選択とコピーも付く | 高い |
| egui/eframe 0.37 | winit 経由。日本語で未解決が複数(fcitx5 #2529、X11 #7975、#8813) | LayoutJob で色とフォント。HTML 相当は自作 | 1.0 前 |
| iced 0.14 | Windows の日本語の変換窓の不具合が未解決(#3189) | 弱い | 1.0 前 |
| Slint 1.18 | winit 経由。日本語の事例が少ない | 弱い | 1.x。ライセンスはロイヤリティフリー・GPLv3・商用から選ぶ |
| Dioxus 0.7 | デスクトップ版は wry(WebView)で動く | HTML | 1.0 前 |

Dioxus に移っても、Chrome と WebKit の違いの懸念は残る。

## WebView2 と WebKitGTK の違い

- WebKitGTK は NVIDIA で DMABUF のレンダラーとドライバの組み合わせが不具合を起こし、canvas が遅い経路に落ちる事がある([Tauri の説明](https://v2.tauri.app/develop/debug/linux-graphics/))
- WebView2 は裏の窓のタイマーを間引く。Tauri の `backgroundThrottling` は Windows では効かない
- IME の確定の Enter の扱いが違う(`ui/src/App.tsx` の keyCode 229 の判定)

## 押しっぱなし移動の詰まりの候補

押しっぱなし移動は、map 窓のキーを Tauri のイベントで main 窓へ送り、main 窓の JS の `setInterval(…, 50)` から `send_line` を呼んでいる(`ui/src/moveRepeat.ts`)。
map 窓にフォーカスがある間、main 窓は裏の窓になる。
WebView2 が main 窓のタイマーを間引くと、移動の間隔が延びる(推測。未検証)。

v0.1.6 で、WebView2 の起動オプションに `--disable-background-timer-throttling`、`--disable-renderer-backgrounding`、`--disable-backgrounding-occluded-windows` を足した(`src-tauri/tauri.conf.json` の `additionalBrowserArgs`)。
これで直らなければ、次を試す。

1. main 窓の tick と `send_line` の時刻をログに出し、map 窓と main 窓のどちらにフォーカスがある時に間隔が延びるかを比べる。v0.1.8 で、ツールのメニューの「時刻の記録を始める・止める」から記録出来るようにした(`src-tauri/src/trace.rs`)
2. 押しっぱなし移動のリピートを Rust 側(tokio)へ移し、map 窓から keydown・keyup を直接 Rust へ送る

## 移す場合に作り直す物

`ui/src` の全部(約4600行)を作り直す。

- タグ付きのログを要素にする処理、仮想リスト、選択とコピー
- IME に対応した入力欄
- 看板エディタ、リスト、設定、ステータスなどの画面
- map の描画、メニュー、スキンのカーソル、窓の位置の記憶

流用出来るのは `crates/phi-proto` と、`src-tauri` のセッションの層の大半。
GPUI に不慣れな1人で2〜4か月と見積もった(推測)。
移した後も、IME と GPUI の API の変更に追う手間が続く。
