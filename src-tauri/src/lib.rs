pub mod steam;
pub mod ost;
pub mod device;
pub mod toolbox;
pub mod localgames;
pub mod manifests;
pub mod onlinefix;
pub mod steamless;

use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use crate::steam::SteamEnvironmentInfo;
use crate::ost::UnlockGamePayload;
use crate::toolbox::ToolboxActionResult;

/// 打开任意 URL（steam:// 协议等），供本地模块复用
pub fn open_url_cmd(url: &str) -> Result<(), String> {
    // AppHandle::current() 仅在命令/事件回调线程中可用；此处通过全局句柄兜底
    match APP_HANDLE.get() {
        Some(app) => app
            .opener()
            .open_url(url.to_string(), None::<&str>)
            .map_err(|e| format!("打开链接失败: {}", e)),
        None => Err("应用句柄未就绪".to_string()),
    }
}

static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

// 窗口控制命令
#[tauri::command]
fn window_minimize(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_maximize(window: Window) -> bool {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
            false
        } else {
            let _ = window.maximize();
            true
        }
    } else {
        false
    }
}

#[tauri::command]
fn window_close(window: Window) {
    let _ = window.close();
}

#[tauri::command]
fn is_window_maximized(window: Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn app_quit(app_handle: AppHandle) {
    app_handle.exit(0);
}

// 设备机器码
#[tauri::command]
fn get_device_id() -> String {
    device::get_device_id()
}

// Steam 环境命令
#[tauri::command]
async fn get_steam_info(custom_path: Option<String>) -> SteamEnvironmentInfo {
        tauri::async_runtime::spawn_blocking(move || { steam::get_steam_info(custom_path.as_deref()) })
        .await
        .unwrap_or_else(|_e| steam::get_steam_info(None))
    }

#[tauri::command]
fn set_steam_path(path: String) -> Result<SteamEnvironmentInfo, String> {
    let p = PathBuf::from(&path);
    if !p.join("steam.exe").exists() {
        return Err(format!("所选目录下未找到 steam.exe: {}", path));
    }
    steam::save_custom_steam_path(&path);
    Ok(steam::get_steam_info(Some(&path)))
}

#[tauri::command]
async fn restart_steam(extra_args: Option<Vec<String>>) -> bool {
        tauri::async_runtime::spawn_blocking(move || { if let Some(steam_path) = steam::detect_steam_path() {
        let args = extra_args.unwrap_or_default();
        steam::restart_steam(&steam_path, &args)
    } else {
        false
    } })
        .await
        .unwrap_or_else(|_e| false)
    }

// Steam 目录选择与打开（对应 Electron 版 selectDirectory / openFolder）
#[tauri::command]
async fn select_directory(app_handle: AppHandle) -> Option<String> {
        tauri::async_runtime::spawn_blocking(move || { app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string()) })
        .await
        .unwrap_or_else(|_e| None)
    }

#[tauri::command]
fn open_path(app_handle: AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("路径为空".to_string());
    }
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("目录不存在: {}", path));
    }
    app_handle
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开目录失败: {}", e))
}

// 解析清单服务器配置：选择 custom 时必须提供自定义地址
fn resolve_manifest_server(
    manifest_api: Option<String>,
    custom_api_url: Option<String>,
) -> Result<String, String> {
    let api = manifest_api.unwrap_or_else(|| "steamrun".to_string());
    if api == "custom" {
        match custom_api_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            Some(url) => Ok(url),
            None => Err("已选择「自定义」清单服务器，但未填写自定义地址".to_string()),
        }
    } else {
        Ok(api)
    }
}

