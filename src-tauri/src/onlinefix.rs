use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::manifests::SERVER_API;

const ONLINEFIX_HOST: &str = "https://online-fix.me";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ARCHIVE_PASSWORD: &str = "online-fix.me";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineFixSearchResult {
    pub found: bool,
    pub message: Option<String>,
    pub game_article_url: Option<String>,
    pub file_name: Option<String>,
    pub download_url: Option<String>,
    /// 全部可用下载源（按优先级排序），prepare 阶段逐个尝试直至成功
    #[serde(default)]
    pub download_candidates: Vec<OnlineFixDownloadCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineFixDownloadCandidate {
    pub url: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineFixPatchResult {
    pub success: bool,
    pub message: String,
    pub file_name: Option<String>,
    pub extracted_count: Option<usize>,
    pub article_url: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEntry {
    pub name: String,
    pub data_b64: String,
}

fn appdata_dir() -> Option<PathBuf> {
    let base = std::env::var("APPDATA").ok()?;
    let dir = PathBuf::from(base).join("com.chunfengdu.app");
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

fn account_path() -> Option<PathBuf> {
    appdata_dir().map(|d| d.join("onlinefix_account.json"))
}

/// 账号文件加密标记前缀：DPAPI:<base64(CryptProtectData(blob))>
const ACCOUNT_ENC_PREFIX: &str = "DPAPI:";

/// Windows DPAPI 加密（当前用户作用域，仅本机本用户可解），
/// 避免联机账号密码明文落盘。flags=0：不跨机器、不提示 UI
#[cfg(windows)]
fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        if CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        ) == 0
        {
            return Err("CryptProtectData 调用失败".to_string());
        }
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        // 密钥 blob 由系统分配，用完必须释放，否则泄漏
        LocalFree(output.pbData as _);
        Ok(out)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: blob.len() as u32,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        if CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        ) == 0
        {
            return Err("CryptUnprotectData 调用失败".to_string());
        }
        let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Ok(out)
    }
}

/// 写入账号文件：一律以 DPAPI 加密落盘（base64 of blob）；
/// 非 Windows 构建无 DPAPI，回退明文（本应用仅发布 Windows 包）
fn write_account_encrypted(payload: &serde_json::Value, path: &Path) {
    let text = payload.to_string();
    #[cfg(windows)]
    {
        match dpapi_protect(text.as_bytes()) {
            Ok(blob) => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&blob);
                let _ = fs::write(path, format!("{}{}", ACCOUNT_ENC_PREFIX, encoded));
                return;
            }
            Err(e) => {
                // 加密失败时保守处理：不落盘明文，直接放弃写入并记录
                eprintln!("[OnlineFix] 账号 DPAPI 加密失败，已放弃写入: {}", e);
                return;
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = fs::write(path, text);
    }
}

/// 读取账号文件内容为 JSON 文本：支持 DPAPI 加密格式与旧版明文格式。
/// 旧明文解析成功后立即迁移为加密格式重写（一次性升级）
fn load_account_json_text(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    if let Some(encoded) = content.strip_prefix(ACCOUNT_ENC_PREFIX) {
        #[cfg(windows)]
        {
            let blob = base64::engine::general_purpose::STANDARD
                .decode(encoded.trim())
                .ok()?;
            let plain = dpapi_unprotect(&blob).ok()?;
            return String::from_utf8(plain).ok();
        }
        #[cfg(not(windows))]
        {
            let _ = encoded;
            return None;
        }
    }
    // 旧版明文 JSON：先原样返回供调用方解析；解析成功（下面的 load_account）
    // 后会触发 migrate_account_file 重写为加密格式
    Some(content)
}

/// 把旧版明文账号文件迁移为 DPAPI 加密格式
fn migrate_account_file(path: &Path, plain_json: &str) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(plain_json) {
        write_account_encrypted(&v, path);
    }
}

