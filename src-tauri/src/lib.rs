pub mod steam;
pub mod ost;
pub mod device;
pub mod toolbox;

use serde_json::json;
use tauri::{AppHandle, Window};
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
fn set_steam_path(path: String) -> SteamEnvironmentInfo {
    steam::get_steam_info(Some(&path))
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

// OpenSteamTool 核心命令
#[tauri::command]
fn ensure_ost_env(manifest_api: Option<String>, _custom_api_url: Option<String>) -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        let server = manifest_api.unwrap_or_else(|| "steamrun".to_string());
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
    _custom_api_url: Option<String>,
    restart_steam: Option<bool>,
) -> serde_json::Value {
    if let Some(steam_path) = steam::detect_steam_path() {
        let server = manifest_api.unwrap_or_else(|| "steamrun".to_string());
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
            Ok(count) => json!({ "success": true, "count": count, "message": format!("已清空全部 {} 个游戏的入库规则！", count) }),
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
            Err(e) => json!({ "success": false, "message": e }),
        }
    } else {
        json!({ "success": false, "message": "未找到 Steam 安装路径" })
    }
}

// 工具箱
#[tauri::command]
fn toolbox_clear_cache() -> ToolboxActionResult {
    if let Some(steam_path) = steam::detect_steam_path() {
        toolbox::clear_steam_cache(&steam_path)
    } else {
        ToolboxActionResult {
            success: false,
            message: "未找到 Steam 客户端路径".to_string(),
            details: None,
        }
    }
}

#[tauri::command]
fn toolbox_repair_ost() -> ToolboxActionResult {
    if let Some(steam_path) = steam::detect_steam_path() {
        let _ = ost::generate_toml_config(&steam_path, "steamrun");
        let _ = ost::ensure_lua_dir(&steam_path);
        match ost::deploy_core_binaries(&steam_path) {
            Ok(_) => ToolboxActionResult {
                success: true,
                message: "OpenSteamTool 动态链接库与配置文件已重新部署修复完毕！".to_string(),
                details: Some(vec!["已校验 OpenSteamTool.dll".to_string(), "已校验 dwmapi.dll".to_string()]),
            },
            Err(e) => ToolboxActionResult {
                success: false,
                message: format!("修复失败: {}", e),
                details: None,
            },
        }
    } else {
        ToolboxActionResult {
            success: false,
            message: "未找到 Steam 客户端路径".to_string(),
            details: None,
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            ensure_ost_env,
            activate_injection,
            unlock_game,
            get_unlocked_games,
            remove_unlocked_game,
            clear_all_games,
            uninstall_injection,
            toolbox_clear_cache,
            toolbox_repair_ost
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
