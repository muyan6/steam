use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;

pub const SERVER_API: &str = "http://150.158.129.222:1257";

/// 在同步命令线程池中阻塞执行 async reqwest 调用
pub fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    tauri::async_runtime::block_on(fut)
}

pub fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("ChunFengDu-Client")
            .build()
            .expect("构建 HTTP 客户端失败")
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppManifestStatus {
    pub app_id: u32,
    pub has_manifest: bool,
    pub manifest_count: usize,
    pub matched_depots: Vec<String>,
    pub manifest_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInstallResult {
    pub success: bool,
    pub app_id: u32,
    pub downloaded_count: usize,
    pub total_depots: usize,
    pub depot_keys: BTreeMap<String, String>,
    pub manifest_files: Vec<String>,
    pub source: String,
    pub message: String,
}

/// 检查 depotcache 中该 app（含 DLC）的清单就绪状态（仅精确匹配 depotId）
pub fn check_manifest_status(steam_path: &Path, app_id: u32, dlcs: &[u32]) -> AppManifestStatus {
    let depot_cache = steam_path.join("depotcache");
    if !depot_cache.exists() {
        return AppManifestStatus {
            app_id,
            has_manifest: false,
            manifest_count: 0,
            matched_depots: vec![],
            manifest_files: vec![],
        };
    }

    let mut prefixes: Vec<String> = vec![app_id.to_string()];
    for d in dlcs {
        prefixes.push(d.to_string());
    }

    let mut matched_files = Vec::new();
    let mut matched_depots = Vec::new();
    if let Ok(files) = fs::read_dir(&depot_cache) {
        for f in files.filter_map(|e| e.ok()) {
            let name = f.file_name().to_string_lossy().to_string();
            if !name.ends_with(".manifest") {
                continue;
            }
            if let Some(d_id) = name.strip_suffix(".manifest").and_then(|s| s.split('_').next()) {
                if prefixes.iter().any(|p| p == d_id) {
                    if !matched_depots.iter().any(|x| x == d_id) {
                        matched_depots.push(d_id.to_string());
                    }
                    matched_files.push(name);
                }
            }
        }
    }

    AppManifestStatus {
        app_id,
        has_manifest: !matched_files.is_empty(),
        manifest_count: matched_files.len(),
        matched_depots,
        manifest_files: matched_files,
    }
}

fn is_valid_key(key: &str) -> bool {
    key.len() >= 32 && key.chars().all(|c| c.is_ascii_hexdigit()) && !key.chars().all(|c| c == '0')
}

struct DepotMeta {
    depot_id: String,
    manifest_gid: Option<String>,
    depot_key: Option<String>,
}

fn parse_metadata(app_id: u32) -> Result<(Vec<DepotMeta>, BTreeMap<String, String>), String> {
    let url = format!("{}/api/metadata/{}?deviceId={}", SERVER_API, app_id, crate::device::get_machine_guid());
    let resp = block_on(http_client().get(&url).timeout(Duration::from_secs(10)).send())
        .map_err(|e| format!("请求元数据失败: {}", e))?;
    let json: serde_json::Value = block_on(resp.json()).map_err(|e| format!("解析元数据失败: {}", e))?;

    let data = json
        .get("data")
        .ok_or_else(|| "元数据响应缺少 data 字段".to_string())?;

    let mut depots = Vec::new();
    let mut depot_keys = BTreeMap::new();

    let mut collect = |obj: &serde_json::Value, depots: &mut Vec<DepotMeta>, keys: &mut BTreeMap<String, String>| {
        let id = match obj.get("depotId") {
            Some(serde_json::Value::Number(n)) => n.to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => return,
        };
        let gid = match obj.get("manifestGid") {
            Some(serde_json::Value::Number(n)) => Some(n.to_string()),
            Some(serde_json::Value::String(s)) if !s.is_empty() && s != "0" => Some(s.clone()),
            _ => None,
        };
        let key = obj
            .get("depotKey")
            .and_then(|k| k.as_str())
            .filter(|k| is_valid_key(k))
            .map(|k| k.to_string());
        if let Some(k) = &key {
            keys.insert(id.clone(), k.clone());
        }
        depots.push(DepotMeta {
            depot_id: id,
            manifest_gid: gid,
            depot_key: key,
        });
    };

    if let Some(list) = data.get("depots").and_then(|v| v.as_array()) {
        for obj in list {
            collect(obj, &mut depots, &mut depot_keys);
        }
    }
    if let Some(list) = data.get("dlcDepots").and_then(|v| v.as_array()) {
        for wrapper in list {
            if let Some(obj) = wrapper.get("depot") {
                collect(obj, &mut depots, &mut depot_keys);
            }
        }
    }

    Ok((depots, depot_keys))
}

const FALLBACK_CDN_HOSTS: [&str; 12] = [
    "cache1-steamcontent.com",
    "cache2-steamcontent.com",
    "cache3-steamcontent.com",
    "cache4-steamcontent.com",
    "cache5-steamcontent.com",
    "cache6-steamcontent.com",
    "cache7-steamcontent.com",
    "cache8-steamcontent.com",
    "cache9-steamcontent.com",
    "cache10-steamcontent.com",
    "cache1-lax1.steamcontent.com",
    "cache2-lax1.steamcontent.com",
];

fn get_cdn_hosts() -> Vec<String> {
    let url = "https://api.steampowered.com/IContentServerDirectoryService/GetServersForSteamPipe/v1/?cell_id=33&max_servers=30";
    if let Ok(resp) = block_on(http_client().get(url).timeout(Duration::from_secs(6)).send()) {
        if let Ok(json) = block_on(resp.json::<serde_json::Value>()) {
            if let Some(servers) = json.pointer("/response/servers").and_then(|v| v.as_array()) {
                let hosts: Vec<String> = servers
                    .iter()
                    .filter_map(|s| s.get("host").and_then(|h| h.as_str()).map(|h| h.to_string()))
                    .collect();
                if !hosts.is_empty() {
                    return hosts;
                }
            }
        }
    }
    FALLBACK_CDN_HOSTS.iter().map(|s| s.to_string()).collect()
}

/// 从 CDN 下载单个 manifest（zip 容器内提取真实 payload）
fn download_single_manifest(
    steam_path: &Path,
    depot_id: &str,
    manifest_gid: &str,
) -> Result<String, String> {
    let depot_cache = steam_path.join("depotcache");
    fs::create_dir_all(&depot_cache).map_err(|e| format!("创建 depotcache 失败: {}", e))?;
    let target = depot_cache.join(format!("{}_{}.manifest", depot_id, manifest_gid));
    if target.exists() && fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok("已存在".to_string());
    }

    let url_tpl = |host: &str| format!("https://{}/depot/{}/manifest/{}/5/0", host, depot_id, manifest_gid);

    for host in get_cdn_hosts() {
        let resp = block_on(
            http_client()
                .get(url_tpl(&host))
                .timeout(Duration::from_secs(15))
                .header("User-Agent", "Valve/Steam HTTP Client 1.0")
                .header("Accept", "*/*")
                .send(),
        );
        if let Ok(resp) = resp {
            if resp.status() == 200 {
                if let Ok(bytes) = block_on(resp.bytes()) {
                    if !bytes.is_empty() {
                        let payload = extract_manifest_payload(&bytes);
                        if !payload.is_empty() {
                            fs::write(&target, &payload).map_err(|e| format!("写入清单失败: {}", e))?;
                            clean_old_manifests(&depot_cache, depot_id, manifest_gid);
                            return Ok(format!("已下载 ({} 字节)", payload.len()));
                        }
                    }
                }
            }
        }
    }

    Err(format!("所有 CDN 均未找到清单 {}_{}", depot_id, manifest_gid))
}

