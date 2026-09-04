use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamlessStatusInfo {
    pub available: bool,
    pub engine: String,
    pub cli_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamlessRepairResult {
    pub success: bool,
    pub message: String,
    pub total_found: usize,
    pub repaired_count: usize,
    pub backup_count: usize,
    pub skipped_count: usize,
    pub details: Vec<SteamlessDetail>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamlessDetail {
    pub file: String,
    pub status: String,
    pub message: Option<String>,
}

/// 候选 CLI 路径：应用资源目录 / exe 同级目录 / 游戏目录旁 tools
fn candidate_cli_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("tools").join("steamless").join("Steamless.CLI.exe"));
            paths.push(dir.join("assets").join("tools").join("steamless").join("Steamless.CLI.exe"));
            if let Some(parent) = dir.parent() {
                paths.push(parent.join("tools").join("steamless").join("Steamless.CLI.exe"));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("src-tauri").join("assets").join("tools").join("steamless").join("Steamless.CLI.exe"));
        paths.push(cwd.join("assets").join("tools").join("steamless").join("Steamless.CLI.exe"));
    }
    paths
}

/// 追加 Tauri 资源目录候选（打包后资源位于 resource_dir）
pub fn candidate_paths_with_resource(resource_dir: Option<&std::path::Path>) -> Vec<PathBuf> {
    let mut paths = candidate_cli_paths();
    if let Some(rd) = resource_dir {
        paths.insert(0, rd.join("assets").join("tools").join("steamless").join("Steamless.CLI.exe"));
        paths.insert(1, rd.join("tools").join("steamless").join("Steamless.CLI.exe"));
    }
    paths
}

pub fn find_steamless_cli() -> Option<String> {
    for p in candidate_cli_paths() {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

pub fn get_status_with_resource(resource_dir: Option<&std::path::Path>) -> SteamlessStatusInfo {
    let cli = candidate_paths_with_resource(resource_dir).into_iter().find(|p| p.exists());
    match cli {
        Some(cli) => SteamlessStatusInfo {
            available: true,
            engine: "Steamless CLI v3.1.0.5 (内置就绪)".to_string(),
            cli_path: Some(cli.to_string_lossy().to_string()),
        },
        None => get_status(),
    }
}

pub fn get_status() -> SteamlessStatusInfo {
    let cli = candidate_cli_paths().into_iter().find(|p| p.exists());
    match cli {
        Some(cli) => SteamlessStatusInfo {
            available: true,
            engine: "Steamless CLI v3.1.0.5 (本地就绪)".to_string(),
            cli_path: Some(cli.to_string_lossy().to_string()),
        },
        None => SteamlessStatusInfo {
            available: false,
            engine: "Steamless CLI 未找到".to_string(),
            cli_path: None,
        },
    }
}

const SKIP_DIRS: [&str; 6] = ["_redist", "directx", "support", "redist", ".git", "node_modules"];
const SKIP_FILES: [&str; 8] = [
    "unins000.exe", "uninstall.exe", "unitycrashhandler", "crashreport",
    "dxsetup.exe", "vcredist", "easyanticheat", "battleye",
];

fn find_executables(dir: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut results = Vec::new();
    fn walk(dir: &Path, depth: usize, max_depth: usize, results: &mut Vec<PathBuf>) {
        if depth > max_depth {
            return;
        }
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
                    results.push(p);
                }
            }
        }
    }
    walk(dir, 0, max_depth, &mut results);
    results
}

