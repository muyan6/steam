use std::fs;
use std::io::Read;
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

/// 面向前端的活跃隧道视图。
///
/// 注意：`P2pAppConfig` 的字段被显式重命名为 PascalCase（openp2p 的 config.json
/// 就长这样），字段级 rename 优先于 `rename_all`，因此它**不能**直接返回给前端 ——
/// 前端 `src/types/index.ts` 的 P2pAppConfig 声明的是 camelCase，直接返回会让
/// activeTunnels[*].srcPort / peerNode / dstPort / appName 全为 undefined。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pTunnelView {
    pub app_name: String,
    pub peer_node: String,
    pub dst_host: String,
    pub dst_port: u16,
    pub src_port: u16,
    pub protocol: String,
}

impl From<&P2pAppConfig> for P2pTunnelView {
    fn from(a: &P2pAppConfig) -> Self {
        P2pTunnelView {
            app_name: a.app_name.clone(),
            peer_node: a.peer_node.clone(),
            dst_host: a.dst_host.clone(),
            dst_port: a.dst_port,
            src_port: a.src_port,
            protocol: a.protocol.clone(),
        }
    }
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
    pub active_tunnels: Vec<P2pTunnelView>,
    pub binary_path: String,
    pub message: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Openp2pSyncInfo {
    pub current_tag: String,
    pub latest_tag: Option<String>,
    pub published_at: Option<String>,
    pub update_available: bool,
    pub running: bool,
    pub message: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pRealtimeState {
    pub stage: String, // 'idle' | 'starting' | 'punching' | 'direct' | 'relay' | 'error'
    pub nat_type: String,
    pub detail: String,
}

fn get_p2p_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(base).join("com.chunfengdu.app").join("openp2p");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn locate_openp2p_bin() -> Option<PathBuf> {
    let p2p_dir = get_p2p_dir();
    let appdata_bin = p2p_dir.join("openp2p.exe");

    // 候选的源二进制路径列表（优先寻找春风度自带并已去提权的 asInvoker 版本）
    let mut candidate_sources: Vec<PathBuf> = Vec::new();

    // 1. 编译期 CARGO_MANIFEST_DIR 绝对路径（针对本地开发 npm run tauri dev，100% 绝对命中）
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/tools/openp2p/openp2p.exe");
    candidate_sources.push(dev_path);

    // 2. 当前工作目录相对路径
    candidate_sources.push(PathBuf::from("src-tauri/assets/tools/openp2p/openp2p.exe"));
    candidate_sources.push(PathBuf::from("assets/tools/openp2p/openp2p.exe"));

    // 3. 安装包打包后可执行程序相对路径
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidate_sources.push(dir.join("assets").join("tools").join("openp2p").join("openp2p.exe"));
            candidate_sources.push(dir.join("tools").join("openp2p").join("openp2p.exe"));
            candidate_sources.push(dir.join("openp2p.exe"));
        }
    }

    // 1. 用户数据目录下已部署的引擎优先级最高。
    //    它要么是首次运行从安装包拷贝来的，要么是用户在「工具箱 → 同步最新 OpenP2P 引擎」
    //    在线升级得到的。绝不能因为「安装包里的二进制体积不同」就把它覆盖回去 ——
    //    那会把用户刚同步到的新引擎静默降级（旧实现正是按体积差异无条件覆写）。
    if is_usable_binary(&appdata_bin) {
        return Some(appdata_bin);
    }

    // 2. 数据目录尚无可用的引擎（首次运行 / 被清理）：从自带资源拷贝一份过去
    for src in candidate_sources {
        if is_usable_binary(&src) {
            if fs::copy(&src, &appdata_bin).is_ok() && is_usable_binary(&appdata_bin) {
                return Some(appdata_bin);
            }
            // 拷贝失败（只读介质 / 权限不足）时退回直接使用源文件
            return Some(src.canonicalize().unwrap_or(src));
        }
    }

    None
}

/// 真实 openp2p.exe 约 8.7MB；小于 1MB 的残留/半截文件一律视为不可用
const MIN_OPENP2P_BIN_BYTES: u64 = 1024 * 1024;

