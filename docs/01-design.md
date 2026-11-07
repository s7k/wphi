# WPHI 設計

旧 Windows クライアント Philly(C++Builder)を、Tauri 2 で作り直す為の設計。
クライアント名は WPHI(2026-11-07 に決定)。識別子は `dev.wphi`、キーチェーンのサービス名は `wphi`、Tauri アプリの crate 名は `wphi`。
見た目と操作は Philly に寄せる。

## 参照資料

| 資料 | 場所 | いつ読むか |
|---|---|---|
| Philly ソース | `~/workspace/PhillySrc.zip`(リポジトリ外。中身は cp932。`iconv -f cp932 -t utf-8` で読む) | 画面構成・キー操作・設定項目・画像の読み込み順を決める時 |
| phi-client-web | `~/workspace/phi-client-web` | プロトコルの解析・世界移動・登録を実装する時。仕様は `docs/01-legacy-investigation.md`、`docs/03-phase0-connection-test.md`、`docs/07-ws-protocol.md`、`docs/16-current-feature-gap.md`。実装は `backend/app/protocol/` と `backend/app/session.py` |
| プロトコル原典 | PhillySrc の `doc/Protocol/` | phi-client-web の資料に無いコマンドを調べる時 |

以下、Philly の根拠は PhillySrc の `Philly/` からの相対パスで書く。

## 1. 対象と範囲

対象 OS は Windows。
Linux は開発用で、窓の位置を扱う機能(吸い付き・位置記憶)を外して動かす。
Wayland はアプリに窓の座標を読ませず、決めさせもしない為である。

macOS は当面対象にしない。
コードは macOS で動かない書き方を避けるだけにとどめ、配布物も作らない。
必要になった時は署名と公証をせずに `.app` を作り、利用者に `xattr -dr com.apple.quarantine WPHI.app` で隔離属性を外して貰う。
Apple Silicon は署名の無いバイナリを起動しないので、その時は `bundle.macOS.signingIdentity` に `"-"`(アドホック署名)を指定する。

最初の版に含めないもの。

- 新規キャラ作成(Philly では別プログラムの `PhillyNewCharacter.exe`)。phi-client-web の `register.py` を移植して後の段階で足す
- 自動更新(`PhillyUpdate.exe`)。配布方法を決めてから `tauri-plugin-updater` で作る
- マスター専用の機能(超魔法メニュー `MasterMagicMenu.xml`、隠しコマンド `HiddenCommand.ini`)
- v6 プロトコル(`#hello phi/6`)。本番の v5y サーバが v6 に移るまで対応しない

## 2. 全体構成

```
┌─ Tauri アプリ ───────────────────────────────────────────┐
│ ui/ (WebView: React + TS)                                 │
│   main / map / eagleeye / priv / medit / settings の各窓  │
│        ▲ event(Channel)        │ invoke(command)          │
│        │                       ▼                          │
│ src-tauri/ (Rust)                                          │
│   session(tokio) ─ assets(phi-asset://) ─ config ─ sound  │
│        │                                                  │
│ crates/phi-proto (Rust, 純粋関数)                          │
│   LineBuffer / cp932 codec / parser / serializer / TagToHtml│
└────────┼──────────────────────────────────────────────────┘
         │ TCP・cp932・改行区切り
   [レガシーサーバ(v5y)]
```

| ディレクトリ | 内容 | 依存 |
|---|---|---|
| `crates/phi-proto` | 行分割、cp932 変換、受信行の解析、送信行の組み立て、ログ HTML への変換 | `encoding_rs`、`serde`、`fancy-regex` |
| `src-tauri` | 接続の保持、画像の配信、設定、音、窓の管理、UI との IPC | `tauri`、`tokio`、`image`、`rodio`、`keyring` |
| `ui` | 各窓の画面 | React、TypeScript、Vite |

`phi-proto` を別 crate にする理由は2つある。
1つ目に、WebView の開発パッケージが無い環境でも `cargo test -p phi-proto` を実行出来る。
2つ目に、phi-client-web の Python パーサと出力を比べるテスト(§3.5)を Tauri から切り離して実行出来る。

phi-client-web にあった FastAPI のゲートウェイは使わない。
アプリが直接レガシーサーバへ TCP で接続する。

## 3. プロトコル層(phi-proto)

### 3.1 行の受信

受信データは `Vec<u8>` のまま扱い、`String` にしない。
`#m57 M` の地形は生のバイナリで、UTF-8 として読むと壊れる。
`BufRead::lines()` は不正な UTF-8 でエラーを返すので使わず、`read_until(b'\n')` を使う。

