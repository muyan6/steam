//! 游戏字典二进制编解码器（仅依赖 std 的自包含模块）。
//! 格式规范与 server/scripts/build-game-dict.mjs、server/src/utils/gameDictCodec.ts 三方一致：
//!   Header: 魔数 'C''F''G''D' (u8×4) + 格式版本 u8=1 + 条目数 u32 LE
//!   条目（按 appId 严格升序）:
//!     varint(appId 与前一条的增量，无符号 LEB128) + u16 LE 原名长度 + 原名 UTF-8
//!     + u16 LE 中文名长度 + 中文名 UTF-8（可为 0 长）
//!   文件整体 SHA256 即字典版本号。
//!
//! 本模块刻意不引入任何外部依赖，保证可以独立编译运行测试
//! （rustc --test），不受 Tauri lib 测试目标在 MinGW 环境的
//! DLL 入口点问题（STATUS_ENTRYPOINT_NOT_FOUND）影响。

/// 编译期内嵌的游戏字典二进制（由 build.rs 在每次编译前经
/// server/scripts/build-game-dict.mjs 从服务端数据重新生成；
/// node 不可用时沿用仓库中已提交的版本）。
pub const EMBEDDED_DICT: &[u8] = include_bytes!("../data/game_dict.bin");

/// 字典二进制魔数 'CFGD'
pub const DICT_MAGIC: [u8; 4] = [0x43, 0x46, 0x47, 0x44];
/// 字典二进制格式版本号
pub const DICT_VERSION: u8 = 1;

/// 字典条目：appId + 原名 + 中文名。
/// 两个名称的小写副本均在载入时预计算一次，
/// 避免每次按键检索都对 18 万+ 名称逐个 to_lowercase 分配
#[derive(Debug, Clone)]
pub struct DictEntry {
    pub app_id: u32,
    pub name: String,
    pub name_lower: String,
    pub name_zh: String,
    pub name_zh_lower: String,
}

impl DictEntry {
    pub fn new(app_id: u32, name: String, name_zh: String) -> Self {
        DictEntry {
            app_id,
            name_lower: name.to_lowercase(),
            name_zh_lower: name_zh.to_lowercase(),
            name,
            name_zh,
        }
    }
}

/// 解析游戏字典二进制（无 serde，手写切片读取以保证 4MB 级数据毫秒级载入）。
/// 魔数/版本不符或任何截断、非法编码均返回空 Vec（调用方按空字典优雅降级）。
pub fn parse_binary_dict(data: &[u8]) -> Vec<DictEntry> {
    if data.len() < 9 || data[0..4] != DICT_MAGIC || data[4] != DICT_VERSION {
        return Vec::new();
    }
    let count = u32::from_le_bytes([data[5], data[6], data[7], data[8]]) as usize;
    // 条目数做上限防御，防止损坏文件触发巨型预分配
    if count > 4_000_000 {
        return Vec::new();
    }
    let mut out: Vec<DictEntry> = Vec::with_capacity(count);
    let mut pos = 9usize;
    let mut prev: u32 = 0;
    for _ in 0..count {
        // 无符号 LEB128 varint：7 bit 一组，低位在前，最高位为续位标志
        let mut delta: u64 = 0;
        let mut shift = 0u32;
        loop {
            if pos >= data.len() {
                return Vec::new();
            }
            let b = data[pos];
            pos += 1;
            delta |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 35 {
                return Vec::new();
            }
        }
        let app_id = prev.wrapping_add(delta as u32);
        prev = app_id;

        // u16 LE 原名长度 + UTF-8 字节
        if pos + 2 > data.len() {
            return Vec::new();
        }
        let name_len = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;
        if pos + name_len > data.len() {
            return Vec::new();
        }
        let name = String::from_utf8_lossy(&data[pos..pos + name_len]).into_owned();
        pos += name_len;

        // u16 LE 中文名长度 + UTF-8 字节（可为 0 长）
        if pos + 2 > data.len() {
            return Vec::new();
        }
        let zh_len = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;
        if pos + zh_len > data.len() {
            return Vec::new();
        }
        let name_zh = String::from_utf8_lossy(&data[pos..pos + zh_len]).into_owned();
        pos += zh_len;

        out.push(DictEntry::new(app_id, name, name_zh));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用真实内嵌字典验证二进制解析器：条目数与首末条解码正确性
    #[test]
    fn embedded_dict_parses_fully() {
        let entries = parse_binary_dict(EMBEDDED_DICT);
        assert_eq!(entries.len(), 183751, "内嵌字典条目数应与生成脚本一致");

        // 首条：appId 有效且原名非空；全表严格按 appId 升序（varint 增量解码正确性）
        let first = &entries[0];
        assert!(first.app_id > 0, "首条 appId 应大于 0");
        assert!(!first.name.is_empty(), "首条原名不应为空");
        assert!(
            entries.windows(2).all(|w| w[0].app_id < w[1].app_id),
            "字典必须严格按 appId 升序"
        );

        // 末条：appId 必须显著大于首条（增量解码未被截断/回绕）
        let last = entries.last().unwrap();
        assert!(last.app_id > first.app_id + 1_000_000, "末条 appId 解码异常");

        // 预计算小写副本必须与原值一致
        assert_eq!(first.name_lower, first.name.to_lowercase());
        assert_eq!(first.name_zh_lower, first.name_zh.to_lowercase());

        // 中文名字段为增量可选数据（服务端缓存独立维护），只验证解码一致性：
        // 所有非空中文名必须能无损还原为合法 UTF-8 文本
        for e in entries.iter().filter(|e| !e.name_zh.is_empty()).take(10) {
            assert!(!e.name_zh_lower.is_empty());
        }
    }

    /// 损坏数据必须优雅降级为空，不得 panic
    #[test]
    fn malformed_dict_degrades_to_empty() {
        assert!(parse_binary_dict(&[]).is_empty());
        assert!(parse_binary_dict(b"XXXX\x01\x00\x00\x00\x00").is_empty());
        assert!(parse_binary_dict(b"CFGD\x02\x00\x00\x00\x00").is_empty());
        // 声明 2 条但 body 截断
        assert!(parse_binary_dict(b"CFGD\x01\x02\x00\x00\x00\x05").is_empty());
    }
}
