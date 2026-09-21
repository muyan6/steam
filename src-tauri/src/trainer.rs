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

/// 获取指定 AppID 的修改器持久化存放目录
pub fn get_trainer_dir(app_id: u32) -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "无法读取 APPDATA 环境变量".to_string())?;
    let dir = PathBuf::from(appdata)
        .join("com.chunfengdu.app")
        .join("trainers")
        .join(app_id.to_string());
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("创建修改器目录失败: {}", e))?;
    }
    Ok(dir)
}

/// 寻找目录下的修改器主执行程序
pub fn find_trainer_exe(dir: &Path) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("exe") {
                        return Some(path);
                    }
                }
            }
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

/// 查询本地修改器状态
pub fn get_trainer_status(app_id: u32) -> Result<TrainerStatus, String> {
    let dir = get_trainer_dir(app_id)?;
    if let Some(exe) = find_trainer_exe(&dir) {
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
        // 解压 Zip 提取里面的 .exe
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes))
            .map_err(|e| format!("解析修改器 Zip 归档失败: {}", e))?;

        let mut extracted_exe: Option<PathBuf> = None;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("读取归档文件项失败: {}", e))?;

            let name = file.name().to_string();
            if name.ends_with(".exe") && !name.contains("__MACOSX") {
                let clean_file_name = Path::new(&name).file_name()
                    .unwrap_or_default();
                let out_path = dir.join(clean_file_name);
                let mut out_file = fs::File::create(&out_path)
                    .map_err(|e| format!("创建解压修改器文件失败: {}", e))?;
                std::io::copy(&mut file, &mut out_file)
                    .map_err(|e| format!("写入解压修改器失败: {}", e))?;
                extracted_exe = Some(out_path);
                break;
            }
        }

        if extracted_exe.is_none() {
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
    let dir = get_trainer_dir(app_id)?;
    let exe = find_trainer_exe(&dir)
        .ok_or_else(|| "本地未找到已下载的修改器程序，请先点击下载".to_string())?;

    #[cfg(windows)]
    {
        // 0x00000200 = CREATE_NEW_PROCESS_GROUP
        let mut cmd = Command::new(&exe);
        cmd.current_dir(&dir);
        cmd.creation_flags(0x00000200);

        cmd.spawn()
            .map_err(|e| format!("启动修改器失败: {}", e))?;

        Ok(true)
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&exe);
        cmd.current_dir(&dir);
        cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;
        Ok(true)
    }
}

/// 打开修改器存放目录
pub fn open_trainer_dir(app_id: u32) -> Result<bool, String> {
    let dir = get_trainer_dir(app_id)?;
    #[cfg(windows)]
    {
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

/// 删除已下载的修改器
pub fn delete_trainer(app_id: u32) -> Result<bool, String> {
    let dir = get_trainer_dir(app_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("删除修改器目录失败: {}", e))?;
    }
    Ok(true)
}
