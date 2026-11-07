# タスク

[01-design.md](01-design.md) の段階(P0〜P5)を作業の単位に分けた一覧。
Philly(PhillySrc)・phi-client-web・今の実装を 2026-11-07 に突き合わせて作った。
終わったものは `[x]` にし、コミットを書き添える。

## P0・P1 の残り

- [ ] 実サーバの受信を記録し、`crates/phi-proto/tests/golden` の正解データに足す。記録の仕組み(開発用の受信ログ)から作る
- [ ] cp932 の変換結果を Windows の `WideCharToMultiByte` と照合する(Windows 実機が要る)

## P2 の残り(キー・マウス)

- [ ] ファンクションキーと Alt の魔法(Philly の `Command.cpp` KeyBindNone の F1〜F12、KeyBindAlt、KeyBindShiftAlt)
- [ ] マップのクリックで移動、右クリックで攻撃(Philly の `MapForm.cpp` の MouseDirection)

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
- [ ] priv 窓(Philly の PrivForm)。相手ごとに窓を開き、`priv <番号> <本文>` で送る
- [ ] EagleEye 窓(Philly の EagleEyeForm)
- [x] 世界移動(`#ch-srv` → `#reserve` → `#rsv-ok` → `#trans` → `#trs-ok` → `#ch-srv-ok`)。Philly の `PersonalThread.cpp` classTransportCharacter に合わせた(移動後は `#open` を送らない、失敗時の通知先も Philly と同じ)。移動先は登録したキャラにも書き戻す
- [ ] `#more` の間は `#` で始まる行をコマンドとして解析しない(Philly の `PersonalThread.cpp:1040`)。Python 版との差になるので、正解データの扱いも決める

## P4

- [ ] メニューバー(`MainForm.dfm` の構成、`Style/Menu.txt` で表示を切り替える)
- [ ] 窓の吸い付きと位置記憶(Windows のみ)
- [ ] 設定画面と `Philly.ini` の取り込み(フルキー移動、リピートの時間など)
- [ ] 効果音(`SoundRegexp.ini`)と BGM(MIDI)
- [ ] 通知とタスクバーの点滅、裏タブの未読表示
- [ ] ログの保存(LogAutoSave)

## P5

- [ ] 新規キャラ作成(`#ex-register`。phi-client-web の `register.py` を移植する)
- [ ] Windows の配布物(NSIS)を CI で作る。署名するかは未決
- [ ] 自動更新
