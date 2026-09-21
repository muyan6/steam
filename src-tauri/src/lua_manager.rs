use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// 入库应用全量详情数据结构 (包含启用/停用分级状态)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedDetail {
    pub app_id: u32,
    pub name: String,
    pub has_token: bool,
    pub has_manifest: bool,
    pub has_depot_keys: bool,
    /// Lua 规则是否钉死了清单版本（setManifestid）；false = 跟随官方最新版
    pub pinned: bool,
    pub depots_count: u32,
    pub dlc_count: u32,
    pub lua_path: String,
    /// 软禁用状态：true = 位于 Disable/ 目录下暂不生效；false = 激活生效中
    pub is_disabled: bool,
}

/// 规则状态切换响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaToggleResult {
    pub success: bool,
    pub app_id: u32,
    pub is_disabled: bool,
    pub message: String,
}

/// 确保标准规则目录与其 Disable 软停用子目录就绪
pub fn ensure_lua_dirs(steam_path: &Path) -> Result<PathBuf, String> {
    let lua_dir = steam_path.join("config").join("lua");
    let disable_dir = lua_dir.join("Disable");
    fs::create_dir_all(&disable_dir)
        .map_err(|e| format!("创建 Lua 规则及 Disable 目录失败: {}", e))?;
    Ok(lua_dir)
}

/// 软切换游戏入库规则的生效状态（无需物理删除文件，随时一键恢复）
pub fn toggle_lua_status(steam_path: &Path, app_id: u32, disable: bool) -> Result<LuaToggleResult, String> {
    let lua_dir = ensure_lua_dirs(steam_path)?;
    let disable_dir = lua_dir.join("Disable");

    let active_path = lua_dir.join(format!("{}.lua", app_id));
    let disabled_path = disable_dir.join(format!("{}.lua", app_id));

    if disable {
        // 请求停用：将 config/lua/<id>.lua 移动至 config/lua/Disable/<id>.lua
        if !active_path.exists() {
            if disabled_path.exists() {
                return Ok(LuaToggleResult {
                    success: true,
                    app_id,
                    is_disabled: true,
                    message: format!("AppID {} 当前已处于停用状态", app_id),
                });
            }
            return Err(format!("未在规则目录找到 AppID {} 的激活规则文件", app_id));
        }

        fs::rename(&active_path, &disabled_path)
            .map_err(|e| format!("移动规则文件至 Disable 目录失败（可能被 Steam 进程锁定）: {}", e))?;

        // 联动刷新 GreenLuma AppList
        crate::ost::sync_greenluma_app_list(steam_path);

        Ok(LuaToggleResult {
            success: true,
            app_id,
            is_disabled: true,
            message: format!("已停用 AppID {} 的入库规则（文件已安全归档至 Disable，随时可恢复）", app_id),
        })
    } else {
        // 请求启用：将 config/lua/Disable/<id>.lua 移回 config/lua/<id>.lua
        if !disabled_path.exists() {
            if active_path.exists() {
                return Ok(LuaToggleResult {
                    success: true,
                    app_id,
                    is_disabled: false,
                    message: format!("AppID {} 当前已处于启用状态", app_id),
                });
            }
            return Err(format!("未在 Disable 归档中找到 AppID {} 的规则文件", app_id));
        }

        fs::rename(&disabled_path, &active_path)
            .map_err(|e| format!("恢复规则文件至激活目录失败: {}", e))?;

        // 联动刷新 GreenLuma AppList
        crate::ost::sync_greenluma_app_list(steam_path);

        Ok(LuaToggleResult {
            success: true,
            app_id,
            is_disabled: false,
            message: format!("已重新启用 AppID {} 的入库规则！", app_id),
        })
    }
}

/// 扫描指定目录下以 AppID 数字命名的 .lua 文件
fn scan_dir_for_lua(dir: &Path, is_disabled: bool) -> Vec<(u32, PathBuf, bool)> {
    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("lua")).unwrap_or(false) {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(app_id) = stem.parse::<u32>() {
                        items.push((app_id, p, is_disabled));
                    }
                }
            }
        }
    }
    items
}

/// 从 Lua 文件内容提取游戏名
fn extract_game_name_from_lua(content: &str, app_id: u32) -> String {
    if let Some(first) = content.lines().next() {
        let t = first.trim_start_matches('-').trim();
        let t = t.strip_prefix("Game:").map(|s| s.trim()).unwrap_or(t);
        if let Some(pos) = t.find("(AppID") {
            let t = t[..pos].trim();
            if !t.is_empty() {
                return t.to_string();
            }
        } else if !t.is_empty() {
            return t.to_string();
        }
    }
    format!("Steam App {}", app_id)
}