// OpenSteamTool 核心命令
#[tauri::command]
async fn ensure_ost_env(manifest_api: Option<String>, custom_api_url: Option<String>) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { let server = match resolve_manifest_server(manifest_api, custom_api_url) {
        Ok(s) => s,
        Err(e) => return json!({ "success": false, "message": e }),
    };

    if let Some(steam_path) = steam::detect_steam_path() {
        let _ = ost::generate_toml_config(&steam_path, &server);
        let _ = ost::ensure_lua_dir(&steam_path);
        match ost::deploy_core_binaries(&steam_path) {
            Ok(_) => json!({ "success": true, "message": "OpenSteamTool 配置文件与运行环境已成功就绪！" }),
            Err(e) => json!({ "success": false, "message": e }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    } })
        .await
        .unwrap_or_else(|e| json!({ "success": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
async fn activate_injection(
    manifest_api: Option<String>,
    custom_api_url: Option<String>,
    restart_steam: Option<bool>,
) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { let server = match resolve_manifest_server(manifest_api, custom_api_url) {
        Ok(s) => s,
        Err(e) => return json!({ "success": false, "message": e }),
    };

    if let Some(steam_path) = steam::detect_steam_path() {
        let _ = ost::generate_toml_config(&steam_path, &server);
        let _ = ost::ensure_lua_dir(&steam_path);
        if let Err(e) = ost::deploy_core_binaries(&steam_path) {
            return json!({ "success": false, "message": e });
        }

        let mut restarted = false;
        if restart_steam.unwrap_or(true) {
            restarted = steam::restart_steam(&steam_path, &[]);
        }

        json!({
            "success": true,
            "message": "OpenSteamTool 内核注入成功！",
            "steamPath": steam_path.to_string_lossy(),
            "steamRestarted": restarted
        })
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    } })
        .await
        .unwrap_or_else(|e| json!({ "success": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
async fn unlock_game(payload: UnlockGamePayload) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(steam_path) = steam::detect_steam_path() {
            match ost::save_lua_rule(&steam_path, &payload) {
                Ok(res) => {
                    // 与 Electron 版一致：入库成功后立即预缓存清单到 depotcache（入库即就绪）
                    let mut precache_text = String::new();
                    if let Some(meta) = &res.metadata {
                        let pc = manifests::precache_manifests(&steam_path, meta);
                        if pc.total > 0 {
                            precache_text = format!("，清单预缓存 {}/{} 已就绪", pc.ok_count, pc.total);
                        }
                    }
                    let name = payload.name_zh.clone().unwrap_or_else(|| payload.name.clone());
                    // 只有真正注入了分包密钥才提示"可直接下载"；
                    // 仅有清单 GID（如 SteamCMD 降级数据）时如实警告下载可能 0 字节
                    let message = if res.metadata_ok && res.key_count > 0 {
                        format!(
                            "成功为「{}」写入标准入库规则（已注入 {} 个分包密钥、{} 条清单 GID，含 {} 个 DLC{}）！已自动热生效，直接在库中搜索即可下载！",
                            name, res.key_count, res.manifest_count, res.dlc_count, precache_text
                        )
                    } else if res.metadata_ok && res.manifest_count > 0 {
                        format!(
                            "成功为「{}」写入入库规则（已固定 {} 条清单 GID，但服务端暂无可用分包密钥{}），直接下载可能为 0 字节！建议稍后重新入库以补齐密钥。",
                            name, res.manifest_count, precache_text
                        )
                    } else if res.metadata_ok {
                        format!(
                            "成功为「{}」写入入库授权（服务器暂无该游戏的密钥/清单数据，共 {} 个分包{}）！已自动热生效，可尝试下载或稍后重试入库。",
                            name, res.depot_count, precache_text
                        )
                    } else {
                        format!(
                            "已为「{}」写入入库授权，但未能连接密钥服务器获取分包密钥与清单，下载可能为 0 字节！请检查网络后重新入库，或在库中对该游戏执行「预缓存」。",
                            name
                        )
                    };
                    json!({
                        "success": true,
                        "message": message,
                        "scriptPath": res.lua_path.to_string_lossy(),
                        "keyCount": res.key_count,
                        "manifestCount": res.manifest_count,
                        "metadataOk": res.metadata_ok
                    })
                }
                Err(e) => json!({ "success": false, "message": e }),
            }
        } else {
            json!({ "success": false, "message": "未找到 Steam 客户端路径" })
        }
    })
    .await
    .unwrap_or_else(|e| json!({ "success": false, "message": format!("入库任务执行失败: {}", e) }))
}

#[tauri::command]
fn get_unlocked_games() -> Vec<u32> {
    if let Some(steam_path) = steam::detect_steam_path() {
        ost::get_unlocked_app_ids(&steam_path)
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn remove_unlocked_game(app_id: u32) -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        match ost::remove_unlocked_rule(&steam_path, app_id) {
            Ok(_) => json!({ "success": true, "message": format!("已成功移除 AppID {} 的入库规则", app_id) }),
            Err(e) => json!({ "success": false, "message": e }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    }
}

#[tauri::command]
fn clear_all_games() -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        match ost::clear_all_rules(&steam_path) {
            Ok(res) => {
                if res.failed > 0 {
                    json!({ "success": false, "count": res.removed, "message": format!("已移除 {} 条规则，但 {} 条删除失败（可能被占用）", res.removed, res.failed) })
                } else {
                    json!({ "success": true, "count": res.removed, "message": format!("已清空全部 {} 个游戏的入库规则！", res.removed) })
                }
            }
            Err(e) => json!({ "success": false, "message": e }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    }
}

#[tauri::command]
fn uninstall_injection() -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        match ost::uninstall_injection_files(&steam_path) {
            Ok(_) => json!({ "success": true, "message": "已成功卸载 OpenSteamTool 注入文件。" }),
            Err(failed) => json!({ "success": false, "message": format!("部分注入文件卸载失败: {}", failed) }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    }
}

// 环境体检：返回与 Electron 版一致的 EnvironmentDiagnosticResult 结构
#[tauri::command]
async fn check_environment_health() -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { let mut items: Vec<serde_json::Value> = Vec::new();

    let steam_path = steam::detect_steam_path();
    match &steam_path {
        None => {
            items.push(json!({
                "name": "Steam 安装路径",
                "category": "path",
                "status": "error",
                "message": "未检测到 Steam 安装路径",
                "detail": "请在设置中手动浏览并指定 Steam 安装根目录。"
            }));
        }
        Some(p) => {
            let exe_ok = p.join("steam.exe").exists();
            // 与 Electron 版语义一致：按宿主系统架构报告
            let bitness = if steam::is_64bit_windows() { "x64".to_string() } else { "x86".to_string() };
            let bitness_text = if bitness == "x86" { "32 位 (x86)" } else { "64 位 (x64)" };
            items.push(json!({
                "name": "Steam 核心主程序",
                "category": "path",
                "status": if exe_ok { "success" } else { "error" },
                "message": if exe_ok { format!("路径有效 ({})", bitness_text) } else { "指定目录下未找到 steam.exe".to_string() },
                "detail": p.to_string_lossy()
            }));

            let has_core = p.join("OpenSteamTool.dll").exists();
            let has_hijack = p.join("dwmapi.dll").exists() || p.join("xinput1_4.dll").exists();
            items.push(json!({
                "name": "OpenSteam 注入模块 (DLL)",
                "category": "hook",
                "status": if has_core && has_hijack { "success" } else { "error" },
                "message": if has_core && has_hijack { "核心 Hook DLL 已就绪".to_string() } else { "未检测到 Hook 模块 (缺少 OpenSteamTool.dll / dwmapi.dll / xinput1_4.dll)".to_string() },
                "detail": p.to_string_lossy()
            }));

            let toml_path = p.join("opensteamtool.toml");
            let toml_exists = toml_path.exists();
            items.push(json!({
                "name": "配置文件 opensteamtool.toml",
                "category": "config",
                "status": if toml_exists { "success" } else { "warning" },
                "message": if toml_exists { "配置文件已就绪".to_string() } else { "尚未生成 opensteamtool.toml".to_string() },
                "detail": toml_path.to_string_lossy()
            }));

            let lua_dir = p.join("config").join("lua");
            let rules = steam::count_unlocked_scripts(p);
            items.push(json!({
                "name": "规则引擎目录 config/lua/",
                "category": "scripts",
                "status": if lua_dir.exists() { "success" } else { "warning" },
                "message": if lua_dir.exists() { format!("规则目录正常，已收录 {} 款应用自动化解锁规则", rules) } else { "规则目录尚未创建".to_string() },
                "detail": lua_dir.to_string_lossy()
            }));
        }
    }

    let running = steam::is_steam_running();
    items.push(json!({
        "name": "Steam 客户端运行状态",
        "category": "process",
        "status": if running { "success" } else { "warning" },
        "message": if running { "Steam 正在运行".to_string() } else { "Steam 客户端当前未运行".to_string() },
        "detail": ""
    }));

    let has_error = items.iter().any(|i| i["status"] == "error");
    let has_warning = items.iter().any(|i| i["status"] == "warning");
    let overall = if has_error { "error" } else if has_warning { "partial" } else { "ready" };
    let summary = match overall {
        "ready" => "所有环境组件均已完美配置，OpenSteam 运行环境已就绪！",
        "partial" => "环境基础项已配置，部分状态建议点击同步或重启优化。",
        _ => "检测到影响正常解锁的核心项异常，请根据提示进行修复。",
    };

    json!({
        "overallStatus": overall,
        "summary": summary,
        "items": items,
        "checkedAt": chrono_like_now()
    }) })
        .await
        .unwrap_or_else(|_e| json!({ "overallStatus": "partial", "summary": "体检任务执行失败", "items": [], "checkedAt": local_time_string() }))
    }

fn chrono_like_now() -> String {
    local_time_string()
}

/// 生成可读的本地时间字符串（UTC+8，无外部依赖）
fn local_time_string() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        + 8 * 3600; // UTC+8
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, m, sec) = (rem / 3600, rem % 3600 / 60, rem % 60);
    // Howard Hinnant civil_from_days 算法
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, d, h, m, sec)
}

