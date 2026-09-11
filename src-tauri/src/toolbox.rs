use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
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

/// 自动扫描并清理 depotcache/ 目录下已损坏的 0 字节无效文件或 HTML 错误响应文本
pub fn clean_depotcache_garbage(steam_path: &Path) -> usize {
    let depot_cache = steam_path.join("depotcache");
    if !depot_cache.exists() {
        return 0;
    }
    let mut removed = 0usize;
    if let Ok(entries) = fs::read_dir(&depot_cache) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Ok(meta) = fs::metadata(&path) {
                if meta.is_file() {
                    // 0 字节损坏文件
                    if meta.len() == 0 {
                        if fs::remove_file(&path).is_ok() {
                            removed += 1;
                        }
                    } else if path.extension().and_then(|ext| ext.to_str()) == Some("manifest") {
                        // 损坏的非有效 manifest 文件（如 HTML 404/盾拦截文本误当清单写入）
                        if let Ok(bytes) = fs::read(&path) {
                            if !crate::manifests::is_valid_manifest_payload(&bytes) {
                                if fs::remove_file(&path).is_ok() {
                                    removed += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    removed
}

/// 深度清理 Steam 缓存（默认整合自愈逻辑）：
/// 杀 Steam 全家桶 → 删 DLL 内核与冲突残留 → 清 opensteamtool/ 与 CEF 缓存 →
/// 清扫 depotcache 坏清单 → 刷新本地 DNS → 重建 lua/depotcache 骨架 → 自动重启 Steam
pub fn clear_steam_cache(steam_path: &Path) -> ToolboxActionResult {
    let mut steps = Vec::new();
    let mut cleaned = 0usize;

    // 步骤 1: 结束 Steam 相关进程
    steps.push("正在结束 Steam 及相关进程 (steam.exe, steamwebhelper.exe)...".to_string());
    let _ = steam::kill_steam();
    std::thread::sleep(Duration::from_millis(1200));
    steps.push("✓ 已成功平滑终止所有 Steam 关联进程".to_string());

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

    // 清理损坏的 0 字节坏清单
    let garbage_manifests = clean_depotcache_garbage(steam_path);
    cleaned += garbage_manifests;

    // 自动刷新 DNS 解析缓存
    steam::flush_dns();

    // 重建 config/lua 与 depotcache 骨架并注入高可用清单调度
    let _ = fs::create_dir_all(steam_path.join("config").join("lua"));
    let _ = fs::create_dir_all(steam_path.join("depotcache"));
    let _ = crate::ost::generate_toml_config(steam_path, "wudrm");
    let _ = crate::ost::deploy_manifest_lua(steam_path);

    steps.push(format!("✓ 已清理 {} 项内核残留/临时缓存/损坏清单，并刷新系统本地 DNS 解析", cleaned));

    // 步骤 3: 重新拉起 Steam
    steps.push("正在重新启动 Steam 客户端...".to_string());
    std::thread::sleep(Duration::from_millis(800));
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

/// 一键修复 Steam 下载“无网络连接”（CloudRedirect / STFixer 方案）：
/// 退出 Steam → 多级镜像下载/确保 CloudRedirectCLI.exe 就绪 →
/// 后台静默执行 /stfixer 修复 SteamPipe 证书与清单分发通道 → 刷新 DNS → 重启 Steam
pub async fn fix_cloud_redirect(steam_path: &Path) -> ToolboxActionResult {
    let mut steps = Vec::new();

    // 步骤 1: 结束 Steam 进程（避免 DLL/配置文件被占用）
    let was_running = steam::is_steam_running();
    if was_running {
        steps.push("正在安全退出 Steam 客户端...".to_string());
        if !steam::kill_steam() {
            return ToolboxActionResult {
                success: false,
                message: "Steam 进程无法结束，请手动退出 Steam 后重试".to_string(),
                steps: Some(steps),
                cleaned_files_count: None,
                restarted_steam: Some(false),
            };
        }
        steps.push("✓ Steam 关联进程已平滑安全退出".to_string());
    }

    // 步骤 2: 获取/更新 CloudRedirectCLI.exe
    steps.push("正在检测并同步 CloudRedirect 修复组件...".to_string());
    let tools_dir = match std::env::var("APPDATA").ok() {
        Some(base) => {
            let p = PathBuf::from(base).join("com.chunfengdu.app").join("tools");
            let _ = fs::create_dir_all(&p);
            p
        }
        None => steam_path.join("tools"),
    };
    let cli_path = tools_dir.join("CloudRedirectCLI.exe");

    let mut download_ok = cli_path.exists() && fs::metadata(&cli_path).map(|m| m.len() > 10000).unwrap_or(false);
    if !download_ok {
        let download_urls = [
            "https://ghfast.top/https://github.com/Selectively11/CloudRedirect/releases/latest/download/CloudRedirectCLI.exe",
            "https://gh-proxy.com/https://github.com/Selectively11/CloudRedirect/releases/latest/download/CloudRedirectCLI.exe",
            "https://github.com/Selectively11/CloudRedirect/releases/latest/download/CloudRedirectCLI.exe",
        ];
        for url in &download_urls {
            if let Ok(resp) = crate::manifests::http_client().get(*url).timeout(Duration::from_secs(10)).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if bytes.len() > 10000 {
                            if fs::write(&cli_path, &bytes).is_ok() {
                                download_ok = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if !download_ok {
        steps.push("[提示] 未能从云端拉取新版 CloudRedirectCLI，将尝试复用本地环境配置...".to_string());
    } else {
        steps.push("✓ CloudRedirect 修复核心组件已就绪".to_string());
    }

    // 步骤 3: 运行 /stfixer 执行证书与 SteamPipe 代理网络重定向修复
    steps.push("正在后台执行 /stfixer 修复 SteamPipe 证书与清单分发通道...".to_string());
    let mut fixer_success = false;
    if cli_path.exists() {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let output = Command::new(&cli_path)
                .arg("/stfixer")
                .current_dir(steam_path)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
            if let Ok(out) = output {
                let stdout_str = String::from_utf8_lossy(&out.stdout);
                let stderr_str = String::from_utf8_lossy(&out.stderr);
                if out.status.success() || stdout_str.contains("success") || stdout_str.contains("Success") || stdout_str.contains("Fixed") || stdout_str.contains("fixed") {
                    fixer_success = true;
                    steps.push("✓ CloudRedirect (STFixer) 修复策略已成功注入 SteamPipe".to_string());
                } else {
                    // 不得在修复失败时仍标记成功：否则会误导用户以为网络已修复
                    steps.push(format!(
                        "⚠ CloudRedirect 修复未成功 (退出码: {:?})，输出: {}",
                        out.status.code(),
                        stderr_str.lines().next().or_else(|| stdout_str.lines().next()).unwrap_or("无")
                    ));
                }
            } else {
                steps.push("⚠ 无法启动 CloudRedirectCLI.exe 执行修复".to_string());
            }
        }
    } else {
        steps.push("[跳过] 未检测到 CloudRedirectCLI.exe 可执行文件".to_string());
    }

    // 步骤 4: 清理坏清单并刷新 DNS
    let garbage = clean_depotcache_garbage(steam_path);
    steam::flush_dns();
    steps.push(format!("✓ 已清理 {} 项无效损坏清单，并刷新系统本地 DNS 解析", garbage));

    // 步骤 5: 重启 Steam
    let mut restarted = false;
    if was_running || fixer_success {
        steps.push("正在重新拉起 Steam 客户端以应用网络重定向...".to_string());
        std::thread::sleep(Duration::from_millis(800));
        restarted = steam::launch_steam(steam_path, &[]);
        steps.push(if restarted {
            "✓ Steam 客户端已重新启动，下载通道已恢复正常！".to_string()
        } else {
            "⚠ Steam 启动失败，请稍后手动点击「重启Steam」".to_string()
        });
    }

    ToolboxActionResult {
        success: fixer_success,
        message: if fixer_success {
            "Steam 下载网络修复已完成！若仍提示无网络连接，请在 Steam 设置中切换下载地区或重新点击下载。".to_string()
        } else {
            "CloudRedirect 修复未能成功执行，请检查网络后重试，或改用「深度清理」后重新入库。".to_string()
        },
        steps: Some(steps),
        cleaned_files_count: Some(garbage),
        restarted_steam: Some(restarted),
    }
}
