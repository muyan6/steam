//! 未激活设备的每日免费入库次数限额。
//! 前端「一键入库」在设备未激活时调用本模块校验/扣减次数，
//! 配额持久化于 %APPDATA%\com.chunfengdu.app\free_quota.json，
//! 按本地日期记录，跨天自动清零（每日刷新）。

use std::fs;
use std::path::PathBuf;

/// 未激活用户每日免费入库次数
pub const FREE_DAILY_LIMIT: u32 = 2;

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

/// 读取今日已用次数；日期不匹配（跨天）视为 0
fn read_used_today(path: Option<&PathBuf>) -> u32 {
    let Some(p) = path else { return 0 };
    let Ok(content) = fs::read_to_string(p) else { return 0 };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) else { return 0 };
    if v.get("date").and_then(|d| d.as_str()) != Some(local_today().as_str()) {
        return 0;
    }
    v.get("used").and_then(|u| u.as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32
}

fn write_used(path: Option<&PathBuf>, used: u32) {
    if let Some(p) = path {
        let data = serde_json::json!({ "date": local_today(), "used": used });
        let _ = fs::write(p, data.to_string());
    }
}

fn build_status(is_activated: bool, used: u32, consumed: bool) -> QuotaStatus {
    let remaining = FREE_DAILY_LIMIT.saturating_sub(used);
    QuotaStatus {
        is_activated,
        used,
        limit: FREE_DAILY_LIMIT,
        remaining,
        allowed: is_activated || remaining > 0,
        consumed,
    }
}

/// 查询当前免费额度（不扣减）。已激活设备不受限制。
pub fn get_free_quota(is_activated: bool) -> QuotaStatus {
    let used = if is_activated { 0 } else { read_used_today(quota_file().as_ref()) };
    build_status(is_activated, used, false)
}

/// 扣减一次免费额度。已激活设备直接放行不扣减；额度耗尽时返回 allowed=false。
pub fn consume_free_quota(is_activated: bool) -> QuotaStatus {
    if is_activated {
        return build_status(true, 0, false);
    }
    let path = quota_file();
    let used = read_used_today(path.as_ref());
    if used >= FREE_DAILY_LIMIT {
        return build_status(false, used, false);
    }
    let new_used = used + 1;
    write_used(path.as_ref(), new_used);
    build_status(false, new_used, true)
}
