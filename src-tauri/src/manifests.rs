use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;

pub const SERVER_API: &str = "https://steam.myil.top";

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

/// 复用统一 UA 的默认配置，供需要自定义超时（如大文件下载）的调用方再加工
pub fn http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().user_agent("ChunFengDu-Client")
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

/// 批量清单状态：仅扫描一次 depotcache，避免逐游戏全量遍历（depotcache 可有数千文件）
pub fn batch_manifest_status(steam_path: &Path, app_ids: &[u32]) -> BTreeMap<u32, AppManifestStatus> {
    let mut result: BTreeMap<u32, AppManifestStatus> = app_ids
        .iter()
        .map(|id| {
            (
                *id,
                AppManifestStatus {
                    app_id: *id,
                    has_manifest: false,
                    manifest_count: 0,
                    matched_depots: vec![],
                    manifest_files: vec![],
                },
            )
        })
        .collect();

    let depot_cache = steam_path.join("depotcache");
    if !depot_cache.exists() {
        return result;
    }
    if let Ok(files) = fs::read_dir(&depot_cache) {
        for f in files.filter_map(|e| e.ok()) {
            let name = f.file_name().to_string_lossy().to_string();
            if !name.ends_with(".manifest") {
                continue;
            }
            if let Some(d_id) = name.strip_suffix(".manifest").and_then(|s| s.split('_').next()) {
                if let Ok(id) = d_id.parse::<u32>() {
                    if let Some(status) = result.get_mut(&id) {
                        status.has_manifest = true;
                        status.manifest_count += 1;
                        if !status.matched_depots.iter().any(|x| x == d_id) {
                            status.matched_depots.push(d_id.to_string());
                        }
                        status.manifest_files.push(name.clone());
                    }
                }
            }
        }
    }
    result
}

fn is_valid_key(key: &str) -> bool {
    key.len() >= 32 && key.chars().all(|c| c.is_ascii_hexdigit()) && !key.chars().all(|c| c == '0')
}