fn load_account() -> Option<(String, String)> {
    let p = account_path()?;
    let json_text = load_account_json_text(&p)?;
    let v: serde_json::Value = serde_json::from_str(&json_text).ok()?;
    let user = v.get("username")?.as_str()?.trim().to_string();
    let pass = v.get("password")?.as_str()?.to_string();
    if user.is_empty() || pass.is_empty() {
        return None;
    }
    // 旧版明文 JSON 读取成功：立即迁移重写为 DPAPI 加密格式（一次性升级）
    let raw = fs::read_to_string(&p).unwrap_or_default();
    if !raw.starts_with(ACCOUNT_ENC_PREFIX) {
        migrate_account_file(&p, &json_text);
    }
    Some((user, pass))
}

pub fn set_account(username: &str, password: &str) {
    if let Some(p) = account_path() {
        let payload = serde_json::json!({ "username": username.trim(), "password": password });
        write_account_encrypted(&payload, &p);
    }
    // 重建会话客户端
    if let Ok(mut guard) = SESSION.lock() {
        *guard = None;
    }
}

/// 带 cookie 存储的会话客户端（未配置账号时为访客模式）
fn session_client() -> reqwest::Client {
    {
        let guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            return c.clone();
        }
    }
    // 登录是两次网络请求（最长可达 ~24s），绝不能在持锁状态下执行，
    // 否则期间所有并发调用 session_client 的线程都会卡在锁上
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(UA)
        .cookie_store(true);
    let mut built = builder.build().unwrap_or_else(|_| reqwest::Client::new());
    if let Some((user, pass)) = load_account() {
        // 登录：先取 authtoken，再提交登录表单（cookie 由 client 自动管理）
        match login(&mut built, &user, &pass) {
            Ok(()) => {
                if let Ok(mut guard) = LOGIN_ERROR.lock() {
                    *guard = None;
                }
            }
            Err(e) => {
                // 登录失败静默降级为访客会话，但记录原因供失败提示透传，
                // 否则用户看到的下载报错与真实原因（未登录）完全对不上
                if let Ok(mut guard) = LOGIN_ERROR.lock() {
                    *guard = Some(e.clone());
                }
                println!("[OnlineFix] 账号登录失败（将降级为访客会话）: {}", e);
            }
        }
    }
    if let Ok(mut guard) = SESSION.lock() {
        *guard = Some(built.clone());
    }
    built
}

static SESSION: Mutex<Option<reqwest::Client>> = Mutex::new(None);
/// 最近一次账号登录失败原因（None=登录成功或访客模式）
static LOGIN_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// 若存在未解决的登录失败，生成一段附加到错误消息上的提示
fn login_error_hint() -> String {
    match LOGIN_ERROR.lock().unwrap_or_else(|e| e.into_inner()).as_deref() {
        Some(e) => format!("（注意：联机账号登录失败：{}，部分资源需登录后才能获取）", e),
        None => String::new(),
    }
}

