use std::path::{Path, PathBuf};
use std::os::windows::process::CommandExt;
use std::process::Command;
use winreg::enums::*;
use winreg::RegKey;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamEnvironmentInfo {
    pub is_running: bool,
    pub steam_path: Option<String>,
    pub steam_exe_path: Option<String>,
    pub steam_bitness: String,
    pub ost_installed: bool,
    pub scripts_count: usize,
    pub platform: String,
    pub global_online_fix_enabled: bool,
}

// 自定义 Steam 路径持久化文件（存于 %APPDATA%\com.chunfengdu.app\）
fn custom_path_file() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("com.chunfengdu.app").join("steam_path.json"))
}

pub fn load_custom_steam_path() -> Option<PathBuf> {
    let file = custom_path_file()?;
    let content = std::fs::read_to_string(file).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    let path = parsed.get("steamPath")?.as_str()?.to_string();
    let p = PathBuf::from(&path);
    if p.join("steam.exe").exists() {
        Some(p)
    } else {
        None
    }
}

pub fn save_custom_steam_path(path: &str) {
    if let Some(file) = custom_path_file() {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let payload = serde_json::json!({ "steamPath": path });
        let _ = std::fs::write(file, payload.to_string());
    }
}

pub fn detect_steam_path() -> Option<PathBuf> {
    // 0. 用户手动指定的自定义路径优先
    if let Some(custom) = load_custom_steam_path() {
        return Some(custom);
    }

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
    // CREATE_NO_WINDOW：GUI 发布版（windows_subsystem）下不加会闪现控制台黑框
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .creation_flags(0x08000000)
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        text.contains("steam.exe")
    } else {
        false
    }
}

pub fn is_onlinefix_running() -> bool {
    // 结果缓存 8 秒：PowerShell CIM 冷启动 0.5~2s，而本函数被 get_steam_info
    // 等高频路径调用，不缓存会导致明显的 UI 卡顿
    static CACHE: std::sync::Mutex<Option<(std::time::Instant, bool)>> = std::sync::Mutex::new(None);
    if let Ok(guard) = CACHE.lock() {
        if let Some((at, val)) = *guard {
            if at.elapsed() < std::time::Duration::from_secs(8) {
                return val;
            }
        }
    }
    let val = is_onlinefix_running_uncached();
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((std::time::Instant::now(), val));
    }
    val
}

fn is_onlinefix_running_uncached() -> bool {
    // 通过 PowerShell CIM 检查 steam.exe 启动命令行是否带 -onlinefix 参数
    // （wmic 在 Windows 11 24H2 起已被移除，故使用 Get-CimInstance）
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_Process -Filter \"Name = 'steam.exe'\").CommandLine",
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        text.contains("-onlinefix")
    } else {
        false
    }
}

/// 检测宿主 Windows 是否为 64 位（与 Electron 版语义一致：
/// steam.exe 引导文件历史沿用 x86，运行时能力取决于宿主系统架构）
pub fn is_64bit_windows() -> bool {
    std::env::var("PROCESSOR_ARCHITEW6432").is_ok()
        || std::env::var("PROCESSOR_ARCHITECTURE").map(|v| v == "AMD64").unwrap_or(false)
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
        .filter(|p| p.join("steam.exe").exists())
        .or_else(load_custom_steam_path)
        .or_else(detect_steam_path);

    let is_running = is_steam_running();
    // 报告值与 Electron 版一致：64 位宿主系统下 Steam 运行时（CEF/WebHelper）为 64 位，
    // 可正常加载 64 位 OpenSteamTool 组件；PE 头检测仅作为参考信息保留
    let bitness = if is_64bit_windows() { "x64".to_string() } else { "x86".to_string() };
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
        steam_bitness: bitness,
        ost_installed,
        scripts_count,
        platform: "win32".to_string(),
        global_online_fix_enabled: is_onlinefix_running(),
    }
}

pub fn kill_steam() -> bool {
    // Steam 未运行时直接返回，不做任何等待
    if !is_steam_running() {
        return true;
    }

    // 1. 先尝试 Steam 官方安全退出，避免强杀中断下载任务
    if let Some(steam_path) = detect_steam_path() {
        let shutdown = steam_path.join("steam.exe");
        if shutdown.exists() {
            let _ = Command::new(&shutdown).arg("-shutdown").spawn();
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(1500));

    // 2. 轮询强制结束：steam.exe / steamwebhelper.exe / steamservice.exe 全家桶
    for _ in 0..4 {
        if !is_steam_running() {
            return true;
        }
        for proc_name in ["steam.exe", "steamwebhelper.exe", "steamservice.exe"] {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", proc_name])
                .creation_flags(0x08000000)
                .output();
        }
        std::thread::sleep(std::time::Duration::from_millis(600));
    }

    // 3. 兜底：Steam 以管理员身份运行时普通 taskkill 无效，触发 UAC 提权强杀
    if is_steam_running() {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Start-Process taskkill -ArgumentList '/F /IM steam.exe','/F /IM steamwebhelper.exe' -Verb RunAs -WindowStyle Hidden",
            ])
            .creation_flags(0x08000000)
            .output();
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }

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