/// 最小 URL query 转义（deviceId 为受限字符集，简单覆盖即可）
fn urlencoding_query(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct DepotMeta {
    pub depot_id: String,
    pub manifest_gid: Option<String>,
    pub depot_key: Option<String>,
}

/// 服务端元数据聚合结果（分包/密钥/DLC 列表）
#[derive(Debug, Clone)]
pub struct AppMetadata {
    pub app_id: u32,
    pub depots: Vec<DepotMeta>,
    pub depot_keys: BTreeMap<String, String>,
    pub dlc_ids: Vec<u32>,
    pub app_level_key: Option<String>,
    pub access_token: Option<String>,
}

pub fn parse_metadata(app_id: u32) -> Result<AppMetadata, String> {
    match parse_metadata_from_server(app_id) {
        Ok(m) if !m.depots.is_empty() => Ok(m),
        // 授权被拒（未激活/免费额度耗尽）属于权限问题而非数据问题：
        // 直接透传服务端原因并终止，不再降级（降级也拿不到密钥）
        Err(e) if e.contains("云端密钥服务拒绝") => Err(e),
        // 服务端不可达/网络异常时：严格校验本地离线会员防篡改数字签名
        Err(server_err) => match crate::license_verify::verify_offline_license() {
            Ok(_verified) => {
                log_diag(&format!(
                    "云端服务不可达 ({})，已成功离线验签会员资格，切换至备用容灾源拉取...",
                    server_err
                ));
                fetch_metadata_from_backup_sources(app_id)
            }
            Err(lic_err) => Err(format!(
                "云端密钥服务连接失败（{}），且未激活离线会员容灾资格：{}。请检查网络或激活后重试。",
                server_err, lic_err
            )),
        },
        Ok(_) => match crate::license_verify::verify_offline_license() {
            Ok(_verified) => {
                log_diag(&format!("云端未收录游戏 {}，尝试备用容灾源...", app_id));
                fetch_metadata_from_backup_sources(app_id)
            }
            Err(_) => parse_metadata_from_steamcmd(app_id),
        },
    }
}

/// 解析 ManifestHub3 分支 Lua 脚本中的分包、解密密钥及清单 GID
fn parse_lua_metadata(lua: &str, app_id: u32) -> AppMetadata {
    let mut depots_map: BTreeMap<String, DepotMeta> = BTreeMap::new();
    let mut depot_keys: BTreeMap<String, String> = BTreeMap::new();
    let mut dlc_ids: Vec<u32> = Vec::new();
    let mut access_token: Option<String> = None;
    let mut app_level_key: Option<String> = None;

    let s_app_id = app_id.to_string();

    for line in lua.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("--") || trimmed.is_empty() {
            continue;
        }

        // addtoken(appid, "hex")
        if let Some(rest) = trimmed.strip_prefix("addtoken(") {
            if let Some(inner) = rest.split(')').next() {
                let parts: Vec<&str> = inner.split(',').collect();
                if parts.len() >= 2 {
                    let token = parts[1].trim().trim_matches('"').trim_matches('\'').trim();
                    if !token.is_empty() {
                        access_token = Some(token.to_string());
                    }
                }
            }
            continue;
        }

        // setManifestid(depot, "gid"[, 0])
        if let Some(rest) = trimmed.strip_prefix("setManifestid(") {
            if let Some(inner) = rest.split(')').next() {
                let parts: Vec<&str> = inner.split(',').collect();
                if parts.len() >= 2 {
                    let d_id = parts[0].trim();
                    let gid = parts[1].trim().trim_matches('"').trim_matches('\'').trim();
                    if d_id.chars().all(|c| c.is_ascii_digit()) && !gid.is_empty() && gid != "0" {
                        let entry = depots_map.entry(d_id.to_string()).or_insert_with(|| DepotMeta {
                            depot_id: d_id.to_string(),
                            manifest_gid: None,
                            depot_key: None,
                        });
                        entry.manifest_gid = Some(gid.to_string());
                    }
                }
            }
            continue;
        }

        // setDepotKey(depot, "key")
        if let Some(rest) = trimmed.strip_prefix("setDepotKey(") {
            if let Some(inner) = rest.split(')').next() {
                let parts: Vec<&str> = inner.split(',').collect();
                if parts.len() >= 2 {
                    let d_id = parts[0].trim();
                    let key = parts[1].trim().trim_matches('"').trim_matches('\'').trim();
                    if d_id.chars().all(|c| c.is_ascii_digit()) && is_valid_key(key) {
                        depot_keys.insert(d_id.to_string(), key.to_string());
                        let entry = depots_map.entry(d_id.to_string()).or_insert_with(|| DepotMeta {
                            depot_id: d_id.to_string(),
                            manifest_gid: None,
                            depot_key: None,
                        });
                        entry.depot_key = Some(key.to_string());
                    }
                }
            }
            continue;
        }

        // addappid(depot, 0|1, "key") or addappid(appid)
        if let Some(rest) = trimmed.strip_prefix("addappid(") {
            if let Some(inner) = rest.split(')').next() {
                let parts: Vec<&str> = inner.split(',').collect();
                if parts.len() >= 3 {
                    let d_id = parts[0].trim();
                    let key = parts[2].trim().trim_matches('"').trim_matches('\'').trim();
                    if d_id.chars().all(|c| c.is_ascii_digit()) && is_valid_key(key) {
                        depot_keys.insert(d_id.to_string(), key.to_string());
                        let entry = depots_map.entry(d_id.to_string()).or_insert_with(|| DepotMeta {
                            depot_id: d_id.to_string(),
                            manifest_gid: None,
                            depot_key: None,
                        });
                        entry.depot_key = Some(key.to_string());
                        if d_id == s_app_id {
                            app_level_key = Some(key.to_string());
                        }
                    }
                } else if parts.len() == 1 {
                    let id_str = parts[0].trim();
                    if let Ok(id) = id_str.parse::<u32>() {
                        if id != app_id && !dlc_ids.contains(&id) {
                            dlc_ids.push(id);
                        }
                    }
                }
            }
            continue;
        }
    }

    AppMetadata {
        app_id,
        depots: depots_map.into_values().collect(),
        depot_keys,
        dlc_ids,
        app_level_key,
        access_token,
    }
}

/// 从备用容灾源（ManifestHub3 镜像加速 + SteamCMD）拉取分包与密钥数据（仅限合法会员）
pub fn fetch_metadata_from_backup_sources(app_id: u32) -> Result<AppMetadata, String> {
    let mut lua_content: Option<String> = None;
    let urls = [
        format!(
            "https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}.lua",
            app_id, app_id
        ),
        format!(
            "https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}.lua",
            app_id, app_id
        ),
    ];

    for url in &urls {
        if let Ok(resp) = block_on(http_client().get(url).timeout(Duration::from_secs(8)).send()) {
            if resp.status().is_success() {
                if let Ok(text) = block_on(resp.text()) {
                    if text.contains("addappid") || text.contains("setManifestid") || text.contains("setDepotKey") {
                        lua_content = Some(text);
                        break;
                    }
                }
            }
        }
    }

    let mut meta = if let Some(lua) = &lua_content {
        parse_lua_metadata(lua, app_id)
    } else {
        AppMetadata {
            app_id,
            depots: Vec::new(),
            depot_keys: BTreeMap::new(),
            dlc_ids: Vec::new(),
            app_level_key: None,
            access_token: None,
        }
    };

    // 结合 SteamCMD 补充公共分支分包结构与最新清单 GID
    if let Ok(cmd_meta) = parse_metadata_from_steamcmd(app_id) {
        for cmd_depot in cmd_meta.depots {
            if let Some(existing) = meta.depots.iter_mut().find(|d| d.depot_id == cmd_depot.depot_id) {
                if existing.manifest_gid.is_none() && cmd_depot.manifest_gid.is_some() {
                    existing.manifest_gid = cmd_depot.manifest_gid;
                }
            } else {
                let d_id = cmd_depot.depot_id.clone();
                let key = meta.depot_keys.get(&d_id).cloned();
                meta.depots.push(DepotMeta {
                    depot_id: d_id,
                    manifest_gid: cmd_depot.manifest_gid,
                    depot_key: key,
                });
            }
        }
        for dlc in cmd_meta.dlc_ids {
            if !meta.dlc_ids.contains(&dlc) {
                meta.dlc_ids.push(dlc);
            }
        }
    }

    if meta.depots.is_empty() {
        return Err(format!(
            "备用容灾源暂未收录 AppID {} 的规则，建议云端恢复后重试。",
            app_id
        ));
    }

    Ok(meta)
}

