use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainerStatus {
    pub is_downloaded: bool,
    pub exe_path: Option<String>,
    pub exe_name: Option<String>,
    pub file_size: Option<u64>,
    pub is_running: bool,
}

/// 计算指定 AppID 的修改器持久化目录路径（**不产生任何磁盘副作用**）
pub fn get_trainer_dir_path(app_id: u32) -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "无法读取 APPDATA 环境变量".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("com.chunfengdu.app")
        .join("trainers")
        .join(app_id.to_string()))
}

/// 获取目录并确保存在（仅下载/写入路径调用）
pub fn get_trainer_dir(app_id: u32) -> Result<PathBuf, String> {
    let dir = get_trainer_dir_path(app_id)?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("创建修改器目录失败: {}", e))?;
    }
    Ok(dir)
}

/// 寻找目录下的修改器主执行程序。
///
/// 结果必须确定：原实现直接返回 read_dir 的第一个 .exe，而目录项顺序由
/// 文件系统决定，同一目录在多次调用间可能给出不同的「主程序」。
/// 改为收集后排序，优先取与 AppID 同名的可执行文件，否则取字典序首个。
pub fn find_trainer_exe(dir: &Path) -> Option<PathBuf> {
    find_trainer_exe_for(dir, None)
}

/// 带 AppID 偏好的主程序查找
pub fn find_trainer_exe_for(dir: &Path, app_id: Option<u32>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("exe") {
                    candidates.push(path);
                }
            }
        }
    }
    candidates.sort();
    if let Some(id) = app_id {
        let needle = id.to_string();
        if let Some(hit) = candidates
            .iter()
            .find(|p| p.file_stem().and_then(|s| s.to_str()).map(|s| s.contains(&needle)).unwrap_or(false))
        {
            return Some(hit.clone());
        }
    }
    candidates.into_iter().next()
}

/// 递归（限深）查找修改器主程序，兼容压缩包内的子目录层级
fn find_trainer_exe_recursive(dir: &Path, app_id: u32, depth: usize) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    if let Some(hit) = find_trainer_exe_for(dir, Some(app_id)) {
        return Some(hit);
    }
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                dirs.push(p);
            }
        }
    }
    dirs.sort();
    for d in dirs {
        if let Some(found) = find_trainer_exe_recursive(&d, app_id, depth + 1) {
            return Some(found);
        }
    }
    None
}

