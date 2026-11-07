fn main() {
    // 同梱のグラフィックスは include_dir で実行ファイルに埋め込むので、変わったら作り直す
    println!("cargo:rerun-if-changed=../resources/phi");
    tauri_build::build()
}
