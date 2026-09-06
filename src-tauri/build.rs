use std::fs;
use std::path::PathBuf;

/// 编译前尽力重新生成内嵌游戏字典：调用 server/scripts/build-game-dict.mjs
/// 把 server/data/steam_all_games.json + chinese_games_cache.json 编译为
/// data/game_dict.bin（include_bytes! 嵌入 app.exe）。
/// node 不可用或脚本失败时仅打印提示并继续使用仓库中已提交的 game_dict.bin，
/// 绝不因数据再生成失败而中断构建。
fn regenerate_game_dict() {
    // 已生成的字典比两份源数据都新时直接跳过：既省一次 node 启动，
    // 也避免重写相同字节导致 mtime 变化触发 include_bytes! 无谓重编
    let bin = PathBuf::from("data/game_dict.bin");
    let src_main = PathBuf::from("../server/data/steam_all_games.json");
    if bin.exists() {
        let bin_time = fs::metadata(&bin).and_then(|m| m.modified()).ok();
        let src_time = fs::metadata(&src_main).and_then(|m| m.modified()).ok();
        if let (Some(b), Some(s)) = (bin_time, src_time) {
            if b >= s {
                println!("[build.rs] data/game_dict.bin 已是最新，跳过字典再生成");
                return;
            }
        }
    }

    let script = PathBuf::from("../server/scripts/build-game-dict.mjs");
    if !script.exists() {
        println!("cargo:warning=未找到 server/scripts/build-game-dict.mjs，游戏字典沿用已提交的 data/game_dict.bin");
        return;
    }
    // 构建脚本的默认工作目录即本 crate 根目录（src-tauri）
    match std::process::Command::new("node")
        .arg(&script)
        .status()
    {
        Ok(status) if status.success() => {
            println!("[build.rs] 游戏字典已从服务端数据重新生成 (data/game_dict.bin)");
        }
        Ok(status) => {
            println!("cargo:warning=build-game-dict.mjs 执行失败 ({})，游戏字典沿用已提交的 data/game_dict.bin", status);
        }
        Err(e) => {
            println!("cargo:warning=node 不可用 ({}), 游戏字典沿用已提交的 data/game_dict.bin", e);
        }
    }
}

fn main() {
    // 依赖变化时才重新执行本脚本（声明后 Cargo 默认的"任意文件变更即重跑"失效，
    // 但 build.rs 自身的变更仍会自动触发重跑）
    regenerate_game_dict();
    println!("cargo:rerun-if-changed=../server/data/steam_all_games.json");
    println!("cargo:rerun-if-changed=../server/data/chinese_games_cache.json");
    println!("cargo:rerun-if-changed=data/game_dict.bin");

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
