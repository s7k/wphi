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
  - [x] F8〜F12 のショートカットと Alt+G の言葉。リスト表示中の F8〜F12 はリスト用の文字列を送る
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
  - [x] リスト表示中に何かを送ったら、9 でない限りリストを閉じる(Philly の SendTextListCancel。v5y は取り消してもリストの終わりを送らない)
  - [x] 魔法を唱える操作の後に届く cast の一覧を出さない(Philly の NextListCancel)。空のリストも出さない
  - [ ] 9 で続きのページ(`#more`)を送る処理と、番号のずれ(ListOffset)・範囲外の番号でリストを閉じる処理(ListEndTenKeyCertainly)
  - [ ] マップ窓のリストをクリックで選ぶ
  - [ ] リストの書き出し(Philly の「書き出し」ボタン)
- [x] s-edit(1行入力)と m-edit(看板などの複数行入力。Philly の MEditForm)。S(write)から開く。s-edit は Philly と同じく入力欄で答える
  - [ ] タグメニュー(`TagMenu.xml`)とタグの無効化
- [x] priv(Philly の PrivForm)。相手の組ごとに会話を分け、`priv <番号> /*to=相手*/本文` を相手ごとと自分に送る。3人以上の会話も宛先のタグで見分ける。`#ulist` で番号を取り直す
  - [ ] `#ulist` の返事を待ってから送る(Philly の RequestUlistWait は最大 60 秒待つ。今は手元の一覧で送る)
- [x] EagleEye 窓(Philly の EagleEyeForm)。受けたら窓を出す。人のマス(属性 0x58)には t_man を重ねる(Philly はスキンの既定グラ「人・銅像」。作者の指定で変えた)
  - [ ] `#mapset-define` のチップ定義(属性の下位2ビット)。マップ本体も未対応
  - [ ] アイテムのマスを Philly と同じくチップ 19 で描く(今はマップと同じアイテムの絵)
- [x] 世界移動(`#ch-srv` → `#reserve` → `#rsv-ok` → `#trans` → `#trs-ok` → `#ch-srv-ok`)。Philly の `PersonalThread.cpp` classTransportCharacter に合わせた(移動後は `#open` を送らない、失敗時の通知先も Philly と同じ)。移動先は登録したキャラにも書き戻す
- [x] `#more` の間は `#end-more` 以外の行をログにし、コマンドとして解析しない(Philly の `PersonalThread.cpp:707-858`)。看板に `#ch-srv` を書かれると、読んだ人がキャラ ID を外部のサーバへ送ってしまう為。Python 版との差なので、正解データには `#more` の中の `#` の行を入れない

## P4

- [x] LANU 系のグラフィックスを使わない(作者の指定)。同梱スキンから消し、同梱の `Index.txt` の既定グラを PCGL のキャラグラ(t_man・t_elf・t_dog・t_fightery・t_golem1・tak_bslime)に付け替えた。利用者の Philly フォルダにあっても読まない

- [x] メニューバー(`MainForm.dfm` の構成、`Style/Menu.txt` で表示を切り替える)。ファイル・操作・行動・魔法・表示の項目はキーと同じ操作にした
  - [ ] キャラクターとツールのメニュー、操作のメニューの大声・全タブ・ログ保存の切り替え
- [ ] 窓の吸い付きと位置記憶(Windows のみ)
- [x] 設定画面と `Philly.ini` の取り込み。今の項目はフルキー移動、リピートの時間、F8〜F12、Alt+G。設定フォルダの `settings.json` に置く
  - [ ] 他の項目(ログ表示、通知、フォントなど)の設定と取り込み
- [x] 効果音。Philly フォルダの `Config/SoundRegexp.ini` と `SoundFile.ini` を読み、受信した行に最初に一致した規則の WAV を鳴らす(ファイルが空ならタスクバーの点滅)。設定で切り替える
  - [ ] `#more` の間は鳴らさない(Philly は #more の外だけで照合する)
- [ ] BGM(MIDI)
- [x] タスクバーの点滅と裏タブの未読表示。発言と priv が届いた時だけ(GtOnly=on)、大声では点滅しない(Loud=off)
  - [ ] 点滅させない正規表現(`NotTaskBarFlashRegexp.ini`)と、裏タブで HP・MP が減った時の印
- [x] 「ログを固定」の切り替え(ログを最下行に固定する。既定 on。off は Philly の「ログスクロール停止」)。スクロールバーを常に出す
- [x] ログの保存(LogAutoSave)。入力欄のツールバーでタブごとに切り替え、`<アプリのログフォルダ>/<表示名>/<yyyymmdd>.html` に Log.css 付きで書く
  - [ ] テキストでの保存(LogSaveHtml=off)と、保存フォルダを開くボタン

## P5

- [x] 新規キャラ作成(`#ex-register`。phi-client-web の `register.py` を移植した)。キャラ選択の画面で初期グラを選び、作ったキャラはそのまま一覧とキーチェーンに入る。改行や制御文字での行の差し込みは送る前に拒否する
  - [ ] 実サーバでの確認
- [x] Windows(NSIS)・Linux(deb・AppImage)・macOS(dmg、ユニバーサル)の配布物を GitHub Actions で作る設定(`.github/workflows/build.yml`)。Linux 版は手元でビルドして起動を確かめた
  - [ ] GitHub にリポジトリを作って push し、CI で3つとも作れるか確かめる
  - [ ] 署名するか(未決。今は Windows は署名なし、macOS はアドホック署名)
- [ ] 自動更新