// 工具箱
fn toolbox_action(success: bool, message: String, steps: Vec<String>) -> ToolboxActionResult {
    ToolboxActionResult {
        success,
        message,
        steps: Some(steps),
        cleaned_files_count: None,
        restarted_steam: None,
    }
}

#[tauri::command]
async fn toolbox_clear_cache() -> ToolboxActionResult {
        tauri::async_runtime::spawn_blocking(move || { if let Some(steam_path) = steam::detect_steam_path() {
        toolbox::clear_steam_cache(&steam_path)
    } else {
        toolbox_action(false, "未找到 Steam 客户端路径".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()])
    } })
        .await
        .unwrap_or_else(|e| toolbox::ToolboxActionResult { success: false, message: format!("任务执行失败: {}", e), steps: Some(Vec::new()), cleaned_files_count: None, restarted_steam: None })
    }

#[tauri::command]
async fn toolbox_repair_ost(manifest_api: Option<String>, custom_api_url: Option<String>) -> ToolboxActionResult {
        tauri::async_runtime::spawn_blocking(move || { if let Some(steam_path) = steam::detect_steam_path() {
        let mut steps = Vec::new();
        // 尊重用户在设置页选择的清单服务器，而非硬编码
        let server = match resolve_manifest_server(manifest_api, custom_api_url) {
            Ok(s) => s,
            Err(e) => return toolbox_action(false, e, steps),
        };
        let was_running = steam::is_steam_running();
        if was_running {
            steps.push("正在安全退出 Steam 客户端...".to_string());
            if !steam::kill_steam() {
                return toolbox_action(false, "Steam 进程无法结束（可能以管理员运行），请手动退出后重试".to_string(), steps);
            }
            steps.push("✓ Steam 进程已退出".to_string());
        }

        if let Err(e) = ost::generate_toml_config(&steam_path, &server) {
            return toolbox_action(false, format!("修复失败: {}", e), steps);
        }
        let _ = ost::ensure_lua_dir(&steam_path);
        match ost::deploy_core_binaries(&steam_path) {
            Ok(_) => {
                steps.push("✓ OpenSteamTool.dll / dwmapi.dll / xinput1_4.dll 已重新部署".to_string());
                steps.push("✓ opensteamtool.toml 配置已重建".to_string());
                let restarted = if was_running {
                    steps.push("正在重新启动 Steam 客户端...".to_string());
                    let ok = steam::launch_steam(&steam_path, &[]);
                    steps.push(if ok { "✓ Steam 客户端已启动".to_string() } else { "⚠ Steam 启动失败，请手动启动".to_string() });
                    ok
                } else {
                    false
                };
                ToolboxActionResult {
                    success: true,
                    message: "OpenSteamTool 动态链接库与配置文件已重新部署修复完毕！".to_string(),
                    steps: Some(steps),
                    cleaned_files_count: None,
                    restarted_steam: Some(restarted),
                }
            }
            Err(e) => {
                steps.push(format!("[错误] {}", e));
                toolbox_action(false, format!("修复失败: {}", e), steps)
            }
        }
    } else {
        toolbox_action(false, "未找到 Steam 客户端路径".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()])
    } })
        .await
        .unwrap_or_else(|e| toolbox::ToolboxActionResult { success: false, message: format!("任务执行失败: {}", e), steps: Some(Vec::new()), cleaned_files_count: None, restarted_steam: None })
    }

