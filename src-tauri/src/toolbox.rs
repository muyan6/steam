use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolboxActionResult {
    pub success: bool,
    pub message: String,
    pub details: Option<Vec<String>>,
}

pub fn clear_steam_cache(steam_path: &Path) -> ToolboxActionResult {
    let mut cleaned = Vec::new();
    let cache_dirs = [
        "appcache\\httpcache",
        "config\\htmlcache",
        "steamui",
    ];

    for rel_path in cache_dirs {
        let p = steam_path.join(rel_path);
        if p.exists() {
            if fs::remove_dir_all(&p).is_ok() {
                cleaned.push(format!("已清理: {}", rel_path));
            }
        }
    }

    ToolboxActionResult {
        success: true,
        message: if cleaned.is_empty() {
            "未发现需要清理的冗余缓存目录".to_string()
        } else {
            format!("成功清理 {} 项 Steam 缓存目录！", cleaned.len())
        },
        details: Some(cleaned),
    }
}
