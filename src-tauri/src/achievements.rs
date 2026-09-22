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

const EMBEDDED_SAM_ZIP: &[u8] = include_bytes!("../resources/sam/SAM.zip");

/// 从编译期嵌入的资源解压释放 SAM（100% 完整内嵌，免去用户手动下载安装）
pub fn extract_embedded_sam(target_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(target_dir).map_err(|e| format!("创建 SAM 目录失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(Cursor::new(EMBEDDED_SAM_ZIP))
        .map_err(|e| format!("解析内置 SAM 归档失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("读取 SAM 归档文件项失败: {}", e))?;
        let name = file.name().to_string();
        if name.contains("__MACOSX") {
            continue;
        }
        let rel = Path::new(&name);
        if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            continue;
        }
        let out_path = target_dir.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut outfile = fs::File::create(&out_path).map_err(|e| format!("创建文件失败: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("写入文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 查询本地 SAM 状态（支持内置与 APPDATA 两种来源）
pub fn get_sam_status_with_resource(resource_dir: Option<&Path>) -> Result<SamStatus, String> {
    // 首次检测到未部署时，直接自动解压释放内嵌的 SAM，实现 100% 免安装开箱即用
    if let Ok(dir) = get_sam_dir() {
        let sam_exe = dir.join("SAM.Game.exe");
        if !sam_exe.exists() {
            let _ = extract_embedded_sam(&dir);
        }
    }

    if let Some(exe) = find_sam_game_exe(resource_dir) {
        Ok(SamStatus {
            is_installed: true,
            exe_path: Some(exe.to_string_lossy().to_string()),
            version: Some("7.0.41 (内置就绪)".to_string()),
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

/// 下载并部署 SAM（版本 7.0.41，优先释放内嵌资源，带国内镜像加速回退）
pub async fn download_sam(download_url: Option<String>) -> Result<SamStatus, String> {
    let dir = get_sam_dir()?;

    // 首先释放内嵌包（零延迟秒级就绪）
    if extract_embedded_sam(&dir).is_ok() {
        if let Some(exe) = find_sam_game_exe(None) {
            return Ok(SamStatus {
                is_installed: true,
                exe_path: Some(exe.to_string_lossy().to_string()),
                version: Some("7.0.41 (内置就绪)".to_string()),
            });
        }
    }

    let mut urls: Vec<String> = Vec::new();
    if let Some(ref u) = download_url {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            urls.push(trimmed.to_string());
        }
    }
    // 始终追加多条镜像与官方兜底，确保无论自定义地址是否 404，都能顺利下载
    urls.push("https://ghfast.top/https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string());
    urls.push("https://gh-proxy.com/https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string());
    urls.push("https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.41/SteamAchievementManager-7.0.41.zip".to_string());

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

// ==================== 原生成就数据抓取 (Rust 核心网络栈，0 浏览器受限) ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementItem {
    pub name: Option<String>,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub percent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievementsData {
    pub app_id: u32,
    pub count: usize,
    pub achievements: Vec<AchievementItem>,
}

fn strip_html_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(c);
        }
    }
    out.trim().to_string()
}

fn extract_html_tag_content(block: &str, tag: &str) -> String {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    if let Some(start_pos) = block.find(&open) {
        let rest = &block[start_pos..];
        if let Some(tag_end) = rest.find('>') {
            let inner = &rest[tag_end + 1..];
            if let Some(close_pos) = inner.find(&close) {
                return strip_html_tags(&inner[..close_pos]);
            }
        }
    }
    String::new()
}

fn extract_img_src_attr(block: &str) -> String {
    if let Some(pos) = block.find("src=\"") {
        let rest = &block[pos + 5..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    String::new()
}

fn extract_class_inner(block: &str, class_name: &str) -> String {
    let needle = format!("class=\"{}\"", class_name);
    if let Some(pos) = block.find(&needle) {
        let rest = &block[pos + needle.len()..];
        if let Some(tag_end) = rest.find('>') {
            let inner = &rest[tag_end + 1..];
            if let Some(close_pos) = inner.find('<') {
                return inner[..close_pos].trim().to_string();
            }
        }
    }
    String::new()
}

/// 由 Rust 底层原生拉取 Steam 官方成就（优先 Steam Community，兜底 Steam Web API）
pub async fn fetch_game_achievements(app_id: u32, lang: Option<String>) -> Result<GameAchievementsData, String> {
    let lang_str = lang.unwrap_or_else(|| "schinese".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败: {}", e))?;

    // 1. Steam Community 官方社区页面抓取（包含中文标题、描述、图标与达成率）
    let community_url = format!("https://steamcommunity.com/stats/{}/achievements/?l={}", app_id, lang_str);
    if let Ok(resp) = client.get(&community_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cookie", format!("Steam_Language={}", lang_str))
        .send().await
    {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                if html.contains("achieveRow") {
                    let mut items = Vec::new();
                    let parts: Vec<&str> = html.split("<div class=\"achieveRow").collect();
                    for part in parts.iter().skip(1) {
                        let end_idx = part.find("<div style=\"clear: both;\">").unwrap_or_else(|| part.len().min(1500));
                        let block = &part[..end_idx];

                        let title = extract_html_tag_content(block, "h3");
                        if title.is_empty() {
                            continue;
                        }
                        let desc = extract_html_tag_content(block, "h5");
                        let img = extract_img_src_attr(block);
                        let pct = extract_class_inner(block, "achievePercent");

                        items.push(AchievementItem {
                            name: None,
                            title,
                            description: desc,
                            icon: img,
                            percent: if pct.is_empty() { "0%".to_string() } else { pct },
                        });
                    }

                    if !items.is_empty() {
                        let count = items.len();
                        return Ok(GameAchievementsData {
                            app_id,
                            count,
                            achievements: items,
                        });
                    }
                }
            }
        }
    }

    // 2. Steam 官方 Web API 兜底
    let stats_url = format!("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid={}", app_id);
    if let Ok(resp) = client.get(&stats_url).send().await {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(list) = json.pointer("/achievementpercentages/achievements").and_then(|v| v.as_array()) {
                    let mut items = Vec::new();
                    for item in list {
                        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if name.is_empty() {
                            continue;
                        }
                        let pct_val = item.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let pct_str = format!("{:.1}%", pct_val);
                        items.push(AchievementItem {
                            name: Some(name.clone()),
                            title: name,
                            description: format!("全球达成率 {}", pct_str),
                            icon: String::new(),
                            percent: pct_str,
                        });
                    }
                    if !items.is_empty() {
                        let count = items.len();
                        return Ok(GameAchievementsData {
                            app_id,
                            count,
                            achievements: items,
                        });
                    }
                }
            }
        }
    }

    Ok(GameAchievementsData {
        app_id,
        count: 0,
        achievements: Vec::new(),
    })
}