// 读取 opensteamtool.toml 中的 server 值
fn read_toml_server(steam_path: &std::path::Path) -> (bool, String) {
    let toml_path = steam_path.join("opensteamtool.toml");
    let mut auto_switch = false;
    let mut server = "steamrun".to_string();
    if let Ok(content) = std::fs::read_to_string(toml_path) {
        auto_switch = content.contains("auto_switch = true");
        for line in content.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("server") {
                let rest = rest.trim_start();
                if let Some(rest) = rest.strip_prefix('=') {
                    let v = rest.trim().trim_matches('"');
                    if !v.is_empty() {
                        server = v.to_string();
                    }
                }
            }
        }
    }
    (auto_switch, server)
}

// 工具箱状态（对应 Electron 版 toolboxGetStatus / ToolboxStatusInfo）
#[tauri::command]
fn get_toolbox_status() -> serde_json::Value {
    let steam_path = steam::detect_steam_path();
    match &steam_path {
        None => json!({
            "steamPath": null,
            "isRunning": false,
            "hasOpenSteamTool": false,
            "hasSha256Cache": false,
            "autoSwitchEnabled": false,
            "currentManifestServer": "steamrun"
        }),
        Some(p) => {
            let (auto_switch, server) = read_toml_server(p);
            json!({
                "steamPath": p.to_string_lossy(),
                "isRunning": steam::is_steam_running(),
                "hasOpenSteamTool": p.join("OpenSteamTool.dll").exists(),
                "hasSha256Cache": p.join("opensteamtool").join("sha256.json").exists(),
                "autoSwitchEnabled": auto_switch,
                "currentManifestServer": server
            })
        }
    }
}

