use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

use crate::steam;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstalledGame {
    pub app_id: u32,
    pub name: String,
    pub install_dir: String,
    pub full_install_path: String,
    pub library_path: String,
    pub size_on_disk: u64,
    pub executable_files: Vec<String>,
    pub primary_exe: Option<String>,
    pub has_steamless_backup: bool,
    pub is_patched: bool,
    pub patch_mode: String,
    pub has_backup: bool,
    /// 联机架构预测: patched | steamworks | mixed | api_only | thirdparty | unknown
    #[serde(default)]
    pub net_type: String,
    /// 命中的联机指纹文件名（前端提示详情用）
    #[serde(default)]
    pub net_signals: Vec<String>,
}

/// 从 ACF 文本中提取 "key" "value" 键值对（简单扫描，无正则依赖）
fn acf_get(content: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let mut search_from = 0;
    while let Some(pos) = content[search_from..].find(&needle) {
        let abs = search_from + pos + needle.len();
        let rest = &content[abs..];
        // 跳过空白，找到第一个引号
        let trimmed = rest.trim_start();
        if let Some(stripped) = trimmed.strip_prefix('"') {
            if let Some(end) = stripped.find('"') {
                return Some(stripped[..end].to_string());
            }
        }
        search_from = abs;
    }
    None
}

/// 解析 libraryfolders.vdf 提取所有 Steam 库 steamapps 目录
pub fn get_steam_library_paths(steam_path: &Path) -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    let main_apps = steam_path.join("steamapps");
    if main_apps.exists() {
        libraries.push(main_apps);
    }

    let vdf_path = steam_path.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(&vdf_path) {
        // 逐行扫描 "path" "X:\\..." 条目
        for line in content.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("\"path\"") {
                let rest = rest.trim();
                if let Some(stripped) = rest.strip_prefix('"') {
                    if let Some(end) = stripped.find('"') {
                        let raw = stripped[..end].replace("\\\\", "\\");
                        let apps_dir = PathBuf::from(&raw).join("steamapps");
                        if apps_dir.exists() && !libraries.contains(&apps_dir) {
                            libraries.push(apps_dir);
                        }
                    }
                }
            }
        }
    }
    libraries
}

fn clean_name(s: &str) -> String {
    s.to_lowercase().replace([' ', '_', '-'], "")
}

/// 递归检索目录下 exe（深度限制，跳过安装器/反作弊等）
pub fn find_executable_files(dir_path: &Path, max_depth: usize) -> Vec<String> {
    let mut results = Vec::new();
    if !dir_path.exists() {
        return results;
    }
    fn walk(dir: &Path, depth: usize, max_depth: usize, results: &mut Vec<String>) {
        if depth > max_depth {
            return;
        }
        const SKIP_DIRS: [&str; 6] = ["_redist", "directx", "support", "redist", ".git", "node_modules"];
        const SKIP_FILES: [&str; 8] = [
            "unins000.exe", "uninstall.exe", "unitycrashhandler", "crashreport",
            "dxsetup.exe", "vcredist", "easyanticheat", "battleye",
        ];
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                let lower = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !SKIP_DIRS.contains(&lower.as_str()) {
                    walk(&p, depth + 1, max_depth, results);
                }
            } else if p.is_file() {
                let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                if name.ends_with(".exe") && !SKIP_FILES.iter().any(|kw| name.contains(kw)) {
                    results.push(p.to_string_lossy().to_string());
                }
            }
        }
    }

    walk(dir_path, 0, max_depth, &mut results);
    results
}

/// 联机架构指纹检测结果：托管封装 / 原生 API / 第三方网络 SDK 各自命中的文件名
struct NetFingerprints {
    managed_wrappers: Vec<String>,
    native_api: Vec<String>,
    thirdparty: Vec<String>,
}

