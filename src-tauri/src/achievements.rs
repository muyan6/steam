use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamStatus {
    pub is_installed: bool,
    pub exe_path: Option<String>,
    pub version: Option<String>,
}

/// 获取 SAM (Steam Achievement Manager) 持久化存放目录
pub fn get_sam_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "无法读取 APPDATA 环境变量".to_string())?;
    let dir = PathBuf::from(appdata)
        .join("com.chunfengdu.app")
        .join("tools")
        .join("sam");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("创建 SAM 工具目录失败: {}", e))?;
    }
    Ok(dir)
}

/// 候选 SAM 路径：应用打包资源目录 / exe 同级目录 / 本地工程 assets 目录
fn candidate_sam_paths(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(rd) = resource_dir {
        paths.push(rd.join("assets").join("tools").join("sam").join("SAM.Game.exe"));
        paths.push(rd.join("tools").join("sam").join("SAM.Game.exe"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("tools").join("sam").join("SAM.Game.exe"));
            paths.push(dir.join("assets").join("tools").join("sam").join("SAM.Game.exe"));
            if let Some(parent) = dir.parent() {
                paths.push(parent.join("tools").join("sam").join("SAM.Game.exe"));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("src-tauri").join("assets").join("tools").join("sam").join("SAM.Game.exe"));
        paths.push(cwd.join("assets").join("tools").join("sam").join("SAM.Game.exe"));
    }
    paths
}

/// 查找 SAM.Game.exe（支持打包内置资源、工程资产与 APPDATA 动态安装目录）
pub fn find_sam_game_exe(resource_dir: Option<&Path>) -> Option<PathBuf> {
    for p in candidate_sam_paths(resource_dir) {
        if p.exists() {
            return Some(p);
        }
    }

    // 备用：从 APPDATA 递归查找
    if let Ok(dir) = get_sam_dir() {
        if let Some(p) = find_sam_game_in_dir(&dir) {
            return Some(p);
        }
    }

    None
}

/// 递归（限深）查找目录下的 SAM.Game.exe
pub fn find_sam_game_in_dir(dir: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, depth: usize) -> Option<PathBuf> {
        if depth > 4 {
            return None;
        }
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            let mut candidates: Vec<PathBuf> = Vec::new();
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    dirs.push(p);
                } else if p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case("SAM.Game.exe"))
                    .unwrap_or(false)
                {
                    candidates.push(p);
                }
            }
            candidates.sort();
            if let Some(first) = candidates.into_iter().next() {
                return Some(first);
            }
        }
        dirs.sort();
        for d in dirs {
            if let Some(found) = walk(&d, depth + 1) {
                return Some(found);
            }
        }
        None
    }
    walk(dir, 0)
}

/// 查询本地 SAM 状态（支持内置与 APPDATA 两种来源）
pub fn get_sam_status_with_resource(resource_dir: Option<&Path>) -> Result<SamStatus, String> {
    if let Some(exe) = find_sam_game_exe(resource_dir) {
        let is_bundled = exe.to_string_lossy().contains("assets") || exe.to_string_lossy().contains("tools\\sam");
        Ok(SamStatus {
            is_installed: true,
            exe_path: Some(exe.to_string_lossy().to_string()),
            version: Some(if is_bundled { "7.0.41 (内置就绪)".to_string() } else { "7.0.41".to_string() }),
        })
    } else {
        Ok(SamStatus {
            is_installed: false,
            exe_path: None,
            version: None,
        })
    }
}

pub fn get_sam_status() -> Result<SamStatus, String> {
    get_sam_status_with_resource(None)
}

/// 下载并部署 SAM（版本 7.0.41，带国内镜像加速回退）
pub async fn download_sam(download_url: Option<String>) -> Result<SamStatus, String> {
    let dir = get_sam_dir()?;
    let urls: Vec<String> = if let Some(u) = download_url {
        vec![u]
    } else {
        vec![
            "https://ghfast.top/https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string(),
            "https://gh-proxy.com/https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string(),
            "https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string(),
        ]
    };

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut last_err = String::new();
    let mut bytes = Vec::new();
    for u in &urls {
        match client.get(u).header("User-Agent", "chunfengdu-client").send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(b) = resp.bytes().await {
                    if b.len() >= 1000 {
                        bytes = b.to_vec();
                        break;
                    }
                }
            }
            Ok(resp) => {
                last_err = format!("HTTP 状态码: {}", resp.status());
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
    }

    if bytes.is_empty() {
        return Err(format!("下载 SAM 失败: {}", last_err));
    }

    let mut archive = zip::ZipArchive::new(Cursor::new(&bytes))
        .map_err(|e| format!("解析 SAM 归档文件失败: {}", e))?;

    // 必须保留压缩包内的目录层级。
    //
    // 原实现用 Path::file_name() 把所有条目扁平化到同一目录：SAM 官方包是多层
    // 子目录结构（SAM.Game/、SAM.Picker/ 等），展平后同名文件互相覆盖、
    // 依赖 DLL 丢失，装完直接起不来。
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取 SAM 归档项失败: {}", e))?;

        let name = file.name().to_string();
        if name.contains("__MACOSX") {
            continue;
        }

        // 只接受 zip 内部的相对路径；拒绝绝对路径与 .. 穿越（zip-slip）
        let rel = Path::new(&name);
        if rel.is_absolute()
            || rel.components().any(|c| matches!(c, std::path::Component::ParentDir))
        {
            continue;
        }
        let out_path = dir.join(rel);

        if file.is_dir() {
            let _ = fs::create_dir_all(&out_path);
            continue;
        }
        if let Some(parent) = out_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let mut out_file = fs::File::create(&out_path)
            .map_err(|e| format!("创建 SAM 解压文件失败: {}", e))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|e| format!("写入 SAM 解压文件失败: {}", e))?;
    }

    get_sam_status()
}

/// 针对指定游戏 AppID 启动 SAM 解锁器（支持内置与安装目录）
pub fn launch_sam_for_game_with_resource(app_id: u32, resource_dir: Option<&Path>) -> Result<bool, String> {
    let exe = find_sam_game_exe(resource_dir)
        .ok_or_else(|| "本地尚未就绪 SAM 成就管理器".to_string())?;

    let work_dir = exe.parent().ok_or_else(|| "无法获取 SAM 工作目录".to_string())?;

    #[cfg(windows)]
    {
        // 0x00000200 = CREATE_NEW_PROCESS_GROUP
        let mut cmd = Command::new(&exe);
        cmd.arg(app_id.to_string());
        cmd.current_dir(work_dir);
        cmd.creation_flags(0x00000200);

        cmd.spawn()
            .map_err(|e| format!("启动 SAM 失败: {}", e))?;

        Ok(true)
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&exe);
        cmd.arg(app_id.to_string());
        cmd.current_dir(work_dir);
        cmd.spawn().map_err(|e| format!("启动 SAM 失败: {}", e))?;
        Ok(true)
    }
}

pub fn launch_sam_for_game(app_id: u32) -> Result<bool, String> {
    launch_sam_for_game_with_resource(app_id, None)
}

/// 打开 SAM 存放目录
pub fn open_sam_dir() -> Result<bool, String> {
    let dir = get_sam_dir()?;
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开 SAM 目录失败: {}", e))?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}