fn extract_manifest_payload(data: &[u8]) -> Vec<u8> {
    if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(data)) {
        for i in 0..archive.len() {
            if let Ok(mut entry) = archive.by_index(i) {
                if !entry.is_dir() {
                    let mut buf = Vec::new();
                    if entry.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                        return buf;
                    }
                }
            }
        }
    }
    // 非 zip 容器，返回原始二进制
    data.to_vec()
}

fn clean_old_manifests(depot_cache: &Path, depot_id: &str, current_gid: &str) {
    let current = format!("{}_{}.manifest", depot_id, current_gid);
    if let Ok(files) = fs::read_dir(depot_cache) {
        for f in files.filter_map(|e| e.ok()) {
            let name = f.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("{}_", depot_id)) && name.ends_with(".manifest") && name != current {
                let _ = fs::remove_file(f.path());
            }
        }
    }
}

/// 批量下载 app 及 DLC 的全部 manifest 到 depotcache
pub fn download_depot_manifests(
    steam_path: &Path,
    app_id: u32,
    _dlcs: &[u32],
) -> ManifestInstallResult {
    let (depots, depot_keys) = match parse_metadata(app_id) {
        Ok(v) => v,
        Err(e) => {
            return ManifestInstallResult {
                success: false,
                app_id,
                downloaded_count: 0,
                total_depots: 0,
                depot_keys: BTreeMap::new(),
                manifest_files: vec![],
                source: "none".to_string(),
                message: e,
            };
        }
    };

    // 元数据已包含本体与全部 DLC depot，统一预缓存（与 Electron 版行为一致）
    let valid: Vec<&DepotMeta> = depots
        .iter()
        .filter(|d| d.manifest_gid.as_deref().map(|g| !g.is_empty() && g != "0").unwrap_or(false))
        .collect();

    if valid.is_empty() {
        return ManifestInstallResult {
            success: true,
            app_id,
            downloaded_count: 0,
            total_depots: depots.len(),
            depot_keys,
            manifest_files: vec![],
            source: "cdn".to_string(),
            message: "无需下载清单或由 DLL 运行时动态下发".to_string(),
        };
    }

    let mut downloaded = Vec::new();
    for d in &valid {
        if let Ok(msg) = download_single_manifest(steam_path, &d.depot_id, d.manifest_gid.as_deref().unwrap()) {
            downloaded.push(format!("{}_{}.manifest", d.depot_id, d.manifest_gid.as_deref().unwrap_or("0")));
            let _ = msg;
        }
    }

    let downloaded_count = downloaded.len();
    ManifestInstallResult {
        success: downloaded_count > 0,
        app_id,
        downloaded_count,
        total_depots: valid.len(),
        depot_keys,
        manifest_files: downloaded,
        source: "cdn".to_string(),
        message: format!("成功就绪 {}/{} 个分包清单到 depotcache！", downloaded_count, valid.len()),
    }
}