/// 深度受限递归收集联机架构指纹（只读目录项名，不读文件内容）。
/// Unity/Mono 的网络库在 <游戏>_Data/Managed（深度2），UE 在 Binaries/Win64（深度2），
/// 原生 C++ 游戏的 steam_api64.dll 在根目录（深度0），深度3 兜底嵌套更深的少数引擎结构。
fn collect_net_fingerprints(dir_path: &Path) -> NetFingerprints {
    let mut out = NetFingerprints { managed_wrappers: Vec::new(), native_api: Vec::new(), thirdparty: Vec::new() };
    if !dir_path.exists() {
        return out;
    }
    const SKIP_DIRS: [&str; 10] = [
        "_redist", "redist", "directx", "support", ".git", "node_modules",
        "__macosx", "movies", "video", "audio",
    ];
    fn push_once(bucket: &mut Vec<String>, name: &str) {
        if !bucket.iter().any(|n| n == name) && bucket.len() < 8 {
            bucket.push(name.to_string());
        }
    }
    fn walk(dir: &Path, depth: usize, out: &mut NetFingerprints) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                let lower = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !SKIP_DIRS.contains(&lower.as_str()) {
                    walk(&p, depth + 1, out);
                }
                continue;
            }
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            // 托管 Steamworks 封装（游戏代码显式调用 Steamworks 联机接口的最强信号）
            if name.contains("steamworks") || name.starts_with("facepunch.steamworks") {
                push_once(&mut out.managed_wrappers, &name);
            }
            // 原生 Steam API（接入 Steam 但联机方式不确定：可能是 P2P 也可能是专用服务器）
            if matches!(name.as_str(), "steam_api64.dll" | "steam_api.dll" | "steam_api2.dll") {
                push_once(&mut out.native_api, &name);
            }
            // 第三方网络 SDK（不走 Steam 网络层，Open 内核无法接管）
            if name.starts_with("photon")
                || name.contains("eossdk")
                || name.contains("playfab")
                || name.contains("fishnet")
                || name.contains("normcore")
                || name == "mirror.dll"
            {
                push_once(&mut out.thirdparty, &name);
            }
        }
    }
    walk(dir_path, 0, &mut out);
    out
}

/// 基于本地文件指纹的联机架构预测。
/// patched 优先：已部署 OnlineFix/Goldberg 的游戏预测无意义，直接标注。
pub fn detect_net_mode(dir_path: &Path, is_patched: bool) -> (String, Vec<String>) {
    if is_patched {
        return ("patched".to_string(), Vec::new());
    }
    if !dir_path.exists() {
        return ("unknown".to_string(), Vec::new());
    }
    let fp = collect_net_fingerprints(dir_path);
    let has_managed = !fp.managed_wrappers.is_empty();
    let has_third = !fp.thirdparty.is_empty();
    let net_type = if has_managed && has_third {
        // 混合架构（如 REPO：Steamworks 核心联机 + Photon 语音），核心联机大概率可用 Open 内核
        "mixed".to_string()
    } else if has_managed {
        "steamworks".to_string()
    } else if !fp.native_api.is_empty() {
        // 原生 steam_api 只说明接入 Steam，P2P 与专用服务器游戏均会携带，置信度中等
        "api_only".to_string()
    } else if has_third {
        "thirdparty".to_string()
    } else {
        "unknown".to_string()
    };
    let mut signals = Vec::new();
    signals.extend(fp.managed_wrappers.iter().cloned());
    signals.extend(fp.thirdparty.iter().cloned());
    signals.extend(fp.native_api.iter().cloned());
    (net_type, signals)
}