/// 直连 SteamCMD 公共 API 获取清单 GID（降级路径，不产生 DepotKey）
fn parse_metadata_from_steamcmd(app_id: u32) -> Result<AppMetadata, String> {
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);
    let resp = block_on(http_client().get(&url).timeout(Duration::from_secs(10)).send())
        .map_err(|e| format!("SteamCMD 降级请求失败: {}", e))?;
    let json: serde_json::Value = block_on(resp.json()).map_err(|e| format!("解析 SteamCMD 响应失败: {}", e))?;

    let mut depots = Vec::new();
    let depot_keys = BTreeMap::new();
    let s_app_id = app_id.to_string();
    // 与服务端 metadataController 一致：跳过 config/sharedinstall/shareddepot/redist 等非内容分包
    const SKIP_PATTERNS: [&str; 4] = ["config", "sharedinstall", "shareddepot", "redist"];
    let mut dlc_ids = Vec::new();
    if let Some(listofdlc) = json.pointer(&format!("/data/{}/extended/listofdlc", s_app_id)).and_then(|v| v.as_str()) {
        for part in listofdlc.split(',') {
            if let Ok(id) = part.trim().parse::<u32>() {
                if id > 0 && id != app_id && !dlc_ids.contains(&id) {
                    dlc_ids.push(id);
                }
            }
        }
    }

    if let Some(depots_data) = json.pointer(&format!("/data/{}/depots", s_app_id)).and_then(|v| v.as_object()) {
        for (d_id, info) in depots_data {
            if !d_id.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            // 过滤非内容分包：共享再发行组件（DirectX / VC++ 等）、0 字节虚拟占位分包
            let is_shared = info.get("sharedinstall").and_then(|v| v.as_str()) == Some("1")
                || info.get("depotfromapp").is_some();
            if is_shared {
                continue;
            }
            if let Some(pub_m) = info.pointer("/manifests/public") {
                let download_0 = pub_m.get("download").and_then(|v| v.as_str()) == Some("0");
                let size_0 = pub_m.get("size").and_then(|v| v.as_str()) == Some("0");
                if download_0 && size_0 {
                    continue;
                }
            }
            if let Some(dlc_app_id) = info
                .get("dlcappid")
                .and_then(|v| v.as_str().and_then(|s| s.parse::<u32>().ok()).or_else(|| v.as_u64().map(|n| n as u32)))
            {
                if dlc_app_id > 0 && dlc_app_id != app_id && !dlc_ids.contains(&dlc_app_id) {
                    dlc_ids.push(dlc_app_id);
                }
            }
            let name = info.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
            if SKIP_PATTERNS.iter().any(|p| name.contains(p)) {
                continue;
            }
            let mut gid = None;
            if let Some(manifests) = info.get("manifests").and_then(|v| v.as_object()) {
                // SteamCMD 返回的分支顺序不固定（previous 可能排在 public 之前），
                // 取第一个分支会拿到旧版清单，必须优先取 public 分支（与服务端一致）
                let pick = manifests.get("public").or_else(|| manifests.values().next());
                if let Some(g) = pick.and_then(|b| b.get("gid")).and_then(|g| g.as_str()) {
                    if !g.is_empty() && g != "0" {
                        gid = Some(g.to_string());
                    }
                }
            }
            depots.push(DepotMeta {
                depot_id: d_id.clone(),
                manifest_gid: gid,
                depot_key: None,
            });
        }
    }
    if depots.is_empty() {
        return Err("SteamCMD 降级查询未返回任何分包".to_string());
    }
    Ok(AppMetadata {
        app_id,
        depots,
        depot_keys,
        dlc_ids,
        app_level_key: None,
        access_token: None,
    })
}

