use winreg::enums::*;
use winreg::RegKey;

pub fn get_machine_guid() -> String {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(crypto) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
        if let Ok(guid) = crypto.get_value::<String, _>("MachineGuid") {
            let clean = guid.trim().replace('-', "").to_uppercase();
            if !clean.is_empty() {
                return clean;
            }
        }
    }

    // 备用：组合计算机名与用户名生成唯一标识
    let comp = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "DEVICE".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "USER".to_string());
    format!("CFD_{}_{}", comp, user)
}
