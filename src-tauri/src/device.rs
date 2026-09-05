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
pub fn get_device_id() -> String {
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
    let mut buffer: Vec<u8>;
    // ERROR_BUFFER_OVERFLOW 重试加上限：API 异常时避免死循环
    let mut retries = 0u8;
    loop {
        buffer = vec![0u8; size as usize];
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
        assert_eq!(id.len(), 19);
        println!("本机设备码: {}", id);
    }
}