/// 检查某 Exe 文件名是否正在运行
fn is_exe_running(exe_name: &str) -> bool {
    #[cfg(windows)]
    {
        let filter = format!("IMAGENAME eq {}", exe_name);
        let output = Command::new("tasklist")
            .args(["/FI", &filter, "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            return text.contains(&exe_name.to_lowercase());
        }
    }
    false
}

/// 查询本地修改器状态。
///
/// 纯只读查询：使用不建目录的 get_trainer_dir_path。
/// 前端会对**每款本地游戏**调用本函数做状态预取，若在此 create_dir_all，
/// 100 款游戏就会在 APPDATA 下凭空生成 100 个空目录。
pub fn get_trainer_status(app_id: u32) -> Result<TrainerStatus, String> {
    let dir = get_trainer_dir_path(app_id)?;
    if let Some(exe) = find_trainer_exe_recursive(&dir, app_id, 0) {
        let exe_name = exe.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Trainer.exe")
            .to_string();
        let file_size = fs::metadata(&exe).ok().map(|m| m.len());
        let running = is_exe_running(&exe_name);

        Ok(TrainerStatus {
            is_downloaded: true,
            exe_path: Some(exe.to_string_lossy().to_string()),
            exe_name: Some(exe_name),
            file_size,
            is_running: running,
        })
    } else {
        Ok(TrainerStatus {
            is_downloaded: false,
            exe_path: None,
            exe_name: None,
            file_size: None,
            is_running: false,
        })
    }
}

/// 下载并解压/保存修改器
pub async fn download_trainer(
    app_id: u32,
    download_url: String,
    filename: Option<String>,
    referer: Option<String>,
) -> Result<TrainerStatus, String> {
    let dir = get_trainer_dir(app_id)?;

    // 使用 reqwest 发起请求（支持 302 重定向跟踪，携带 Referer 与 User-Agent）
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut req = client.get(&download_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    if let Some(ref r) = referer {
        req = req.header("Referer", r);
    } else {
        req = req.header("Referer", "https://flingtrainer.com/");
    }

    let resp = req.send().await
        .map_err(|e| format!("下载修改器网络请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载修改器失败，HTTP 状态码: {}", resp.status()));
    }

    let bytes = resp.bytes().await
        .map_err(|e| format!("接收修改器数据流失败: {}", e))?;

    if bytes.len() < 100 {
        return Err("下载内容异常，文件体积过小".to_string());
    }

    // 判断是 Zip 压缩包还是直接为 Exe 文件
    let is_zip = bytes.len() > 4 && bytes[0] == b'P' && bytes[1] == b'K';
    let is_exe = bytes.len() > 2 && bytes[0] == b'M' && bytes[1] == b'Z';

    if is_zip {
        // 解压 Zip：**完整保留目录层级，并解出全部文件**。
        //
        // 原实现只取压缩包内第一个 .exe 就 break，同包的配置、依赖 DLL、
        // 说明文件全部丢弃，压缩包内带子目录时更是直接丢结构；FLiNG 的包
        // 常带配置与依赖，只留一个 exe 会导致修改器起不来或功能缺失。
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes))
            .map_err(|e| format!("解析修改器 Zip 归档失败: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("读取归档文件项失败: {}", e))?;

            let name = file.name().to_string();
            if name.contains("__MACOSX") {
                continue;
            }

            // 只接受包内相对路径，拒绝绝对路径与 .. 穿越（zip-slip）
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
                .map_err(|e| format!("创建解压修改器文件失败: {}", e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("写入解压修改器失败: {}", e))?;
        }

        if find_trainer_exe_recursive(&dir, app_id, 0).is_none() {
            return Err("修改器压缩包内未找到可执行文件 (.exe)".to_string());
        }
    } else if is_exe {
        // 直接为 Exe 可执行程序
        let safe_name = filename
            .unwrap_or_else(|| format!("Trainer_{}.exe", app_id));
        let out_name = if safe_name.ends_with(".exe") {
            safe_name
        } else {
            format!("{}.exe", safe_name)
        };
        let out_path = dir.join(out_name);
        fs::write(&out_path, &bytes)
            .map_err(|e| format!("写入修改器文件失败: {}", e))?;
    } else {
        return Err("下载内容并非有效的修改器程序或压缩包 (文件头不匹配)".to_string());
    }

    get_trainer_status(app_id)
}

/// 脱机拉起修改器进程（独立进程组，不卡死主界面，不因春风渡退出而受影响）
pub fn launch_trainer(app_id: u32) -> Result<bool, String> {
    let dir = get_trainer_dir_path(app_id)?;
    let exe = find_trainer_exe_recursive(&dir, app_id, 0)
        .ok_or_else(|| "本地未找到已下载的修改器程序，请先点击下载".to_string())?;
    // 工作目录取 exe 所在目录：修改器常按相对路径读取同目录的配置与依赖
    let work_dir = exe.parent().unwrap_or(&dir).to_path_buf();

    #[cfg(windows)]
    {
        // 0x00000200 = CREATE_NEW_PROCESS_GROUP
        let mut cmd = Command::new(&exe);
        cmd.current_dir(&work_dir);
        cmd.creation_flags(0x00000200);

        cmd.spawn()
            .map_err(|e| format!("启动修改器失败: {}", e))?;

        Ok(true)
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&exe);
        cmd.current_dir(&work_dir);
        cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;
        Ok(true)
    }
}

/// 打开修改器存放目录
pub fn open_trainer_dir(app_id: u32) -> Result<bool, String> {
    let dir = get_trainer_dir_path(app_id)?;
    #[cfg(windows)]
    {
        if !dir.exists() {
            return Err("该游戏尚未下载修改器，目录不存在".to_string());
        }
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("打开修改器目录失败: {}", e))?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// 删除已下载的修改器。
///
/// 刻意用不建目录的 get_trainer_dir_path：原实现先 create_dir_all 再 remove_dir_all，
/// 对「本来就没有修改器」的游戏等于白建又白删一次目录。
pub fn delete_trainer(app_id: u32) -> Result<bool, String> {
    let dir = get_trainer_dir_path(app_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("删除修改器目录失败: {}", e))?;
    }
    Ok(true)
}
