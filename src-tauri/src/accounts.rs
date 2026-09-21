use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

/// 本机已记录的 Steam 账号模型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSteamAccount {
    /// 64 位 SteamID (如 "76561198012345678")
    pub steam_id: String,
    /// 登录账户名 (用于 AutoLoginUser)
    pub account_name: String,
    /// 昵称 (Steam 个人资料显示名称)
    pub persona_name: String,
    /// 最后登录时间戳 (秒)
    pub timestamp: i64,
    /// 是否为最近一次活跃账号 (来自 loginusers.vdf mostrecent 标记)
    pub is_most_recent: bool,
    /// 是否为当前系统注册表中配置的自动登录账号
    pub is_current_auto_login: bool,
    /// 头像 Base64 Data URL (data:image/png;base64,...)，无缓存则为 None
    pub avatar_base64: Option<String>,
    /// 是否配置为离线模式
    pub wants_offline_mode: bool,
}

/// 切换账号操作响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAccountResult {
    pub success: bool,
    pub message: String,
    pub target_account: String,
    pub restarted_steam: bool,
}

/// 获取 Windows 注册表中当前配置的 Steam 自动登录用户名
pub fn get_current_auto_login_user() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\Valve\\Steam") {
            if let Ok(val) = key.get_value::<String, _>("AutoLoginUser") {
                let trimmed = val.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }
    None
}

