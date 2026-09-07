//! 客户端离线授权防篡改验证引擎
//! 采用 Ed25519 非对称加密数字签名，公钥固化于客户端，私钥仅存在于服务端。
//! 任何对本地授权缓存的篡改（包括修改 expiresAt、isLifetime、deviceId）均会导致验签失败。

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// 云端权威公钥 Hex 指纹（对应 server/data/license_ed25519_public.hex）
pub const DEFAULT_PUBKEY_HEX: &str = "34c2a8ab59b1d134bd32091c62525aa392c6bada97d4480f9d21abf0b9eae5a4";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub is_activated: bool,
    pub status: Option<String>,
    pub device_id: String,
    pub license_type: Option<String>,
    #[serde(rename = "type")]
    pub r#type: Option<String>,
    pub type_name: Option<String>,
    pub code: Option<String>,
    pub bound_at: Option<String>,
    pub expires_at: Option<String>,
    pub remaining_days: Option<i64>,
    pub is_lifetime: Option<bool>,
    pub message: Option<String>,
    pub signature: Option<String>,
    pub issued_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedLicense {
    pub is_activated: bool,
    pub is_lifetime: bool,
    pub expires_at: Option<String>,
    pub device_id: String,
    pub message: String,
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let clean = s.trim();
    if clean.len() % 2 != 0 {
        return Err("十六进制字符串长度必须为偶数".to_string());
    }
    (0..clean.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// 解析 ISO 8601 时间戳（如 2026-10-06T12:00:00.000Z 或 2026-10-06）转为毫秒时间戳
pub fn parse_iso_time(s: &str) -> Option<i64> {
    let clean = s.trim();
    if clean.len() < 10 {
        return None;
    }
    let year: i64 = clean.get(0..4)?.parse().ok()?;
    let month: i64 = clean.get(5..7)?.parse().ok()?;
    let day: i64 = clean.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let mut hour: i64 = 0;
    let mut min: i64 = 0;
    let mut sec: i64 = 0;
    if clean.len() >= 19 && clean.as_bytes()[10] == b'T' {
        hour = clean.get(11..13)?.parse().ok()?;
        min = clean.get(14..16)?.parse().ok()?;
        sec = clean.get(17..19)?.parse().ok()?;
    }

    let mut days = 0i64;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    let days_in_months = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    for m in 1..month {
        days += days_in_months[(m - 1) as usize];
    }
    days += day - 1;
    let total_secs = days * 86400 + hour * 3600 + min * 60 + sec;
    Some(total_secs * 1000)
}

/// 严格与服务端 licenseSignService.buildCanonicalString 保持对齐
/// 格式: deviceId|isActivated|status|type|isLifetime|expiresAt|issuedAt
pub fn build_canonical_string(
    device_id: &str,
    is_activated: bool,
    status: &str,
    lic_type: &str,
    is_lifetime: bool,
    expires_at: Option<&str>,
    issued_at: u64,
) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        device_id.trim().to_lowercase(),
        if is_activated { "true" } else { "false" },
        status.trim().to_lowercase(),
        lic_type.trim().to_lowercase(),
        if is_lifetime { "true" } else { "false" },
        expires_at.unwrap_or("").trim(),
        issued_at
    )
}

/// 使用 Ed25519 公钥校验数字签名
pub fn verify_signature(canonical: &str, signature_b64: &str, pubkey_hex: &str) -> Result<(), String> {
    let pubkey_bytes = hex_decode(pubkey_hex).map_err(|e| format!("公钥解析失败: {}", e))?;
    if pubkey_bytes.len() != 32 {
        return Err("公钥长度非 32 字节".to_string());
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&pubkey_bytes);

    let verifying_key = VerifyingKey::from_bytes(&key_arr)
        .map_err(|e| format!("无效的 Ed25519 公钥: {}", e))?;

    use base64::Engine;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64.trim())
        .map_err(|e| format!("签名 Base64 解码失败: {}", e))?;

    if sig_bytes.len() != 64 {
        return Err("签名长度非 64 字节".to_string());
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);

    let signature = Signature::from_bytes(&sig_arr);

    verifying_key
        .verify(canonical.as_bytes(), &signature)
        .map_err(|e| format!("数字签名校验不通过（授权数据可能已被篡改）: {}", e))
}

/// 读取本地离线缓存并执行全量防篡改签名校验
pub fn verify_offline_license() -> Result<VerifiedLicense, String> {
    let raw = crate::quota::load_license_cache_str()
        .ok_or_else(|| "未找到本地授权缓存文件，无法离线验证".to_string())?;

    let lic: LicensePayload = serde_json::from_str(&raw)
        .map_err(|e| format!("本地授权缓存格式损坏: {}", e))?;

    let current_dev_id = crate::device::get_device_id();
    if lic.device_id.trim().to_lowercase() != current_dev_id.trim().to_lowercase() {
        return Err("授权绑定的设备码与本机硬件不匹配，已拒绝离线放行！".to_string());
    }

    let signature = lic.signature.as_deref().unwrap_or("");
    if signature.is_empty() {
        return Err("本地授权缺少防篡改数字签名，请联网后重新校验！".to_string());
    }

    let lic_type = lic.r#type.as_deref().or(lic.license_type.as_deref()).unwrap_or("");
    let status = lic
        .status
        .as_deref()
        .unwrap_or(if lic.is_activated { "active" } else { "unactivated" });
    let is_lifetime = lic.is_lifetime.unwrap_or(false);
    let issued_at = lic.issued_at.unwrap_or(0);

    let canonical = build_canonical_string(
        &lic.device_id,
        lic.is_activated,
        status,
        lic_type,
        is_lifetime,
        lic.expires_at.as_deref(),
        issued_at,
    );

    verify_signature(&canonical, signature, DEFAULT_PUBKEY_HEX)?;

    if !lic.is_activated || status != "active" {
        return Err("当前设备未激活，离线备用容灾源仅对已激活会员开放！".to_string());
    }

    // 检查有效期
    if !is_lifetime {
        let Some(exp_str) = &lic.expires_at else {
            return Err("非终身会员卡缺失到期时间，无法在离线状态下放行！".to_string());
        };

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        if let Some(exp_ms) = parse_iso_time(exp_str) {
            if exp_ms < now_ms {
                return Err("您的会员授权已过期，请联网续费后使用！".to_string());
            }
        }
    }

    Ok(VerifiedLicense {
        is_activated: true,
        is_lifetime,
        expires_at: lic.expires_at,
        device_id: current_dev_id,
        message: "离线数字签名校验通过，确认合法会员资格！".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_verification() {
        let canonical = "test_dev|true|active|lifetime|true||1000";
        let sig = "z4xmb8pO4leF9un+0JUjzvxifKWod3Sz4uSlE5+SVE5C9BwIydj/40qkWCE3MEggXfRmzGhR8jo34/hQJwO2Bg==";
        let res = verify_signature(canonical, sig, DEFAULT_PUBKEY_HEX);
        assert!(res.is_ok(), "有效签名应验签通过");

        // 篡改数据：把 isLifetime 从 true 改成 false
        let tampered = "test_dev|true|active|lifetime|false||1000";
        let res_tampered = verify_signature(tampered, sig, DEFAULT_PUBKEY_HEX);
        assert!(res_tampered.is_err(), "篡改数据必须验签失败");
    }

    #[test]
    fn test_iso_time_parsing() {
        let t = parse_iso_time("2026-10-06T12:00:00.000Z");
        assert!(t.is_some());
        assert!(t.unwrap() > 0);
    }
}
