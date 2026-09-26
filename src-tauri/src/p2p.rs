use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DEFAULT_PUBLIC_TOKEN: u64 = 11602319472897248650;
const DEFAULT_SERVER_HOST: &str = "api.openp2p.cn";
const DEFAULT_SERVER_PORT: u32 = 27183;

static ACTIVE_P2P_CHILD: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pNetworkConfig {
    #[serde(rename = "Token")]
    pub token: u64,
    #[serde(rename = "Node")]
    pub node: String,
    #[serde(rename = "User")]
    pub user: String,
    #[serde(rename = "ShareBandwidth")]
    pub share_bandwidth: u32,
    #[serde(rename = "ServerHost")]
    pub server_host: String,
    #[serde(rename = "ServerPort")]
    pub server_port: u32,
    #[serde(rename = "PublicIPPort")]
    pub public_ip_port: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pAppConfig {
    #[serde(rename = "AppName")]
    pub app_name: String,
    #[serde(rename = "PeerNode")]
    pub peer_node: String,
    #[serde(rename = "DstHost")]
    pub dst_host: String,
    #[serde(rename = "DstPort")]
    pub dst_port: u16,
    #[serde(rename = "SrcPort")]
    pub src_port: u16,
    #[serde(rename = "Protocol")]
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pFullConfig {
    #[serde(rename = "Network")]
    pub network: P2pNetworkConfig,
    #[serde(rename = "Apps")]
    pub apps: Vec<P2pAppConfig>,
    #[serde(rename = "LogLevel")]
    pub log_level: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pTunnelPayload {
    pub peer_uid: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub protocol: String,
    pub game_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pStatusInfo {
    pub running: bool,
    pub node_id: String,
    pub exe_found: bool,
    pub active_tunnels: Vec<P2pAppConfig>,
    pub binary_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedShareCode {
    pub uid: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub protocol: String,
    pub game_name: String,
}

fn get_p2p_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(base).join("com.chunfengdu.app").join("openp2p");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn locate_openp2p_bin() -> Option<PathBuf> {
    // 1. 优先当前工作目录 assets/tools/openp2p/openp2p.exe
    let local_path = PathBuf::from("src-tauri/assets/tools/openp2p/openp2p.exe");
    if local_path.is_file() {
        return Some(local_path.canonicalize().unwrap_or(local_path));
    }

    // 2. 检查可执行程序所在目录相对 tools/openp2p/openp2p.exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p1 = dir.join("assets").join("tools").join("openp2p").join("openp2p.exe");
            if p1.is_file() {
                return Some(p1);
            }
            let p2 = dir.join("tools").join("openp2p").join("openp2p.exe");
            if p2.is_file() {
                return Some(p2);
            }
            let p3 = dir.join("openp2p.exe");
            if p3.is_file() {
                return Some(p3);
            }
        }
    }

    // 3. 检查系统全局 Program Files 安装路径
    let sys_path = PathBuf::from(r"C:\Program Files\OpenP2P\openp2p.exe");
    if sys_path.is_file() {
        return Some(sys_path);
    }

    None
}

/// 获取或生成唯一的 16 位小写十六进制 UID
pub fn get_or_generate_node_id() -> String {
    let dir = get_p2p_dir();
    let config_file = dir.join("config.json");
    if config_file.is_file() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(node) = val.get("Network").and_then(|n| n.get("Node")).and_then(|n| n.as_str()) {
                    let trimmed = node.trim();
                    if !trimmed.is_empty() {
                        return trimmed.to_string();
                    }
                }
            }
        }
    }

    // 生成稳定随机 16 位十六进制字符串
    let machine_id = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "CFD_PC".to_string());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seed = format!("{}_{}_{}", machine_id, now, std::process::id());
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let hex_full = format!("{:x}", hasher.finalize());
    let node_id = hex_full[..16].to_lowercase();

    // 初始化写入默认配置文件
    let default_cfg = P2pFullConfig {
        network: P2pNetworkConfig {
            token: DEFAULT_PUBLIC_TOKEN,
            node: node_id.clone(),
            user: "cfd_user".to_string(),
            share_bandwidth: 10,
            server_host: DEFAULT_SERVER_HOST.to_string(),
            server_port: DEFAULT_SERVER_PORT,
            public_ip_port: 0,
        },
        apps: Vec::new(),
        log_level: 1,
    };
    if let Ok(json_str) = serde_json::to_string_pretty(&default_cfg) {
        let _ = fs::write(&config_file, json_str);
    }

    node_id
}