/// 简单且健壮的 VDF Token 解析器，用于提取 loginusers.vdf 中的多账号字典
fn parse_loginusers_vdf(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut accounts: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut tokens: Vec<String> = Vec::new();

    // 分词：提取被双引号包裹的字符串以及大括号
    let mut chars = content.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            let mut s = String::new();
            while let Some(&next_ch) = chars.peek() {
                chars.next();
                if next_ch == '"' {
                    break;
                }
                if next_ch == '\\' {
                    if let Some(&esc) = chars.peek() {
                        chars.next();
                        s.push(esc);
                        continue;
                    }
                }
                s.push(next_ch);
            }
            tokens.push(s);
        } else if ch == '{' || ch == '}' {
            tokens.push(ch.to_string());
        } else if ch == '/' && chars.peek() == Some(&'/') {
            // 注释，跳至行末
            for c in chars.by_ref() {
                if c == '\n' {
                    break;
                }
            }
        }
    }

    // 状态机解析：
    // 寻找 "users" -> "{" -> 循环提取 "<steam_id>" -> "{" -> 键值对 -> "}"
    let mut i = 0;
    let len = tokens.len();
    let mut in_users = false;

    while i < len {
        let t = &tokens[i];
        if !in_users {
            if t.eq_ignore_ascii_case("users") && i + 1 < len && tokens[i + 1] == "{" {
                in_users = true;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }

        // 此时在 users 块内
        if t == "}" {
            break; // users 块结束
        }

        // 当前 token 可能是 steam_id，紧接着是 "{"
        if i + 1 < len && tokens[i + 1] == "{" {
            let steam_id = t.clone();
            i += 2; // 跳过 steam_id 和 "{"
            let mut props = HashMap::new();
            while i < len && tokens[i] != "}" {
                if i + 1 < len && tokens[i] != "{" && tokens[i + 1] != "{" && tokens[i + 1] != "}" {
                    let k = tokens[i].clone();
                    let v = tokens[i + 1].clone();
                    props.insert(k, v);
                    i += 2;
                } else {
                    i += 1;
                }
            }
            if !props.is_empty() {
                accounts.insert(steam_id, props);
            }
            if i < len && tokens[i] == "}" {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    accounts
}

/// 读取并解析本地 Steam 所有已记住凭证的账号列表
pub fn list_local_steam_accounts(steam_path: &Path) -> Vec<LocalSteamAccount> {
    let mut list = Vec::new();
    let loginusers_path = steam_path.join("config").join("loginusers.vdf");
    if !loginusers_path.exists() {
        return list;
    }

    let content = match fs::read_to_string(&loginusers_path) {
        Ok(c) => c,
        Err(_) => return list,
    };

    let raw_accounts = parse_loginusers_vdf(&content);
    let current_autologin = get_current_auto_login_user().unwrap_or_default();
    let avatar_cache_dir = steam_path.join("config").join("avatarcache");

    for (steam_id, props) in raw_accounts {
        let account_name = props
            .get("AccountName")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();

        if account_name.is_empty() {
            continue;
        }

        let persona_name = props
            .get("PersonaName")
            .cloned()
            .unwrap_or_else(|| account_name.clone());

        let timestamp: i64 = props
            .get("Timestamp")
            .and_then(|ts| ts.parse::<i64>().ok())
            .unwrap_or(0);

        let is_most_recent = props
            .get("mostrecent")
            .map(|v| v == "1")
            .unwrap_or(false);

        let wants_offline_mode = props
            .get("WantsOfflineMode")
            .map(|v| v == "1")
            .unwrap_or(false);

        let is_current_auto_login = !current_autologin.is_empty()
            && current_autologin.eq_ignore_ascii_case(&account_name);

        // 头像检测：优先 {steam_id}.png，备选 {steam_id}_f.png
        let mut avatar_base64 = None;
        if avatar_cache_dir.exists() {
            let primary = avatar_cache_dir.join(format!("{}.png", steam_id));
            let fallback = avatar_cache_dir.join(format!("{}_f.png", steam_id));
            let avatar_file = if primary.exists() {
                Some(primary)
            } else if fallback.exists() {
                Some(fallback)
            } else {
                None
            };

            if let Some(path) = avatar_file {
                if let Ok(bytes) = fs::read(&path) {
                    if !bytes.is_empty() {
                        avatar_base64 = Some(format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&bytes)));
                    }
                }
            }
        }

        list.push(LocalSteamAccount {
            steam_id,
            account_name,
            persona_name,
            timestamp,
            is_most_recent,
            is_current_auto_login,
            avatar_base64,
            wants_offline_mode,
        });
    }

    // 排序策略：当前激活账号排在最前，其余按最后活跃时间戳降序排列
    list.sort_by(|a, b| {
        b.is_current_auto_login
            .cmp(&a.is_current_auto_login)
            .then_with(|| b.is_most_recent.cmp(&a.is_most_recent))
            .then_with(|| b.timestamp.cmp(&a.timestamp))
    });

    list
}

/// 免密切换至目标 Steam 账号并平滑重启 Steam
pub fn switch_steam_account(steam_path: &Path, target_account: &str) -> Result<SwitchAccountResult, String> {
    let target = target_account.trim();
    if target.is_empty() {
        return Err("目标切换账号名不能为空".to_string());
    }

    // 1. 安全平滑退出正在运行的 Steam 进程以释放注册表与锁
    let was_running = crate::steam::is_steam_running();
    if was_running {
        crate::steam::kill_steam();
        crate::steam::clear_steam_running_cache();
        for _ in 0..20 {
            if !crate::steam::is_steam_running() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
            crate::steam::clear_steam_running_cache();
        }
    }

    // 2. 写入 Windows 注册表配置 AutoLoginUser 与 RememberPassword
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey("Software\\Valve\\Steam")
            .map_err(|e| format!("无法打开注册表 Software\\Valve\\Steam: {}", e))?;

        key.set_value("AutoLoginUser", &target)
            .map_err(|e| format!("写入注册表 AutoLoginUser 失败: {}", e))?;

        key.set_value("RememberPassword", &1u32)
            .map_err(|e| format!("写入注册表 RememberPassword 失败: {}", e))?;
    }

    // 3. 重新拉起 Steam 客户端
    let restarted = crate::steam::launch_steam(steam_path, &[]);
    if restarted {
        std::thread::sleep(std::time::Duration::from_millis(600));
        crate::steam::clear_steam_running_cache();
    }

    Ok(SwitchAccountResult {
        success: true,
        message: format!(
            "已成功切换登录账号至「{}」{}",
            target,
            if restarted { "，Steam 客户端已重新拉起！" } else { "，请手动启动 Steam 查看。" }
        ),
        target_account: target.to_string(),
        restarted_steam: restarted,
    })
}