/// 检测游戏目录补丁状态（OnlineFix / Goldberg）
pub fn check_game_directory(dir_path: &Path) -> (bool, String, Option<u32>) {
    if !dir_path.exists() {
        return (false, "none".to_string(), None);
    }
    let _has_backup = dir_path.join("steam_api64_o.dll").exists() || dir_path.join("steam_api_o.dll").exists();

    let mut found_online_fix = dir_path.join("OnlineFix.ini").exists() || dir_path.join("OnlineFix64.dll").exists();
    if !found_online_fix {
        if let Ok(entries) = fs::read_dir(dir_path) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if entry.path().join("OnlineFix.ini").exists() || entry.path().join("OnlineFix64.dll").exists() {
                        found_online_fix = true;
                        break;
                    }
                }
            }
        }
    }

    if found_online_fix {
        let mut app_id = None;
        if let Ok(content) = fs::read_to_string(dir_path.join("OnlineFix.ini")) {
            // 查找 RealAppId=数字（大小写不敏感）
            // 用 get 切片而非索引：INI 来自外部下载文件，按字节索引
            // 可能把多字节字符切开直接 panic，毁掉整个本地游戏扫描
            for line in content.lines() {
                let line = line.trim();
                let is_prefix = line.get(..10).map(|p| p.eq_ignore_ascii_case("RealAppId=")).unwrap_or(false);
                if is_prefix {
                    if let Some(rest) = line.get(10..) {
                        if let Ok(id) = rest.trim().trim_end_matches(';').parse::<u32>() {
                            app_id = Some(id);
                        }
                    }
                }
            }
        }
        return (true, "spacewar".to_string(), app_id);
    }

    let goldberg = dir_path.join("steam_settings");
    if goldberg.exists() {
        let mut app_id = None;
        let id_file = goldberg.join("steam_appid.txt");
        if let Ok(content) = fs::read_to_string(&id_file) {
            if let Ok(id) = content.trim().parse::<u32>() {
                app_id = Some(id);
            }
        }
        return (true, "goldberg".to_string(), app_id);
    }

    (false, "none".to_string(), None)
}

fn backup_api_dlls(dir_path: &Path) {
    for (main, bak) in [("steam_api64.dll", "steam_api64_o.dll"), ("steam_api.dll", "steam_api_o.dll")] {
        let src = dir_path.join(main);
        let dst = dir_path.join(bak);
        if src.exists() && !dst.exists() {
            let _ = fs::copy(&src, &dst);
        }
    }
}

pub fn apply_spacewar_fix(dir_path: &Path, real_app_id: u32) -> Result<String, String> {
    if !dir_path.exists() {
        return Err("游戏目录不存在".to_string());
    }
    backup_api_dlls(dir_path);
    let ini = format!(
        "[Main]\nRealAppId={}\nFakeAppId=480\nLanguage=schinese\nOverlay=1\n\n[Steam]\nFakeSteamId=1\n",
        real_app_id
    );
    fs::write(dir_path.join("OnlineFix.ini"), ini).map_err(|e| format!("写入 OnlineFix.ini 失败: {}", e))?;
    fs::write(dir_path.join("steam_appid.txt"), "480").map_err(|e| format!("写入 steam_appid.txt 失败: {}", e))?;
    Ok(format!("成功为 AppID: {} 部署 Spacewar (480) 联机配置！原 DLL 已安全备份。", real_app_id))
}

pub fn apply_goldberg_fix(dir_path: &Path, app_id: u32, player_name: &str) -> Result<String, String> {
    if !dir_path.exists() {
        return Err("游戏目录不存在".to_string());
    }
    // 清洗玩家名：禁止换行/分号等注入 ini 字段
    let safe_name: String = player_name
        .chars()
        .filter(|c| !matches!(c, '\r' | '\n' | ';' | '=' | '[' | ']'))
        .collect::<String>()
        .trim()
        .chars()
        .take(32)
        .collect();
    let safe_name = if safe_name.is_empty() { "春风渡玩家".to_string() } else { safe_name };

    backup_api_dlls(dir_path);
    let settings = dir_path.join("steam_settings");
    fs::create_dir_all(&settings).map_err(|e| format!("创建 steam_settings 失败: {}", e))?;
    fs::write(settings.join("steam_appid.txt"), app_id.to_string()).map_err(|e| e.to_string())?;
    fs::write(dir_path.join("steam_appid.txt"), app_id.to_string()).map_err(|e| e.to_string())?;
    fs::write(settings.join("force_account_name.txt"), &safe_name).map_err(|e| e.to_string())?;
    let ini = format!(
        "[user_general]\naccount_name={}\nlanguage=schinese\n\n[auto_discovery]\nenable=1\n",
        safe_name
    );
    fs::write(settings.join("settings.ini"), ini).map_err(|e| e.to_string())?;
    Ok(format!("成功配置 Goldberg 局域网联机环境（玩家名: {}）！", safe_name))
}