fn read_current_config() -> P2pFullConfig {
    let dir = get_p2p_dir();
    let config_file = dir.join("config.json");
    let node_id = get_or_generate_node_id();

    if config_file.is_file() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(cfg) = serde_json::from_str::<P2pFullConfig>(&content) {
                return cfg;
            }
        }
    }

    P2pFullConfig {
        network: P2pNetworkConfig {
            token: DEFAULT_PUBLIC_TOKEN,
            node: node_id,
            user: "cfd_user".to_string(),
            share_bandwidth: 10,
            server_host: DEFAULT_SERVER_HOST.to_string(),
            server_port: DEFAULT_SERVER_PORT,
            public_ip_port: 0,
        },
        apps: Vec::new(),
        log_level: 1,
    }
}

fn save_config(cfg: &P2pFullConfig) -> Result<(), String> {
    let dir = get_p2p_dir();
    let config_file = dir.join("config.json");
    let json_str = serde_json::to_string_pretty(cfg).map_err(|e| format!("配置序列化失败: {}", e))?;
    fs::write(&config_file, json_str).map_err(|e| format!("写入配置文件失败: {}", e))
}

pub fn is_p2p_running() -> bool {
    let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return true,
            _ => {
                *guard = None;
            }
        }
    }

    // 辅助检查系统进程是否有我们目录拉起的 openp2p
    false
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 优雅停止所有由本客户端启动的 openp2p 实例
pub fn stop_p2p() -> Result<bool, String> {
    let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    // 强行清理残留可能挂起的独立进程（仅在用户显式断开时）
    let _ = Command::new("taskkill")
        .args(&["/F", "/IM", "openp2p.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    Ok(true)
}

/// 启动 openp2p 守护模式（房主或待命监听状态）
pub fn start_p2p_daemon() -> Result<bool, String> {
    stop_p2p()?;

    let exe_path = locate_openp2p_bin().ok_or_else(|| "未找到 openp2p.exe 组件，请检查 assets/tools 目录".to_string())?;
    let dir = get_p2p_dir();

    // 确保配置文件存在
    let _ = read_current_config();

    let child = Command::new(&exe_path)
        .arg("-d")
        .current_dir(&dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动 openp2p 失败: {}", e))?;

    let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
    *guard = Some(child);

    Ok(true)
}

/// 建立对端隧道（客机连接房主）
pub fn connect_tunnel(payload: P2pTunnelPayload) -> Result<P2pAppConfig, String> {
    let mut cfg = read_current_config();
    let clean_peer = payload.peer_uid.trim().to_lowercase();
    if clean_peer.is_empty() {
        return Err("目标 UID 不能为空".to_string());
    }

    let protocol = payload.protocol.to_lowercase();
    let proto = if protocol.contains("udp") { "udp" } else { "tcp" };
    let app_name = format!("cfd_{}", payload.remote_port);

    // 移除已有相同端口或相同 AppName 的旧配置
    cfg.apps.retain(|a| a.src_port != payload.local_port && a.app_name != app_name);

    let new_app = P2pAppConfig {
        app_name: app_name.clone(),
        peer_node: clean_peer,
        dst_host: "127.0.0.1".to_string(),
        dst_port: payload.remote_port,
        src_port: payload.local_port,
        protocol: proto.to_string(),
    };

    cfg.apps.push(new_app.clone());
    save_config(&cfg)?;

    // 重启进程以加载新隧道
    start_p2p_daemon()?;

    Ok(new_app)
}

/// 断开指定的隧道
pub fn remove_tunnel(local_port: u16) -> Result<bool, String> {
    let mut cfg = read_current_config();
    let len_before = cfg.apps.len();
    cfg.apps.retain(|a| a.src_port != local_port);
    if cfg.apps.len() != len_before {
        save_config(&cfg)?;
        start_p2p_daemon()?;
    }
    Ok(true)
}

/// 获取全局 P2P 运行状态
pub fn get_status() -> P2pStatusInfo {
    let exe = locate_openp2p_bin();
    let node_id = get_or_generate_node_id();
    let cfg = read_current_config();
    let running = is_p2p_running();

    P2pStatusInfo {
        running,
        node_id,
        exe_found: exe.is_some(),
        active_tunnels: cfg.apps,
        binary_path: exe.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        message: if running {
            "P2P 隧道服务正在运行中".to_string()
        } else {
            "P2P 隧道服务未启动".to_string()
        },
    }
}

/// 生成分享联机码 (CFD://Base64)
pub fn generate_share_code(
    uid: &str,
    remote_port: u16,
    local_port: u16,
    protocol: &str,
    game_name: &str,
) -> String {
    let raw = serde_json::json!({
        "uid": uid.trim(),
        "remotePort": remote_port,
        "localPort": local_port,
        "protocol": protocol.trim().to_lowercase(),
        "gameName": game_name.trim(),
    });
    let json_bytes = raw.to_string();
    let b64 = base64::engine::general_purpose::STANDARD.encode(json_bytes.as_bytes());
    format!("CFD://{}", b64)
}

/// 解析分享联机码（向下兼容 CFD:// 与 OPL:// 格式）
pub fn parse_share_code(code_str: &str) -> Result<ParsedShareCode, String> {
    let trimmed = code_str.trim();
    let b64_part = if let Some(stripped) = trimmed.strip_prefix("CFD://") {
        stripped
    } else if let Some(stripped) = trimmed.strip_prefix("cfd://") {
        stripped
    } else if let Some(stripped) = trimmed.strip_prefix("OPL://") {
        stripped
    } else if let Some(stripped) = trimmed.strip_prefix("opl://") {
        stripped
    } else {
        trimmed
    };

    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(b64_part)
        .map_err(|_| "联机码 Base64 格式无效，请检查复制内容".to_string())?;

    let text = String::from_utf8(decoded_bytes)
        .map_err(|_| "联机码文本编码无效".to_string())?;

    // 优先尝试 JSON 格式
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        let uid = v.get("uid").and_then(|u| u.as_str()).unwrap_or("").to_string();
        let remote_port = v.get("remotePort")
            .or_else(|| v.get("Sport"))
            .or_else(|| v.get("port"))
            .and_then(|p| p.as_u64())
            .unwrap_or(0) as u16;
        let local_port = v.get("localPort")
            .or_else(|| v.get("Cport"))
            .and_then(|p| p.as_u64())
            .unwrap_or(remote_port as u64) as u16;
        let protocol = v.get("protocol")
            .or_else(|| v.get("type"))
            .and_then(|p| p.as_str())
            .unwrap_or("udp")
            .to_string();
        let game_name = v.get("gameName")
            .or_else(|| v.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("自定义游戏")
            .to_string();

        if !uid.is_empty() && remote_port > 0 {
            return Ok(ParsedShareCode {
                uid,
                remote_port,
                local_port,
                protocol,
                game_name,
            });
        }
    }

    // 备用尝试简单分隔符格式：uid:port:protocol
    let parts: Vec<&str> = text.split(':').collect();
    if parts.len() >= 2 {
        let uid = parts[0].trim().to_string();
        let remote_port = parts[1].trim().parse::<u16>().unwrap_or(0);
        let proto = if parts.len() >= 3 { parts[2].trim().to_string() } else { "udp".to_string() };
        if !uid.is_empty() && remote_port > 0 {
            return Ok(ParsedShareCode {
                uid,
                remote_port,
                local_port: remote_port,
                protocol: proto,
                game_name: "自定义联机".to_string(),
            });
        }
    }

    Err("无法识别的联机码数据格式".to_string())
}

/// 检查 Windows 防火墙是否存在春风度 P2P 放行规则
pub fn check_firewall_rule() -> bool {
    let output = Command::new("netsh")
        .args(&["advfirewall", "firewall", "show", "rule", "name=ChunFengDu P2P"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    if let Ok(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        return stdout.contains("ChunFengDu P2P") || stdout.contains("规则名称");
    }
    false
}

/// 自动向 Windows 防火墙添加入站规则放行 openp2p
pub fn allow_firewall_rule() -> Result<bool, String> {
    let bin = locate_openp2p_bin().ok_or_else(|| "未找到 openp2p 可执行文件".to_string())?;
    let bin_str = bin.to_string_lossy();

    let output = Command::new("netsh")
        .args(&[
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=ChunFengDu P2P",
            "dir=in",
            "action=allow",
            &format!("program={}", bin_str),
            "enable=yes",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行防火墙放行失败: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("防火墙配置未成功: {}", err))
    }
}