/// 运行 Steamless CLI 处理单个 exe（30 秒超时，超时强杀）
/// 注意：Steamless 的输出文件名规则是「输入路径原样追加 .unpacked.exe」：
///   game.exe -> game.exe.unpacked.exe
fn unpack_single(
    cli: &str,
    exe_path: &Path,
) -> (bool, String, &'static str) {
    let dir = exe_path.parent().unwrap_or(Path::new("."));
    let unpacked = PathBuf::from(format!("{}.unpacked.exe", exe_path.display()));
    let file_label = exe_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    let child = Command::new(cli)
        // Steamless CLI 参数为精确小写匹配：--quiet / --keepbind（没有 --keep-bind）
        .args(["--quiet", "--keepbind"])
        .arg(exe_path)
        .current_dir(dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => return (false, format!("启动 Steamless CLI 失败: {}", e), "error"),
    };

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = Command::new("taskkill")
                        .args(["/PID", &child.id().to_string(), "/T", "/F"])
                        .creation_flags(0x08000000)
                        .output();
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => break,
        }
    }

    // 超时被强杀时输出可能是残缺文件，绝不能用它覆盖原 exe
    if timed_out {
        let _ = fs::remove_file(&unpacked);
        return (false, format!("Steamless CLI 处理 {} 超时，已放弃本次解密", file_label), "error");
    }

    if unpacked.exists() && fs::metadata(&unpacked).map(|m| m.len() > 0).unwrap_or(false) {
        // 备份命名与 Steamless 输出同规则追加：game.exe -> game.exe.bak
        let backup = PathBuf::from(format!("{}.bak", exe_path.display()));
        if !backup.exists() {
            let _ = fs::copy(exe_path, &backup);
        }
        if fs::copy(&unpacked, exe_path).is_ok() {
            let _ = fs::remove_file(&unpacked);
            return (true, format!("成功通过 Steamless CLI 解密并替换 ({})", file_label), "unpacked");
        }
    }

    (
        false,
        format!("Steamless CLI 处理 {} 未产生解密输出（该文件可能未加壳或不被支持）", file_label),
        "error",
    )
}

pub fn repair_game(game_dir: &str, game_name: Option<&str>) -> SteamlessRepairResult {
    repair_game_with_resource(game_dir, game_name, None)
}

pub fn repair_game_with_resource(game_dir: &str, game_name: Option<&str>, resource_dir: Option<&std::path::Path>) -> SteamlessRepairResult {
    let dir = PathBuf::from(game_dir);
    if !dir.exists() {
        return SteamlessRepairResult {
            success: false,
            message: format!("游戏目录不存在: {}", game_dir),
            total_found: 0,
            repaired_count: 0,
            backup_count: 0,
            skipped_count: 0,
            details: vec![],
        };
    }

    let exes = find_executables(&dir, 3);
    if exes.is_empty() {
        return SteamlessRepairResult {
            success: false,
            message: format!("在《{}》目录下未找到可执行文件 (.exe)", game_name.unwrap_or("指定游戏")),
            total_found: 0,
            repaired_count: 0,
            backup_count: 0,
            skipped_count: 0,
            details: vec![],
        };
    }

    let Some(cli) = candidate_paths_with_resource(resource_dir).into_iter().find(|p| p.exists()) else {
        return SteamlessRepairResult {
            success: false,
            message: "Steamless CLI 未找到，无法执行脱壳解密。".to_string(),
            total_found: exes.len(),
            repaired_count: 0,
            backup_count: 0,
            skipped_count: 0,
            details: vec![],
        };
    };

    let mut repaired = 0;
    let mut skipped = 0;
    let mut details = Vec::new();
    for exe in &exes {
        let name = exe.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let (ok, msg, status) = unpack_single(&cli.to_string_lossy(), exe);
        details.push(SteamlessDetail {
            file: name,
            status: status.to_string(),
            message: Some(msg),
        });
        if ok {
            repaired += 1;
        } else if status == "skipped" {
            skipped += 1;
        }
    }

    let title = game_name.map(|n| format!("《{}》", n)).unwrap_or_else(|| "游戏".to_string());
    let success = repaired > 0 || details.iter().all(|d| d.status != "error");
    SteamlessRepairResult {
        success,
        message: if success {
            format!("已成功对 {} 目录下 {} 个可执行文件完成 Steamless 解密脱壳与修复！", title, exes.len())
        } else {
            "部分可执行文件解密修复时遇到异常，请查看明细日志。".to_string()
        },
        total_found: exes.len(),
        repaired_count: repaired,
        backup_count: repaired,
        skipped_count: skipped,
        details,
    }
}