行末の `\r` を落とす処理と空行を捨てる処理は、phi-client-web の `line_buffer.py` と同じにする。
地形バイトの末尾が `0x0D` になり得るかは未確認である。
挙動を変えると Python 版との差分の原因を追えなくなる為、まず同じ動きにする。

### 3.2 行の種類と変換

行頭のコマンドで変換の仕方を分ける(phi-client-web `code_converter.py`、`parser.py`)。

| 種類 | 行 | 扱い |
|---|---|---|
| バイナリ | `#m57 M`、`#map M`、`#ex-eagleeye M` | 変換しない。固定位置のバイトを読む(`#m57 M` は `raw[18..116]` が chip と attr の組×49) |
| 一部だけ cp932 | `#m57 O`、`#m57 W`、`#user` | 固定位置の名前欄だけ cp932 で読む(`#m57 O` は name=`raw[19..50]`、gra=`raw[54..69]`) |
| 全体を cp932 | 上記以外(チャット、`#status`、`#ex-notice` など) | 行全体を cp932 で読む |

固定位置で切った名前欄は、2バイト文字の途中で切れる事がある。
切れた文字は置換文字にして、例外にしない。

### 3.3 cp932 の扱い

`encoding_rs::SHIFT_JIS` を使う。
WHATWG の Shift_JIS は Windows-31J とほぼ同じ表を持つ。

送信側では、`encode()` が変換出来ない文字(絵文字など)を `&#128512;` 形式の文字参照に置き換える。
このまま送るとチャットに文字参照の文字列が流れる。
防ぐ為に `encode_from_utf8_without_replacement` で自前のループを書き、変換出来ない文字は `?` にする(phi-client-web の `errors="replace"` と同じ結果)。

Python の cp932 とはバイト表現が一部違う。

| 入力 | Python cp932 | encoding_rs |
|---|---|---|
| `髙` を送る | `EE E0`(NEC 選定 IBM 拡張) | `FB FC`(IBM 拡張)と推測 |
| `0xA0` / `0xFD` を受ける | `U+F8F0` / `U+F8F1` | `U+FFFD` |

Philly は Win32 API で変換していた為、encoding_rs の方が Philly に近いと考えている(未検証)。
P0 で Windows 上の `WideCharToMultiByte` の結果と照合する。

### 3.4 解析結果の型

パーサは受信1行を受け取り、`Vec<Event>` を返す。
`Event` の種類とフィールド名は phi-client-web の `docs/07-ws-protocol.md` §6 と `frontend/src/types/protocol.ts` に合わせる。
合わせておくと、phi-client-web のマップ描画(`lib/drawMap.ts`、`lib/mapRender.ts`)をほぼそのまま持ち込める。

`#lag`(`#end-lag` で応答)や `#remap`(`#map` で応答)のように、サーバへ自動で返す行は `Event::Internal` にする。
セッション層がこれを受けて応答し、UI には渡さない。

`#ex-map size=40/57` でマップの大きさが切り替わる(`Command.cpp:1105-1108`)ので、5×5 の `#map` と 7×7 の `#m57` の両方を解析する。

### 3.5 Python 版との出力比較テスト

phi-client-web の `backend/tests/fixtures/synthetic/` に、受信行のバイナリ(`m57_M.bin`、`m57_O_jp.bin` など)と期待値の `expected.json` がある。
これを `phi-proto` のテストにそのまま読み込み、Rust 版の出力と比べる。
実サーバの受信を記録した fixtures(`recorded/`)はまだ空なので、P0 で実機の受信を記録して追加する。

## 4. セッション層(src-tauri)

### 4.1 接続

1キャラにつき tokio のタスクを1つ立て、そのタスクが `TcpStream` を持つ。
UI からの送信は `mpsc` でタスクへ渡す。
受信して解析したイベントは、Tauri の `Channel` で UI へ送る。
タブを複数開くと、接続も同じ数だけ並ぶ(Philly の `TabSession.ini` と同じ)。

### 4.2 ログイン

ログイン時の送信は Philly(`CharacterCommon.cpp:761-798`)と同じにする。

```
#open <ID>
#version-cli 05107100
#map-iv <秒>
#status-iv <秒>
#ex-switch eagleeye=form
#ex-map size=57
#ex-map style=turn | solid
#ex-switch ex-move-recv=true
#ex-switch ex-list-mode-end=true
#ex-switch ex-disp-magic=true | false
```

