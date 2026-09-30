use std::path::Path;

/// 缓存归属于规范化的 Steam 根目录；旧缓存缺少此字段时不复用。
pub fn path_key(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let text = resolved.to_string_lossy().replace('\\', "/");
    let text = text.trim_start_matches("//?/").trim_end_matches('/');
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_identity_changes_with_steam_directory() {
        assert_ne!(
            path_key(Path::new("C:/Steam-A")),
            path_key(Path::new("C:/Steam-B"))
        );
        assert_ne!(path_key(Path::new("C:/Steam-A")), "");
        assert_eq!(
            path_key(Path::new("C:/Steam-A/")),
            path_key(Path::new("C:/Steam-A"))
        );
    }
}
