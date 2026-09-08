//! 未激活设备的每日免费入库次数限额。
//! 前端「一键入库」在设备未激活时调用本模块校验/扣减次数，
//! 配额持久化于 %APPDATA%\com.chunfengdu.app\free_quota.json，
//! 按本地日期记录，跨天自动清零（每日刷新）。

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// 未激活用户每日免费入库次数
pub const FREE_DAILY_LIMIT: u32 = 2;

/// 读-改-写互斥：防止并发调用同时读到相同 used 而少扣额度
static QUOTA_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone)]
pub struct QuotaStatus {
    pub is_activated: bool,
    pub used: u32,
    pub limit: u32,
    pub remaining: u32,
    pub allowed: bool,
    pub consumed: bool,
}

impl QuotaStatus {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "isActivated": self.is_activated,
            "used": self.used,
            "limit": self.limit,
            "remaining": self.remaining,
            "allowed": self.allowed,
            "consumed": self.consumed
        })
    }
}

fn quota_file() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let dir = PathBuf::from(appdata).join("com.chunfengdu.app");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("free_quota.json"))
}

#[cfg(windows)]
fn local_today() -> String {
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let mut st: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut st) };
    format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
}

#[cfg(not(windows))]
fn local_today() -> String {
    // 非 Windows 构建兜底：UTC 日期（本应用仅发布 Windows 包）
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let z = secs / 86400 + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!(
        "{:04}-{:02}-{:02}",
        if m <= 2 { y + 1 } else { y },
        m,
        d
    )
}

/// 读取今日已用次数与当前生效上限（日期不匹配视为跨天，used=0）
fn read_quota_data(path: Option<&PathBuf>) -> (u32, u32) {
    let Some(p) = path else { return (0, FREE_DAILY_LIMIT) };
    let Ok(content) = fs::read_to_string(p) else { return (0, FREE_DAILY_LIMIT) };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) else { return (0, FREE_DAILY_LIMIT) };
    let limit = v
        .get("limit")
        .and_then(|l| l.as_u64())
        .map(|n| n.min(999) as u32)
        .unwrap_or(FREE_DAILY_LIMIT);
    if v.get("date").and_then(|d| d.as_str()) != Some(local_today().as_str()) {
        return (0, limit);
    }
    let used = v.get("used").and_then(|u| u.as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32;
    (used, limit)
}

fn write_quota_data(path: Option<&PathBuf>, used: u32, limit: u32) {
    if let Some(p) = path {
        let data = serde_json::json!({
            "date": local_today(),
            "used": used,
            "limit": limit
        });
        // 先写临时文件再原子 rename：进程中途被杀时不会留下写了一半的 JSON
        //（半截文件解析失败会被当成 used=0，导致额度被重置）
        let tmp = p.with_extension("json.tmp");
        if fs::write(&tmp, data.to_string()).is_ok() {
            let _ = fs::rename(&tmp, p);
        }
    }
}

fn build_status(is_activated: bool, used: u32, limit: u32, consumed: bool) -> QuotaStatus {
    let remaining = limit.saturating_sub(used);
    QuotaStatus {
        is_activated,
        used,
        limit,
        remaining,
        allowed: is_activated || remaining > 0,
        consumed,
    }
}

/// 同步云端最新的每日免费额度上限（后台调整即时生效）
pub fn update_quota_limit(new_limit: u32) {
    let _guard = QUOTA_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = quota_file();
    let (used, _) = read_quota_data(path.as_ref());
    write_quota_data(path.as_ref(), used, new_limit.min(999));
}

/// 查询当前免费额度（不扣减）。已激活设备不受限制。
pub fn get_free_quota(is_activated: bool) -> QuotaStatus {
    if is_activated {
        return build_status(true, 0, FREE_DAILY_LIMIT, false);
    }
    let (used, limit) = read_quota_data(quota_file().as_ref());
    build_status(is_activated, used, limit, false)
}

/// 扣减一次免费额度。已激活设备直接放行不扣减；额度耗尽时返回 allowed=false。
pub fn consume_free_quota(is_activated: bool) -> QuotaStatus {
    if is_activated {
        return build_status(true, 0, FREE_DAILY_LIMIT, false);
    }
    let _guard = QUOTA_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = quota_file();
    let (used, limit) = read_quota_data(path.as_ref());
    if used >= limit {
        return build_status(false, used, limit, false);
    }
    let new_used = used + 1;
    write_quota_data(path.as_ref(), new_used, limit);
    build_status(false, new_used, limit, true)
}

fn license_cache_file() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let dir = PathBuf::from(appdata).join("com.chunfengdu.app");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("license_cache.json"))
}

pub fn save_license_cache_str(data: &str) -> bool {
    if let Some(path) = license_cache_file() {
        fs::write(path, data).is_ok()
    } else {
        false
    }
}

pub fn load_license_cache_str() -> Option<String> {
    let path = license_cache_file()?;
    fs::read_to_string(path).ok()
}

pub fn clear_license_cache_file() -> bool {
    if let Some(path) = license_cache_file() {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    true
}