fn parse_metadata_from_server(app_id: u32) -> Result<AppMetadata, String> {
    // deviceId 同时经请求头与 query 传递：新服务端优先读头，
    // 旧服务端（未升级）仍可从 query 兜底，保证向前兼容
    let device_id = crate::device::get_device_id();
    let url = format!(
        "{}/api/metadata/{}?deviceId={}",
        SERVER_API,
        app_id,
        urlencoding_query(&device_id)
    );
    let resp = block_on(
        http_client()
            .get(&url)
            .timeout(Duration::from_secs(10))
            .header("x-device-id", device_id)
            .send(),
    )
    .map_err(|e| format!("请求元数据失败: {}", e))?;
    // 显式检查状态码：403（未激活/免费额度耗尽）时把服务端原因透传出去，
    // 否则会被吞成"缺少 data 字段"，用户无法看到真实失败原因
    let status = resp.status();
    let json: serde_json::Value = block_on(resp.json()).unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let server_msg = json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("当前设备未激活或免费额度已用完");
        return Err(format!("云端密钥服务拒绝 (HTTP {}): {}", status.as_u16(), server_msg));
    }

    let data = json
        .get("data")
        .ok_or_else(|| "元数据响应缺少 data 字段".to_string())?;

    let mut depots = Vec::new();
    let mut depot_keys = BTreeMap::new();
    let mut dlc_ids: Vec<u32> = Vec::new();

    let collect = |obj: &serde_json::Value, depots: &mut Vec<DepotMeta>, keys: &mut BTreeMap<String, String>| {
        let id = match obj.get("depotId") {
            Some(serde_json::Value::Number(n)) => n.to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => return,
        };
        let gid = match obj.get("manifestGid").or_else(|| obj.get("manifestId")) {
            Some(serde_json::Value::Number(n)) => Some(n.to_string()),
            Some(serde_json::Value::String(s)) if !s.is_empty() && s != "0" => Some(s.clone()),
            _ => None,
        };
        let key = obj
            .get("depotKey")
            .or_else(|| obj.get("key"))
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
            if let Some(dlc_app_id) = wrapper
                .get("dlcAppId")
                .and_then(|v| v.as_str().and_then(|s| s.parse::<u32>().ok()).or_else(|| v.as_u64().map(|n| n as u32)))
            {
                if dlc_app_id > 0 && !dlc_ids.contains(&dlc_app_id) {
                    dlc_ids.push(dlc_app_id);
                }
            }
            if let Some(obj) = wrapper.get("depot") {
                collect(obj, &mut depots, &mut depot_keys);
            }
        }
    }

    // 兼容：data.dlcIds 直接给出 DLC 列表时一并合并
    if let Some(list) = data.get("dlcIds").and_then(|v| v.as_array()) {
        for v in list {
            let id = match v {
                serde_json::Value::Number(n) => n.as_u64().map(|x| x as u32),
                serde_json::Value::String(s) => s.parse::<u32>().ok(),
                _ => None,
            };
            if let Some(id) = id {
                if id > 0 && id != app_id && !dlc_ids.contains(&id) {
                    dlc_ids.push(id);
                }
            }
        }
    }

    // appLevelKey / accessToken（addappid 密钥挂载与 addtoken 所需）
    let app_level_key = data
        .get("appLevelKey")
        .and_then(|k| k.as_str())
        .filter(|k| is_valid_key(k))
        .map(|k| k.to_string());
    let access_token = data
        .get("accessToken")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string());

    Ok(AppMetadata {
        app_id,
        depots,
        depot_keys,
        dlc_ids,
        app_level_key,
        access_token,
    })
}

const FALLBACK_CDN_HOSTS: [&str; 5] = [
    "dl.steam.clngaa.com",
    "st.dl.eccdnx.com",
    "xz.pphimalayanrt.com",
    "al.dl.eccdnx.com",
    "client-download.steampowered.com.edgesuite.net",
];

fn get_cdn_hosts() -> Vec<String> {
    static CACHED_HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    CACHED_HOSTS.get_or_init(|| {
        let url = "https://api.steampowered.com/IContentServerDirectoryService/GetServersForSteamPipe/v1/?cell_id=33&max_servers=5";
        if let Ok(resp) = block_on(http_client().get(url).timeout(Duration::from_secs(2)).send()) {
            if let Ok(json) = block_on(resp.json::<serde_json::Value>()) {
                if let Some(servers) = json.pointer("/response/servers").and_then(|v| v.as_array()) {
                    let hosts: Vec<String> = servers
                        .iter()
                        .filter_map(|s| s.get("host").and_then(|h| h.as_str()).map(|h| h.to_string()))
                        .take(5)
                        .collect();
                    if !hosts.is_empty() {
                        return hosts;
                    }
                }
            }
        }
        FALLBACK_CDN_HOSTS.iter().map(|s| s.to_string()).collect()
    }).clone()
}