`ex-move-recv`、`ex-list-mode-end`、`ex-disp-magic` の3つは、v5y サーバに実装が無い(phi-client-web `docs/16-current-feature-gap.md` §2)。
送っても害は無く、Philly との差を減らす為に残す。
朱蓮の位置取得用に `#ex-switch ex-abspos=true` を足す(同 §3)。

### 4.3 維持と世界移動

無通信が続いた時は `#code-sjis` を送る(phi-client-web は2分)。
Philly が何秒で送っていたかは P1 で `PersonalThread.cpp` から確認する。

世界移動(`#ch-srv` → `#reserve` → `#rsv-ok` → `#trans` → `#trs-ok` → `#ch-srv-ok`)は、phi-client-web の `session.py` の手順を移植する。

### 4.4 キャラ ID の保存

Philly はキャラごとに `<名前>.chara\.phirc` を作り、1行目に ID、2〜3行目に `IP:ポート` を平文で書いている(`CharacterCommon.cpp:1203-1219`、`Const.cpp:66-68`)。
ID はログインの認証情報そのものである。
WPHI は ID を OS のキーチェーン(`keyring` crate)へ置き、IP とポートだけを設定ファイルに書く。
キャラ選択の画面で Philly フォルダを指定すると、`*.chara\.phirc` を読み込んで既存のキャラを一覧へ取り込む(`src-tauri/src/characters.rs`)。
一覧と、終了時に開いていたタブの表示名(Philly の `TabSession.ini` に当たる)は、設定フォルダの `characters.json` に置く。
ID は一覧に書かず、接続の時に Rust 側がキーチェーンから読む。UI には返さない。

## 5. 画像

### 5.1 一次情報

BMP を一次情報にし、実行時に読み込む。
画像ファイルとして読むのは BMP だけで、PNG のファイルを読む処理は持たない。

探す場所は2つある。
先に利用者の Philly フォルダ(初回起動時に指定する。省略可)を探し、無ければアプリに同梱した PCGL のグラフィックス(§5.4)を探す。
どちらも Philly と同じフォルダ構成にするので、読み込み処理は1つで済む。
各フォルダの中での読み込み先と代わりの画像の順序は Philly の `GraCache.cpp` に合わせる。

| 種類 | 読む場所 | 見つからない時 | 透過方式 |
|---|---|---|---|
| キャラグラ | `chara/<グラ名>.bmp` | `Skins/<スキン>/Chara/` から `Index.txt` で引く(`GraCache.cpp:472-490`) | teal(0,128,128) を透明にする |
| マップチップ | `chip/<名前>.bmp` | `Skins/<スキン>/chip/Default.bmp`(`GraCache.cpp:290`) | 左半分が画像、右半分がマスク |
| アイテム | `Skins/<スキン>/Images/Items.bmp` | なし | 上半分が画像、下半分がマスク |
| 方角 | `Skins/<スキン>/Images/Direction.bmp` | なし | 白を透明にする |
| HP/MP パネル・ステータス | `Skins/<スキン>/Images/` | なし | teal を透明にする |

透過方式の詳細と確認結果は phi-client-web の `docs/06-graphics-transparency.md` にある。
変換処理は同リポジトリの `backend/app/gfx/transparency.py` を移植する。

Philly は Windows 用で、`Chara` と `chara` のように大文字と小文字が揃っていない。
Linux はファイル名の大文字と小文字を区別するので、パスは大文字小文字を無視して探す。

利用者の Philly フォルダにある BMP は配布物に含めない。
PCGL(Phi Charactor Graphics License)が付いていない画像が混ざっている為で、phi-client-web でもコミットしていない(同 README)。

### 5.2 変換とキャッシュ

Rust 側で BMP を読み(`image` crate)、透過を適用した RGBA を PNG にして返す。
WebView は独自形式の画素データを `<img>` や `drawImage` で描けないので、PNG にする。
UI からは独自スキーム `phi-asset://localhost/<種類>?<引数>` で取得する(種類は chara・chip・items)。

変換した PNG はメモリ上に上限なしで持つ。
Philly は名前をキーにしたメモリ上の LRU で持っていた(`GraCache.cpp:241-254`)が、キャラグラは1枚 20KB 前後で数百枚なので、上限は設けていない。
ディスクにキャッシュを置くと、利用者がスキンや BMP を差し替えた時に古い PNG を返さない為の判定(パス・更新時刻・サイズの照合)が要る。
変換に掛かる時間を P2 で測った(`src-tauri/src/assets.rs` の `convert_time`。2026-11-07、開発機の Linux)。

