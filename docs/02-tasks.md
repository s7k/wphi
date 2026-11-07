# タスク

[01-design.md](01-design.md) の段階(P0〜P5)を作業の単位に分けた一覧。
Philly(PhillySrc)・phi-client-web・今の実装を 2026-11-07 に突き合わせて作った。
終わったものは `[x]` にし、コミットを書き添える。

## P0・P1 の残り

- [x] 実サーバの受信を記録する仕組み(`WPHI_RECORD=<フォルダ> npm run tauri dev` で受信した生のバイト列を書く)
- [ ] 記録した受信から、名前と本文を置き換えた正解データを作って `crates/phi-proto/tests/golden` に足す(実機での記録が要る)
- [ ] cp932 の変換結果を Windows の `WideCharToMultiByte` と照合する(Windows 実機が要る)

## P2 の残り(キー・マウス)

- [x] ファンクションキーと Alt の魔法(Philly の `Command.cpp` KeyBindNone の F1〜F7、KeyBindAlt、KeyBindShiftAlt)。Call と Return は送る前に確認する。Shift+F5 でマップ窓を出し入れする
  - [ ] F8〜F12 のショートカットと Alt+G の言葉(設定画面と一緒に作る)
  - [ ] Alt+S(看板の検索)、Shift+Alt+C・A・U(名前を聞くダイアログが要る)
  - [ ] 系統魔法の前に武器を外す処理(AutoUnequipSystemMagic)
- [x] マップのクリックで移動、右クリックで攻撃(Philly の `MapForm.cpp` の MouseDirection)。押している間はマウスの向きへ進む
  - [ ] マウスカーソルをスキンの `Cursor/*.cur` にする(今はブラウザ標準の矢印のカーソル)
  - [ ] 北固定で Shift か Ctrl を押しながらマウスを向けると、その向きを向く(NorthFixTurn)

## P3: 入力と会話

- [x] 入力欄を Philly と同じ複数行のエディタにする。Enter でカーソルの行を送って次の行へ移り、送った行は欄に残す
- [x] 発言の前処理(`MainForm.cpp` の SendFromInputEdit)
  - [x] 先頭が `*` の発言は `/**/` を前置して大声にしない(LoudlyByAsterisk=0)
  - [x] Ctrl+Enter はパーティー発言(先頭に `+`、PartyTalkByCtrl=on)
  - [x] 空行は `/**/` にして送る(EditSendNullLine=on。末尾の空行は送らない)
  - [x] 連続送信を 100ms 空ける
- [x] 大声モード(ツールバーのボタンで切り替え、入力欄を黄色にし、送る前に確認する。Philly の大声にキーの割り当ては無い)
  - [ ] 確認の「すべて大声」(解除するまで確認しない)。今はブラウザ標準の確認ダイアログで、はい・いいえしか無い
- [x] 全タブ発言(送る前に確認する)

## P3: リスト・入力窓・priv・EagleEye・世界移動

- [x] リスト(`#list` 〜 `#end-list`)の表示と選択。番号キーで選び、0 は取り消し(`Command.cpp` の ListModeSend と KeyBindListMode)。ログの上のチェックリストとマップ窓の右の領域に出す
  - [ ] 9 で続きのページ(`#more`)を送る処理と、番号のずれ(ListOffset)・範囲外の番号でリストを閉じる処理(ListEndTenKeyCertainly)
  - [ ] マップ窓のリストをクリックで選ぶ
- [x] s-edit(1行入力)と m-edit(看板などの複数行入力。Philly の MEditForm)。S(write)から開く。s-edit は Philly と同じく入力欄で答える
  - [ ] 看板エディタを別窓にする(今は main 窓の中に重ねている。窓の配置と一緒に決める)
  - [ ] タグメニュー(`TagMenu.xml`)とタグの無効化
- [x] priv(Philly の PrivForm)。相手の組ごとに会話を分け、`priv <番号> /*to=相手*/本文` を相手ごとと自分に送る。3人以上の会話も宛先のタグで見分ける。`#ulist` で番号を取り直す
  - [ ] priv を別窓にする(今は main 窓の右に置いている。窓の配置と一緒に決める)
  - [ ] `#ulist` の返事を待ってから送る(Philly の RequestUlistWait は最大 60 秒待つ。今は手元の一覧で送る)
- [x] EagleEye 窓(Philly の EagleEyeForm)。受けたら窓を出す。人のマス(属性 0x58)には既定グラの人を重ねる
  - [ ] `#mapset-define` のチップ定義(属性の下位2ビット)。マップ本体も未対応
  - [ ] アイテムのマスを Philly と同じくチップ 19 で描く(今はマップと同じアイテムの絵)
- [x] 世界移動(`#ch-srv` → `#reserve` → `#rsv-ok` → `#trans` → `#trs-ok` → `#ch-srv-ok`)。Philly の `PersonalThread.cpp` classTransportCharacter に合わせた(移動後は `#open` を送らない、失敗時の通知先も Philly と同じ)。移動先は登録したキャラにも書き戻す
- [x] `#more` の間は `#end-more` 以外の行をログにし、コマンドとして解析しない(Philly の `PersonalThread.cpp:707-858`)。看板に `#ch-srv` を書かれると、読んだ人がキャラ ID を外部のサーバへ送ってしまう為。Python 版との差なので、正解データには `#more` の中の `#` の行を入れない

## P4

- [ ] メニューバー(`MainForm.dfm` の構成、`Style/Menu.txt` で表示を切り替える)
- [ ] 窓の吸い付きと位置記憶(Windows のみ)
- [ ] 設定画面と `Philly.ini` の取り込み(フルキー移動、リピートの時間など)
- [ ] 効果音(`SoundRegexp.ini`)と BGM(MIDI)
- [ ] 通知とタスクバーの点滅、裏タブの未読表示
- [x] ログの保存(LogAutoSave)。入力欄のツールバーでタブごとに切り替え、`<アプリのログフォルダ>/<表示名>/<yyyymmdd>.html` に Log.css 付きで書く
  - [ ] テキストでの保存(LogSaveHtml=off)と、保存フォルダを開くボタン

## P5

- [ ] 新規キャラ作成(`#ex-register`。phi-client-web の `register.py` を移植する)
- [ ] Windows の配布物(NSIS)を CI で作る。署名するかは未決
- [ ] 自動更新
