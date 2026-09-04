use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::manifests::{http_client, SERVER_API};

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

fn load_account() -> Option<(String, String)> {
    let p = account_path()?;
    let content = fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let user = v.get("username")?.as_str()?.trim().to_string();
    let pass = v.get("password")?.as_str()?.to_string();
    if user.is_empty() || pass.is_empty() {
        return None;
    }
    Some((user, pass))
}

pub fn set_account(username: &str, password: &str) {
    if let Some(p) = account_path() {
        let payload = serde_json::json!({ "username": username.trim(), "password": password });
        let _ = fs::write(p, payload.to_string());
    }
    // 重建会话客户端
    if let Ok(mut guard) = SESSION.lock() {
        *guard = None;
    }
}

/// 带 cookie 存储的会话客户端（未配置账号时为访客模式）
fn session_client() -> reqwest::Client {
    let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = guard.as_ref() {
        return c.clone();
    }
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(UA)
        .cookie_store(true);
    if let Some((user, pass)) = load_account() {
        // 登录：先取 authtoken，再提交登录表单（cookie 由 client 自动管理）
        let c = builder.build().unwrap_or_else(|_| reqwest::Client::new());
        let _ = login(&c, &user, &pass);
        *guard = Some(c.clone());
        return c;
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

static SESSION: Mutex<Option<reqwest::Client>> = Mutex::new(None);

fn login(client: &reqwest::Client, user: &str, pass: &str) -> Result<(), String> {
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

    let _ = crate::manifests::block_on(
        client
            .post(ONLINEFIX_HOST)
            .header("Referer", format!("{}/", ONLINEFIX_HOST))
            .form(&form)
            .send(),
    );
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
        let Ok(html) = crate::manifests::block_on(
            http_client()
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

        // 提取第一个 https://online-fix.me/games/xxx 链接（排除 # 与分页）
        let marker = "https://online-fix.me/games/";
        let mut rest: &str = &html;
        while let Some(pos) = rest.find(marker) {
            let start = &rest[pos + marker.len()..];
            let end = start.find('"').map(|i| &start[..i]).unwrap_or("");
            let full = format!("{}{}", marker, end);
            if !end.is_empty() && !full.contains('#') && !full.contains("/page,") {
                return Some(full);
            }
            rest = start;
        }
    }
    None
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
            message: Some(format!("未在 online-fix.me 搜索到该游戏 (AppID: {}) 的联机补丁", app_id)),
            game_article_url: None,
            file_name: None,
            download_url: None,
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
            };
        }
        Err(e) => {
            return OnlineFixSearchResult {
                found: false,
                message: Some(format!("解析补丁源异常: {}", e)),
                game_article_url: Some(article),
                file_name: None,
                download_url: None,
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
            message: Some("分流页面加载失败".to_string()),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
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
    let target_list = if fixes.is_empty() { &candidates } else { &fixes };

    if target_list.is_empty() {
        return OnlineFixSearchResult {
            found: true,
            message: Some("未在分流页面中检索到可用的 Fix_Repair 补丁包".to_string()),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
        };
    }

    // 优先 PixelDrain
    let mut chosen = target_list.iter().find(|(l, _)| l.contains("pixeldrain.com/u/"));
    if chosen.is_none() {
        chosen = target_list.first();
    }
    let Some((link, file_name)) = chosen else {
        return OnlineFixSearchResult {
            found: true,
            message: Some("未找到可用下载链接".to_string()),
            game_article_url: Some(article),
            file_name: None,
            download_url: None,
        };
    };

    let download_url = if let Some(id) = extract_pixeldrain_id(link) {
        format!("https://pixeldrain.com/api/file/{}", id)
    } else {
        link.clone()
    };

    OnlineFixSearchResult {
        found: true,
        message: None,
        game_article_url: Some(article),
        file_name: Some(file_name.clone()),
        download_url: Some(download_url),
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

pub fn is_temp_archive(path: &str) -> bool {
    let p = PathBuf::from(path);
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

    // 备份原版 DLL
    let gp = PathBuf::from(game_path);
    for (main, bak) in [("steam_api64.dll", "steam_api64_o.dll"), ("steam_api.dll", "steam_api_o.dll")] {
        let src = gp.join(main);
        let dst = gp.join(bak);
        if src.exists() && !dst.exists() {
            let _ = fs::copy(&src, &dst);
        }
    }

    let download_url = search.download_url.clone().unwrap();
    let file_name = search.file_name.clone().unwrap();
    let ext = Path::new(&file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_else(|| ".rar".to_string());

    let temp_path = temp_download_dir().join(format!("patch_{}_{}{}", app_id, chrono_millis(), ext));

    // 下载（无 12 秒限制，独立客户端，10 分钟上限）
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent(UA)
        .build()
        .map_err(|e| fail(format!("构建下载客户端失败: {}", e)))?;
    let resp = crate::manifests::block_on(client.get(&download_url).send())
        .map_err(|e| fail(format!("下载补丁失败: {}", e)))?;

    if !resp.status().is_success() {
        return Err(fail(format!("从 online-fix.me 下载补丁失败，HTTP 状态码: {}", resp.status())));
    }

    let bytes = crate::manifests::block_on(resp.bytes())
        .map_err(|e| fail(format!("读取补丁数据流失败: {}", e)))?;
    if bytes.is_empty() {
        return Err(fail("下载数据为空".to_string()));
    }

    let mut file = fs::File::create(&temp_path).map_err(|e| fail(format!("创建临时文件失败: {}", e)))?;
    file.write_all(&bytes).map_err(|e| fail(format!("写入临时文件失败: {}", e)))?;

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
    let resolved_game = match gp.canonicalize() {
        Ok(p) => p,
        Err(_) => gp.clone(),
    };

    let mut count = 0usize;
    for entry in entries {
        let dest = gp.join(&entry.name);
        let dest_resolved = match dest.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                // 尚不存在，逐段归一化后校验
                let mut acc = resolved_game.clone();
                let mut ok = true;
                for part in Path::new(&entry.name).components() {
                    match part {
                        std::path::Component::Normal(c) => acc.push(c),
                        std::path::Component::CurDir => {}
                        _ => {
                            ok = false;
                            break;
                        }
                    }
                }
                if !ok {
                    println!("[OnlineFix] 已拒绝解压越界条目: {}", entry.name);
                    continue;
                }
                acc
            }
        };
        if dest_resolved != resolved_game && !dest_resolved.starts_with(&resolved_game) {
            println!("[OnlineFix] 已拒绝解压越界条目: {}", entry.name);
            continue;
        }

        let data = match B64.decode(&entry.data_b64) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if let Some(parent) = dest_resolved.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::write(&dest_resolved, &data).is_ok() {
            count += 1;
        }
    }

    if let Some(archive) = archive_path {
        if is_temp_archive(archive) {
            let _ = fs::remove_file(archive);
        }
    }

    OnlineFixPatchResult {
        success: count > 0,
        message: format!("成功从 online-fix.me 下载并安装联机补丁，共解压部署 {} 个文件！", count),
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
    let dest_resolved = dest.canonicalize().unwrap_or(dest.clone());
    let mut count = 0usize;

    for i in 0..archive.len() {
        // 先探测密码解密可行性，再按结果走对应读取路径（避免借用冲突）
        let can_decrypt = {
            let a = &mut archive;
            a.by_index_decrypt(i, ARCHIVE_PASSWORD.as_bytes()).is_ok()
        };
        let mut entry = if can_decrypt {
            let a = &mut archive;
            a.by_index_decrypt(i, ARCHIVE_PASSWORD.as_bytes())
                .map_err(|e| format!("归档条目解密失败: {}", e))?
        } else {
            archive.by_index(i).map_err(|e| format!("读取归档条目失败: {}", e))?
        };

        let Some(safe_name) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue; // 越界条目直接拒绝
        };
        let out_path = dest.join(&safe_name);
        if !out_path.starts_with(&dest_resolved) {
            continue;
        }

        if entry.is_dir() {
            let _ = fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut buf = Vec::new();
            if entry.read_to_end(&mut buf).is_ok() {
                if fs::write(&out_path, &buf).is_ok() {
                    count += 1;
                }
            }
        }
    }

    if is_temp_archive(archive_path) {
        let _ = fs::remove_file(archive_path);
    }
    Ok(count)
}

pub fn server_api() -> &'static str {
    SERVER_API
}
