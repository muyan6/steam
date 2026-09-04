use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

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

pub fn clear_steam_cache(steam_path: &Path) -> ToolboxActionResult {
    let mut cleaned = Vec::new();
    let mut failed = Vec::new();
    // 仅清理真正的缓存目录；steamui 属于 Steam 客户端 UI 程序目录，不可删除
    let cache_dirs = [
        "appcache\\httpcache",
        "config\\htmlcache",
    ];

    for rel_path in cache_dirs {
        let p = steam_path.join(rel_path);
        if p.exists() {
            if fs::remove_dir_all(&p).is_ok() {
                cleaned.push(format!("已清理: {}", rel_path));
            } else {
                failed.push(format!("清理失败 (目录被占用或权限不足): {}", rel_path));
            }
        }
    }

    let success = failed.is_empty();
    let message = if !cleaned.is_empty() && success {
        format!("成功清理 {} 项 Steam 缓存目录！", cleaned.len())
    } else if !cleaned.is_empty() {
        format!("清理了 {} 项缓存，但部分目录清理失败（Steam 可能正在运行）", cleaned.len())
    } else if success {
        "未发现需要清理的冗余缓存目录".to_string()
    } else {
        "缓存目录清理失败，请先退出 Steam 后重试".to_string()
    };

    let mut steps = cleaned.clone();
    steps.extend(failed);

    ToolboxActionResult {
        success,
        message,
        steps: Some(steps),
        cleaned_files_count: Some(cleaned.len()),
        restarted_steam: None,
    }
}
