//! 更新 URL 与摘要验证：不执行网络或安装器，便于独立回归。
pub fn installer_filename(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "无效的更新下载地址".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("更新下载地址仅支持 HTTPS".to_string());
    }
    let raw = parsed.path_segments().and_then(|mut parts| parts.next_back()).unwrap_or("");
    let name: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')).collect();
    if name.is_empty() || name.len() > 200 || !name.to_ascii_lowercase().ends_with(".exe") {
        return Err("下载地址必须是安装包 (.exe) 直链".to_string());
    }
    Ok(name)
}

pub fn expected_digest(digest: Option<&str>) -> Result<Option<String>, String> {
    match digest.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) => Ok(Some(s.to_ascii_lowercase())),
        Some(_) => Err("安装包 SHA256 格式错误，已拒绝跳过校验".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_and_fragment_urls_use_path_filename() {
        for suffix in ["", "?token=fixture", "#download", "?token=fixture#download"] {
            assert_eq!(installer_filename(&format!("https://example.invalid/setup.exe{}", suffix)).unwrap(), "setup.exe");
        }
        assert!(installer_filename("http://example.invalid/setup.exe").is_err());
        assert!(installer_filename("https://example.invalid/setup.zip?name=setup.exe").is_err());
    }
    #[test]
    fn malformed_supplied_digest_is_an_error() {
        assert_eq!(expected_digest(None).unwrap(), None);
        assert!(expected_digest(Some("invalid")).is_err());
        assert_eq!(expected_digest(Some(&"A".repeat(64))).unwrap(), Some("a".repeat(64)));
    }
}