/// 异步版单清单下载（四级容灾分发）：
/// 1. 第一优先级：自有云端服务端下载（支持服务端 Cache-Through 自动回源沉淀）
/// 2. 第二优先级：ManifestHub3 加速镜像（拉取真实 .manifest 实体）
/// 3. 第三优先级：ManifestHub3 GitHub Raw 直连
/// 4. 第四优先级：Steam 官方 CDN 多节点调度
async fn download_single_manifest(
    steam_path: &Path,
    app_id: u32,
    depot_id: &str,
    manifest_gid: &str,
    hosts: &[String],
) -> Result<String, String> {
    let depot_cache = steam_path.join("depotcache");
    fs::create_dir_all(&depot_cache).map_err(|e| format!("创建 depotcache 失败: {}", e))?;
    let target = depot_cache.join(format!("{}_{}.manifest", depot_id, manifest_gid));
    if target.exists() && fs::metadata(&target).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok("已存在".to_string());
    }

    let device_id = crate::device::get_device_id();

    // 1. 第一优先级：自有云端服务端下载（带 Cache-Through 自动沉淀机制）
    let server_url = format!(
        "{}/api/manifests/download/{}/{}?appId={}&deviceId={}",
        SERVER_API,
        depot_id,
        manifest_gid,
        app_id,
        urlencoding_query(&device_id)
    );
    if let Ok(resp) = http_client()
        .get(&server_url)
        .timeout(Duration::from_secs(8))
        .header("x-device-id", &device_id)
        .header("User-Agent", "ChunFengDu-Client")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(bytes) = resp.bytes().await {
                if !bytes.is_empty() {
                    let payload = extract_manifest_payload(&bytes);
                    if !payload.is_empty() {
                        fs::write(&target, &payload).map_err(|e| format!("写入清单失败: {}", e))?;
                        clean_old_manifests(&depot_cache, depot_id, manifest_gid);
                        return Ok(format!("已从自有服务端下载 ({} 字节)", payload.len()));
                    }
                }
            }
        }
    }

    // 2. 第二优先级：ManifestHub3 加速镜像源（拉取真实 .manifest 实体）
    let mirror_candidates = [
        format!(
            "https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}_{}.manifest",
            app_id, depot_id, manifest_gid
        ),
        format!(
            "https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}_{}.manifest",
            depot_id, depot_id, manifest_gid
        ),
    ];
    for m_url in &mirror_candidates {
        if let Ok(resp) = http_client()
            .get(m_url)
            .timeout(Duration::from_secs(8))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        let payload = extract_manifest_payload(&bytes);
                        if !payload.is_empty() {
                            fs::write(&target, &payload).map_err(|e| format!("写入清单失败: {}", e))?;
                            clean_old_manifests(&depot_cache, depot_id, manifest_gid);
                            return Ok(format!("已从 ManifestHub3 镜像下载 ({} 字节)", payload.len()));
                        }
                    }
                }
            }
        }
    }

    // 3. 第三优先级：ManifestHub3 GitHub Raw 直连
    let raw_candidates = [
        format!(
            "https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}_{}.manifest",
            app_id, depot_id, manifest_gid
        ),
        format!(
            "https://raw.githubusercontent.com/steamtools-games/ManifestHub3/{}/{}_{}.manifest",
            depot_id, depot_id, manifest_gid
        ),
    ];
    for r_url in &raw_candidates {
        if let Ok(resp) = http_client()
            .get(r_url)
            .timeout(Duration::from_secs(8))
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        let payload = extract_manifest_payload(&bytes);
                        if !payload.is_empty() {
                            fs::write(&target, &payload).map_err(|e| format!("写入清单失败: {}", e))?;
                            clean_old_manifests(&depot_cache, depot_id, manifest_gid);
                            return Ok(format!("已从 GitHub 直连下载 ({} 字节)", payload.len()));
                        }
                    }
                }
            }
        }
    }

    // 4. 第四优先级：Steam 官方 CDN 多节点调度（兜底路径）
    let url_tpl = |host: &str| format!("https://{}/depot/{}/manifest/{}/5/0", host, depot_id, manifest_gid);
    for host in hosts {
        let resp = http_client()
            .get(url_tpl(host))
            .timeout(Duration::from_millis(2500))
            .header("User-Agent", "Valve/Steam HTTP Client 1.0")
            .header("Accept", "*/*")
            .send()
            .await;
        if let Ok(resp) = resp {
            let status = resp.status();
            if status == reqwest::StatusCode::NOT_FOUND
                || status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                break;
            }
            if status == reqwest::StatusCode::OK {
                if let Ok(bytes) = resp.bytes().await {
                    if !bytes.is_empty() {
                        let payload = extract_manifest_payload(&bytes);
                        if !payload.is_empty() {
                            fs::write(&target, &payload).map_err(|e| format!("写入清单失败: {}", e))?;
                            clean_old_manifests(&depot_cache, depot_id, manifest_gid);
                            return Ok(format!("已从 Steam CDN 下载 ({} 字节)", payload.len()));
                        }
                    }
                }
            }
        }
    }

    Err(format!("所有源均未找到清单 {}_{}", depot_id, manifest_gid))
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
    let meta = match parse_metadata(app_id) {
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
    let depot_keys = meta.depot_keys.clone();
    let precache = precache_manifests(steam_path, &meta);

    ManifestInstallResult {
        success: precache.ok_count > 0,
        app_id,
        downloaded_count: precache.ok_count,
        total_depots: precache.total,
        depot_keys,
        manifest_files: precache.files,
        source: "cdn".to_string(),
        message: format!(
            "成功就绪 {}/{} 个分包清单到 depotcache！",
            precache.ok_count, precache.total
        ),
    }
}

pub struct PrecacheResult {
    pub ok_count: usize,
    pub total: usize,
    pub files: Vec<String>,
}

