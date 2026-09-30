//! 原始配置恢复：只有复制成功后才删除备份；错误由调用方展示并中止启动。
use std::fs;
use std::path::Path;

fn restore_appid_file(dir: &Path) -> Result<(), String> {
    let target = dir.join("steam_appid.txt");
    let backup = dir.join("steam_appid.txt.cfd_bak");
    if backup.try_exists().map_err(|e| format!("检查备份失败 {}: {}", backup.display(), e))? {
        fs::copy(&backup, &target)
            .map_err(|e| format!("还原失败，原备份已保留 {}: {}", backup.display(), e))?;
        fs::remove_file(&backup)
            .map_err(|e| format!("原文件已还原，清理备份失败 {}: {}", backup.display(), e))?;
    } else if target.try_exists().map_err(|e| format!("检查文件失败 {}: {}", target.display(), e))? {
        let content = fs::read_to_string(&target)
            .map_err(|e| format!("读取原配置失败 {}: {}", target.display(), e))?;
        // 没有备份时只删除工具写入的值，保留用户自建配置。
        if content.trim() == "480" {
            fs::remove_file(&target)
                .map_err(|e| format!("清理配置失败 {}: {}", target.display(), e))?;
        }
    }
    Ok(())
}

pub fn restore_appid_tree(root: &Path) -> Result<(), String> {
    fn walk(dir: &Path, depth: usize) -> Result<(), String> {
        restore_appid_file(dir)?;
        if depth >= 3 { return Ok(()); }
        let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
            let kind = entry.file_type().map_err(|e| format!("读取文件类型失败: {}", e))?;
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if kind.is_dir() && !kind.is_symlink()
                && !["_redist", "directx", "support", "redist", ".git", "node_modules", ".cfd_patch_backup"].contains(&name.as_str()) {
                walk(&entry.path(), depth + 1)?;
            }
        }
        Ok(())
    }
    walk(root, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cfd-restore-{}-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn restores_nested_backups_and_preserves_unowned_values() {
        let root = fixture();
        let nested = root.join("Binaries/Win64");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("steam_appid.txt"), "67890").unwrap();
        fs::write(nested.join("steam_appid.txt"), "480").unwrap();
        fs::write(nested.join("steam_appid.txt.cfd_bak"), "12345").unwrap();
        restore_appid_tree(&root).unwrap();
        assert_eq!(fs::read_to_string(root.join("steam_appid.txt")).unwrap(), "67890");
        assert_eq!(fs::read_to_string(nested.join("steam_appid.txt")).unwrap(), "12345");
        assert!(!nested.join("steam_appid.txt.cfd_bak").exists());
        restore_appid_tree(&root).unwrap(); // 重试/重复调用保持幂等。
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_failure_retains_backup_and_can_be_retried() {
        let root = fixture();
        let target = root.join("steam_appid.txt");
        let backup = root.join("steam_appid.txt.cfd_bak");
        fs::create_dir(&target).unwrap(); // 确定性制造复制失败。
        fs::write(&backup, "12345").unwrap();
        assert!(restore_appid_tree(&root).is_err());
        assert_eq!(fs::read_to_string(&backup).unwrap(), "12345");
        fs::remove_dir(&target).unwrap();
        restore_appid_tree(&root).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "12345");
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removes_only_owned_value_without_backup() {
        let root = fixture();
        fs::write(root.join("steam_appid.txt"), "480\n").unwrap();
        restore_appid_tree(&root).unwrap();
        assert!(!root.join("steam_appid.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