/// 对 opensteamtool.toml 做 [manifest] 段内字段级更新（保留其余用户配置）
fn update_toml_manifest_fields(
    steam_path: &std::path::Path,
    updates: &[(&str, &str)],
) -> Result<(), String> {
    let toml_path = steam_path.join("opensteamtool.toml");
    let content = std::fs::read_to_string(&toml_path).unwrap_or_else(|_| {
        "# OpenSteamTool Configuration generated by 春风渡\n[inject]\nenabled = true\n".to_string()
    });

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut pending: Vec<(&str, &str)> = updates.to_vec();
    let mut in_manifest = false;
    let mut has_manifest_section = false;
    let mut insert_at: Option<usize> = None;

    for i in 0..lines.len() {
        let t = lines[i].trim().to_string();
        if t.starts_with('[') && t.ends_with(']') {
            if in_manifest && !pending.is_empty() && insert_at.is_none() {
                // 离开 [manifest] 段：剩余键插在段尾
                insert_at = Some(i);
            }
            in_manifest = t == "[manifest]";
            if in_manifest {
                has_manifest_section = true;
            }
            continue;
        }
        if !in_manifest || t.is_empty() || t.starts_with('#') {
            continue;
        }
        let key = t.split('=').next().map(|k| k.trim()).unwrap_or("");
        if let Some(pos) = pending.iter().position(|(k, _)| *k == key) {
            let (k, v) = pending.remove(pos);
            lines[i] = format!("{} = {}", k, v);
        }
    }

    let insert_idx = insert_at.unwrap_or(lines.len());
    let mut new_lines: Vec<String> = Vec::new();
    if !has_manifest_section && !pending.is_empty() {
        new_lines.push(String::new());
        new_lines.push("[manifest]".to_string());
    }
    for (k, v) in &pending {
        new_lines.push(format!("{} = {}", k, v));
    }
    for (offset, l) in new_lines.into_iter().enumerate() {
        lines.insert(insert_idx + offset, l);
    }

    std::fs::write(&toml_path, lines.join("\n") + "\n").map_err(|e| format!("写入 opensteamtool.toml 失败: {}", e))
}

// 清单服务器自动切换（对应 Electron 版 toolboxAutoSwitchManifest）
#[tauri::command]
async fn auto_switch_manifest() -> ToolboxActionResult {
        tauri::async_runtime::spawn_blocking(move || { let mut steps = Vec::new();
    let Some(steam_path) = steam::detect_steam_path() else {
        return toolbox_action(false, "未找到 Steam 安装目录。".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()]);
    };

    steps.push("1. 正在结束 Steam 客户端进程...".to_string());
    if !steam::kill_steam() {
        steps.push("[错误] Steam 进程无法结束（可能以管理员运行），配置未修改".to_string());
        return toolbox_action(false, "Steam 进程无法结束，已中止自动切换配置".to_string(), steps);
    }
    steps.push("✓ Steam 进程已安全退出".to_string());

    steps.push("2. 正在写入多节点高可用清单自动切换配置（字段级更新，保留其他自定义项）...".to_string());
    let updates: [(&str, &str); 5] = [
        ("server", "\"steamrun\""),
        ("auto_switch", "true"),
        ("fallback_servers", "[\"gmrc.wudrm.com\", \"manifest.steam.run\", \"opensteamtool.com\"]"),
        ("timeout_ms", "4000"),
        ("retry_count", "3"),
    ];
    if let Err(e) = update_toml_manifest_fields(&steam_path, &updates) {
        steps.push(format!("[错误] 写入配置失败: {}", e));
        return toolbox_action(false, format!("开启清单服务器自动切换失败: {}", e), steps);
    }
    steps.push("✓ 已配置 SteamRun、WUDRM 与社区多节点自动故障转移策略".to_string());

    steps.push("3. 正在重新启动 Steam 客户端...".to_string());
    let restarted = steam::launch_steam(&steam_path, &[]);
    steps.push(if restarted { "✓ Steam 客户端已成功重新启动并加载多节点清单网络".to_string() } else { "⚠ Steam 启动失败，请手动启动".to_string() });

    ToolboxActionResult {
        success: true,
        message: "Open 内核清单服务器自动切换已开启！多节点智能轮询已生效，解决下载游戏无网络问题。".to_string(),
        steps: Some(steps),
        cleaned_files_count: None,
        restarted_steam: Some(restarted),
    } })
        .await
        .unwrap_or_else(|e| toolbox::ToolboxActionResult { success: false, message: format!("任务执行失败: {}", e), steps: Some(Vec::new()), cleaned_files_count: None, restarted_steam: None })
    }