/// 将 panic 详情追加到临时目录日志，GUI 版没有控制台可看，
/// 线上排障只能靠这里（附时间戳，按大小轮转防止无限增长）。
/// 多线程可能同时追加/轮转，必须经互斥锁串行化，否则轮转时新写入会丢失
pub fn log_diag(line: &str) {
    use std::io::Write;
    static LOG_LOCK: StdMutex<()> = StdMutex::new(());
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = std::env::temp_dir().join("chunfengdu_diag.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 追加前先检查当前大小：现有内容 + 本次追加将超过 512KB 时先截断，
    // 防止（多线程并发下）轮转判断与追加交错导致无限增长
    let cur_len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if cur_len + line.len() as u64 + 32 > 512 * 1024 {
        let _ = std::fs::write(&path, b"");
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {}", ts, line);
    }
}

/// 把 panic 载荷转成可读消息
pub fn panic_message(panic: &Box<dyn std::any::Any + Send>) -> String {
    panic
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown panic".to_string())
}

/// 就绪元数据中带 GID 的全部清单到 depotcache（供一键入库后的自动预缓存复用）。
/// CDN host 列表只取一次复用；清单分 4 路并发下载，避免大型游戏串行卡数分钟。
/// 单个清单下载的任何失败/panic 只损失该清单，绝不向调用方传播——
/// 入库主流程（Lua 规则写入）在此步之前就已完成。
pub fn precache_manifests(steam_path: &Path, meta: &AppMetadata) -> PrecacheResult {
    let any_has_key = meta.depots.iter().any(|d| d.depot_key.as_deref().map(|k| is_valid_key(k)).unwrap_or(false));
    let valid: Vec<&DepotMeta> = meta
        .depots
        .iter()
        .filter(|d| {
            let has_gid = d.manifest_gid.as_deref().map(|g| !g.is_empty() && g != "0").unwrap_or(false);
            if any_has_key {
                let has_key = d.depot_key.as_deref().map(|k| is_valid_key(k)).unwrap_or(false);
                has_gid && has_key
            } else {
                has_gid
            }
        })
        .collect();
    let total = valid.len();

    let hosts = get_cdn_hosts();

    // 并发下载必须全部在 Tokio 运行时内完成：此前用 thread::scope 起普通
    // 线程再手动 block_on，会因子线程没有 Tokio 反应器而全部 panic
    // （"there is no reactor running"，表现为清单 0 下载、入库后无法下载）。
    // 现改为 4 个异步任务经 tauri::async_runtime::spawn 调度，各认领一段
    // 清单串行下载；调用方（spawn_blocking 线程）一次性 block_on 等待完成
    // ——该位置的单次 block_on 与旧版串行实现相同，已验证可用。
    let chunk_size = (total + 3) / 4;
    let mut handles = Vec::new();
    let app_id = meta.app_id;
    for chunk in valid.chunks(chunk_size.max(1)) {
        let steam_path = steam_path.to_path_buf();
        let hosts = hosts.clone();
        let tasks: Vec<(String, String)> = chunk
            .iter()
            .map(|d| (d.depot_id.clone(), d.manifest_gid.as_deref().unwrap().to_string()))
            .collect();
        handles.push(tauri::async_runtime::spawn(async move {
            let mut files = Vec::new();
            for (depot_id, gid) in tasks {
                match download_single_manifest(&steam_path, app_id, &depot_id, &gid, &hosts).await {
                    Ok(_) => files.push(format!("{}_{}.manifest", depot_id, gid)),
                    Err(e) => log_diag(&format!("manifest {} 下载失败: {}", depot_id, e)),
                }
            }
            files
        }));
    }

    let mut files = Vec::new();
    for h in handles {
        match block_on(h) {
            Ok(mut f) => files.append(&mut f),
            Err(e) => {
                log_diag(&format!("manifest 下载任务 join 失败: {}", e));
                println!("[Manifests] 清单下载任务异常结束: {}", e);
            }
        }
    }

    PrecacheResult {
        ok_count: files.len(),
        total,
        files,
    }
}

// ==================== 本地 18万+ 全量库检索（内嵌二进制字典 + 云端同步） ====================

use std::sync::Mutex as StdMutex;
use sha2::{Digest, Sha256};

use crate::dict_parser::{parse_binary_dict, DictEntry, DICT_MAGIC, EMBEDDED_DICT};

/// 云端字典同步 sidecar 文件名（位于 exe 同目录，版本更新后静默落盘）
pub const DICT_SIDECAR_FILE: &str = "game_dict.dat";

struct LocalDbState {
    parsed: bool,
    games: Vec<DictEntry>,
    /// 已加载字典的数据来源描述（sidecar / 内嵌 / 遗留 JSON）
    source: String,
    /// 已加载字典字节整体 SHA256（即字典版本号，供云端同步比对）
    sha256: String,
}

impl Default for LocalDbState {
    fn default() -> Self {
        LocalDbState {
            parsed: false,
            games: Vec::new(),
            source: String::new(),
            sha256: String::new(),
        }
    }
}

fn local_db_state() -> &'static StdMutex<LocalDbState> {
    static STATE: StdMutex<LocalDbState> = StdMutex::new(LocalDbState {
        parsed: false,
        games: Vec::new(),
        source: String::new(),
        sha256: String::new(),
    });
    &STATE
}