/// 全量读取已入库规则详情列表（自动合并激活规则与 Disable 归档规则）
pub fn get_all_unlocked_details(steam_path: &Path) -> Vec<UnlockedDetail> {
    let lua_dir = steam_path.join("config").join("lua");
    let disable_dir = lua_dir.join("Disable");

    let mut all_scanned = Vec::new();
    // 1. 扫描激活目录
    all_scanned.extend(scan_dir_for_lua(&lua_dir, false));
    // 2. 扫描软禁用目录
    all_scanned.extend(scan_dir_for_lua(&disable_dir, true));

    // 按 AppID 排序，若同个 AppID 在两处同时存在（极罕见），激活优先
    all_scanned.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));
    all_scanned.dedup_by_key(|item| item.0);

    let ids: Vec<u32> = all_scanned.iter().map(|(id, _, _)| *id).collect();
    let manifest_map = crate::manifests::batch_manifest_status(steam_path, &ids);

    let mut details = Vec::with_capacity(all_scanned.len());
    for (app_id, path, is_disabled) in all_scanned {
        let content = fs::read_to_string(&path).unwrap_or_default();
        let name = extract_game_name_from_lua(&content, app_id);
        let addappid_count = content.matches("addappid").count() as u32;
        let has_token = content.contains("addtoken");
        let has_depot_keys = crate::ost::lua_has_valid_key(&content);
        let has_manifest = manifest_map
            .get(&app_id)
            .map(|s| s.has_manifest)
            .unwrap_or(false);

        let rel_lua_path = if is_disabled {
            format!("config/lua/Disable/{}.lua", app_id)
        } else {
            format!("config/lua/{}.lua", app_id)
        };

        details.push(UnlockedDetail {
            app_id,
            name,
            has_token,
            has_manifest,
            has_depot_keys,
            pinned: content.contains("setManifestid"),
            depots_count: addappid_count.max(1),
            dlc_count: addappid_count.saturating_sub(1),
            lua_path: rel_lua_path,
            is_disabled,
        });
    }

    details
}

/// 彻底删除游戏入库规则（同时清理激活与 Disable 归档路径）
pub fn remove_unlocked_rule_comprehensive(steam_path: &Path, app_id: u32) -> Result<(usize, usize), String> {
    let paths = [
        steam_path.join("config").join("lua").join(format!("{}.lua", app_id)),
        steam_path.join("config").join("lua").join("Disable").join(format!("{}.lua", app_id)),
        steam_path.join("st_scripts").join(format!("{}.lua", app_id)),
        steam_path.join("st_scripts").join(format!("app_{}.lua", app_id)),
        steam_path.join("config").join("stplug-in").join(format!("app_{}.lua", app_id)),
    ];

    let mut removed = 0;
    let mut failed = 0;
    for p in paths {
        if p.exists() {
            if fs::remove_file(&p).is_ok() {
                removed += 1;
            } else {
                failed += 1;
            }
        }
    }
    crate::ost::sync_greenluma_app_list(steam_path);
    Ok((removed, failed))
}

/// DLC 差异对比结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlcDiffResult {
    pub success: bool,
    pub app_id: u32,
    pub total_remote_dlcs: usize,
    pub local_dlc_count: usize,
    pub missing_dlc_ids: Vec<u32>,
    pub message: String,
}

/// DLC 增量追加写入响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlcAppendResult {
    pub success: bool,
    pub app_id: u32,
    pub added_count: usize,
    pub added_dlc_ids: Vec<u32>,
    pub message: String,
}

/// 查找指定 AppID 的 Lua 规则文件路径（优先激活目录，其次 Disable 目录）
pub fn find_lua_path(steam_path: &Path, app_id: u32) -> Option<(PathBuf, bool)> {
    let active = steam_path.join("config").join("lua").join(format!("{}.lua", app_id));
    if active.exists() {
        return Some((active, false));
    }
    let disabled = steam_path.join("config").join("lua").join("Disable").join(format!("{}.lua", app_id));
    if disabled.exists() {
        return Some((disabled, true));
    }
    None
}