fn is_usable_binary(p: &PathBuf) -> bool {
    fs::metadata(p)
        .map(|m| m.is_file() && m.len() >= MIN_OPENP2P_BIN_BYTES)
        .unwrap_or(false)
}

fn get_stable_machine_seed() -> String {
    #[cfg(windows)]
    {
        // 尝试从 Windows 注册表获取永久唯一的 MachineGuid
        if let Ok(output) = Command::new("powershell")
            .args(&["-NoProfile", "-Command", "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if output.status.success() {
                let guid = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !guid.is_empty() {
                    return guid;
                }
            }
        }
    }

    let comp = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "CFD_PC".to_string());
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "USER".to_string());
    format!("{}_{}", comp, user)
}

/// 获取或生成唯一的 16 位小写十六进制 UID（永久固化硬件指纹）
pub fn get_or_generate_node_id() -> String {
    let dir = get_p2p_dir();
    let node_file = dir.join("node_id.txt");

    // 1. 优先读取已持久化固化的 node_id.txt 文件
    if node_file.is_file() {
        if let Ok(content) = fs::read_to_string(&node_file) {
            let trimmed = content.trim();
            if trimmed.len() >= 12 {
                return trimmed.to_string();
            }
        }
    }

    // 2. 检查现有 config.json 中是否已有节点 ID（若有，将其固化至 node_id.txt 保持不变）
    let config_file = dir.join("config.json");
    if config_file.is_file() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(node) = val.get("Network").and_then(|n| n.get("Node")).and_then(|n| n.as_str()) {
                    let trimmed = node.trim();
                    if trimmed.len() >= 12 {
                        let _ = fs::write(&node_file, trimmed);
                        return trimmed.to_string();
                    }
                }
            }
        }
    }

    // 3. 基于本机唯一物理硬件标识 MachineGuid 生成永久固定 16 位十六进制字符串
    let seed = get_stable_machine_seed();
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let hex_full = format!("{:x}", hasher.finalize());
    let node_id = hex_full[..16].to_lowercase();

    // 写入永久固化文件
    let _ = fs::write(&node_file, &node_id);

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