/// 计算字节切片的 SHA256 十六进制小写串（即字典版本号）
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 解析 steam_all_games.json（数组，元素含 appid/name 字段）——仅作开发模式遗留兜底
fn parse_local_db_text(text: &str) -> Vec<DictEntry> {
    let mut out = Vec::new();
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(arr) = json.as_array() {
            for item in arr {
                // 数据文件字段名为驼峰 appId（兼容小写 appid）
                let appid = match item.get("appId").or_else(|| item.get("appid")) {
                    Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0) as u32,
                    Some(serde_json::Value::String(s)) => s.parse::<u32>().unwrap_or(0),
                    _ => continue,
                };
                let name = item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let name_zh = item
                    .get("nameZh")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if appid > 0 && !name.is_empty() {
                    out.push(DictEntry::new(appid, name, name_zh));
                }
            }
        }
    }
    out
}

/// 定位遗留全量库 JSON 数据文件：Tauri 资源目录 → 开发目录。
/// 仅作开发模式兜底（正式包已内嵌二进制字典），不做任何迁移/删除
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

/// 云端同步落盘的 sidecar 路径（exe 同目录 game_dict.dat）
fn sidecar_dict_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(DICT_SIDECAR_FILE)))
}

/// 单一数据源载入结果
struct DictLoad {
    games: Vec<DictEntry>,
    sha256: String,
    source: &'static str,
}

/// 从 sidecar 二进制载入（云端同步更新后的版本）
fn load_sidecar_dict() -> Option<DictLoad> {
    let path = sidecar_dict_path()?;
    let bytes = fs::read(&path).ok()?;
    let games = parse_binary_dict(&bytes);
    if games.is_empty() {
        // sidecar 损坏（魔数/版本/截断异常）：按空处理，回退内嵌字典
        println!("[Manifests] sidecar 字典无效，回退内嵌字典: {}", path.display());
        return None;
    }
    Some(DictLoad { games, sha256: sha256_hex(&bytes), source: "sidecar" })
}

/// 从编译期内嵌二进制载入（正式包主路径）
fn load_embedded_dict() -> DictLoad {
    let games = parse_binary_dict(EMBEDDED_DICT);
    if games.is_empty() {
        // 内嵌字典理论上不可能损坏（编译期校验 + 测试覆盖），仅防御性兜底
        println!("[Manifests] 内嵌字典解析异常，请检查 game_dict.bin");
    }
    DictLoad { games, sha256: sha256_hex(EMBEDDED_DICT), source: "embedded" }
}

/// 从遗留 steam_all_games.json 载入（开发模式兜底，无中文名）
fn load_legacy_json_dict(resource_dir: Option<&Path>) -> Option<DictLoad> {
    let path = locate_local_db_file(resource_dir)?;
    let bytes = fs::read(&path).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let games = parse_local_db_text(&text);
    if games.is_empty() {
        return None;
    }
    Some(DictLoad { games, sha256: sha256_hex(&bytes), source: "legacy_json" })
}

/// 确保全量库已载入（懒加载：首次检索/首次同步时解析并缓存，约 18.3 万条）。
/// 加载优先级：exe 同目录 sidecar（云端更新产物）→ 编译期内嵌字典 → 遗留 JSON
fn ensure_local_db_loaded(resource_dir: Option<&Path>) {
    let mut state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
    if state.parsed {
        return;
    }
    state.parsed = true;

    let load = load_sidecar_dict()
        .or_else(|| {
            let emb = load_embedded_dict();
            if emb.games.is_empty() {
                None
            } else {
                Some(emb)
            }
        })
        .or_else(|| load_legacy_json_dict(resource_dir));

    match load {
        Some(l) => {
            state.games = l.games;
            state.sha256 = l.sha256;
            state.source = l.source.to_string();
            println!(
                "[Manifests] 本地全量库载入完成: {} 条 (来源: {}, sha256: {})",
                state.games.len(),
                state.source,
                &state.sha256[..state.sha256.len().min(12)]
            );
        }
        None => {
            // 所有来源均失败：保持空库，检索走纯数字 AppID 兜底
            state.source = "none".to_string();
            state.sha256 = String::new();
            println!("[Manifests] 本地全量库载入失败：无可用数据源");
        }
    }
}

/// 当前已载入字典的 (来源, sha256 版本号, 条目数)
pub fn local_dictionary_info() -> (String, String, u32) {
    let state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
    (state.source.clone(), state.sha256.clone(), state.games.len() as u32)
}

/// 云端字典同步结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionarySyncOutcome {
    pub updated: bool,
    pub count: u32,
}

