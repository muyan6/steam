use sha2::{Digest, Sha256};
use winreg::enums::*;
use winreg::RegKey;

/// 获取本机唯一设备码（与 Electron 版 deviceService 完全一致的 CFD 算法）
///
/// 种子串：`win_guid_{MachineGuid}|{MAC串}|{CPU型号串}|{主机名}|win32|x64`
/// 输出格式：CFD-XXXX-XXXX-XXXX-XXXX（SHA256 前 16 位 hex 大写，4 段）
///
/// 必须逐字节复刻旧版算法：老用户的授权卡在服务端绑定的是该 ID，
/// 任何偏差都会导致已激活设备被判定为未激活。
/// 验证设备码格式是否为 CFD-XXXX-XXXX-XXXX-XXXX（`CFD-` 前缀 + 4 段各 4 位 hex，共 23 字符）。
///
/// 注意：这里**不能**用固定长度 19 去卡 —— `compute_device_id` 产出的是 4 段 hex，
/// 合法值恒为 23 字符。历史上曾写成 19，导致本函数恒为 false：持久化设备码永远
/// 读不回来、`license_cache` 自愈也被拒，设备码每次启动都重算（换网卡即丢授权）。
pub fn is_valid_device_id(id: &str) -> bool {
    let trimmed = id.trim();
    let Some(rest) = trimmed.strip_prefix("CFD-") else {
        return false;
    };
    let segs: Vec<&str> = rest.split('-').collect();
    segs.len() == 4
        && segs
            .iter()
            .all(|seg| seg.len() == 4 && seg.chars().all(|c| c.is_ascii_hexdigit()))
}

/// 设备码持久化密文前缀：`DPAPI:<std_base64(CryptProtectData(deviceId))>`。
///
/// 为什么要加密而不能明文持久化：明文设备码（`device_id.txt` / 注册表 / 授权缓存里的
/// deviceId）可以被**原样复制到另一台电脑**。设备码是密钥接口的唯一凭据，一旦可复制，
/// 攻击者把某台已激活机器的设备码文件拷到新机器，新机就会"变成"那台设备，
/// 从而免授权使用其卡密（离线验签也会通过，因为签名就是针对该 deviceId 的）。
/// DPAPI 绑定当前机器+当前用户：密文换个机器/换个用户就解密失败 → 回退硬件重算 → 拒绝冒用。
const DEVICE_ENC_PREFIX: &str = "DPAPI:";

fn encode_device_id_for_storage(id: &str) -> String {
    #[cfg(windows)]
    {
        if let Ok(blob) = crate::onlinefix::dpapi_protect(id.as_bytes()) {
            use base64::Engine;
            return format!(
                "{}{}",
                DEVICE_ENC_PREFIX,
                base64::engine::general_purpose::STANDARD.encode(blob)
            );
        }
    }
    id.to_string()
}

/// 解析持久化的设备码。
///
/// **明文一律不信任**：`device_id.txt` / 注册表里的明文设备码可以被任意复制，
/// 接受它等于把设备码变成可克隆的凭据（A4 克隆缺陷）。只有能通过 DPAPI 解密的
/// 密文才作为身份来源；解不开就当作没有持久化记录，回退硬件重算。
fn decode_device_id_from_storage(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let b64 = raw.strip_prefix(DEVICE_ENC_PREFIX)?;
    #[cfg(windows)]
    {
        use base64::Engine;
        let blob = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
        let plain = crate::onlinefix::dpapi_unprotect(&blob).ok()?;
        String::from_utf8(plain).ok()
    }
    #[cfg(not(windows))]
    {
        let _ = b64;
        None
    }
}

fn read_persisted_file() -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let path = std::path::PathBuf::from(appdata).join("com.chunfengdu.app").join("device_id.txt");
    let content = std::fs::read_to_string(path).ok()?;
    let decoded = decode_device_id_from_storage(&content)?.trim().to_uppercase();
    if is_valid_device_id(&decoded) {
        Some(decoded)
    } else {
        None
    }
}

fn write_persisted_file(id: &str) {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = std::path::PathBuf::from(appdata).join("com.chunfengdu.app");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("device_id.txt");
        let _ = std::fs::write(path, encode_device_id_for_storage(&id.trim().to_uppercase()));
    }
}

fn read_persisted_registry() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sub = hkcu.open_subkey("Software\\ChunFengDu").ok()?;
    let stored: String = sub.get_value("DeviceId").ok()?;
    let decoded = decode_device_id_from_storage(&stored)?.trim().to_uppercase();
    if is_valid_device_id(&decoded) {
        Some(decoded)
    } else {
        None
    }
}