pub fn restore_original_game(dir_path: &Path) -> Result<String, String> {
    if !dir_path.exists() {
        return Err("游戏目录不存在".to_string());
    }
    for (bak, main) in [("steam_api64_o.dll", "steam_api64.dll"), ("steam_api_o.dll", "steam_api.dll")] {
        let bak_p = dir_path.join(bak);
        if bak_p.exists() {
            let _ = fs::copy(&bak_p, dir_path.join(main));
            let _ = fs::remove_file(&bak_p);
        }
    }
    for f in ["OnlineFix.ini", "OnlineFix64.dll", "OnlineFix.url", "Launch_Online_Fix.bat"] {
        let _ = fs::remove_file(dir_path.join(f));
    }
    // steam_appid.txt：仅当内容是本工具 Spacewar 模式写入的 480 时才删除，
    // 避免误删游戏自带或用户自建的同名文件
    let appid_file = dir_path.join("steam_appid.txt");
    if appid_file.exists() {
        if fs::read_to_string(&appid_file).map(|c| c.trim() == "480").unwrap_or(false) {
            let _ = fs::remove_file(&appid_file);
        }
    }
    // Spacewar 启动前备份的 steam_appid.txt.cfd_bak 还原并清理，避免残留
    let appid_bak = dir_path.join("steam_appid.txt.cfd_bak");
    if appid_bak.exists() {
        let _ = fs::copy(&appid_bak, &appid_file);
        let _ = fs::remove_file(&appid_bak);
    }
    // steam_settings：仅当包含本工具 Goldberg 修复写入的标记文件时才删除，
    // 保留用户自建的 Goldberg 配置
    let settings_dir = dir_path.join("steam_settings");
    if settings_dir.exists()
        && (settings_dir.join("force_account_name.txt").exists() || settings_dir.join("settings.ini").exists())
    {
        let _ = fs::remove_dir_all(&settings_dir);
    }

    // 递归搜索还原（深度 3）
    fn walk_restore(dir: &Path, depth: usize) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                walk_restore(&p, depth + 1);
            } else {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                match name.as_str() {
                    "steam_api64_o.dll" => {
                        let _ = fs::copy(&p, dir.join("steam_api64.dll"));
                        let _ = fs::remove_file(&p);
                    }
                    "steam_api_o.dll" => {
                        let _ = fs::copy(&p, dir.join("steam_api.dll"));
                        let _ = fs::remove_file(&p);
                    }
                    "OnlineFix.ini" | "OnlineFix64.dll" | "OnlineFix.url" => {
                        let _ = fs::remove_file(&p);
                    }
                    _ => {}
                }
            }
        }
    }
    walk_restore(dir_path, 0);
    Ok("已完全恢复游戏原版状态与 DLL 文件！".to_string())
}

pub fn is_spacewar_installed(steam_path: &Path) -> (bool, Option<String>) {
    for lib in get_steam_library_paths(steam_path) {
        let manifest = lib.join("appmanifest_480.acf");
        let common = lib.join("common").join("Spacewar");
        if manifest.exists() {
            return (true, Some(manifest.to_string_lossy().to_string()));
        }
        if common.exists() {
            return (true, Some(common.to_string_lossy().to_string()));
        }
    }
    (false, None)
}

