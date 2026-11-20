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

消す時は、zip の物は展開したフォルダを消す。
インストーラで入れた物は、Windows の「設定」→「アプリ」→「インストールされているアプリ」の WPHI から消す。
設定とキャラの登録は設定フォルダに残るので、要らなければそのフォルダも消す。

## 始め方

画像付きの使い方は[利用者ガイド](https://s7k.github.io/wphi/guide/)にある。

初めて起動すると、キャラを選ぶ画面になる。

- Philly を使っていたなら、「Philly から取り込む」で Philly のフォルダを指定する。登録したキャラを取り込み、Philly のキャラグラとマップチップも使う。設定(`Config/Philly.ini`)は取り込まないので、その後で設定の画面の「Philly.ini から取り込む」を押す
- 新しく始めるなら、「新規キャラ作成」で名前・パスワード・初期グラを決めて作る
- キャラ ID が分かっていれば、「キャラを登録」で表示名・ID・接続先を入れる

キャラを選ぶと接続し、タブが1つ開く。
キャラごとにタブを開いて、同時に何人でも遊べる。

2 回目からは、起動すると前回開いていたタブのキャラへ自動で接続する。
自動で接続しないようにするには、設定の画面 (メニューの「ファイル」→「設定...」か、右上の「設定」のボタン) の先頭の「起動した時に、前回開いていたタブのキャラへ自動で接続する」を外す。

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
| Ctrl+1〜8 | 魔法の列の呪文を唱える(v6 のサーバ、モダンの画面) |
| Shift+F5 | 地図の窓を出す・隠す |
| T・Shift+T | 回転の地図・北固定の地図 |
| Ctrl+Tab | 次のタブ |
| Ctrl+F(macOS は Cmd+F) | ログを検索 |

メニューは Philly と同じ並びで、macOS では窓の中にも出す。
マスターのキャラには超魔法のメニューも出る。

## Philly に無い機能

- 広い地図: v6 に対応したサーバでは、地図の窓に入るだけの広さを見る。窓の大きさを変えると見える範囲も変わる
- 位置の予想: v6 の北固定で地図が届かない時も、進んだとみなして地図をずらす(朱蓮の系統の世界)
- ログの検索: Ctrl+F で検索窓を出す。Enter で古い方へ、Shift+Enter で新しい方へ移る。探すのはログ欄に残っている行だけ
- 吹き出しと HP・MP の増減: 発言と priv を、地図のキャラの上に吹き出しで出す。攻撃や回復で増減した HP・MP を、受けたキャラの上に数字で出す。攻撃した時は斬撃を出す。攻撃したキャラが直前に唱えた呪文で攻撃した時は、魔法弾を出す。ミスした時は攻撃した側に MISS、毒と麻痺を受けた時はその文字を出し、倒されたキャラは光って消える。攻撃力などが上がった時は金色の光と「攻撃力↑」を、下げられた時は青い光と「速度↓」などを出す。「表示」→「吹き出しと HP・MP の増減をマップに出す」で切り替える。同じ名前のキャラが複数いる時は、自分に一番近いキャラに出す
- 地図の拡大率: 設定で % を指定する
- 窓の位置と大きさを覚える。ログの窓を最小化すると、地図の窓も一緒に最小化する
- 看板の札(試験中): 看板などの本文(`#more` 〜 `#end-more`)を、ログに流すのに加えて地図の上の札に出す。ログと同じく色と大きさのタグを反映し、色は暗い地で読めるよう白へ寄せる。×、Esc、歩くと閉じる
- カバン(v6、試験中): 右上のリュックのボタンで開く。手持ちの 8 個と、どこでも出し入れできるインベントリ(預かり所)を、武器の種類と用途のドット絵と属性の色で並べる。装備中の印とチャージの残りの回数も出す。使う・装備する・外す・置く・カバンに入れる・取り出すが出来る
- パーティ: 地図ですぐ隣のキャラを左クリックすると「パーティに誘う」が出る(向きを変えてから join を送る)。v6 の世界では、仲間の名前と HP・MP・状態異常を右上に出し続け、押すと区域・位置・放置時間・遅延と「脱退」の付いた窓を開く(サーバの `#v6 P`)
- 追尾移動: 地図をホイール(中ボタン)でクリックすると、マウスポインタの方へ歩き続ける。もう一度の中クリックか左クリックで止める
- 木と草の揺らぎ(試験中): 木をマスの中で少しずつずらし、草のマスに小さな草の房と小石を置く。場所で決まるので、同じ場所はいつも同じ見え方になる。北固定の地図で、自分の位置が分かる世界(`#ex-pos` か `#v6 G`)だけ
- 窓の形を「表示」で選ぶ
  - クラシック(2窓): Philly と同じく、地図とログを別の窓に出す
  - クラシック(1窓): 地図をログの左に出す。境目をドラッグして幅を変えられる。縦長の窓では地図を上に積む
  - モダン(既定): 地図を窓いっぱいに描き、地名と HP・MP、方角、ログを白文字・黒縁で重ねる。ログは白い枠で囲み、高さを小・中・大から選ぶ。v6 のサーバでは窓を広げた分だけ見える範囲が広がる
- マップの倍率は 100・200・300% だけ。画面の実際のピクセルで整数倍にするので、ドットが崩れない。v6 の地図と 7x7 の地図(v5y など)で別に選べる

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
新規接続の設定(`resist.ini`)は「新規キャラ作成」と「キャラを登録」を開いた時に自動で取得し、世界を選べるようにする。
取得出来ない時は、同梱の `worlds.ini` の世界を出す。
画像を足した時は、「ツール」→「画像を読み直す」で読み直す。

## 開発

| 資料 | 内容 |
|---|---|
| [docs/04-client-spec.md](docs/04-client-spec.md) | クライアントの要件と挙動。サーバとのやり取り、キー、リスト、魔法、超魔法。他の言語でクライアントを作る人の為の資料 |
| [docs/01-design.md](docs/01-design.md) | WPHI の設計 |
| [docs/05-protocol-v6.md](docs/05-protocol-v6.md) | 可変サイズの視界 (v6 プロトコル) への対応の設計。拡張マップは取りやめた |
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
| デバッグ表示 | メニューの「ツール」→「デバッグ表示」。サーバから受けた `#` の行(`← #v6 G 1 0` など)と、送った行(`→ go E` など)をログに灰色で出す。もう一度選ぶと止まる |
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

コードは MIT ([LICENSE](LICENSE))。
同梱のグラフィックスのライセンスは [resources/phi/README.md](resources/phi/README.md) に従う。

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Windows の配布物 (インストーラと zip の中の WPHI.exe) は、このリポジトリの GitHub Actions (`.github/workflows/build.yml`) がタグの push でビルドした物だけに署名する。
手元でビルドした物には署名しない。
署名はリリースごとに、下の承認者が SignPath で承認してから行う。

- Committers and reviewers: [s7k](https://github.com/s7k)
- Approvers: [s7k](https://github.com/s7k)

承認者以外からの変更 (pull request) は、Committers が読んでから取り込む。

## Privacy policy

WPHI は、利用者が指示した場合を除き、利用者の情報を外へ送らない。
外へつなぐのは次の 2 つだけ。

- 利用者が接続先に選んだ PHI のサーバ。キャラ ID と、ゲームの中の操作を送る
- 新しい版の有無を確かめる為の GitHub の API (`https://api.github.com/repos/s7k/wphi/releases/latest`)。送るのは通常の HTTP の要求だけで、利用者の情報は含めない

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, except the PHI server the user connects to and the GitHub API that checks for a new version.
