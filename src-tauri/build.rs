use std::fs;
use std::path::PathBuf;

fn main() {
    // 拷贝图标至纯英文 Temp 路径，彻底解决 MinGW windres 中文工作区路径报错
    let temp_ico = std::env::temp_dir().join("chunfengdu_app_icon.ico");
    let icon_src = PathBuf::from("icons/icon.ico");
    if icon_src.exists() {
        let _ = fs::copy(&icon_src, &temp_ico);
    }

    let mut windows = tauri_build::WindowsAttributes::new();
    if temp_ico.exists() {
        windows = windows.window_icon_path(&temp_ico);
    }

    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