| 対象 | リリースビルド | デバッグビルド |
|---|---|---|
| チップ(1024×96 → 512×96) | 1.5ms | 37ms |
| キャラグラ1枚(96×160) | 0.28ms | 11.5ms |

リリースビルドでは、1画面分(キャラ十数体とチップ)を初めて描く時でも 10ms に満たない。
2回目からはメモリのキャッシュから返すので、ディスクへの PNG キャッシュは作らない。

### 5.3 マウスカーソル

`Skins/<スキン>/Cursor/*.cur` は、読み込み時に PNG とホットスポットに変換し、CSS の `cursor: url(...) x y` で使う。
WebKitGTK(Linux)が `.cur` をそのまま読めるかは未確認なので、変換を挟んで OS による差をなくす。

### 5.4 同梱するグラフィックス

Philly フォルダを持たない利用者の為に、画像を `resources/phi/` に Philly と同じフォルダ構成で同梱する。
出所とライセンスの一覧は `resources/phi/README.md` にある。

| 置き場所 | 出所 |
|---|---|
| `chara/<グラ名>.bmp`(336件) | phi-client-web の `assets/chara/*.png`(PCGL の透過 PNG)を teal カラーキーの 24bit BMP に戻したもの |
| `Skins/Mine/` | Philly の既定スキン(`Philly.ini` の `SkinName="Mine"`)をそのまま複写。チップの `chip/Default.bmp`、アイテムの `Images/Items.bmp`、HP/MP パネル、カーソル、`Log.css` を含む |

Philly のパーツは再利用してよい事をリポジトリ管理者が確認済み(2026-11-07)。
Philly の `Skins/Mine/chip/Default.bmp` は phi-client-web の `assets/chip/default.png` と画素単位で一致したので、チップとアイテムは PNG から戻さずに Philly の BMP を使う。

キャラグラの変換は `tools/png2phibmp` で1度だけ行い、変換した BMP をコミットする。
ビルドのたびに変換しない為である。
`assets/` の PNG はアルファ値がすべて 0 か 255 で、変換した BMP から透過を戻すと全件で元の PNG と一致した。
不透明の teal や半透明の画素があると BMP に戻せないので、ツールはその時に止まる。

PCGL は、同じ PCGL で配布する事を条件に、変更した二次著作物の配布を認めている(PCGL d項)。
配布物には PCGL の全文(`resources/phi/PCGL.txt`)を同梱し、同梱したグラフィックスが PCGL 下にある事を `resources/phi/README.md` に書いた(PCGL c項 ii・iii)。
`sushi_*.bmp` は MIT なので、同じフォルダにあっても PCGL の対象外である事を同 README に明記した(PCGL b項)。

## 6. 画面

### 6.1 窓

Philly の窓をそのまま Tauri の窓にする。
マップ窓は Philly と同じく1枚だけ作り(`Philly.cpp:83`)、アクティブなタブのキャラを表示する。

| 窓 | Philly | 内容 |
|---|---|---|
| main | `MainForm.dfm` | メニューバー、キャラのタブ、ログ、入力欄、ステータスバー |
| map | `MapForm.dfm` | マップ、横の領域、HP/MP とステータスのパネル、ステータスバー |
| eagleeye | `EagleEyeForm.dfm` | EagleEye の俯瞰マップ |
| priv | `PrivForm.dfm` | 相手ごとのプライベート発言 |
| medit | `MEditForm.dfm` | 看板などの複数行入力 |
| settings | (Philly は INI を直接編集) | 設定画面 |

`Philly.ini` の `MapOverlapMain` などで指定する「メイン窓より常に上」は、Tauri の窓の親子関係で実現する。

### 6.2 吸い付きと位置記憶

窓が画面端や他の窓に吸い付く動作(`SrcLink/WindowDock`)は、窓の移動イベントを受けて座標を補正して作る。
窓の位置と大きさは `PosMemory.ini` に相当するファイルへ保存する。
Linux では両方とも無効にする。

### 6.3 ログ

Philly のログ欄は IE を埋め込み(`SrcLink/IeView`)、HTML とスキンの CSS で描いている。
WPHI も同じ作りにする。