// ==================== 本地 18万+ 全量库检索 ====================

use std::sync::Mutex as StdMutex;

struct LocalDbState {
    parsed: bool,
    games: Vec<(u32, String)>,
}

fn local_db_state() -> &'static StdMutex<LocalDbState> {
    static STATE: StdMutex<LocalDbState> = StdMutex::new(LocalDbState { parsed: false, games: Vec::new() });
    &STATE
}

/// 解析 steam_all_games.json（数组，元素含 appid/name 字段）
fn parse_local_db_text(text: &str) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(arr) = json.as_array() {
            for item in arr {
                let appid = match item.get("appid") {
                    Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0) as u32,
                    Some(serde_json::Value::String(s)) => s.parse::<u32>().unwrap_or(0),
                    _ => continue,
                };
                let name = item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if appid > 0 && !name.is_empty() {
                    out.push((appid, name));
                }
            }
        }
    }
    out
}

/// 定位全量库数据文件：Tauri 资源目录 → 开发目录
fn locate_local_db_file(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(rd) = resource_dir {
        candidates.push(rd.join("steam_all_games.json"));
        candidates.push(rd.join("data").join("steam_all_games.json"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("..").join("server").join("data").join("steam_all_games.json"));
        candidates.push(cwd.join("server").join("data").join("steam_all_games.json"));
        candidates.push(cwd.join("data").join("steam_all_games.json"));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// 全量库分页检索（与 Electron 版 searchService 的本地模式语义一致）
pub fn search_local_all(
    resource_dir: Option<&Path>,
    query: Option<&str>,
    page: u32,
    page_size: u32,
) -> serde_json::Value {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);

    // 懒加载：首次调用时解析并缓存（约 18.3 万条）
    {
        let mut state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
        if !state.parsed {
            state.parsed = true;
            if let Some(path) = locate_local_db_file(resource_dir) {
                match fs::read_to_string(&path) {
                    Ok(text) => {
                        state.games = parse_local_db_text(&text);
                        println!("[Manifests] 本地全量库载入完成: {} 条 ({})", state.games.len(), path.display());
                    }
                    Err(e) => println!("[Manifests] 读取本地全量库失败: {}", e),
                }
            }
        }
    }

    let state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
    let q = query.unwrap_or("").trim().to_lowercase();
    let is_number = !q.is_empty() && q.chars().all(|c| c.is_ascii_digit());

    let matched: Vec<&(u32, String)> = if q.is_empty() {
        state.games.iter().collect()
    } else {
        let mut matched: Vec<&(u32, String)> = state
            .games
            .iter()
            .filter(|(id, name)| {
                id.to_string().contains(&q) || name.to_lowercase().contains(&q)
            })
            .collect();
        matched
    };

    // 纯数字且无命中时，合成 Steam App 条目兜底（与 Electron 版一致）
    if matched.is_empty() && is_number {
        if let Ok(id) = q.parse::<u32>() {
            return json!({
                "items": [{
                    "appId": id,
                    "name": format!("Steam App {}", id),
                    "nameZh": format!("Steam App {}", id),
                    "headerUrl": format!("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{}/header.jpg", id),
                    "description": format!("Steam 官方收录应用 (AppID: {})", id)
                }],
                "total": 1,
                "page": page,
                "pageSize": page_size,
                "totalPages": 1,
                "source": "local_db",
                "sourceName": "本地18万+全量库"
            });
        }
    }

    let total = matched.len();
    let total_pages = (total + page_size as usize - 1) / page_size as usize;
    let start = ((page - 1) as usize) * page_size as usize;
    let items: Vec<serde_json::Value> = matched
        .into_iter()
        .skip(start)
        .take(page_size as usize)
        .map(|(id, name)| {
            json!({
                "appId": id,
                "name": name,
                "nameZh": name,
                "headerUrl": format!("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{}/header.jpg", id),
                "description": format!("Steam 官方收录应用 (AppID: {})", id)
            })
        })
        .collect();

    json!({
        "items": items,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages.max(1),
        "source": "local_db",
        "sourceName": "本地18万+全量库"
    })
}
