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

/// 递归（限深）查找 SAM.Game.exe。
///
/// 保留目录层级解压后，SAM.Game.exe 可能位于 SAM.Game/ 子目录下，
/// 固定一层的旧实现会漏掉更深层级；同时输出顺序必须确定，
/// 不能依赖 read_dir 的返回顺序。
pub fn find_sam_game_exe(dir: &Path) -> Option<PathBuf> {
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
            // 同一层有多个时按路径排序，保证结果稳定可复现
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

/// 查询本地 SAM 状态
pub fn get_sam_status() -> Result<SamStatus, String> {
    let dir = get_sam_dir()?;
    if let Some(exe) = find_sam_game_exe(&dir) {
        Ok(SamStatus {
            is_installed: true,
            exe_path: Some(exe.to_string_lossy().to_string()),
            version: Some("7.0.25".to_string()),
        })
    } else {
        Ok(SamStatus {
            is_installed: false,
            exe_path: None,
            version: None,
        })
    }
}

/// 下载并部署 SAM
pub async fn download_sam(download_url: Option<String>) -> Result<SamStatus, String> {
    let dir = get_sam_dir()?;
    let url = download_url.unwrap_or_else(|| {
        "https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.25/SteamAchievementManager-7.0.25.zip".to_string()
    });

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let resp = client.get(&url)
        .header("User-Agent", "chunfengdu-client")
        .send().await
        .map_err(|e| format!("下载 SAM 工具失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载 SAM 失败，HTTP 状态码: {}", resp.status()));
    }

    let bytes = resp.bytes().await
        .map_err(|e| format!("接收 SAM 数据流失败: {}", e))?;

    if bytes.len() < 1000 {
        return Err("下载的 SAM 压缩包体积异常".to_string());
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

/// 针对指定游戏 AppID 启动 SAM 解锁器
pub fn launch_sam_for_game(app_id: u32) -> Result<bool, String> {
    let dir = get_sam_dir()?;
    let exe = find_sam_game_exe(&dir)
        .ok_or_else(|| "本地尚未安装 SAM 成就管理器，请先点击一键安装".to_string())?;

    let work_dir = exe.parent().unwrap_or(&dir);

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