/// 结束整个进程树。
///
/// openp2p 以 `-d` 启动时会再 fork 一个 `-nv` worker（实测 daemon 与 worker 是两个进程），
/// 只 kill 直接子进程会留下孤儿 worker 继续占用 1919 / 27183 端口，导致下次启动 bind 失败。
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(&["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

/// 仅清理「本应用数据目录下」的 openp2p 实例（崩溃/强退后的残留）。
///
/// 绝不使用 `taskkill /IM openp2p.exe`：那会把用户自己、或 Guailoudou / OPL 等
/// 第三方联机工具拉起的同名进程一起杀掉，直接切断别人正在使用的隧道。
/// 这里按可执行文件全路径精确匹配，只动我们自己部署的那一份。
#[cfg(windows)]
fn kill_own_openp2p_instances() {
    let target = get_p2p_dir().join("openp2p.exe");
    let target_lit = target.to_string_lossy().replace('\'', "''").to_lowercase();
    let script = format!(
        "Get-CimInstance Win32_Process -Filter \"Name='openp2p.exe'\" | Where-Object {{ $_.ExecutablePath -and $_.ExecutablePath.ToLower() -eq '{}' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}",
        target_lit
    );
    let _ = Command::new("powershell")
        .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(windows))]
fn kill_own_openp2p_instances() {}

/// 优雅停止所有由本客户端启动的 openp2p 实例
pub fn stop_p2p() -> Result<bool, String> {
    {
        let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
        if let Some(mut child) = guard.take() {
            // 先连子进程（worker）一起杀，再收割句柄
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // 兜底：清理本应用目录下因崩溃/强退残留的实例（含 taskkill 未及杀掉的 worker）
    kill_own_openp2p_instances();

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
        .map_err(|e| format!("启动 openp2p 失败 (路径: {}): {}", exe_path.display(), e))?;

    let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
    *guard = Some(child);

    Ok(true)
}

/// 建立对端隧道（客机连接房主）
pub fn connect_tunnel(payload: P2pTunnelPayload) -> Result<P2pTunnelView, String> {
    let mut cfg = read_current_config();
    let clean_peer = payload.peer_uid.trim().to_lowercase();
    if clean_peer.is_empty() {
        return Err("目标 UID 不能为空".to_string());
    }
    if payload.remote_port == 0 || payload.local_port == 0 {
        return Err("端口号必须为 1-65535".to_string());
    }

    let protocol = payload.protocol.to_lowercase();
    let proto = if protocol.contains("udp") { "udp" } else { "tcp" };

    // AppName 是 openp2p 配置里的条目标识，必须逐隧道唯一：
    // 旧实现只用 "cfd_{远端端口}"，两台主机都用同一游戏默认端口时，
    // 后加入的隧道会把先前的条目顶掉（常用房间列表里两条都在，实际只剩一条 active）。
    let peer_short: String = clean_peer.chars().take(8).collect();
    let app_name = format!("cfd_{}_{}", payload.remote_port, peer_short);

    // 同一主机 + 同一远端端口视为同一条隧道的重复添加（原地更新）；
    // 本地端口冲突也一并移除 —— 两条隧道不可能同时监听同一个本地端口。
    cfg.apps.retain(|a| {
        !(a.peer_node == clean_peer && a.dst_port == payload.remote_port) && a.src_port != payload.local_port
    });

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

    Ok(P2pTunnelView::from(&new_app))
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
        active_tunnels: cfg.apps.iter().map(P2pTunnelView::from).collect(),
        binary_path: exe.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        message: if running {
            "P2P 隧道服务正在运行中".to_string()
        } else {
            "P2P 隧道服务未启动".to_string()
        },
        version: read_deployed_openp2p_tag(),
    }
}

/// 获取当前实时连接与打洞状态（分析 openp2p 日志）
pub fn get_realtime_state() -> P2pRealtimeState {
    let running = is_p2p_running();
    if !running {
        return P2pRealtimeState {
            stage: "idle".to_string(),
            nat_type: "未检测".to_string(),
            detail: "服务待命中".to_string(),
        };
    }

    let dir = get_p2p_dir();
    // 注意：openp2p 会 fork 出 worker 进程，日志由 worker 写；
    // daemon 自己的 daemon.log 只有启动信息，真实打洞状态一律在 openp2p.log。
    let log_file = dir.join("log").join("openp2p.log");
    if !log_file.is_file() {
        return P2pRealtimeState {
            stage: "starting".to_string(),
            nat_type: "检测中".to_string(),
            detail: "服务已启动，等待网络就绪...".to_string(),
        };
    }

    let content = match fs::read_to_string(&log_file) {
        Ok(c) => c,
        Err(_) => {
            return P2pRealtimeState {
                stage: "starting".to_string(),
                nat_type: "检测中".to_string(),
                detail: "服务运行中".to_string(),
            };
        }
    };

    let lines: Vec<&str> = content.lines().rev().take(30).collect();
    let mut nat = "检测中".to_string();
    let mut stage = "starting".to_string();
    let mut detail = "服务已启动，节点已上线".to_string();

    // 逆序查找 NAT 类型
    for line in &lines {
        if line.contains("NAT type:") {
            if let Some(pos) = line.find("NAT type:") {
                let sub = &line[pos + 9..];
                let num_str: String = sub.chars().take_while(|c| c.is_digit(10)).collect();
                if let Ok(n) = num_str.parse::<u32>() {
                    nat = match n {
                        1 => "NAT 1 (全锥型 · 极佳)".to_string(),
                        2 => "NAT 2 (受限锥型 · 良好)".to_string(),
                        3 => "NAT 3 (端口受限 · 正常)".to_string(),
                        4 => "NAT 4 (对称型 · 需中继)".to_string(),
                        _ => format!("NAT {}", n),
                    };
                    break;
                }
            }
        }
    }

    // 逆序查找最新隧道连接状态
    for line in &lines {
        if line.contains("Punch ok") || line.contains("TCP4 Punch ok") || line.contains("UDP Punch ok") {
            stage = "direct".to_string();
            detail = "P2P 隧道已成功直连！(Direct Connected)".to_string();
            break;
        } else if line.contains("relay") || line.contains("Relay") || line.contains("share node") {
            stage = "relay".to_string();
            detail = "已自动切换为公网共享节点中继转发".to_string();
            break;
        } else if line.contains("try TCP4 Punch") || line.contains("try UDP Punch") || line.contains("punching") {
            stage = "punching".to_string();
            detail = "正在与对端节点打洞握手中...".to_string();
            break;
        } else if line.contains("read msg error") || line.contains("connect error") {
            // 注意：不要把裸 "timeout" 判为错误 —— 中继/共享节点的正常心跳日志里
            // 也会出现 timeout，会把「已在中继转发」误报成「握手失败」。
            stage = "error".to_string();
            detail = "打洞握手暂时超时，正在自动重试...".to_string();
            break;
        } else if line.contains("login ok") {
            stage = "starting".to_string();
            detail = "节点已登录公网信令网络，随时可被连接".to_string();
        }
    }

    P2pRealtimeState {
        stage,
        nat_type: nat,
        detail,
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

/// 检查 Windows 防火墙是否存在春风度 P2P 放行规则。
///
/// 判定依据是 netsh 的**退出码**，而不是解析输出文本：
/// 实测 `netsh advfirewall firewall show rule name="<不存在>"` 输出
/// `No rules match the specified criteria.` 且 exit=1，与规则是否存在无关 ——
/// 旧实现用 `stdout.contains("规则名称")` 判定，英文系统上表头是 `Rule Name`，
/// 必然恒为 false（即便规则已存在也会一直提示「未放行」）。
pub fn check_firewall_rule() -> bool {
    let output = Command::new("netsh")
        .args(&["advfirewall", "firewall", "show", "rule", "name=ChunFengDu P2P"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
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

// ==================== OpenP2P 联机引擎在线同步 ====================

const OPENP2P_REPO: &str = "openp2p-cn/openp2p";

/// 随应用内置的 OpenP2P 引擎版本号。
///
/// 仅作为「本地既没有 p2p_version.txt、也执行不了 -v」时的最后兜底展示值；
/// 一旦引擎被部署/在线同步过，真实版本会写入 p2p_version.txt 覆盖它。
const BUNDLED_OPENP2P_VERSION: &str = "v3.25.11";

/// 版本号归一化：GitHub 的 tag_name 可能带也可能不带 `v` 前缀
/// （如 `3.25.11` vs `v3.25.11`）。不做归一化直接比较字符串，
/// 会出现 current=`v3.25.11` / latest=`3.25.11` 恒不相等 ——
/// 界面永远显示「可更新」，每点一次同步就白下 8.7MB 并重写版本文件，死循环。
fn normalize_tag(tag: &str) -> String {
    tag.trim().trim_start_matches(['v', 'V']).to_string()
}

/// 已解析出的引擎版本号缓存。
///
/// 前端 P2P 面板每 3 秒轮询一次状态，而 `read_deployed_openp2p_tag` 在缺少
/// p2p_version.txt 时会 **spawn 一个 openp2p.exe 进程** 来读 `-v` —— 不缓存的话
/// 就是每 3 秒起一个进程。这里缓存首次结果，同步/部署后由调用方显式失效。
static DEPLOYED_TAG_CACHE: Mutex<Option<String>> = Mutex::new(None);

fn invalidate_deployed_tag_cache() {
    if let Ok(mut guard) = DEPLOYED_TAG_CACHE.lock() {
        *guard = None;
    }
}

/// 读取本地当前部署的 OpenP2P 版本号（优先从 p2p_version.txt 读取，否则尝试执行 -v）
pub fn read_deployed_openp2p_tag() -> String {
    if let Ok(guard) = DEPLOYED_TAG_CACHE.lock() {
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
    }

    let tag = detect_deployed_openp2p_tag();
    if let Ok(mut guard) = DEPLOYED_TAG_CACHE.lock() {
        *guard = Some(tag.clone());
    }
    tag
}

fn detect_deployed_openp2p_tag() -> String {
    let p2p_dir = get_p2p_dir();
    let version_file = p2p_dir.join("p2p_version.txt");
    if let Ok(v) = fs::read_to_string(&version_file) {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return if trimmed.starts_with('v') {
                trimmed.to_string()
            } else {
                format!("v{}", trimmed)
            };
        }
    }

    // 若无 version.txt，尝试运行 openp2p.exe -v
    if let Some(exe) = locate_openp2p_bin() {
        if let Ok(out) = Command::new(&exe)
            .arg("-v")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() && text.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                // -v 只输出纯版本号，可能带前导 "v" 也可能不带；统一存成 vX.Y.Z
                let tag = format!("v{}", normalize_tag(&text));
                let _ = fs::write(&version_file, &tag);
                return tag;
            }
        }
    }

    BUNDLED_OPENP2P_VERSION.to_string()
}

/// 检查 OpenP2P 联机引擎在线同步状态（当前版本 vs GitHub / 镜像最新 release）
pub fn check_openp2p_sync() -> Openp2pSyncInfo {
    let current_tag = read_deployed_openp2p_tag();
    let running = is_p2p_running();

    match fetch_latest_openp2p_release() {
        Ok((latest_tag, published_at, _asset, _digest)) => Openp2pSyncInfo {
            update_available: normalize_tag(&latest_tag) != normalize_tag(&current_tag),
            current_tag,
            latest_tag: Some(latest_tag),
            published_at,
            running,
            message: None,
        },
        Err(e) => Openp2pSyncInfo {
            current_tag,
            latest_tag: None,
            published_at: None,
            update_available: false,
            running,
            message: Some(e),
        },
    }
}

/// 查询 OpenP2P 官方最新 Release 信息（带 GitHub 直链、加速镜像与服务端兜底中转）
fn fetch_latest_openp2p_release() -> Result<(String, Option<String>, String, Option<String>), String> {
    let endpoints = [
        format!("https://api.github.com/repos/{}/releases/latest", OPENP2P_REPO),
        format!("https://gh-proxy.com/https://api.github.com/repos/{}/releases/latest", OPENP2P_REPO),
    ];

    for ep in &endpoints {
        let resp_res = crate::manifests::block_on(
            crate::manifests::http_client()
                .get(ep)
                .timeout(std::time::Duration::from_secs(8))
                .header("User-Agent", "chunfengdu")
                .header("Accept", "application/vnd.github+json")
                .send(),
        );

        if let Ok(resp) = resp_res {
            if resp.status().is_success() {
                if let Ok(json) = crate::manifests::block_on(resp.json::<serde_json::Value>()) {
                    if let Some(tag) = json.get("tag_name").and_then(|t| t.as_str()) {
                        let published = json.get("published_at").and_then(|p| p.as_str()).map(|s| s.to_string());
                        if let Some(assets) = json.get("assets").and_then(|a| a.as_array()) {
                            let picked = assets.iter().find(|a| {
                                a.get("name")
                                    .and_then(|n| n.as_str())
                                    .map_or(false, |name| name.contains("windows-amd64.zip") || name.contains("windows-amd64"))
                            });
                            if let Some(asset_obj) = picked {
                                let asset_name = asset_obj.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                                let digest = asset_obj
                                    .get("digest")
                                    .and_then(|d| d.as_str())
                                    .and_then(|d| d.strip_prefix("sha256:"))
                                    .map(|s| s.trim().to_ascii_lowercase())
                                    .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
                                return Ok((tag.to_string(), published, asset_name, digest));
                            }
                        }
                    }
                }
            }
        }
    }

    // 最终兜底：经春风渡服务器中转查询
    let relay_url = format!("{}/api/openp2p/latest", crate::manifests::SERVER_API);
    if let Ok(resp) = crate::manifests::block_on(
        crate::manifests::http_client()
            .get(&relay_url)
            .timeout(std::time::Duration::from_secs(10))
            .header("User-Agent", "chunfengdu")
            .header("x-device-id", crate::device::get_device_id())
            .send(),
    ) {
        if let Ok(json) = crate::manifests::block_on(resp.json::<serde_json::Value>()) {
            if json.get("success").and_then(|v| v.as_bool()) == Some(true) {
                if let (Some(tag), Some(asset)) = (
                    json.get("tag").and_then(|t| t.as_str()),
                    json.get("asset").and_then(|a| a.as_str()),
                ) {
                    if !tag.is_empty() && !asset.is_empty() {
                        let published = json.get("publishedAt").and_then(|p| p.as_str()).map(|s| s.to_string());
                        let digest = json
                            .get("digest")
                            .and_then(|d| d.as_str())
                            .and_then(|d| d.strip_prefix("sha256:"))
                            .map(|s| s.trim().to_ascii_lowercase())
                            .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
                        return Ok((tag.to_string(), published, asset.to_string(), digest));
                    }
                }
            }
        }
    }

    Err("无法连接 GitHub 查询 OpenP2P 最新版本（请检查网络或稍后重试）".to_string())
}

/// 多镜像链下载 release zip（官方直链 ➔ ghfast.top ➔ gh-proxy.com ➔ 服务器中转）
fn download_openp2p_release_zip(
    tag: &str,
    asset: &str,
    expected_sha256: Option<&str>,
) -> Result<Vec<u8>, String> {
    let target = format!("https://github.com/{}/releases/download/{}/{}", OPENP2P_REPO, tag, asset);
    let mirrors = [
        target.clone(),
        format!("https://ghfast.top/{}", target),
        format!("https://gh-proxy.com/{}", target),
        format!("{}/api/openp2p/download/{}/{}", crate::manifests::SERVER_API, tag, asset),
    ];

    let mut last_err = String::from("未尝试任何镜像");
    for url in &mirrors {
        match crate::manifests::block_on(
            crate::manifests::http_client()
                .get(url)
                .timeout(std::time::Duration::from_secs(120))
                .header("User-Agent", "chunfengdu")
                // 服务端中转镜像（{SERVER_API}/api/openp2p/download/...）要求 x-device-id；
                // GitHub 直链会忽略这个多余的头，因此统一带上即可。
                .header("x-device-id", crate::device::get_device_id())
                .send(),
        ) {
            Ok(resp) if resp.status().is_success() => {
                match crate::manifests::read_body_limited_blocking(
                    resp,
                    crate::manifests::MAX_ASSET_DOWNLOAD_BYTES,
                ) {
                    Ok(bytes) if bytes.len() > 100 * 1024 => {
                        if let Some(expected) = expected_sha256 {
                            let actual = crate::manifests::sha256_hex(&bytes);
                            if actual != expected {
                                last_err = format!("{} 内容校验失败（SHA256 不匹配）", url);
                                continue;
                            }
                        }
                        return Ok(bytes);
                    }
                    Ok(_) => last_err = format!("{} 返回内容异常", url),
                    Err(e) => last_err = format!("{} 下载失败: {}", url, e),
                }
            }
            Ok(resp) => last_err = format!("{} 返回 HTTP {}", url, resp.status()),
            Err(e) => last_err = format!("{} 连接失败: {}", url, e),
        }
    }
    Err(format!("所有 OpenP2P 镜像均下载失败，最后错误：{}", last_err))
}

/// 从 release zip 中提取 openp2p.exe 并自动修补 UAC 权限
fn extract_openp2p_from_zip(zip_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| format!("OpenP2P 压缩包解析失败: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        if entry.is_dir() {
            continue;
        }
        let fname = entry.name().rsplit('/').next().unwrap_or("");
        if fname.eq_ignore_ascii_case("openp2p.exe") {
            let cap = crate::manifests::MAX_ASSET_DOWNLOAD_BYTES;
            let mut buf = Vec::new();
            std::io::Read::take(&mut entry, cap + 1)
                .read_to_end(&mut buf)
                .map_err(|e| format!("解压 openp2p.exe 失败: {}", e))?;
            // 与 manifests.rs 的解压路径保持一致：超过上限说明条目被截断或异常膨胀
            if buf.len() as u64 > cap {
                return Err("解压出的 openp2p.exe 体积异常（超过 50MB 上限），已拒绝部署".to_string());
            }
            if !buf.starts_with(b"MZ") {
                return Err("解压出的 openp2p.exe 不是合法的 Windows 可执行文件 (MZ)".to_string());
            }

            patch_manifest_to_as_invoker(&mut buf);

            return Ok(buf);
        }
    }

    Err("在压缩包中未找到 openp2p.exe 文件".to_string())
}

/// 自动将 PE 内嵌的 requestedExecutionLevel 从 requireAdministrator 修补为 asInvoker
fn patch_manifest_to_as_invoker(bytes: &mut [u8]) {
    let target = b"level=\"requireAdministrator\"";
    let replacement = b"level=\"asInvoker\"           ";

    if let Some(pos) = bytes.windows(target.len()).position(|window| window == target) {
        bytes[pos..pos + replacement.len()].copy_from_slice(replacement);
    }
}

/// 在线同步最新 OpenP2P 联机引擎
pub fn sync_openp2p_latest() -> Result<String, String> {
    let _ = stop_p2p();

    let (tag, _published, asset, digest) = fetch_latest_openp2p_release()?;
    let current_tag = read_deployed_openp2p_tag();
    let p2p_dir = get_p2p_dir();
    let appdata_bin = p2p_dir.join("openp2p.exe");

    if normalize_tag(&tag) == normalize_tag(&current_tag) && is_usable_binary(&appdata_bin) {
        // 版本号一致但版本文件可能缺失/写成非 v 前缀，顺手归一化落盘
        let _ = fs::write(p2p_dir.join("p2p_version.txt"), &tag);
        return Ok(format!("OpenP2P 联机引擎已是最新版本（{}），无需重复同步。", tag));
    }

    let zip_bytes = download_openp2p_release_zip(&tag, &asset, digest.as_deref())?;
    let exe_bytes = extract_openp2p_from_zip(&zip_bytes)?;

    let old_bin = p2p_dir.join("openp2p.exe.old");
    let new_bin = p2p_dir.join("openp2p.exe.new");

    fs::write(&new_bin, &exe_bytes).map_err(|e| format!("写入新 OpenP2P 暂存文件失败: {}", e))?;

    if appdata_bin.exists() {
        let _ = fs::remove_file(&old_bin);
        if let Err(e) = fs::rename(&appdata_bin, &old_bin) {
            let _ = fs::remove_file(&new_bin);
            return Err(format!("备份原 openp2p.exe 失败: {}（可能仍被其他进程占用）", e));
        }
    }

    if let Err(e) = fs::rename(&new_bin, &appdata_bin) {
        if old_bin.exists() {
            let _ = fs::rename(&old_bin, &appdata_bin);
        }
        return Err(format!("部署新 openp2p.exe 失败: {}，已还原旧版本", e));
    }

    let _ = fs::remove_file(&old_bin);

    let version_file = p2p_dir.join("p2p_version.txt");
    // 统一存成 vX.Y.Z，避免 GitHub tag 不带 v 时本地版本文件与展示值形态不一致
    let _ = fs::write(&version_file, format!("v{}", normalize_tag(&tag)));
    // 版本已变化，让 read_deployed_openp2p_tag 的缓存失效，
    // 否则同步后前端立刻回读状态仍会拿到旧版本号
    invalidate_deployed_tag_cache();

    // 注意：**不要**把新引擎回写到源码目录（env!("CARGO_MANIFEST_DIR")/assets/...）。
    // 旧实现这么做，在开发者本机上会在用户点一次「同步」后静默改脏工作区（8.7MB 二进制 diff，
    // 还会被下一次 git add -A 带进提交）。同步的权威落点是用户数据目录，已在上方完成。
    // 安装包内置的引擎由发布流程统一更新。

    Ok(format!(
        "已成功同步 OpenP2P 联机引擎 {} → {}（已自动解除 UAC 提权要求并完成安全部署）！",
        current_tag, tag
    ))
}