fn login(client: &mut reqwest::Client, user: &str, pass: &str) -> Result<(), String> {
    let token_resp = crate::manifests::block_on(
        client
            .get(format!("{}/engine/ajax/authtoken.php", ONLINEFIX_HOST))
            .header("Referer", format!("{}/", ONLINEFIX_HOST))
            .header("X-Requested-With", "XMLHttpRequest")
            .send(),
    )
    .map_err(|e| e.to_string())?;
    let token: serde_json::Value = crate::manifests::block_on(token_resp.json()).map_err(|e| e.to_string())?;

    let mut form = Vec::new();
    form.push(("login_name", user.to_string()));
    form.push(("login_password", pass.to_string()));
    form.push(("login", "submit".to_string()));
    form.push(("login_not_save", "0".to_string()));
    if let (Some(field), Some(value)) = (
        token.get("field").and_then(|f| f.as_str()),
        token.get("value").and_then(|v| v.as_str()),
    ) {
        form.push((field, value.to_string()));
    }

    let resp = crate::manifests::block_on(
        client
            .post(ONLINEFIX_HOST)
            .header("Referer", format!("{}/", ONLINEFIX_HOST))
            .form(&form)
            .send(),
    )
    .map_err(|e| format!("登录请求发送失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("登录返回 HTTP {}", resp.status()));
    }
    Ok(())
}

fn find_article_url(app_id: u32, game_name: Option<&str>) -> Option<String> {
    let mut queries: Vec<String> = vec![app_id.to_string()];
    if let Some(name) = game_name {
        let clean: String = name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' })
            .collect();
        let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
        if !clean.is_empty() && clean != app_id.to_string() && !queries.contains(&clean) {
            queries.push(clean);
        }
    }

    for q in queries {
        let url = format!("{}/index.php?do=search&subaction=search&story={}", ONLINEFIX_HOST, urlencoding_escape(&q));
        // 与文章页/分流页共用会话客户端（同 UA + cookie），降低被站点风控拦截的概率
        let Ok(html) = crate::manifests::block_on(
            session_client()
                .get(&url)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .send(),
        ) else {
            continue;
        };
        let Ok(html) = crate::manifests::block_on(html.text()) else { continue };
        if html.contains("ничего не найдено") {
            continue;
        }

        // 提取全部候选文章链接（排除 # 与分页）
        let marker = "https://online-fix.me/games/";
        let mut candidates: Vec<String> = Vec::new();
        let mut rest: &str = &html;
        while let Some(pos) = rest.find(marker) {
            let start = &rest[pos + marker.len()..];
            let end = start.find('"').map(|i| &start[..i]).unwrap_or("");
            let full = format!("{}{}", marker, end);
            if !end.is_empty() && !full.contains('#') && !full.contains("/page,") && !candidates.contains(&full) {
                candidates.push(full);
            }
            rest = start;
        }
        if candidates.is_empty() {
            continue;
        }
        // 有游戏名时按名称 token 重合度挑选，避免搜索页置顶推荐导致装错补丁
        return Some(pick_best_article(candidates, game_name));
    }
    None
}

/// 在候选文章链接中按游戏名 token 重合度评分取最优；无人得分时保持第一个
fn pick_best_article(candidates: Vec<String>, game_name: Option<&str>) -> String {
    let Some(name) = game_name else {
        return candidates.into_iter().next().unwrap_or_default();
    };
    let tokens: Vec<String> = name
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| t.to_string())
        .collect();
    if tokens.is_empty() {
        return candidates.into_iter().next().unwrap_or_default();
    }
    let mut best_idx = 0usize;
    let mut best_score = 0usize;
    for (i, c) in candidates.iter().enumerate() {
        let lower = c.to_lowercase();
        let score = tokens.iter().filter(|t| lower.contains(t.as_str())).count();
        if score > best_score {
            best_score = score;
            best_idx = i;
        }
    }
    candidates.into_iter().nth(best_idx).unwrap_or_default()
}