// 补齐核心 DLL 真实 SHA256 校验数据（对应 Electron 版 toolboxFillSha256）
#[tauri::command]
async fn fill_sha256() -> ToolboxActionResult {
        tauri::async_runtime::spawn_blocking(move || { use sha2::{Digest, Sha256};

    let mut steps = Vec::new();
    let Some(steam_path) = steam::detect_steam_path() else {
        return toolbox_action(false, "未找到 Steam 安装目录。".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()]);
    };

    steps.push("1. 正在结束 Steam 相关进程...".to_string());
    if !steam::kill_steam() {
        steps.push("[错误] Steam 进程无法结束（可能以管理员运行）".to_string());
        return toolbox_action(false, "Steam 进程无法结束，已中止补齐 SHA256".to_string(), steps);
    }
    steps.push("✓ Steam 进程已安全退出".to_string());

    let ost_dir = steam_path.join("opensteamtool");
    if let Err(e) = std::fs::create_dir_all(&ost_dir) {
        steps.push(format!("[错误] 创建 opensteamtool 目录失败: {}", e));
        return toolbox_action(false, format!("补齐 SHA256 失败: {}", e), steps);
    }

    steps.push("2. 正在计算核心 DLL 的真实 SHA256 摘要...".to_string());
    let mut checksums = serde_json::Map::new();
    for dll in ["OpenSteamTool.dll", "dwmapi.dll", "xinput1_4.dll"] {
        let p = steam_path.join(dll);
        if p.exists() {
            match std::fs::read(&p) {
                Ok(bytes) => {
                    let mut hasher = Sha256::new();
                    hasher.update(&bytes);
                    let digest = format!("{:x}", hasher.finalize());
                    checksums.insert(dll.to_string(), json!(digest));
                    steps.push(format!("✓ {} SHA256 已计算", dll));
                }
                Err(e) => steps.push(format!("[错误] 读取 {} 失败: {}", dll, e)),
            }
        }
    }

    if checksums.is_empty() {
        steps.push("[错误] 未找到已部署的核心 DLL，请先执行「修复 OpenSteamTool 内核」".to_string());
        return toolbox_action(false, "未找到已部署的核心 DLL，请先执行「修复 OpenSteamTool 内核」".to_string(), steps);
    }

    let payload = json!({
        "version": "1.4.8-full",
        "generatedAt": chrono_like_now(),
        "engine": "OpenSteamTool-x64",
        "checksums": checksums,
        "meta": { "autoValidate": true, "skipCorrupted": false, "manifestIntegrityCheck": true }
    });
    let target = ost_dir.join("sha256.json");
    match std::fs::write(&target, serde_json::to_string_pretty(&payload).unwrap_or_default()) {
        Ok(_) => {
            steps.push("✓ SHA256 校验数据已写入 opensteamtool/sha256.json".to_string());
            toolbox_action(true, "OpenSteamTool SHA256 校验数据已成功补齐并就绪！".to_string(), steps)
        }
        Err(e) => {
            steps.push(format!("[错误] 写入失败: {}", e));
            toolbox_action(false, format!("补齐 SHA256 失败: {}", e), steps)
        }
    } })
        .await
        .unwrap_or_else(|e| toolbox::ToolboxActionResult { success: false, message: format!("任务执行失败: {}", e), steps: Some(Vec::new()), cleaned_files_count: None, restarted_steam: None })
    }

// ==================== 联机修复中心 / 清单预缓存 / Steamless ====================

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open_url_cmd(&url)
}

#[tauri::command]
fn check_manifest_status(app_id: u32, dlcs: Option<Vec<u32>>) -> serde_json::Value {
    match steam::detect_steam_path() {
        Some(sp) => {
            let dlcs = dlcs.unwrap_or_default();
            let s = manifests::check_manifest_status(&sp, app_id, &dlcs);
            serde_json::to_value(s).unwrap_or(json!({}))
        }
        None => json!({ "appId": app_id, "hasManifest": false, "manifestCount": 0, "matchedDepots": [], "manifestFiles": [] }),
    }
}