/// 检查并同步云端游戏字典：
/// 1. GET /api/games/library/version 比对 SHA256 版本；
/// 2. 不一致则 GET /api/games/library/download（带 x-device-id）下载并校验；
/// 3. 校验通过后原子写入 exe 同目录 sidecar，并重置本地缓存让下次检索热加载。
/// 任何失败仅返回 Err（记录日志），绝不 panic、离线安全。
pub fn check_and_sync_dictionary(resource_dir: Option<&Path>) -> Result<DictionarySyncOutcome, String> {
    // 确保基线字典已载入，否则无从比对版本
    ensure_local_db_loaded(resource_dir);
    let (_, current_sha, current_count) = local_dictionary_info();

    // 1. 查询云端版本（10s 超时）
    let version_url = format!("{}/api/games/library/version", SERVER_API);
    let resp = block_on(http_client().get(&version_url).timeout(Duration::from_secs(10)).send())
        .map_err(|e| format!("查询云端字典版本失败: {}", e))?;
    let status = resp.status();
    let json: serde_json::Value = block_on(resp.json()).unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(format!("查询云端字典版本失败 (HTTP {})", status.as_u16()));
    }
    let data = json.get("data").ok_or_else(|| "云端字典版本响应缺少 data 字段".to_string())?;
    let server_sha = data
        .get("sha256")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "云端字典版本响应缺少 sha256".to_string())?
        .to_lowercase();
    let server_count = data.get("count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

    // 2. 版本一致则无需更新
    if !current_sha.is_empty() && current_sha == server_sha {
        println!(
            "[Manifests] 云端字典版本一致 ({} 条, sha256: {})，跳过同步",
            current_count,
            &server_sha[..server_sha.len().min(12)]
        );
        return Ok(DictionarySyncOutcome { updated: false, count: current_count });
    }

    // 3. 下载最新字典（30s 超时，携带设备标识）
    println!(
        "[Manifests] 云端字典版本变化，开始下载 (本地 sha256: {}, 云端 sha256: {})",
        if current_sha.is_empty() { "无".to_string() } else { current_sha[..12.min(current_sha.len())].to_string() },
        &server_sha[..server_sha.len().min(12)]
    );
    let device_id = crate::device::get_device_id();
    let download_url = format!("{}/api/games/library/download", SERVER_API);
    let resp = block_on(
        http_client()
            .get(&download_url)
            .timeout(Duration::from_secs(30))
            .header("x-device-id", device_id)
            .send(),
    )
    .map_err(|e| format!("下载云端字典失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("下载云端字典失败 (HTTP {})", status.as_u16()));
    }
    let bytes = block_on(resp.bytes()).map_err(|e| format!("读取云端字典响应失败: {}", e))?;
    let bytes = bytes.as_ref();

    // 4. 校验：SHA256 与版本接口一致 + 魔数 CFGD + 解析条目数 > 10 万
    let download_sha = sha256_hex(bytes);
    if download_sha != server_sha {
        return Err(format!(
            "云端字典校验失败: SHA256 不匹配 (期望 {}, 实际 {})",
            &server_sha[..12.min(server_sha.len())],
            &download_sha[..12.min(download_sha.len())]
        ));
    }
    if bytes.len() < 9 || bytes[0..4] != DICT_MAGIC {
        return Err("云端字典校验失败: 魔数不符".to_string());
    }
    let entries = parse_binary_dict(bytes);
    if entries.len() <= 100_000 {
        return Err(format!("云端字典校验失败: 条目数异常 ({})", entries.len()));
    }

    // 5. 原子写入 sidecar（.tmp + rename，避免半截文件被下次启动当作有效字典）
    let target = sidecar_dict_path()
        .ok_or_else(|| "无法定位 exe 目录，无法写入字典 sidecar".to_string())?;
    let tmp = target.with_extension("dat.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("写入字典临时文件失败: {}", e))?;
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换字典 sidecar 失败: {}", e));
    }

    // 6. 重置本地缓存：下次检索按优先级重新从 sidecar 热加载
    {
        let mut state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
        *state = LocalDbState::default();
    }

    println!(
        "[Manifests] 云端字典同步完成: {} 条 (云端标记 {}, sha256: {}) → {}",
        entries.len(),
        server_count,
        &server_sha[..server_sha.len().min(12)],
        target.display()
    );
    Ok(DictionarySyncOutcome { updated: true, count: entries.len() as u32 })
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

    // 懒加载：首次调用时按优先级解析并缓存（约 18.3 万条）
    ensure_local_db_loaded(resource_dir);

    let state = local_db_state().lock().unwrap_or_else(|e| e.into_inner());
    let q = query.unwrap_or("").trim().to_lowercase();
    let is_number = !q.is_empty() && q.chars().all(|c| c.is_ascii_digit());

    let matched: Vec<&DictEntry> = if q.is_empty() {
        state.games.iter().collect()
    } else {
        state
            .games
            .iter()
            .filter(|e| {
                // 同时匹配原名与中文名（各自的小写副本已在载入时预计算）
                e.app_id.to_string().contains(&q)
                    || e.name_lower.contains(&q)
                    || e.name_zh_lower.contains(&q)
            })
            .collect()
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
        .map(|e| {
            // 优先展示中文名，无中文时回退原名
            let display = if e.name_zh.is_empty() { e.name.clone() } else { e.name_zh.clone() };
            json!({
                "appId": e.app_id,
                "name": e.name,
                "nameZh": display,
                "headerUrl": format!("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{}/header.jpg", e.app_id),
                "description": format!("Steam 官方收录应用 (AppID: {})", e.app_id)
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