fn urlencoding_escape(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn search_onlinefix_patch(app_id: u32, game_name: Option<&str>) -> OnlineFixSearchResult {
    let Some(article) = find_article_url(app_id, game_name) else {
        return OnlineFixSearchResult {
            found: false,
            message: Some(format!(
                "未在 online-fix.me 搜索到该游戏 (AppID: {}) 的联机补丁{}",
                app_id,
                login_error_hint()
            )),
            game_article_url: None,
            file_name: None,
            download_url: None,
            download_candidates: Vec::new(),
        };
    };

    let client = session_client();
    let article_res = crate::manifests::block_on(
        client
            .get(&article)
            .header("Referer", format!("{}/", ONLINEFIX_HOST))
            .send(),
    );
    let article_html = match article_res.and_then(|r| r.error_for_status()).map(|r| crate::manifests::block_on(r.text())) {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => {
            return OnlineFixSearchResult {
                found: false,
                message: Some(format!("解析补丁源异常: {}", e)),
                game_article_url: Some(article),
                file_name: None,
                download_url: None,
            download_candidates: Vec::new(),
            };
        }
        Err(e) => {
            return OnlineFixSearchResult {
                found: false,
                message: Some(format!("解析补丁源异常: {}", e)),
                game_article_url: Some(article),
                file_name: None,
                download_url: None,
            download_candidates: Vec::new(),
            };
        }
    };

    let Some(hoster_url) = find_between(&article_html, "href=\"https://hosters.online-fix.me:2053/", "\"")
        .map(|rest| format!("https://hosters.online-fix.me:2053/{}", rest))
    else {
        return OnlineFixSearchResult {
            found: true,
            message: Some("已找到游戏页面，但该页面暂无可用的联机补丁分流源".to_string()),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
            download_candidates: Vec::new(),
        };
    };

    let Ok(hoster_html) = crate::manifests::block_on(async {
        let resp = client
            .get(&hoster_url)
            .header("Referer", &article)
            .send()
            .await?;
        resp.text().await
    })
    else {
        return OnlineFixSearchResult {
            found: true,
            message: Some(format!("分流页面加载失败{}", login_error_hint())),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
            download_candidates: Vec::new(),
        };
    };

    // 提取全部 data-links='...' JSON 条目
    let mut candidates: Vec<(String, String)> = Vec::new(); // (direct_link, file_name)
    let mut rest: &str = &hoster_html;
    while let Some(pos) = rest.find("data-links='") {
        let after = &rest[pos + "data-links='".len()..];
        let Some(end) = after.find('\'') else { break };
        let raw = &after[..end];
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) {
            if let Some(arr) = parsed.as_array() {
                for item in arr {
                    let link = item.get("direct_link").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = item.get("file_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !link.is_empty() {
                        candidates.push((link, name));
                    }
                }
            }
        }
        rest = &after[end + 1..];
    }

    let fixes: Vec<_> = candidates
        .iter()
        .filter(|(_, n)| {
            let l = n.to_lowercase();
            l.contains("fix") || l.contains("repair") || l.contains("patch")
        })
        .cloned()
        .collect();

    // 下载源优先级：Fix_Repair 小补丁包 > 其他候选；
    // 同优先级内按网盘可达性排序：PixelDrain（速度快但部分地区被墙）→
    // fileditch/filekeeper（可直下/可解析）→ 其余 → gofile/vikingfile
    // （匿名已无法下载，仅作占位）。任一源失败由 prepare 阶段自动换下一个
    let host_rank = |l: &str| -> u8 {
        if l.contains("pixeldrain.com/u/") {
            0
        } else if l.contains("fileditchfiles.st") || l.contains("filekeeper.net") {
            1
        } else if l.contains("gofile.io") || l.contains("vikingfile.com") {
            3
        } else {
            2
        }
    };
    let rank = |(l, n): &(String, String)| -> (u8, u8) {
        let ln = n.to_lowercase();
        let is_fix = ln.contains("fix") || ln.contains("repair") || ln.contains("patch");
        (if is_fix { 0 } else { 1 }, host_rank(l))
    };

    // 补丁包本体是几 MB 的 Fix_Repair 归档；同一文章里的 partN.rar 是整包游戏
    // 分卷（动辄数 GB），严禁当作补丁下载。仅当文章里确实没有任何 Fix 命名
    // 包时才回退到非分卷候选。
    let mut target_list: Vec<(String, String)> = if !fixes.is_empty() {
        fixes
    } else {
        let non_part: Vec<_> = candidates
            .iter()
            .filter(|(_l, n)| {
                let ln = n.to_lowercase();
                !(ln.contains(".part") && ln.ends_with(".rar"))
            })
            .cloned()
            .collect();
        if non_part.is_empty() {
            // 文章里只有整包游戏分卷，没有独立补丁包——明确拒绝而不是误下游戏本体
            return OnlineFixSearchResult {
                found: true,
                message: Some("该文章仅包含整包游戏分卷，未提供独立的 Fix_Repair 联机补丁包".to_string()),
                game_article_url: Some(article),
                file_name: None,
                download_url: None,
                download_candidates: Vec::new(),
            };
        }
        non_part
    };
    target_list.sort_by_key(rank);

    if target_list.is_empty() {
        return OnlineFixSearchResult {
            found: true,
            message: Some("未在分流页面中检索到可用的 Fix_Repair 补丁包".to_string()),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
            download_candidates: Vec::new(),
        };
    }

    let download_candidates: Vec<OnlineFixDownloadCandidate> = target_list
        .iter()
        .map(|(link, file_name)| {
            let download_url = if let Some(id) = extract_pixeldrain_id(link) {
                format!("https://pixeldrain.com/api/file/{}", id)
            } else {
                link.clone()
            };
            OnlineFixDownloadCandidate {
                url: download_url,
                file_name: file_name.clone(),
            }
        })
        .collect();

    let (_, chosen_name) = &target_list[0];
    let chosen_download_url = download_candidates[0].url.clone();

    OnlineFixSearchResult {
        found: true,
        message: None,
        game_article_url: Some(article),
        file_name: Some(chosen_name.clone()),
        download_url: Some(chosen_download_url),
        download_candidates,
    }
}