1. `phi-proto` の `tag_to_html` で、受信したテキストを HTML にする。先に `<` `>` `&` `"` を実体参照にしてから、カラーマークアップ(`/*color=red*/〜/*.*/`)を `<font class="color_red_">` に変換する(`TagToHtml.cpp:143`)
2. 時刻と発言者名に `class_time`、`class_name` を付ける(`TagToHtml.cpp:420,434`)
3. UI は受け取った HTML をログ欄の末尾に `insertAdjacentHTML` で足す
4. スキンの `Style/Log.css` をログ欄に読み込む

手順2の正規表現には否定先読み `(?!...)` がある。
`regex` crate は先読みに対応しないので `fancy-regex` を使う。
利用者が書く `LogDeleteRegexp.ini`、`SoundRegexp.ini` なども Perl 互換(Philly は BREGEXP)なので同じ crate で読む。

ログ欄にはサーバから届いた文字列を HTML として入れる。
エスケープを漏らすと、他のプレイヤーが発言に仕込んだスクリプトが WebView で動く。
そのスクリプトから Tauri の command を呼び出す事も可能になる。
対策は次の3つで、P1 から入れる。

- 手順1のエスケープを、マークアップ変換より前に必ず通す。`phi-proto` のテストに `<script>` や `onerror=` を含む行を入れる
- CSP で `script-src 'self'` とし、インラインスクリプトを禁止する。画像はログ内の `img=` の為に `http:` と `https:` を許す
- Tauri の capability で、窓ごとに呼べる command を絞る

### 6.4 キー操作

Philly のキー操作(PhillySrc `doc/キー操作.txt`、`Command.cpp`)を移す。
phi-client-web の `lib/keyHandler.ts` に、Philly 互換の対応表が既にある。
phi-client-web がブラウザの都合で見送った Alt+英字の魔法と Ctrl+Tab は、WPHI では実装する。

判定には `KeyboardEvent.code` を使う。
`key` は IME やキー配列で値が変わり、Shift+数字の判定がずれる為である。

### 6.5 メニュー

Tauri のメニュー API で、`MainForm.dfm` のメニュー構成を作る。
スキンの `Style/Menu.txt` で項目の表示と非表示を切り替える(Philly と同じく起動時にだけ読む)。

## 7. 設定

WPHI の設定は、アプリの設定フォルダに JSON で保存する。
初回起動時に Philly フォルダの `Config/Philly.ini`(cp932)を読み込み、対応する項目を取り込む。
`Config.cpp` には INI の読み書きが336箇所あるので、全項目は移さない。
P4 で対応表を作り、取り込む項目を決める。

## 8. 音

| 種類 | Philly | WPHI |
|---|---|---|
| 効果音 | `SoundRegexp.ini` に一致した行で WAV を鳴らす(`PlaySound`、`PersonalThread.cpp:929`) | `rodio` で鳴らす |
| BGM | `#bgm` で MIDI を鳴らす | `midir` で Windows 標準の GS 音源(Microsoft GS Wavetable Synth)へ送る。Philly と同じ音源になる。Linux では鳴らさない |

## 9. 段階

| 段階 | 内容 | 終わりの条件 |
|---|---|---|
| P0(一部済) | `phi-proto` の行分割、cp932 変換、パーサ。同梱グラフィックス | Python 版と同じ入力で出力が一致する(`tools/golden/gen.py`、済)。実機の受信を `recorded/` に記録する(P1 の接続後)。cp932 の変換結果を Windows で照合する(未) |
| P1(着手) | main 窓。接続、ログ(`tag_to_html` と `Log.css`)、入力欄、タブ | 実サーバにログインし、日本語のチャットを送受信出来る。IME の変換候補が入力欄の位置に出る |
| P2 | map 窓。BMP の読み込み、マップ描画、ステータス、キー操作 | 移動と攻撃が出来る。マップ表示までの時間を測る |
| P3 | リスト、s-edit/m-edit、priv、EagleEye、世界移動 | Philly の操作マニュアル(PhillySrc `doc/操作マニュアル.txt`)の操作が一通り出来る |
| P4 | 吸い付き、位置記憶、メニュー、設定の取り込み、音 | Philly の利用者が設定を持ち越せる |
| P5 | 新規キャラ作成、署名、自動更新 | Windows の配布物を CI で作成出来る |

## 10. 未決事項

- Windows の配布物に署名するか。署名しないと SmartScreen が警告を出す
- 開発環境に Tauri のビルドに要るパッケージ(`webkit2gtk-4.1`、`gtk3`、`libsoup-3.0` など)が入っていない。P1 の前に入れる
