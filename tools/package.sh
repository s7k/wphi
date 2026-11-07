#!/usr/bin/env bash
# ビルドした WPHI を、利用者が展開してそのまま使える zip にする。
#
#   tools/package.sh windows|linux|macos
#
# zip の中身は WPHI/ の下に、アプリと空の chara・chip と README.txt。
# WPHI は、アプリを置いたフォルダの chara・chip から先に画像を探す(src-tauri/src/main.rs の app_folder)。
# 先に npm run tauri build で、その OS の配布物を作っておく。
set -euo pipefail

os="${1:?windows・linux・macos のどれかを渡す}"
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$root/src-tauri/tauri.conf.json').version")"
out="$root/dist-zip"
stage="$out/WPHI"
rm -rf "$stage"
mkdir -p "$stage/chara" "$stage/chip"

case "$os" in
  windows)
    # インストールせずに使う形。同梱のグラフィックスは実行ファイルの隣の phi に置く(Tauri の resource_dir)
    cp "$root/target/release/wphi.exe" "$stage/WPHI.exe"
    cp -R "$root/resources/phi" "$stage/phi"
    app="WPHI.exe"
    ;;
  linux)
    cp "$root"/target/release/bundle/appimage/*.AppImage "$stage/WPHI.AppImage"
    chmod +x "$stage/WPHI.AppImage"
    app="WPHI.AppImage"
    ;;
  macos)
    cp -R "$root/target/universal-apple-darwin/release/bundle/macos/WPHI.app" "$stage/WPHI.app"
    app="WPHI.app"
    ;;
  *)
    echo "windows・linux・macos のどれかを渡す: $os" >&2
    exit 1
    ;;
esac

# Windows のメモ帳でも読めるよう、改行は CRLF にする
{
  echo "WPHI $version"
  echo
  echo "$app を起動する。"
  echo
  echo "キャラグラは chara に、マップチップは chip に、Philly と同じ BMP で置く。"
  echo "ファイル名は <グラ名>.bmp(キャラグラ)、<マップセット名>.bmp(チップ)。"
  echo "置いた画像は、アプリを起動し直すと使われる。"
  echo "Philly のフォルダがあれば、キャラ選択の画面の「Philly から取り込む」で指定してもよい。"
  case "$os" in
    windows)
      echo
      echo "署名していないので、初めて開く時に Windows が警告を出す。"
      echo "「詳細情報」から「実行」を選ぶ。"
      ;;
    linux)
      echo
      echo "AppImage は FUSE(Ubuntu では libfuse2)が要る。"
      echo "無い時は APPIMAGE_EXTRACT_AND_RUN=1 ./WPHI.AppImage で起動する。"
      ;;
    macos)
      echo
      echo "署名していないので、開く前にターミナルで隔離属性を外す。"
      echo "  xattr -dr com.apple.quarantine WPHI.app"
      echo "外さずに開くと、macOS がアプリを別の場所に移して起動し、隣の chara と chip が見えなくなる。"
      ;;
  esac
} | sed 's/$/\r/' > "$stage/README.txt"

zip_name="WPHI-$version-$os.zip"
rm -f "$out/$zip_name"
case "$os" in
  # macOS の .app は ditto で固める(実行権限や拡張属性を保つ)
  macos) (cd "$out" && ditto -c -k --keepParent WPHI "$zip_name") ;;
  # Windows の CI(Git Bash)には zip が無いので PowerShell で固める
  windows) (cd "$out" && powershell -NoProfile -Command "Compress-Archive -Path WPHI -DestinationPath '$zip_name' -Force") ;;
  *) (cd "$out" && zip -qr "$zip_name" WPHI) ;;
esac
echo "$out/$zip_name"