/// 核验已入库游戏与云端最新 DLC 的差异（提取本地缺失的增量 DLC）
pub fn check_game_dlc_diff(steam_path: &Path, app_id: u32) -> Result<DlcDiffResult, String> {
    let (lua_path, _) = find_lua_path(steam_path, app_id)
        .ok_or_else(|| format!("未在规则目录中找到 AppID {} 的规则文件", app_id))?;

    let content = fs::read_to_string(&lua_path)
        .map_err(|e| format!("读取规则文件失败: {}", e))?;

    // 本地已有的所有 AppID / DepotID（含主 AppID 及所有已挂载 DLC）
    let local_ids = crate::ost::extract_addappid_ids(&content);
    let local_dlc_count = local_ids.iter().filter(|&&id| id != app_id).count();

    // 从云端/备用容灾源拉取完整元数据（包含全部最新 DLC）
    let meta = crate::manifests::parse_metadata(app_id, false)
        .map_err(|e| format!("获取云端游戏元数据失败: {}", e))?;

    // 铁律：凡是出现在 meta.depots 里的 id 一律归属「分包」管辖，绝不当 DLC 补。
    //
    // 事故复盘（AppID 2054970）：服务端 dlcIds 里混入过本身就是分包的 id 2757100，
    // 它在 ost::generate_lua_script 第 2 步因无密钥被正确跳过，却因不在 seen 里
    // 又被第 4 步当普通 DLC `addappid(2757100)` 挂了上去，Steam 随即
    // 「Failed to initialize depot 2757100 ... (Missing decryption key)」
    // 整个游戏被拖垮。ost.rs 为此建了 all_depot_ids 白名单（见 ost.rs:665-675）。
    // 本链路复用同一判定，防止增量补全把同一个坑再踩一遍。
    let depot_id_set: HashSet<u32> = meta
        .depots
        .iter()
        .filter_map(|d| d.depot_id.parse::<u32>().ok())
        .collect();

    // 差集计算：云端存在但本地 Lua 尚未添加、且确认不是分包的 DLC
    let mut missing_dlc_ids: Vec<u32> = meta
        .dlc_ids
        .into_iter()
        .filter(|id| *id > 0 && *id != app_id && !local_ids.contains(id) && !depot_id_set.contains(id))
        .collect();
    missing_dlc_ids.sort_unstable();
    missing_dlc_ids.dedup();

    let total_remote_dlcs = local_dlc_count + missing_dlc_ids.len();

    let message = if missing_dlc_ids.is_empty() {
        "已拥有该游戏的全部最新 DLC，无需补全！".to_string()
    } else {
        format!("发现 {} 个尚未入库的新 DLC，支持一键智能补全！", missing_dlc_ids.len())
    };

    Ok(DlcDiffResult {
        success: true,
        app_id,
        total_remote_dlcs,
        local_dlc_count,
        missing_dlc_ids,
        message,
    })
}

/// 一键向已入库游戏的规则文件中增量追加新 DLC（不破坏原有密钥与配置）
pub fn append_game_dlcs(steam_path: &Path, app_id: u32, dlc_ids: Vec<u32>) -> Result<DlcAppendResult, String> {
    let (lua_path, _) = find_lua_path(steam_path, app_id)
        .ok_or_else(|| format!("未在规则目录中找到 AppID {} 的规则文件", app_id))?;

    let content = fs::read_to_string(&lua_path)
        .map_err(|e| format!("读取规则文件失败: {}", e))?;

    let local_ids = crate::ost::extract_addappid_ids(&content);

    // 二次防御：即便上游/前端把分包 id 混进来，也绝不以裸 addappid 形式写入。
    // 重新拉一次元数据构造分包白名单（与 ost::generate_lua_script 的 all_depot_ids 同源）；
    // 拉取失败时退化为空集合（只影响过滤强度，不影响用户明确点选的正常 DLC）。
    let depot_id_set: HashSet<u32> = match crate::manifests::parse_metadata(app_id, false) {
        Ok(meta) => meta
            .depots
            .iter()
            .filter_map(|d| d.depot_id.parse::<u32>().ok())
            .collect(),
        Err(e) => {
            eprintln!(
                "[LuaManager] 追加 DLC 前拉取元数据失败，跳过分包白名单过滤 ({}): {}",
                app_id, e
            );
            HashSet::new()
        }
    };

    let mut skipped_depot_ids: Vec<u32> = Vec::new();

    // 过滤出真正尚未写入、且确认不是分包的 DLC
    let mut to_add: Vec<u32> = dlc_ids
        .into_iter()
        .filter(|id| {
            if *id == 0 || *id == app_id || local_ids.contains(id) {
                return false;
            }
            if depot_id_set.contains(id) {
                skipped_depot_ids.push(*id);
                return false;
            }
            true
        })
        .collect();
    to_add.sort_unstable();
    to_add.dedup();
    skipped_depot_ids.sort_unstable();
    skipped_depot_ids.dedup();

    if to_add.is_empty() {
        let message = if skipped_depot_ids.is_empty() {
            "所选 DLC 均已在当前入库规则中，无需重复添加".to_string()
        } else {
            format!(
                "已跳过 {} 个属于分包（depot）的 ID：{}。分包必须由入库规则按密钥挂载，不能作为 DLC 补写",
                skipped_depot_ids.len(),
                skipped_depot_ids
                    .iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        return Ok(DlcAppendResult {
            success: true,
            app_id,
            added_count: 0,
            added_dlc_ids: vec![],
            message,
        });
    }

    let mut new_content = content;
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    new_content.push_str("\n-- ==================== [CFD] 一键增量补全新 DLC ====================\n");
    for id in &to_add {
        new_content.push_str(&format!("addappid({})\n", id));
    }

    fs::write(&lua_path, new_content)
        .map_err(|e| format!("写入规则文件失败: {}", e))?;

    // 联动刷新 GreenLuma AppList
    crate::ost::sync_greenluma_app_list(steam_path);

    Ok(DlcAppendResult {
        success: true,
        app_id,
        added_count: to_add.len(),
        added_dlc_ids: to_add.clone(),
        message: format!("成功为游戏增量追加 {} 个新 DLC 到入库规则！", to_add.len()),
    })
}