const SKIP_APP_IDS: [u32; 5] = [228980, 1070560, 1391110, 1628350, 223750];

/// 扫描结果缓存：内存 TTL 内重复请求（切换页面/再次进入联机中心）直接复用；
/// 磁盘缓存让应用重启后无需重扫即可秒开列表，超过 24h 由前端判定为陈旧并后台静默重扫
struct ScanCacheEntry {
    games: std::sync::Arc<Vec<LocalInstalledGame>>,
    at: Instant,
    at_ms: u64,
}

static SCAN_CACHE: Mutex<Option<ScanCacheEntry>> = Mutex::new(None);
const SCAN_CACHE_TTL: Duration = Duration::from_secs(60);
/// 磁盘缓存陈旧阈值：超过后前端秒开旧数据并触发一次后台静默重扫
pub const SCAN_STALE_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize)]
struct DiskScanCache {
    scanned_at_ms: u64,
    games: Vec<LocalInstalledGame>,
}

pub struct CachedScan {
    pub games: std::sync::Arc<Vec<LocalInstalledGame>>,
    pub scanned_at_ms: u64,
    pub from_cache: bool,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 扫描时间戳是否已超过 24h 陈旧阈值
pub fn is_scan_stale(scanned_at_ms: u64) -> bool {
    scanned_at_ms == 0 || now_ms().saturating_sub(scanned_at_ms) > SCAN_STALE_MS
}

/// 返回 Arc 共享引用：内存缓存命中只克隆 Arc（引用计数），
/// 不再整份克隆可能上百条、每条含完整 exe 列表的游戏 Vec。
/// cache_path 传入应用数据目录下的缓存文件路径（None 则跳过磁盘缓存）。
pub fn scan_installed_games_cached(
    steam_path: &Path,
    force: bool,
    cache_path: Option<&Path>,
) -> CachedScan {
    if !force {
        // 一级：进程内存缓存（60s），挡住同会话内的高频重复请求
        if let Ok(guard) = SCAN_CACHE.lock() {
            if let Some(entry) = guard.as_ref() {
                if entry.at.elapsed() < SCAN_CACHE_TTL {
                    return CachedScan { games: entry.games.clone(), scanned_at_ms: entry.at_ms, from_cache: true };
                }
            }
        }
        // 二级：磁盘缓存（跨重启），无论新旧都先秒开，陈旧与否由前端决定是否后台重扫
        if let Some(cp) = cache_path {
            if let Ok(text) = fs::read_to_string(cp) {
                if let Ok(c) = serde_json::from_str::<DiskScanCache>(&text) {
                    // 空列表不入缓存也不读缓存：Steam 路径异常时的空扫描不允许污染缓存
                    if c.scanned_at_ms > 0 && !c.games.is_empty() {
                        let games = std::sync::Arc::new(c.games);
                        if let Ok(mut guard) = SCAN_CACHE.lock() {
                            *guard = Some(ScanCacheEntry { games: games.clone(), at: Instant::now(), at_ms: c.scanned_at_ms });
                        }
                        return CachedScan { games, scanned_at_ms: c.scanned_at_ms, from_cache: true };
                    }
                }
            }
        }
    }
    let games = std::sync::Arc::new(scan_installed_games(steam_path));
    let now = now_ms();
    if let Ok(mut guard) = SCAN_CACHE.lock() {
        *guard = Some(ScanCacheEntry { games: games.clone(), at: Instant::now(), at_ms: now });
    }
    if let Some(cp) = cache_path {
        if !games.is_empty() {
            let cache = DiskScanCache { scanned_at_ms: now, games: (*games).clone() };
            if let Ok(text) = serde_json::to_string(&cache) {
                // 临时文件 + 原子替换，避免写一半被进程退出截断成损坏 JSON
                let tmp = cp.with_extension("json.tmp");
                if fs::write(&tmp, text).is_ok() {
                    let _ = fs::rename(&tmp, cp);
                }
            }
        }
    }
    CachedScan { games, scanned_at_ms: now, from_cache: false }
}

/// 单个 appmanifest 的解析与游戏目录探测（在并行扫描线程中执行）
fn scan_single_manifest(lib: &Path, acf_path: &Path, app_id: u32) -> Option<LocalInstalledGame> {
    let content = fs::read_to_string(acf_path).ok()?;
    let game_name = acf_get(&content, "name").unwrap_or_else(|| format!("AppID {}", app_id));
    let install_dir = acf_get(&content, "installdir").unwrap_or_else(|| game_name.clone());
    let size_on_disk = acf_get(&content, "SizeOnDisk").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

    let mut full_path = lib.join("common").join(&install_dir);
    if !full_path.exists() {
        let common_dir = lib.join("common");
        if common_dir.exists() {
            let base_target = clean_name(&install_dir);
            if base_target.len() >= 3 {
                if let Ok(entries) = fs::read_dir(&common_dir) {
                    for e in entries.filter_map(|e| e.ok()) {
                        let clean = clean_name(&e.file_name().to_string_lossy());
                        if clean == base_target || (clean.len() >= 3 && (clean.contains(&base_target) || base_target.contains(&clean))) {
                            full_path = e.path();
                            break;
                        }
                    }
                }
            }
        }
    }

    let mut executables: Vec<String> = Vec::new();
    let mut primary_exe = None;
    let mut has_steamless_backup = false;
    if full_path.exists() {
        executables = find_executable_files(&full_path, 2);
        if !executables.is_empty() {
            let lower_install = install_dir.replace(' ', "").to_lowercase();
            primary_exe = executables
                .iter()
                .find(|p| {
                    let stem = Path::new(p)
                        .file_stem()
                        .map(|s| s.to_string_lossy().replace(' ', "").to_lowercase())
                        .unwrap_or_default();
                    stem == lower_install || lower_install.contains(&stem) || stem.contains(&lower_install)
                })
                .cloned()
                .or_else(|| executables.first().cloned());
        }
        if let Ok(entries) = fs::read_dir(&full_path) {
            has_steamless_backup = entries.filter_map(|e| e.ok()).any(|e| {
                e.file_name().to_string_lossy().to_lowercase().ends_with(".bak")
            });
        }
    }

    let (is_patched, patch_mode, _) = check_game_directory(&full_path);
    let (net_type, net_signals) = detect_net_mode(&full_path, is_patched);
    Some(LocalInstalledGame {
        app_id,
        name: game_name,
        install_dir,
        full_install_path: full_path.to_string_lossy().to_string(),
        library_path: lib.to_string_lossy().to_string(),
        size_on_disk,
        executable_files: executables,
        primary_exe,
        has_steamless_backup,
        is_patched,
        patch_mode,
        has_backup: full_path.join("steam_api64_o.dll").exists() || full_path.join("steam_api_o.dll").exists() || has_steamless_backup,
        net_type,
        net_signals,
    })
}

pub fn scan_installed_games(steam_path: &Path) -> Vec<LocalInstalledGame> {
    let libs = get_steam_library_paths(steam_path);

    // 先按库顺序收集待扫描清单（去重与跳过逻辑与原实现一致），再并行处理
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut tasks: Vec<(usize, PathBuf, u32)> = Vec::new();
    for (lib_idx, lib) in libs.iter().enumerate() {
        let Ok(files) = fs::read_dir(lib) else { continue };
        for entry in files.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                continue;
            }
            let Some(app_id) = name
                .trim_start_matches("appmanifest_")
                .trim_end_matches(".acf")
                .parse::<u32>()
                .ok()
            else {
                continue;
            };
            if seen.contains(&app_id) || SKIP_APP_IDS.contains(&app_id) {
                continue;
            }
            seen.insert(app_id);
            tasks.push((lib_idx, entry.path(), app_id));
        }
    }
    drop(seen);

    let mut results: Vec<Option<LocalInstalledGame>> = vec![None; tasks.len()];
    // 每个游戏的目录递归探测（exe/补丁状态）互不依赖，按 CPU 核数分块并行执行
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).max(1);
    let chunk_size = tasks.len().div_ceil(workers).max(1);
    std::thread::scope(|scope| {
        let mut rest: &mut [Option<LocalInstalledGame>] = &mut results;
        for chunk in tasks.chunks(chunk_size) {
            let (head, tail) = rest.split_at_mut(chunk.len());
            rest = tail;
            let libs_ref = &libs;
            scope.spawn(move || {
                for (i, (lib_idx, acf_path, app_id)) in chunk.iter().enumerate() {
                    head[i] = scan_single_manifest(&libs_ref[*lib_idx], acf_path, *app_id);
                }
            });
        }
    });

    let mut games: Vec<LocalInstalledGame> = results.into_iter().flatten().collect();
    games.sort_by(|a, b| b.full_install_path.cmp(&a.full_install_path).then(a.name.cmp(&b.name)));
    games
}