#[tauri::command]
async fn download_manifests(app_id: u32, dlcs: Option<Vec<u32>>) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { match steam::detect_steam_path() {
        Some(sp) => {
            let result = manifests::download_depot_manifests(&sp, app_id, &dlcs.unwrap_or_default());
            serde_json::to_value(result).unwrap_or(json!({}))
        }
        None => json!({
            "success": false, "appId": app_id, "downloadedCount": 0, "totalDepots": 0,
            "depotKeys": {}, "manifestFiles": [], "source": "none",
            "message": "未检测到 Steam 客户端安装目录"
        }),
    } })
        .await
        .unwrap_or_else(|e| json!({ "success": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
async fn is_spacewar_installed() -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { match steam::detect_steam_path() {
        Some(sp) => {
            let (installed, path) = localgames::is_spacewar_installed(&sp);
            json!({ "isInstalled": installed, "path": path, "appName": "Spacewar", "appId": 480 })
        }
        None => json!({ "isInstalled": false, "appName": "Spacewar", "appId": 480 }),
    } })
        .await
        .unwrap_or_else(|_e| json!({ "isInstalled": false, "appName": "Spacewar", "appId": 480 }))
    }

#[tauri::command]
async fn scan_local_games() -> Vec<localgames::LocalInstalledGame> {
        tauri::async_runtime::spawn_blocking(move || { match steam::detect_steam_path() {
        Some(sp) => localgames::scan_installed_games(&sp),
        None => vec![],
    } })
        .await
        .unwrap_or_else(|_e| Vec::new())
    }

#[tauri::command]
fn check_game_dir(dir_path: String) -> serde_json::Value {
    let p = PathBuf::from(&dir_path);
    let has_backup = p.join("steam_api64_o.dll").exists() || p.join("steam_api_o.dll").exists();
    let (is_patched, mode, app_id) = localgames::check_game_directory(&p);
    json!({ "gamePath": dir_path, "hasBackup": has_backup, "isPatched": is_patched, "mode": mode, "appId": app_id })
}

#[tauri::command]
fn apply_spacewar_fix(dir_path: String, real_app_id: u32) -> serde_json::Value {
    match localgames::apply_spacewar_fix(Path::new(&dir_path), real_app_id) {
        Ok(msg) => json!({ "success": true, "message": msg }),
        Err(e) => json!({ "success": false, "message": e }),
    }
}

#[tauri::command]
fn apply_goldberg_fix(dir_path: String, app_id: u32, player_name: Option<String>) -> serde_json::Value {
    match localgames::apply_goldberg_fix(Path::new(&dir_path), app_id, player_name.as_deref().unwrap_or("春风渡玩家")) {
        Ok(msg) => json!({ "success": true, "message": msg }),
        Err(e) => json!({ "success": false, "message": e }),
    }
}

#[tauri::command]
fn restore_game(dir_path: String) -> serde_json::Value {
    match localgames::restore_original_game(Path::new(&dir_path)) {
        Ok(msg) => json!({ "success": true, "message": msg }),
        Err(e) => json!({ "success": false, "message": e }),
    }
}

#[tauri::command]
async fn launch_local_game(
    app_id: u32,
    game_path: String,
    primary_exe: Option<String>,
    mode: String,
    online_app_id: u32,
) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { match localgames::launch_game_online(app_id, &game_path, primary_exe, &mode, online_app_id) {
        Ok(msg) => json!({ "success": true, "message": msg }),
        Err(e) => json!({ "success": false, "message": e }),
    } })
        .await
        .unwrap_or_else(|e| json!({ "success": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
async fn search_onlinefix_patch(app_id: u32, game_name: Option<String>) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { let r = onlinefix::search_onlinefix_patch(app_id, game_name.as_deref());
    serde_json::to_value(r).unwrap_or(json!({ "found": false })) })
        .await
        .unwrap_or_else(|e| json!({ "found": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
fn set_onlinefix_account(username: String, password: String) -> serde_json::Value {
    onlinefix::set_account(&username, &password);
    json!({ "success": true })
}

#[tauri::command]
async fn onlinefix_prepare(
    game_path: String,
    app_id: u32,
    game_name: Option<String>,
) -> Result<serde_json::Value, onlinefix::OnlineFixPatchResult> {
        tauri::async_runtime::spawn_blocking(move || { match onlinefix::prepare_patch(&game_path, app_id, game_name.as_deref()) {
        Ok(prep) => Ok(serde_json::to_value(prep).unwrap_or(json!({}))),
        Err(fail) => Err(fail),
    } })
        .await
        .map_err(|e| onlinefix::OnlineFixPatchResult { success: false, message: format!("任务执行失败: {}", e), file_name: None, extracted_count: None, article_url: None, download_url: None })?
    }

/// 读取临时目录中的补丁归档（原始字节，仅限应用临时下载目录）
#[tauri::command]
async fn read_file_raw(path: String) -> Result<tauri::ipc::Response, String> {
        tauri::async_runtime::spawn_blocking(move || { if !onlinefix::is_temp_archive(&path) {
        return Err("非法的文件访问路径".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("读取归档失败: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes)) })
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
    }

#[tauri::command]
async fn zip_extract(archive_path: String, dest_dir: String) -> Result<serde_json::Value, String> {
        tauri::async_runtime::spawn_blocking(move || { if !onlinefix::is_temp_archive(&archive_path) {
        return Err("非法的归档路径".to_string());
    }
    let count = onlinefix::extract_zip_archive(&archive_path, &dest_dir)?;
    Ok(json!({ "extractedCount": count })) })
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
    }

#[tauri::command]
async fn onlinefix_deploy(
    game_path: String,
    entries: Vec<onlinefix::PatchEntry>,
    archive_path: Option<String>,
) -> serde_json::Value {
        tauri::async_runtime::spawn_blocking(move || { let r = onlinefix::deploy_patch_entries(&game_path, &entries, archive_path.as_deref());
    serde_json::to_value(r).unwrap_or(json!({ "success": false, "message": "部署失败" })) })
        .await
        .unwrap_or_else(|e| json!({ "success": false, "message": format!("任务执行失败: {}", e) }))
    }

#[tauri::command]
fn get_steamless_status(app: AppHandle) -> steamless::SteamlessStatusInfo {
    let resource_dir = app.path().resource_dir().ok();
    steamless::get_status_with_resource(resource_dir.as_deref())
}

#[tauri::command]
async fn repair_game_steamless(app: AppHandle, game_path: String, game_name: Option<String>) -> steamless::SteamlessRepairResult {
        let resource_dir = app.path().resource_dir().ok();
        tauri::async_runtime::spawn_blocking(move || { steamless::repair_game_with_resource(&game_path, game_name.as_deref(), resource_dir.as_deref()) })
        .await
        .unwrap_or_else(|e| steamless::SteamlessRepairResult { success: false, message: format!("任务执行失败: {}", e), total_found: 0, repaired_count: 0, backup_count: 0, skipped_count: 0, details: Vec::new() })
    }

// 本地 18万+ 全量库分页检索（Tauri 版，数据文件随包分发）
#[tauri::command]
async fn search_local_games(
    app: AppHandle,
    query: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> serde_json::Value {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        manifests::search_local_all(resource_dir.as_deref(), query.as_deref(), page.unwrap_or(1), page_size.unwrap_or(48))
    })
    .await
    .unwrap_or_else(|e| json!({ "items": [], "total": 0, "totalPages": 1, "source": "local_db", "sourceName": "本地全量库", "error": format!("任务执行失败: {}", e) }))
}

// 已入库游戏详情（真实清单/密钥状态，供 LibraryView 渲染"预缓存"入口）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedDetail {
    pub app_id: u32,
    pub name: String,
    pub has_token: bool,
    pub has_manifest: bool,
    pub has_depot_keys: bool,
    pub depots_count: u32,
    pub dlc_count: u32,
    pub lua_path: String,
}

#[tauri::command]
async fn get_unlocked_details() -> Vec<UnlockedDetail> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut details = Vec::new();
        if let Some(steam_path) = steam::detect_steam_path() {
            let lua_dir = steam_path.join("config").join("lua");
            if let Ok(entries) = std::fs::read_dir(&lua_dir) {
                let mut items: Vec<(u32, PathBuf)> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let p = e.path();
                        let stem = p.file_stem()?.to_str()?;
                        let id = stem.parse::<u32>().ok()?;
                        p.extension()?.to_str()?.eq_ignore_ascii_case("lua").then_some((id, p))
                    })
                    .collect();
                items.sort_by_key(|(id, _)| *id);
                // 仅扫描一次 depotcache，避免逐游戏全量遍历（depotcache 可有数千文件）
                let ids: Vec<u32> = items.iter().map(|(id, _)| *id).collect();
                let manifest_map = manifests::batch_manifest_status(&steam_path, &ids);
                for (app_id, path) in items {
                    let content = std::fs::read_to_string(&path).unwrap_or_default();
                    // 名称来自首行注释 "-- Game: X" / "-- X"
                    let mut name = format!("Steam App {}", app_id);
                    if let Some(first) = content.lines().next() {
                        let t = first.trim_start_matches('-').trim();
                        let t = t.strip_prefix("Game:").map(|s| s.trim()).unwrap_or(t);
                        if let Some(pos) = t.find("(AppID") {
                            let t = t[..pos].trim();
                            if !t.is_empty() {
                                name = t.to_string();
                            }
                        } else if !t.is_empty() {
                            name = t.to_string();
                        }
                    }
                    // 新方言下 addappid 同时覆盖本体/分包，统计口径为"挂载的 App/Depot 总数"
                    let addappid_count = content.matches("addappid").count() as u32;
                    let has_token = content.contains("addtoken");
                    // 兼容新旧两种方言：addappid 带有效密钥 / setDepotKey 均判定为已注入密钥
                    let has_depot_keys = ost::lua_has_valid_key(&content);
                    let has_manifest = manifest_map
                        .get(&app_id)
                        .map(|s| s.has_manifest)
                        .unwrap_or(false);
                    details.push(UnlockedDetail {
                        app_id,
                        name,
                        has_token,
                        has_manifest,
                        has_depot_keys,
                        depots_count: addappid_count.max(1),
                        dlc_count: addappid_count.saturating_sub(1),
                        lua_path: format!("config/lua/{}.lua", app_id),
                    });
                }
            }
        }
        details
    })
    .await
    .unwrap_or_default()
}

// 批量清单状态（LibraryView 用一次调用替代逐游戏请求）
#[tauri::command]
async fn check_manifest_status_batch(app_ids: Vec<u32>) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || match steam::detect_steam_path() {
        Some(sp) => {
            let map = manifests::batch_manifest_status(&sp, &app_ids);
            let list: Vec<&manifests::AppManifestStatus> = app_ids.iter().filter_map(|id| map.get(id)).collect();
            serde_json::to_value(list).unwrap_or(json!([]))
        }
        None => json!([]),
    })
    .await
    .unwrap_or_else(|_e| json!([]))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_maximize,
            window_close,
            is_window_maximized,
            app_quit,
            get_device_id,
            get_steam_info,
            set_steam_path,
            restart_steam,
            select_directory,
            open_path,
            open_url,
            ensure_ost_env,
            activate_injection,
            unlock_game,
            get_unlocked_games,
            remove_unlocked_game,
            clear_all_games,
            uninstall_injection,
            check_environment_health,
            toolbox_clear_cache,
            toolbox_repair_ost,
            get_toolbox_status,
            auto_switch_manifest,
            fill_sha256,
            check_manifest_status,
            check_manifest_status_batch,
            download_manifests,
            is_spacewar_installed,
            scan_local_games,
            check_game_dir,
            apply_spacewar_fix,
            apply_goldberg_fix,
            restore_game,
            launch_local_game,
            search_onlinefix_patch,
            set_onlinefix_account,
            onlinefix_prepare,
            read_file_raw,
            zip_extract,
            onlinefix_deploy,
            get_steamless_status,
            repair_game_steamless,
            search_local_games,
            get_unlocked_details
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