fn write_persisted_registry(id: &str) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((sub, _)) = hkcu.create_subkey("Software\\ChunFengDu") {
        let _ = sub.set_value("DeviceId", &encode_device_id_for_storage(&id.trim().to_uppercase()));
    }
}

/// 获取本机唯一设备码（终生固化锁定 + CFD 算法）
///
/// 1. 优先读取已持久化的设备码（文件与注册表双副本，均须通过 DPAPI 解密）
/// 2. 若均无则通过硬件特征动态计算，并立即双重持久化锁定
///
/// 注意：**不再**从 `license_cache.json` 自愈设备码。那份缓存是明文 JSON、可被
/// 原样复制，而其中的 deviceId 恰好是授权签名覆盖的字段 —— 接受它等于允许
/// "拷贝一份缓存文件即可在任意新机器上克隆授权"（A4）。持久化改用 DPAPI 绑定后，
/// 正常用户的设备码漂移（换网卡等）依然由步骤 1 兜住，无需该自愈通道。
pub fn get_device_id() -> String {
    static DEVICE_ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DEVICE_ID.get_or_init(resolve_and_lock_device_id).clone()
}

fn resolve_and_lock_device_id() -> String {
    // 1. 优先读取持久化文件
    if let Some(id) = read_persisted_file() {
        write_persisted_registry(&id);
        return id;
    }

    // 2. 其次读取注册表持久化
    if let Some(id) = read_persisted_registry() {
        write_persisted_file(&id);
        return id;
    }

    // 3. 计算初始设备码
    let id = compute_device_id();

    // 4. 立即双重持久化，终身锁定
    write_persisted_file(&id);
    write_persisted_registry(&id);
    id
}

fn compute_device_id() -> String {
    // 1. MachineGuid（保留原始大小写与连字符，与旧版 reg query 捕获结果一致）
    let raw_identifier = read_machine_guid()
        .map(|g| format!("win_guid_{}", g))
        .unwrap_or_default();

    // 2. 网卡 MAC 串：跳过回环与全零 MAC；同一适配器有几条 unicast 地址就重复几次
    //    （旧版 os.networkInterfaces() 每个地址条目都携带一次 MAC）
    let mac_address = collect_mac_chain();

    // 3. CPU 型号串：HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor 逐核 ProcessorNameString
    //    （libuv 的 os.cpus() 同源同序）
    let cpu_info = collect_cpu_chain();

    // 4. 主机名（gethostname 等价于 NetBIOS 名 = COMPUTERNAME）
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "localhost".to_string());

    let combined_seed = format!(
        "{}|{}|{}|{}|win32|x64",
        raw_identifier, mac_address, cpu_info, hostname
    );

    let mut hasher = Sha256::new();
    hasher.update(combined_seed.as_bytes());
    let hash = format!("{:x}", hasher.finalize()).to_uppercase();

    format!(
        "CFD-{}-{}-{}-{}",
        &hash[0..4],
        &hash[4..8],
        &hash[8..12],
        &hash[12..16]
    )
}

fn read_machine_guid() -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
    let guid: String = crypto.get_value("MachineGuid").ok()?;
    let trimmed = guid.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// 与 libuv uv_interface_addresses 相同语义的 MAC 串联：
/// GetAdaptersAddresses(AF_UNSPEC, SKIP_ANYCAST|SKIP_MULTICAST|SKIP_DNS_SERVER)
/// 按枚举顺序遍历适配器；仅统计 OperStatus=Up 的适配器（旧版 Node 输出只含已连接适配器）；
/// 回环跳过（Node 的 internal 标志）；全零 MAC 跳过；每个适配器按其 unicast 地址条数重复 MAC。
fn collect_mac_chain() -> String {
    let mut chain = String::new();
    for (mac, unicast_count) in enumerate_adapters() {
        if unicast_count == 0 {
            continue;
        }
        if mac.iter().all(|&b| b == 0) || mac.is_empty() {
            continue;
        }
        let mac_str: String = mac
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(":");
        for _ in 0..unicast_count {
            chain.push_str(&mac_str);
        }
    }
    chain
}

