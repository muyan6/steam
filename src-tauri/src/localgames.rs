use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;

use crate::steam;

#[derive(Debug, Clone, Serialize)]
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
            for line in content.lines() {
                let line = line.trim();
                if line.len() >= 10 && line[..10].eq_ignore_ascii_case("RealAppId=") {
                    if let Ok(id) = line[10..].trim().trim_end_matches(';').parse::<u32>() {
                        app_id = Some(id);
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

pub fn scan_installed_games(steam_path: &Path) -> Vec<LocalInstalledGame> {
    let mut games: Vec<LocalInstalledGame> = Vec::new();
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();

    for lib in get_steam_library_paths(steam_path) {
        let Ok(files) = fs::read_dir(&lib) else { continue };
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

            let Ok(content) = fs::read_to_string(entry.path()) else { continue };
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
            let _ = 0; // has_backup 在下方按文件存在性计算
            seen.insert(app_id);
            games.push(LocalInstalledGame {
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
                has_backup: {
                    let _ = &full_path;
                    full_path.join("steam_api64_o.dll").exists() || full_path.join("steam_api_o.dll").exists() || has_steamless_backup
                },
            });
        }
    }

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
        crate::open_url_cmd(&format!("steam://rungameid/{}", app_id))?;
        return Ok(format!("已通过 Open内核联机模式唤起游戏 (AppID: {})！", app_id));
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

    if mode == "spacewar" {
        // 覆写 steam_appid.txt 前备份用户/游戏自带文件，便于手动恢复
        let appid_file = gp.join("steam_appid.txt");
        if appid_file.exists() {
            let _ = fs::copy(&appid_file, gp.join("steam_appid.txt.cfd_bak"));
        }
        let _ = fs::write(&appid_file, online_app_id.to_string());
        Command::new(&target)
            .current_dir(target.parent().unwrap_or(&gp))
            .env("SteamAppId", online_app_id.to_string())
            .env("SteamGameId", online_app_id.to_string())
            .env("SteamOverlayGameId", online_app_id.to_string())
            .spawn()
            .map_err(|e| format!("启动游戏失败: {}", e))?;
        return Ok(format!("已通过 Spacewar 模式 (AppID: {}) 成功拉起游戏！", online_app_id));
    }

    if mode == "bat" {
        let exe_name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let bat = format!(
            "@echo off\ntitle Online Fix Launcher - {}\ncd /d \"%~dp0\"\nset SteamAppId={}\nset SteamGameId={}\nset SteamOverlayGameId={}\nstart \"\" \"{}\" %*\nexit\n",
            gp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
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
            .spawn()
            .map_err(|e| format!("执行启动脚本失败: {}", e))?;
        return Ok(format!("已生成并执行 Launch_Online_Fix.bat (AppID: {}) 成功拉起游戏！", online_app_id));
    }

    Err("未知的联机启动模式".to_string())
}