/// 启动联机模式：open(Open内核) / spacewar(环境变量直启) / bat(批处理)
pub fn launch_game_online(
    app_id: u32,
    game_path: &str,
    primary_exe: Option<String>,
    mode: &str,
    online_app_id: u32,
) -> Result<String, String> {
    if mode == "open" {
        // Open 内核联机模式要求 Steam 会话以 -onlinefix 参数运行（OST 内核联机拦截生效）：
        // - 未运行：带参启动并等待就绪
        // - 已运行但不带参（如 -silent 普通会话）：重启到联机模式
        // - 已带参：直接唤起
        let steam_running = steam::is_steam_running();
        if !(steam_running && steam::is_onlinefix_running()) {
            let Some(sp) = steam::detect_steam_path() else {
                return Err("未找到 Steam 安装路径，无法进入 Open 内核联机模式".to_string());
            };
            if steam_running {
                steam::kill_steam();
            }
            steam::restart_steam(&sp, &["-onlinefix".to_string()]);
            // 就绪检测前先失效运行状态缓存，否则 8 秒旧值会让前几轮轮询读到过期结果
            steam::clear_steam_running_cache();
            // 等待 steam.exe 真正就绪（冷启动可达 15s+），就绪后再发协议
            let mut ready = false;
            for _ in 0..20 {
                if steam::is_steam_running() {
                    ready = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
            if !ready {
                return Err("Steam 未能以联机模式启动，请手动启动 Steam 后重试".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(2000));
        }
        // 注意：此处不再走 steam://rungameid/真实AppID —— lua 伪许可证只存在于客户端，
        // Valve 服务器会丢弃无有效许可 AppID 的 presence 广播，好友完全看不到（假启动）。
        // 改为与 Spacewar 相同的 480 会话直启，落到下方统一启动逻辑，
        // 由内核把好友列表里的显示名映射成真实游戏名。
    }

    let gp = PathBuf::from(game_path);
    if !gp.exists() {
        crate::open_url_cmd(&format!("steam://rungameid/{}", app_id))?;
        return Ok(format!("已通过 Steam 协议唤起游戏 (AppID: {})", app_id));
    }

    let mut target = primary_exe.clone().map(PathBuf::from);
    if target.as_ref().map(|t| !t.exists()).unwrap_or(true) {
        let exes = find_executable_files(&gp, 2);
        target = exes.first().map(PathBuf::from);
    }
    let Some(target) = target.filter(|t| t.exists()) else {
        crate::open_url_cmd(&format!("steam://rungameid/{}", app_id))?;
        return Ok("未在游戏目录找到 exe，已回退至 Steam 协议启动。".to_string());
    };

    if mode == "spacewar" || mode == "open" {
        // 仅注入 SteamAppId 环境变量、严禁写 steam_appid.txt（实测 OST 内核检测到
        // 该文件会把 480 会话改写回真实 AppID，导致 presence 以无许可身份广播、
        // 好友完全看不到 —— 即"假启动"）；环境变量方式广播保持 480，好友可见可加入。
        // 游戏自带的 steam_appid.txt 需备份移除，避免覆盖环境变量语义。
        // Open 模式与 Spacewar 模式在此汇合：前者额外保证 Steam 带 -onlinefix 运行，
        // 内核会把好友列表里的 480 显示名映射成真实游戏名。
        let appid_file = gp.join("steam_appid.txt");
        if appid_file.exists() {
            let _ = fs::copy(&appid_file, gp.join("steam_appid.txt.cfd_bak"));
            let _ = fs::remove_file(&appid_file);
        }
        Command::new(&target)
            .current_dir(target.parent().unwrap_or(&gp))
            .env("SteamAppId", online_app_id.to_string())
            .env("SteamGameId", online_app_id.to_string())
            .env("SteamOverlayGameId", online_app_id.to_string())
            .spawn()
            .map_err(|e| format!("启动游戏失败: {}", e))?;
        let mode_name = if mode == "open" { "Open内核" } else { "Spacewar" };
        return Ok(format!("已通过 {} 模式 (AppID: {}) 成功拉起游戏！", mode_name, online_app_id));
    }

    if mode == "bat" {
        // 与 Spacewar 模式同理：已有 steam_appid.txt（旧版残留/补丁模式遗留）会让
        // OST 内核把 480 会话改写回真实 AppID，启动前备份移除，仅靠环境变量伪装
        let appid_file = gp.join("steam_appid.txt");
        if appid_file.exists() {
            let _ = fs::copy(&appid_file, gp.join("steam_appid.txt.cfd_bak"));
            let _ = fs::remove_file(&appid_file);
        }
        let dir_name = gp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let exe_name_orig = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        // 目录名/exe 名直接拼进 bat 命令行，& | ^ < > % 等字符会被 cmd 解析
        // 成额外命令或变量展开（文件夹名合法含这些字符），必须先清洗
        let sanitize = |s: &str| -> String {
            s.chars()
                .filter(|c| !"&|^<>%\"!".contains(*c))
                .collect::<String>()
                .trim()
                .to_string()
        };
        let bat_title = sanitize(&dir_name);
        let exe_name = sanitize(&exe_name_orig);
        // 清洗改变了原名（含 cmd 元字符）：bat 里的路径已与真实文件不一致，
        // 绝不能生成启动失败的 bat，回退 Steam 协议正常启动路径
        if bat_title != dir_name || exe_name != exe_name_orig {
            crate::open_url_cmd(&format!("steam://rungameid/{}", app_id))?;
            return Ok(format!(
                "游戏路径含命令行特殊字符，无法生成 bat 联机脚本，已回退 Steam 协议启动 (AppID: {})。",
                app_id
            ));
        }
        let bat = format!(
            "@echo off\ntitle Online Fix Launcher - {}\ncd /d \"%~dp0\"\nset SteamAppId={}\nset SteamGameId={}\nset SteamOverlayGameId={}\nstart \"\" \"{}\" %*\nexit\n",
            bat_title,
            online_app_id,
            online_app_id,
            online_app_id,
            exe_name
        );
        let bat_path = gp.join("Launch_Online_Fix.bat");
        fs::write(&bat_path, bat).map_err(|e| format!("写入启动脚本失败: {}", e))?;
        Command::new("cmd.exe")
            .args(["/c", "Launch_Online_Fix.bat"])
            .current_dir(&gp)
            // CREATE_NO_WINDOW：bat 由 start 拉起游戏 GUI，执行 cmd 本身无需窗口
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("执行启动脚本失败: {}", e))?;
        return Ok(format!("已生成并执行 Launch_Online_Fix.bat (AppID: {}) 成功拉起游戏！", online_app_id));
    }

    Err("未知的联机启动模式".to_string())
}