/// 返回 (物理地址, unicast 地址条数) 列表，顺序与 GetAdaptersAddresses 一致
#[cfg(windows)]
fn enumerate_adapters() -> Vec<(Vec<u8>, usize)> {
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
        GAA_FLAG_SKIP_MULTICAST, IF_TYPE_SOFTWARE_LOOPBACK, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

    const FLAGS: u32 = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;

    let mut out = Vec::new();
    let mut size: u32 = 15 * 1024;
    let mut buffer: Vec<u64>;
    // ERROR_BUFFER_OVERFLOW 重试加上限：API 异常时避免死循环
    let mut retries = 0u8;
    loop {
        // 以 u64 为元素分配：IP_ADAPTER_ADDRESSES_LH 含指针成员，
        // 要求 8 字节对齐，直接 Vec<u8> 的首地址无法保证对齐（UB）。
        // u64 恒 8 字节对齐，长度向上取整覆盖 API 需要的字节数
        buffer = vec![0u64; (size as usize).div_ceil(8)];
        let rc = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                FLAGS,
                std::ptr::null_mut(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            )
        };
        if rc == NO_ERROR {
            break;
        }
        if rc == ERROR_BUFFER_OVERFLOW && retries < 5 {
            retries += 1;
            continue;
        }
        return out;
    }

    let mut ptr = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !ptr.is_null() {
        let adapter = unsafe { &*ptr };
        if adapter.IfType != IF_TYPE_SOFTWARE_LOOPBACK && adapter.OperStatus == IfOperStatusUp {
            let mac = unsafe {
                std::slice::from_raw_parts(
                    adapter.PhysicalAddress.as_ptr(),
                    adapter.PhysicalAddressLength as usize,
                )
            }
            .to_vec();
            // 统计 unicast 地址链表长度（对应 Node 每个适配器下的地址条目数）
            let mut count = 0usize;
            let mut ua = adapter.FirstUnicastAddress;
            while !ua.is_null() {
                count += 1;
                ua = unsafe { (*ua).Next };
            }
            out.push((mac, count));
        }
        ptr = adapter.Next;
    }
    out
}

/// CPU 型号串联：CentralProcessor 下逐核读取 ProcessorNameString，
/// 枚举顺序与 libuv（RegEnumKeyExW）一致，不做排序
fn collect_cpu_chain() -> String {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(root) = hklm.open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor") else {
        return String::new();
    };
    let mut models: Vec<String> = Vec::new();
    for name in root.enum_keys().flatten() {
        if let Ok(sub) = root.open_subkey(&name) {
            let model: String = sub.get_value("ProcessorNameString").unwrap_or_default();
            models.push(model);
        }
    }
    models.join("|")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_id_format() {
        let id = get_device_id();
        assert!(id.starts_with("CFD-"), "got {}", id);
        // CFD-XXXX-XXXX-XXXX-XXXX = 23 字符；校验器必须接受自身产出的格式
        assert_eq!(id.len(), 23, "got {}", id);
        assert!(is_valid_device_id(&id), "is_valid_device_id 拒绝了自身产出的设备码: {}", id);
        assert!(!is_valid_device_id("CFD-1234-5678-9ABC"), "长度不足应被拒绝");
        assert!(!is_valid_device_id("CFD-1234-5678-9ABC-0XYZ"), "非 hex 应被拒绝");
        println!("本机设备码: {}", id);
    }

    /// 防克隆回归：明文设备码一律不信任，只有 DPAPI 密文才被接受。
    ///
    /// 若这里回归（明文被接受），则把另一台已激活机器的 device_id.txt / 注册表
    /// 拷到新机器即可"变成"那台设备，冒用其卡密（A4）。
    #[test]
    fn plaintext_device_id_is_rejected() {
        let dev = "CFD-36DB-2FA8-26AB-4AA2";
        // 明文字符串与裸 base64 都不是合法存储形态
        assert_eq!(decode_device_id_from_storage(dev), None, "明文设备码必须被拒绝");
        assert_eq!(decode_device_id_from_storage(""), None);
        assert_eq!(decode_device_id_from_storage("DPAPI:"), None, "空前缀内容必须被拒绝");
        assert_eq!(decode_device_id_from_storage("DPAPI:bm90LWEtYmxvYg=="), None, "非法密文必须被拒绝");
    }

    /// 本机闭环：写入持久化后必须能原样读回（DPAPI 加密-解密往返）。
    #[test]
    fn persisted_file_roundtrip_is_machine_bound() {
        #[cfg(windows)]
        {
            let dev = compute_device_id();
            let stored = encode_device_id_for_storage(&dev);
            assert!(stored.starts_with(DEVICE_ENC_PREFIX), "持久化应为 DPAPI 密文: {}", &stored[..stored.len().min(16)]);
            assert_eq!(decode_device_id_from_storage(&stored).as_deref(), Some(dev.as_str()));
        }
    }
}