fn extract_pixeldrain_id(link: &str) -> Option<String> {
    let pos = link.find("pixeldrain.com/u/")?;
    let after = &link[pos + "pixeldrain.com/u/".len()..];
    let id: String = after
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if id.is_empty() { None } else { Some(id) }
}

fn find_between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let pos = s.find(start)? + start.len();
    let rest = &s[pos..];
    let end_pos = rest.find(end)?;
    Some(&rest[..end_pos])
}

fn temp_download_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("steammaster_onlinefix_downloads");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 去掉 Windows canonicalize 产生的 `\\?\` verbatim 前缀。
/// Path::starts_with 按组件比较，Verbatim 前缀与 Disk 前缀不相等，
/// 不归一化会导致「目标存在时所有解压条目被误判越界」。
fn canonicalize_normalized(p: &Path) -> PathBuf {
    match p.canonicalize() {
        Ok(c) => {
            let s = c.as_os_str().to_string_lossy();
            if let Some(unc) = s.strip_prefix(r"\\?\UNC\") {
                PathBuf::from(format!(r"\\{}", unc))
            } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
                PathBuf::from(stripped.to_string())
            } else {
                c
            }
        }
        Err(_) => p.to_path_buf(),
    }
}

/// 大小写不敏感的组件级路径前缀比较（含相等）。
/// Path::starts_with 对大小写敏感：目标文件尚未落盘时 canonicalize 失败
/// 回退原始路径，与归一化后的真实大小写路径比较一旦盘符/目录大小写
/// 不一致就会全部误判越界（表现为「补丁解压成功但 0 个文件写入」）。
fn starts_with_ci(p: &Path, base: &Path) -> bool {
    let pc: Vec<String> = p
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect();
    let bc: Vec<String> = base
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect();
    pc.len() >= bc.len() && pc[..bc.len()] == bc[..]
}

/// 校验下载内容确为 RAR/ZIP 归档（防风控页/错误页 HTML 被当作补丁落盘）
fn is_archive_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(b"Rar!") || bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

pub fn is_temp_archive(path: &str) -> bool {
    let p = PathBuf::from(path);
    // Path::starts_with 逐组件比较、不归一化 `..`，必须先拒绝任何父目录组件，
    // 否则 "<临时目录>\..\..\<任意文件>" 会绕过该围栏，导致任意文件读取/删除
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    p.starts_with(temp_download_dir())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedArchive {
    pub archive_path: String,
    pub file_name: String,
    pub article_url: Option<String>,
    pub download_url: String,
}

/// 下载单个候选源到临时目录并做归档魔数校验；失败返回原因（由调用方换下一个源）
fn try_download_candidate(download_url: &str, app_id: u32) -> Result<PathBuf, String> {
    let ext = Path::new(download_url)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        // pixeldrain api 直链无扩展名，补丁包绝大多数是 RAR
        .unwrap_or_else(|| ".rar".to_string());
    let temp_path = temp_download_dir().join(format!("patch_{}_{}{}", app_id, chrono_millis(), ext));

    // 独立下载客户端：10 分钟上限 + 15 秒连接超时（换源时快速失败）。
    // cookie_store 必须开启：部分分流源（如 fileditch）有 Cookie 门禁，
    // 首次 302 下发 cookie 后必须带着 cookie 重试才放行真实文件
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(UA)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("构建下载客户端失败: {}", e))?;

    // filekeeper 是 op=download2 型网盘：直链访问只会得到倒计时页面，
    // 必须先 GET 页面（下发 file_code cookie）解析表单参数，再 POST 回去
    // 才会 302 到真实文件直链（reqwest 自动跟随）
    let request = if download_url.contains("filekeeper.net/") {
        let page_resp = crate::manifests::block_on(client.get(download_url).send())
            .map_err(|e| format!("连接失败 {}", e))?;
        if !page_resp.status().is_success() {
            return Err(format!("HTTP {}", page_resp.status()));
        }
        let page = crate::manifests::block_on(page_resp.text())
            .map_err(|e| format!("读取分流页面失败: {}", e))?;
        let attr = |name: &str| find_between(&page, &format!("data-{}=\"", name), "\"").unwrap_or("").to_string();
        let code = if attr("code").is_empty() {
            download_url.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string()
        } else {
            attr("code")
        };
        client
            .post(download_url)
            .header("Referer", download_url)
            .form(&[
                ("op", "download2".to_string()),
                ("id", code),
                ("rand", attr("rand")),
                ("referer", attr("referer")),
                ("method_free", attr("method")),
                ("down_direct", "1".to_string()),
            ])
    } else {
        client.get(download_url)
    };
    let mut resp = crate::manifests::block_on(request.send())
        .map_err(|e| format!("连接失败 {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // 流式写入临时文件，避免 100MB+ 补丁整包驻留内存
    let mut file = fs::File::create(&temp_path).map_err(|e| format!("创建临时文件失败: {}", e))?;
    let mut total: u64 = 0;
    loop {
        match crate::manifests::block_on(resp.chunk()) {
            Ok(Some(chunk)) => {
                file.write_all(&chunk).map_err(|e| format!("写入临时文件失败: {}", e))?;
                total += chunk.len() as u64;
            }
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&temp_path);
                return Err(format!("读取补丁数据流失败: {}", e));
            }
        }
    }
    if total == 0 {
        let _ = fs::remove_file(&temp_path);
        return Err("下载数据为空".to_string());
    }

    // 魔数校验：下载内容必须确实是 RAR/ZIP 归档，防止风控页/错误页 HTML 被当作补丁
    let mut magic = [0u8; 4];
    {
        let mut probe = fs::File::open(&temp_path).map_err(|e| format!("读取临时文件失败: {}", e))?;
        probe.read_exact(&mut magic).map_err(|_| "下载数据过短，不是有效的补丁归档".to_string())?;
    }
    if !is_archive_magic(&magic) {
        let _ = fs::remove_file(&temp_path);
        return Err("内容不是有效的补丁归档".to_string());
    }
    Ok(temp_path)
}

/// 搜索并下载补丁包到临时目录，返回归档路径（由前端读取后解压，或直接 zip_extract）
pub fn prepare_patch(
    game_path: &str,
    app_id: u32,
    game_name: Option<&str>,
) -> Result<PreparedArchive, OnlineFixPatchResult> {
    let fail = |msg: String| OnlineFixPatchResult {
        success: false,
        message: msg,
        file_name: None,
        extracted_count: None,
        article_url: None,
        download_url: None,
    };

    if game_path.is_empty() || !Path::new(game_path).exists() {
        return Err(fail(format!("目标游戏目录不存在: {}", game_path)));
    }

    let search = search_onlinefix_patch(app_id, game_name);
    if !search.found || search.download_url.is_none() || search.file_name.is_none() {
        return Err(fail(search.message.unwrap_or_else(|| {
            format!("未在 online-fix.me 搜索到《{}》的联机补丁", game_name.unwrap_or("未知游戏"))
        })));
    }

    // 备份原版 DLL（延迟到下载校验成功之后：检索/下载失败时不在游戏目录留下"假备份"）
    let backup_dlls = |gp: &Path| {
        for (main, bak) in [("steam_api64.dll", "steam_api64_o.dll"), ("steam_api.dll", "steam_api_o.dll")] {
            let src = gp.join(main);
            let dst = gp.join(bak);
            if src.exists() && !dst.exists() {
                let _ = fs::copy(&src, &dst);
            }
        }
    };

    // 逐个尝试候选下载源：单一源随时可能被墙/限流/失效
    // （如 PixelDrain 在部分地区 TLS 直接被重置），必须自动回退到下一个
    let candidates = if !search.download_candidates.is_empty() {
        search.download_candidates.clone()
    } else {
        // 兼容：旧检索结果只有单源
        vec![OnlineFixDownloadCandidate {
            url: search.download_url.clone().unwrap(),
            file_name: search.file_name.clone().unwrap(),
        }]
    };
    let mut attempts: Vec<String> = Vec::new();
    let mut downloaded: Option<(PathBuf, String, String)> = None; // (临时路径, 文件名, 下载URL)

    for cand in &candidates {
        match try_download_candidate(&cand.url, app_id) {
            Ok(temp_path) => {
                downloaded = Some((temp_path, cand.file_name.clone(), cand.url.clone()));
                break;
            }
            Err(e) => attempts.push(format!("{}: {}", cand.file_name, e)),
        }
    }

    let Some((temp_path, file_name, download_url)) = downloaded else {
        return Err(fail(format!(
            "所有下载源均失败 → {}",
            attempts.join(" | ")
        )));
    };

    backup_dlls(&PathBuf::from(game_path));

    Ok(PreparedArchive {
        archive_path: temp_path.to_string_lossy().to_string(),
        file_name,
        article_url: search.game_article_url,
        download_url,
    })
}

fn chrono_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 部署解压出的补丁文件到游戏目录（含越界防护与临时归档清理）
pub fn deploy_patch_entries(
    game_path: &str,
    entries: &[PatchEntry],
    archive_path: Option<&str>,
) -> OnlineFixPatchResult {
    use base64::engine::general_purpose::STANDARD as B64;

    let gp = PathBuf::from(game_path);
    let resolved_game = canonicalize_normalized(&gp);

    let mut count = 0usize;
    let mut rejected = 0usize;
    for entry in entries {
        // 先拒绝含盘符/根目录/.. 等非法组件的条目，再做路径归一化比较
        if !Path::new(&entry.name)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_) | std::path::Component::CurDir))
        {
            println!("[OnlineFix] 已拒绝解压越界条目: {}", entry.name);
            rejected += 1;
            continue;
        }
        let dest = gp.join(&entry.name);
        let dest_resolved = canonicalize_normalized(&dest);
        if !starts_with_ci(&dest_resolved, &resolved_game) {
            println!("[OnlineFix] 已拒绝解压越界条目: {}", entry.name);
            rejected += 1;
            continue;
        }

        let data = match B64.decode(&entry.data_b64) {
            Ok(d) => d,
            Err(_) => {
                rejected += 1;
                continue;
            }
        };
        if let Some(parent) = dest_resolved.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(&dest_resolved, &data).is_ok() {
            count += 1;
        } else {
            rejected += 1;
        }
    }

    if let Some(archive) = archive_path {
        if is_temp_archive(archive) {
            let _ = fs::remove_file(archive);
        }
    }

    // 0 部署或整体失败时必须给出失败原因，而不是照搬成功文案
    // （"成功…共解压部署 0 个文件"会误导用户以为补丁已生效）
    let (success, message) = if count > 0 {
        (true, format!("成功从 online-fix.me 下载并安装联机补丁，共解压部署 {} 个文件！", count))
    } else {
        (false, format!(
            "联机补丁部署失败：0 个文件写入成功（共 {} 个条目，其中 {} 个被拒绝或写入失败）。请检查游戏目录是否被游戏进程/杀毒软件占用后重试。",
            entries.len(),
            rejected
        ))
    };

    OnlineFixPatchResult {
        success,
        message,
        file_name: None,
        extracted_count: Some(count),
        article_url: None,
        download_url: None,
    }
}

/// 解压 zip 归档到目标目录（ZipCrypto/AES 密码自动尝试，越界防护）
pub fn extract_zip_archive(archive_path: &str, dest_dir: &str) -> Result<usize, String> {
    let file = fs::File::open(archive_path).map_err(|e| format!("打开归档失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析归档失败: {}", e))?;

    let dest = PathBuf::from(dest_dir);
    // 必须归一化 verbatim 前缀：canonicalize 返回 \\?\C:\...，与普通 C:\... 按组件
    // 比较恒不相等，会导致目标目录存在时所有条目被误判越界（ZIP 补丁 0 解压）
    let dest_resolved = canonicalize_normalized(&dest);
    let mut count = 0usize;
    let mut skipped = 0usize;
    // zip 炸弹防护：单条目 ≤512MB、累计解压 ≤2GB，超限立即中止。
    // entry.size() 为声明解压后大小，读取前即可判断，避免先把膨胀内容读进内存
    const MAX_ENTRY_SIZE: u64 = 512 * 1024 * 1024;
    const MAX_TOTAL_SIZE: u64 = 2 * 1024 * 1024 * 1024;
    let mut total_out: u64 = 0;

    for i in 0..archive.len() {
        // 解密失败（密码不匹配）或损坏的条目直接跳过，绝不回退明文读取——
        // 对加密条目回退 by_index 必然报 PASSWORD_REQUIRED 并中止整个解压
        let mut entry = match archive.by_index_decrypt(i, ARCHIVE_PASSWORD.as_bytes()) {
            Ok(f) => f,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };

        let Some(safe_name) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue; // 越界条目直接拒绝
        };
        let out_path = dest.join(&safe_name);
        if !starts_with_ci(&out_path, &dest_resolved) {
            continue;
        }

        if entry.is_dir() {
            let _ = fs::create_dir_all(&out_path);
        } else {
            let entry_size = entry.size();
            if entry_size > MAX_ENTRY_SIZE || total_out + entry_size > MAX_TOTAL_SIZE {
                return Err(format!(
                    "归档解压量超出安全限制（单文件上限 512MB / 总量上限 2GB），已中止：条目 {} 解压后 {} 字节",
                    safe_name.display(),
                    entry_size
                ));
            }
            if let Some(parent) = out_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut buf = Vec::new();
            if entry.read_to_end(&mut buf).is_ok() {
                if fs::write(&out_path, &buf).is_ok() {
                    count += 1;
                    total_out += entry_size;
                }
            }
        }
    }

    if is_temp_archive(archive_path) {
        let _ = fs::remove_file(archive_path);
    }
    if skipped > 0 {
        println!("[OnlineFix] 有 {} 个条目因密码不匹配被跳过", skipped);
    }
    Ok(count)
}

pub fn server_api() -> &'static str {
    SERVER_API
}
