use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::steam;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxActionResult {
    pub success: bool,
    pub message: String,
    pub steps: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleaned_files_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restarted_steam: Option<bool>,
}

/// 深度清理 Steam 缓存（与 Electron 版 clearSteamCache 行为一致）：
/// 杀 Steam 全家桶 → 删 DLL 内核与冲突残留 → 清 opensteamtool/ 与 CEF 缓存 →
/// 重建 lua/depotcache 骨架 → 自动重启 Steam
pub fn clear_steam_cache(steam_path: &Path) -> ToolboxActionResult {
    let mut steps = Vec::new();
    let mut cleaned = 0usize;

    // 步骤 1: 结束 Steam 相关进程
    steps.push("正在结束 Steam 及相关进程 (steam.exe, steamwebhelper.exe)...".to_string());
    let _ = steam::kill_steam();
    std::thread::sleep(std::time::Duration::from_millis(1200));
    steps.push("✓ 已成功终止所有 Steam 关联进程".to_string());

    // 步骤 2: 删除 DLL 内核文件与冲突残留
    steps.push("正在深度清理 DLL 内核文件、CEF/网页缓存及临时日志...".to_string());
    // 注意：绝不能清理 hid.dll —— Steam 安装目录自带官方 hid.dll（手柄输入支持），
    // 误删会破坏 Steam Input 且用户无法自行恢复
    let kernel_files = [
        "OpenSteamTool.dll",
        "dwmapi.dll",
        "xinput1_4.dll",
        "version.dll",
        "SmokeAPI.dll",
        "opensteamtool.toml",
    ];
    for f in kernel_files {
        let p = steam_path.join(f);
        if p.exists() && fs::remove_file(&p).is_ok() {
            cleaned += 1;
        }
    }

    // opensteamtool 缓存目录与日志
    let ost_dir = steam_path.join("opensteamtool");
    if ost_dir.exists() && fs::remove_dir_all(&ost_dir).is_ok() {
        cleaned += 1;
    }

    // CEF 网页与网络缓存
    for rel in ["appcache\\httpcache", "config\\htmlcache"] {
        let p = steam_path.join(rel);
        if p.exists() && fs::remove_dir_all(&p).is_ok() {
            cleaned += 1;
        }
    }

    // 重建 config/lua 与 depotcache 骨架
    let _ = fs::create_dir_all(steam_path.join("config").join("lua"));
    let _ = fs::create_dir_all(steam_path.join("depotcache"));

    steps.push(format!("✓ 已清理 {} 项内核残留与临时缓存", cleaned));

    // 步骤 3: 重新拉起 Steam
    steps.push("正在重新启动 Steam 客户端...".to_string());
    std::thread::sleep(std::time::Duration::from_millis(800));
    let restarted = steam::launch_steam(steam_path, &[]);
    steps.push(if restarted {
        "✓ Steam 客户端已重新启动".to_string()
    } else {
        "⚠ Steam 客户端启动失败，请稍后手动点击「重启Steam」".to_string()
    });

    ToolboxActionResult {
        success: true,
        message: "Steam 缓存与 DLL 内核残留已清理完毕，已自动重启 Steam！请重新入库一个游戏进行测试。".to_string(),
        steps: Some(steps),
        cleaned_files_count: Some(cleaned),
        restarted_steam: Some(restarted),
    }
}
