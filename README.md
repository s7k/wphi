# WPHI

PHI のクライアント。
Windows 用だった Philly を作り直し、Windows・macOS・Linux で動くようにした。
Philly のキー操作、メニュー、スキン、キャラグラをそのまま使える。

## ダウンロード

[Releases](https://github.com/s7k/wphi/releases) の最新の版から、OS に合ったファイルを取る。

| OS | ファイル | 使い方 |
|---|---|---|
| Windows | `WPHI-<版>-windows.zip` | 展開して `WPHI.exe` を起動する |
| Windows | `WPHI_<版>_x64-setup.exe` | インストーラ |
| macOS | `WPHI-<版>-macos.zip`、`WPHI_<版>_universal.dmg` | Intel と Apple Silicon の両方で動く |
| Linux | `WPHI-<版>-linux.zip`(AppImage)、`WPHI_<版>_amd64.deb` | |

どれも署名していない。
Windows では初めて開く時に SmartScreen が警告を出すので、「詳細情報」から「実行」を選ぶ。
macOS では、`.app` の隔離属性を `xattr -dr com.apple.quarantine WPHI.app` で外してから開く。
Linux の AppImage は FUSE(Ubuntu では `libfuse2`)が要る。無い時は `APPIMAGE_EXTRACT_AND_RUN=1` を付けて起動する。

新しい版が出ると、起動した時に知らせる。
自動では入れ替えないので、知らせに従って新しい版を取り直す。

## 始め方

起動すると、キャラを選ぶ画面になる。

- Philly を使っていたなら、「Philly から取り込む」で Philly のフォルダを指定する。登録したキャラと設定(`Config/Philly.ini`)を取り込み、Philly のキャラグラとマップチップも使う
- 新しく始めるなら、「新規キャラ作成」で名前・パスワード・初期グラを決めて作る
- キャラ ID が分かっていれば、「キャラを登録」で表示名・ID・接続先を入れる

キャラを選ぶと接続し、タブが1つ開く。
キャラごとにタブを開いて、同時に何人でも遊べる。

## 操作

キー操作は Philly と同じ。
主な物を挙げる。全部の表は [docs/04-client-spec.md](docs/04-client-spec.md) の「キー操作」にある。

| キー | 動作 |
|---|---|
| テンキー・矢印(フルキー移動なら U I O J K L M 7 8 9) | 移動 |
| Esc | 入力欄からログ欄へ移り、キーを操作に使う |
| Tab | 入力欄へ |
| Z・X・C | 拾う・置く・使う |
| Space | 攻撃(hit) |
| Alt+W、Alt+E など | 系統魔法(Wizard eye、Eagle eye など) |
| Shift+F5 | 地図の窓を出す・隠す |
| T・Shift+T | 回転の地図・北固定の地図 |
| Ctrl+Tab | 次のタブ |

メニューは Philly と同じ並びで、macOS では窓の中にも出す。
マスターのキャラには超魔法のメニューも出る。

## Philly に無い機能

- 拡張マップ: 通った所の地形を覚えて、地図の外に重ねて出す(朱蓮の系統の世界)
- 位置の予想: 地図が届かない時も、進んだとみなして地図をずらす(拡張マップの付属)
- 地図の拡大率: 設定で % を指定する
- 窓の位置と大きさを覚える。ログの窓を最小化すると、地図の窓も一緒に最小化する

## 設定とデータの置き場

| OS | 設定フォルダ |
|---|---|
| Windows | `%APPDATA%\dev.wphi` |
| macOS・Linux | `~/.config/wphi` |

設定フォルダには、設定(`settings.json`)、登録したキャラ(`characters.json`)、キャラごとの `<表示名>.chara/.phirc` を置く。
`.phirc` は Philly と同じ形で、1行目がキャラ ID になる。ID は平文なので、設定フォルダを他人に渡さない。
メニューの「ツール」→「設定フォルダを開く」で開ける。

キャラグラとマップチップは、取り込んだ Philly フォルダ、アプリを置いたフォルダの `chara`・`chip`、設定フォルダの `data`、同梱の分の順に探す。
「ツール」→「キャラグラとマップチップを取得する...」で、Raphi の更新ツールと同じ配布元(`resources/phi/Config/unew.ini`)から取得して `data` に置ける。「全部取得する」で、まだ取得していない物と新しい版がある物をまとめて取得する。
新規接続の設定(`resist.ini`)は「新規キャラ作成」を開いた時に自動で取得し、世界を選べるようにする。
画像を足した時は、「ツール」→「画像を読み直す」で読み直す。

## 開発

| 資料 | 内容 |
|---|---|
| [docs/04-client-spec.md](docs/04-client-spec.md) | クライアントの要件と挙動。サーバとのやり取り、キー、リスト、魔法、超魔法。他の言語でクライアントを作る人の為の資料 |
| [docs/01-design.md](docs/01-design.md) | WPHI の設計 |
| [docs/02-tasks.md](docs/02-tasks.md) | 作業の記録 |
| [docs/03-gpui.md](docs/03-gpui.md) | GPUI へ移す検討と、移動の詰まりの調査 |

### 手元で動かす

Rust と Node は mise で入れる。
Linux では Tauri の前提のパッケージ(`libwebkit2gtk-4.1-dev` など)も要る。

```sh
mise install
npm install
cargo test --workspace
npm test            # UI のテスト
npm run tauri dev   # アプリを起動する
```

GNOME(Wayland)と ibus の組み合わせでは、Wayland のままだと IME の変換候補がカーソルから離れた位置に出る。
この為 Linux では、`GDK_BACKEND` と `GTK_IM_MODULE` が未設定ならアプリが `x11` と `ibus` を選ぶ(`src-tauri/src/main.rs` の `prefer_x11_ime`)。

### 配布物を作る

`v` で始まるタグを push すると、GitHub Actions(`.github/workflows/build.yml`)が3つの OS の分を作って Releases に置く。
どの OS の分も、その OS の上でしかビルド出来ない。
手元で作る時は次のコマンドを使う。

| OS | コマンド |
|---|---|
| Windows | `npm run tauri build -- --bundles nsis` |
| Linux | `npm run tauri build -- --bundles deb,appimage` |
| macOS | `npm run tauri build -- --bundles app,dmg --target universal-apple-darwin` |

展開してそのまま使える zip は、ビルドの後に `tools/package.sh windows|linux|macos` で作る。

### 調べる時の道具

| 道具 | 使い方 |
|---|---|
| 時刻の記録 | メニューの「ツール」→「時刻の記録」。キー・送信・受信・描画の時刻をログのフォルダの `trace-*.txt` に書く。移動の詰まりを調べるのに使った |
| 受信の記録 | `WPHI_RECORD=<フォルダ> npm run tauri dev` で起動すると、受信した生のバイト列を接続ごとに書く。他のプレイヤーの発言も入るので、コミットしない |

### アイコンの作り直し

アイコンの元は `src-tauri/icons/icon.svg`。
書き換えたら、1024px の PNG にしてから Tauri でアイコン一式を作る。

```sh
resvg src-tauri/icons/icon.svg /tmp/icon-1024.png -w 1024
npx tauri icon /tmp/icon-1024.png -o /tmp/icons
cp /tmp/icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.ico,icon.png} src-tauri/icons/
```

### 構成

| ディレクトリ | 内容 |
|---|---|
| `crates/phi-proto` | 行の分割、cp932 の変換、受信した行の解析、ログの HTML 化 |
| `src-tauri` | Tauri アプリ。サーバへの接続、画像、設定、メニュー |
| `ui` | 窓の画面(React と TypeScript) |
| `tools/golden` | phi-client-web の Python のパーサの出力を、`phi-proto` の比較テスト用に書き出す |
| `tools/png2phibmp` | phi-client-web の透過 PNG のキャラグラを Philly の BMP に戻す |
| `resources/phi` | 同梱のグラフィックス・スキン・超魔法の定義。ライセンスは同じフォルダの README |

## ライセンス

コードは MIT。
同梱のグラフィックスのライセンスは [resources/phi/README.md](resources/phi/README.md) に従う。
