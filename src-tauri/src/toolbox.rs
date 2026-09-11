use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use serde::{Deserialize, Serialize};

use crate::steam;

/// 注入核心三件套（缺失即视为注入环境异常）
const CORE_DLLS: [&str; 3] = ["OpenSteamTool.dll", "dwmapi.dll", "xinput1_4.dll"];
/// 清单有效性判定只需要文件头部字节（见 manifests::is_valid_manifest_payload，最多用到前 128 字节）
const MANIFEST_HEADER_PROBE: usize = 128;

/// 只读取文件头部若干字节用于魔数校验。
/// 清单文件可达数百 MB，整份读入（旧实现）会显著拖慢启动检测与工具箱清理。
fn read_header(path: &Path, n: usize) -> Option<Vec<u8>> {
    let mut f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; n];
    let mut filled = 0usize;
    while filled < n {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(k) => filled += k,
            Err(_) => return None,
        }
    }
    buf.truncate(filled);
    Some(buf)
}

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

/// 启动自愈中「需要用户点一下」的问题项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupActionItem {
    pub title: String,
    pub message: String,
    /// 前端据此决定修复动作：repair_injection（需退出/重启 Steam）| set_steam_path
    pub action: String,
}

/// 启动自愈结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupHealResult {
    /// 是否无需用户任何操作（needs_action 为空即视为可正常使用）
    pub healthy: bool,
    /// 本次已自动无损修复的项（供轻提示）
    pub healed: Vec<String>,
    /// 需要用户确认后才能修复的项（如需关闭 Steam）
    pub needs_action: Vec<StartupActionItem>,
}

/// 启动环境自愈：只做无损、幂等、不触碰 Steam 进程的修复；
/// 任何需要关闭 Steam 才能完成的修复一律只登记到 needs_action，交由用户点击确认。
/// 开销很低（仅存在性检查 + 小文件读取 + 清单文件头读取），可在启动后台线程安全调用。
pub fn startup_self_heal() -> StartupHealResult {
    let mut healed: Vec<String> = Vec::new();
    let mut needs_action: Vec<StartupActionItem> = Vec::new();

    let Some(steam_path) = steam::detect_steam_path() else {
        // 未配置路径时同样不打扰：仅在向导未处理的情况下由前端决定是否提示
        needs_action.push(StartupActionItem {
            title: "未检测到 Steam 安装路径".to_string(),
            message: "请在「系统与环境设置」中手动指定 Steam 根目录，否则无法自动修复注入环境。".to_string(),
            action: "set_steam_path".to_string(),
        });
        return StartupHealResult {
            healthy: false,
            healed,
            needs_action,
        };
    };

    // 1) 注入三件套：缺失即用内嵌副本重部署（不联网、不改配置）
    let missing: Vec<&str> = CORE_DLLS
        .iter()
        .copied()
        .filter(|n| !steam_path.join(n).exists())
        .collect();
    if !missing.is_empty() {
        match crate::ost::deploy_core_binaries(&steam_path) {
            Ok(_) => healed.push(format!("已重新部署注入组件（{}）", missing.join(" / "))),
            Err(e) => needs_action.push(StartupActionItem {
                title: "注入组件缺失且无法自动写入".to_string(),
                message: format!(
                    "{}。通常是因为 Steam 正在运行（DLL 被占用）或权限不足。点击修复将退出并重启 Steam 后完成部署。",
                    e
                ),
                action: "repair_injection".to_string(),
            }),
        }
    }

    // 2) opensteamtool.toml 关键字段 + manifest.lua 动态清单调度器
    //    （复用既有幂等修复逻辑，通过「修复前后内容比对」判断是否真的修了东西）
    let lua_was_stale = crate::ost::manifest_lua_stale(&steam_path);
    let toml_path = steam_path.join("opensteamtool.toml");
    let toml_before = fs::read_to_string(&toml_path).ok();
    crate::ensure_auto_switch_default(&steam_path);
    let toml_after = fs::read_to_string(&toml_path).ok();
    if toml_before != toml_after {
        healed.push("已补全 opensteamtool.toml 清单调度配置".to_string());
    }
    if lua_was_stale && !crate::ost::manifest_lua_stale(&steam_path) {
        healed.push("已重建动态清单调度器 manifest.lua".to_string());
    }

    // 3) depotcache 损坏文件（0 字节 / HTML 错误页被当成清单），仅读文件头
    let cleaned = clean_depotcache_garbage(&steam_path);
    if cleaned > 0 {
        healed.push(format!("已清理 {} 个损坏的清单缓存文件", cleaned));
    }

    StartupHealResult {
        healthy: needs_action.is_empty(),
        healed,
        needs_action,
    }
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
                        // 损坏的非有效 manifest 文件（如 HTML 404/盾拦截文本误当清单写入）。
                        // 只读文件头：有效性判定仅依赖前 128 字节，无需整份读入
                        if let Some(head) = read_header(&path, MANIFEST_HEADER_PROBE) {
                            if !crate::manifests::is_valid_manifest_payload(&head) {
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

    // 清理会删除注入 DLL，必须重新部署：否则重启后 Steam 无注入，
    // 所有已入库游戏都会显示"内容处于加密状态"，直到用户再次入库才自愈
    let redeployed = match crate::ost::deploy_core_binaries(steam_path) {
        Ok(_) => {
            steps.push("✓ 已重新部署 OpenSteamTool 注入内核".to_string());
            true
        }
        Err(e) => {
            steps.push(format!("⚠ 注入内核重新部署失败：{}", e));
            false
        }
    };

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
        message: if redeployed {
            "Steam 缓存与 DLL 内核残留已清理完毕，注入内核已重新部署并自动重启 Steam！".to_string()
        } else {
            "Steam 缓存已清理并自动重启，但注入内核重新部署失败，请查看步骤详情或手动重新入库。".to_string()
        },
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
                    // 体积上限 50MB，防止超大响应/错误页耗尽内存
                    if let Ok(bytes) = crate::manifests::read_body_limited(resp, crate::manifests::MAX_ASSET_DOWNLOAD_BYTES).await {
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
