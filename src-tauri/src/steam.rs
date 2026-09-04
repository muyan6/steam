use std::path::{Path, PathBuf};
use std::process::Command;
use winreg::enums::*;
use winreg::RegKey;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamEnvironmentInfo {
    pub is_running: bool,
    pub steam_path: Option<String>,
    pub steam_exe_path: Option<String>,
    pub steam_bitness: String,
    pub ost_installed: bool,
    pub scripts_count: usize,
    pub platform: String,
}

pub fn detect_steam_path() -> Option<PathBuf> {
    // 1. 尝试从 HKCU 注册表读取
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(steam_key) = hkcu.open_subkey("Software\\Valve\\Steam") {
        if let Ok(path) = steam_key.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(path.replace('/', "\\"));
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. 尝试从 HKLM 64位注册表读取
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(steam_key) = hklm.open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam") {
        if let Ok(path) = steam_key.get_value::<String, _>("InstallPath") {
            let p = PathBuf::from(path.replace('/', "\\"));
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 3. 尝试从 HKLM 32位注册表读取
    if let Ok(steam_key) = hklm.open_subkey("SOFTWARE\\Valve\\Steam") {
        if let Ok(path) = steam_key.get_value::<String, _>("InstallPath") {
            let p = PathBuf::from(path.replace('/', "\\"));
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 4. 常见盘符路径枚举扫描
    let default_paths = [
        "C:\\Program Files (x86)\\Steam",
        "C:\\Program Files\\Steam",
        "D:\\Steam",
        "E:\\Steam",
        "F:\\Steam",
        "D:\\Program Files (x86)\\Steam",
        "E:\\Program Files (x86)\\Steam",
    ];

    for path_str in default_paths {
        let p = PathBuf::from(path_str);
        if p.join("steam.exe").exists() {
            return Some(p);
        }
    }

    None
}

pub fn is_steam_running() -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        text.contains("steam.exe")
    } else {
        false
    }
}

pub fn count_unlocked_scripts(steam_path: &Path) -> usize {
    let lua_dir = steam_path.join("config").join("lua");
    if !lua_dir.exists() {
        return 0;
    }
    if let Ok(entries) = std::fs::read_dir(lua_dir) {
        entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "lua")
                    .unwrap_or(false)
            })
            .count()
    } else {
        0
    }
}

pub fn check_ost_installed(steam_path: &Path) -> bool {
    let ost_dll = steam_path.join("OpenSteamTool.dll");
    let dwmapi_dll = steam_path.join("dwmapi.dll");
    let xinput_dll = steam_path.join("xinput1_4.dll");
    ost_dll.exists() && (dwmapi_dll.exists() || xinput_dll.exists())
}

pub fn get_steam_info(custom_path: Option<&str>) -> SteamEnvironmentInfo {
    let steam_path_buf = custom_path
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .or_else(detect_steam_path);

    let is_running = is_steam_running();
    let (steam_path_str, steam_exe_path, ost_installed, scripts_count) = match &steam_path_buf {
        Some(p) => {
            let exe = p.join("steam.exe");
            let ost = check_ost_installed(p);
            let count = count_unlocked_scripts(p);
            (
                Some(p.to_string_lossy().to_string()),
                if exe.exists() { Some(exe.to_string_lossy().to_string()) } else { None },
                ost,
                count,
            )
        }
        None => (None, None, false, 0),
    };

    SteamEnvironmentInfo {
        is_running,
        steam_path: steam_path_str,
        steam_exe_path,
        steam_bitness: "x64".to_string(),
        ost_installed,
        scripts_count,
        platform: "win32".to_string(),
    }
}

pub fn kill_steam() -> bool {
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "steam.exe"])
        .output();
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "steamservice.exe"])
        .output();
    std::thread::sleep(std::time::Duration::from_millis(600));
    !is_steam_running()
}

pub fn launch_steam(steam_path: &Path, extra_args: &[String]) -> bool {
    let exe = steam_path.join("steam.exe");
    if !exe.exists() {
        return false;
    }

    let mut cmd = Command::new(&exe);
    for arg in extra_args {
        cmd.arg(arg);
    }

    match cmd.spawn() {
        Ok(_) => true,
        Err(_) => false,
    }
}

pub fn restart_steam(steam_path: &Path, extra_args: &[String]) -> bool {
    kill_steam();
    std::thread::sleep(std::time::Duration::from_millis(800));
    launch_steam(steam_path, extra_args)
}
