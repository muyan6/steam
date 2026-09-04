pub mod steam;
pub mod ost;
pub mod device;
pub mod toolbox;

use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use crate::steam::SteamEnvironmentInfo;
use crate::ost::UnlockGamePayload;
use crate::toolbox::ToolboxActionResult;

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
    device::get_machine_guid()
}

// Steam 环境命令
#[tauri::command]
fn get_steam_info(custom_path: Option<String>) -> SteamEnvironmentInfo {
    steam::get_steam_info(custom_path.as_deref())
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
fn restart_steam(extra_args: Option<Vec<String>>) -> bool {
    if let Some(steam_path) = steam::detect_steam_path() {
        let args = extra_args.unwrap_or_default();
        steam::restart_steam(&steam_path, &args)
    } else {
        false
    }
}

// Steam 目录选择与打开（对应 Electron 版 selectDirectory / openFolder）
#[tauri::command]
fn select_directory(app_handle: AppHandle) -> Option<String> {
    app_handle
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
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
fn ensure_ost_env(manifest_api: Option<String>, custom_api_url: Option<String>) -> serde_json::Value {
    let server = match resolve_manifest_server(manifest_api, custom_api_url) {
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
    }
}

#[tauri::command]
fn activate_injection(
    manifest_api: Option<String>,
    custom_api_url: Option<String>,
    restart_steam: Option<bool>,
) -> serde_json::Value {
    let server = match resolve_manifest_server(manifest_api, custom_api_url) {
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
    }
}

#[tauri::command]
fn unlock_game(payload: UnlockGamePayload) -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        match ost::save_lua_rule(&steam_path, &payload) {
            Ok(file_path) => {
                let name = payload.name_zh.as_deref().unwrap_or(&payload.name);
                json!({
                    "success": true,
                    "message": format!("成功为「{}」写入标准入库规则！已自动热生效 (无须重启 Steam，直接在库中搜索即可下载)！", name),
                    "scriptPath": file_path.to_string_lossy()
                })
            }
            Err(e) => json!({ "success": false, "message": e }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 客户端路径" })
    }
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
fn check_environment_health() -> serde_json::Value {
    let mut items: Vec<serde_json::Value> = Vec::new();

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
            let bitness = steam::detect_steam_bitness(p);
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
    })
}

fn chrono_like_now() -> String {
    // 使用标准库生成可读时间戳（本地时区由系统格式化输出不可用时退化为 UTC 秒）
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{}", secs)
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
fn toolbox_clear_cache() -> ToolboxActionResult {
    if let Some(steam_path) = steam::detect_steam_path() {
        toolbox::clear_steam_cache(&steam_path)
    } else {
        toolbox_action(false, "未找到 Steam 客户端路径".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()])
    }
}

#[tauri::command]
fn toolbox_repair_ost() -> ToolboxActionResult {
    if let Some(steam_path) = steam::detect_steam_path() {
        let mut steps = Vec::new();
        let was_running = steam::is_steam_running();
        if was_running {
            steps.push("正在安全退出 Steam 客户端...".to_string());
            steam::kill_steam();
            steps.push("✓ Steam 进程已退出".to_string());
        }

        if let Err(e) = ost::generate_toml_config(&steam_path, "steamrun") {
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
    }
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

// 清单服务器自动切换（对应 Electron 版 toolboxAutoSwitchManifest）
#[tauri::command]
fn auto_switch_manifest() -> ToolboxActionResult {
    let mut steps = Vec::new();
    let Some(steam_path) = steam::detect_steam_path() else {
        return toolbox_action(false, "未找到 Steam 安装目录。".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()]);
    };

    steps.push("1. 正在结束 Steam 客户端进程...".to_string());
    steam::kill_steam();
    steps.push("✓ Steam 进程已安全退出".to_string());

    steps.push("2. 正在写入多节点高可用清单自动切换配置...".to_string());
    let toml_path = steam_path.join("opensteamtool.toml");
    let toml_content = "# OpenSteamTool Configuration generated by 春风渡\n\
        [inject]\n\
        enabled = true\n\n\
        [manifest]\n\
        server = \"steamrun\"\n\
        auto_switch = true\n\
        fallback_servers = [\"gmrc.wudrm.com\", \"manifest.steam.run\", \"opensteamtool.com\"]\n\
        timeout_ms = 4000\n\
        retry_count = 3\n";
    if let Err(e) = std::fs::write(&toml_path, toml_content) {
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
    }
}

// 补齐核心 DLL 真实 SHA256 校验数据（对应 Electron 版 toolboxFillSha256）
#[tauri::command]
fn fill_sha256() -> ToolboxActionResult {
    use sha2::{Digest, Sha256};

    let mut steps = Vec::new();
    let Some(steam_path) = steam::detect_steam_path() else {
        return toolbox_action(false, "未找到 Steam 安装目录。".to_string(), vec!["[失败] 无法定位 Steam 目录".to_string()]);
    };

    steps.push("1. 正在结束 Steam 相关进程...".to_string());
    steam::kill_steam();
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
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            fill_sha256
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
