use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DEFAULT_PUBLIC_TOKEN: u64 = 11602319472897248650;
const DEFAULT_SERVER_HOST: &str = "api.openp2p.cn";
const DEFAULT_SERVER_PORT: u32 = 27183;

static ACTIVE_P2P_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// 退出路径的清理只做一次。
///
/// `window_close` / `app_quit` / `WindowEvent::Destroyed` 可能连续触发
/// （点关闭按钮会先走 window_close，再触发 Destroyed），没有这道闸就会跑两遍。
static P2P_SHUTDOWN_DONE: AtomicBool = AtomicBool::new(false);

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
pub struct P2pPeer {
    /// 对端 node id（openp2p 的 16 位 hex 节点标识）
    pub node_id: String,
    /// 入站(别人连我) / 出站(我连别人)
    pub direction: String,
    /// 打洞方式：TCP4 / TCP6 / UDP4 / relay（中继）
    pub transport: String,
    /// 该对端对应该本地端口的隧道（可多个）
    pub ports: Vec<u16>,
    /// 最近一次活跃时间（日志时间戳原文）
    pub last_seen: String,
    /// openp2p 为该对端分配的 appID（0 表示未识别）
    pub app_id: u32,
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
    //
    //    注意：**不要**在这个函数里做任何二进制修补。locate_openp2p_bin() 被
    //    get_status() 调用，而 P2P 面板每 3 秒轮询一次状态 —— 把「读 8.7MB + 全量扫描
    //    + 可能回写」放在这里，等于每 3 秒做一次无用功（引擎运行中还会因文件被锁而
    //    反复重试写 exe）。修补只放在「真的要把文件落盘/拉起」的路径上。
    if is_usable_binary(&appdata_bin) {
        return Some(appdata_bin);
    }

    // 2. 数据目录尚无可用的引擎（首次运行 / 被清理）：从自带资源拷贝一份过去
    for src in candidate_sources {
        if is_usable_binary(&src) {
            if let Ok(bytes) = fs::read(&src) {
                if write_binary_atomically(&appdata_bin, &bytes).is_ok() && is_usable_binary(&appdata_bin) {
                    // 首次部署：顺手把老版本可能残留的 requireAdministrator 清单修成 asInvoker。
                    // 只针对数据目录副本，绝不改写源码目录 / 安装目录里的原始资源。
                    ensure_binary_as_invoker(&appdata_bin);
                    return Some(appdata_bin);
                }
            }
            // 拷贝失败（只读介质 / 权限不足）时退回直接使用源文件
            return Some(src.canonicalize().unwrap_or(src));
        }
    }

    None
}

/// 原子写入二进制：先写同目录临时文件再 rename 覆盖。
///
/// 直接 `fs::write` 是「截断再写」，8.7MB 的 exe 若中途失败会留下半截文件
/// （虽然 is_usable_binary 的 1MB 下限能在下次自愈，但没必要冒这个风险）。
fn write_binary_atomically(dest: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = dest.with_extension("exe.new");
    fs::write(&tmp, bytes)?;
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    match fs::rename(&tmp, dest) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// 已确认过 asInvoker 清单的二进制路径（避免重复读盘扫描）
static MANIFEST_CHECKED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 确保二进制文件清单为 asInvoker 权限。
///
/// 修复老版本春风渡残留的 requireAdministrator 提权要求（会让非管理员启动时报
/// os error 740）。只在**即将拷贝/启动该文件**时调用一次：
///   - 该路径已检查过 → 直接返回（关键：不要在状态轮询路径上重复读 8.7MB）；
///   - 只对用户数据目录 / 安装目录的副本做修补，**绝不写 git 跟踪的源码目录**。
fn ensure_binary_as_invoker(path: &PathBuf) {
    let key = path.to_string_lossy().to_lowercase();

    // 源码目录（开发机上的 assets/tools/openp2p）只读不写：那是 git 跟踪文件，
    // 静默改写会在开发者本机改脏工作区，并被下一次 git add -A 带进提交。
    let is_source_tree = key.contains("assets") && key.contains("tools") && key.contains("openp2p");
    let is_appdata_copy = key.contains("com.chunfengdu.app");

    if let Ok(guard) = MANIFEST_CHECKED.lock() {
        if guard.iter().any(|k| *k == key) {
            return;
        }
    }

    if let Ok(mut bytes) = fs::read(path) {
        let target = b"level=\"requireAdministrator\"";
        if bytes.windows(target.len()).any(|w| w == target) {
            patch_manifest_to_as_invoker(&mut bytes);
            if is_appdata_copy && !is_source_tree {
                // 原子替换，避免 8.7MB exe 写到一半失败留下半截文件
                let _ = write_binary_atomically(path, &bytes);
            }
        }
    }

    if let Ok(mut guard) = MANIFEST_CHECKED.lock() {
        guard.push(key);
    }
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

/// config.json 读改写的互斥锁：connect/remove 隧道都是"读配置→改→写回"，
/// 并发调用会交错丢条目。锁保护整段读改写，配合 save_config 的原子写即可。
static CONFIG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn save_config(cfg: &P2pFullConfig) -> Result<(), String> {
    let dir = get_p2p_dir();
    let config_file = dir.join("config.json");
    let json_str = serde_json::to_string_pretty(cfg).map_err(|e| format!("配置序列化失败: {}", e))?;
    // 原子写：写临时文件再 rename。直接 fs::write 若在中途崩溃/被杀软打断，
    // 会留下截断的 JSON —— 而 read_current_config 解析失败会静默回退到空配置，
    // 用户保存的全部隧道就凭空消失了。
    let tmp = dir.join("config.json.tmp");
    fs::write(&tmp, &json_str).map_err(|e| format!("写入配置文件失败: {}", e))?;
    fs::rename(&tmp, &config_file).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("提交配置文件失败: {}", e)
    })
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 枚举系统中所有 openp2p.exe 进程，返回 (pid, 父 pid, 可执行文件全路径)。
///
/// 用 ToolHelp 快照而不是 `Get-CimInstance` / `tasklist`：后者每次调用都要 spawn
/// 一个进程（本机实测 PowerShell 约 446ms、taskkill 约 192ms），而本函数既服务于
/// 「是否在运行」的 3 秒轮询，也服务于窗口关闭路径 —— 这两处都不该付那个代价。
#[cfg(windows)]
fn list_openp2p_processes() -> Vec<(u32, u32, String)> {
    use std::mem::zeroed;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut out: Vec<(u32, u32, String)> = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
            return out;
        }

        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                if name.eq_ignore_ascii_case("openp2p.exe") {
                    let pid = entry.th32ProcessID;
                    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !handle.is_null() {
                        let mut buf = [0u16; 1024];
                        let mut size = buf.len() as u32;
                        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size);
                        CloseHandle(handle);
                        if ok != 0 {
                            out.push((
                                pid,
                                entry.th32ParentProcessID,
                                String::from_utf16_lossy(&buf[..size as usize]),
                            ));
                        }
                    }
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
    }
    out
}

#[cfg(not(windows))]
fn list_openp2p_processes() -> Vec<(u32, u32, String)> {
    Vec::new()
}

/// 本应用数据目录下 openp2p.exe 的路径比对形式（小写；含规范化后的去 `\\?\` 形式）
#[cfg(windows)]
fn own_binary_path_keys() -> Vec<String> {
    let raw = get_p2p_dir().join("openp2p.exe");
    let mut keys = vec![raw.to_string_lossy().to_lowercase()];
    if let Ok(canon) = fs::canonicalize(&raw) {
        let c = canon.to_string_lossy().to_lowercase();
        keys.push(c.trim_start_matches("\\\\?\\").to_string());
        keys.push(c);
    }
    keys
}

/// 本应用数据目录下正在运行的 openp2p 进程 pid。
///
/// 绝不按镜像名通杀（`taskkill /IM openp2p.exe`）：那会把用户自己、或
/// Guailoudou / OPL 等第三方联机工具拉起的同名进程一起杀掉，切断别人正在用的隧道。
/// 这里按可执行文件全路径精确匹配，只认我们自己部署的那一份。
#[cfg(windows)]
fn own_openp2p_pids() -> Vec<u32> {
    let keys = own_binary_path_keys();
    list_openp2p_processes()
        .into_iter()
        .filter(|(_, _, path)| {
            let p = path.to_lowercase();
            keys.iter().any(|k| *k == p)
        })
        .map(|(pid, _, _)| pid)
        .collect()
}

#[cfg(not(windows))]
fn own_openp2p_pids() -> Vec<u32> {
    Vec::new()
}

#[cfg(windows)]
fn terminate_pid(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let ok = TerminateProcess(handle, 1);
        CloseHandle(handle);
        ok != 0
    }
}

#[cfg(not(windows))]
fn terminate_pid(_pid: u32) -> bool {
    false
}

/// 结束整个进程树。
///
/// openp2p 以 `-d` 启动时会再 fork 一个 `-nv` worker（实测 daemon 与 worker 是两个进程），
/// 只 kill 直接子进程会留下孤儿 worker 继续占用 1919 / 27183 端口，导致下次启动 bind 失败。
fn kill_process_tree(pid: u32) {
    // 迭代 + 入栈即标记 visited，替代原先的递归。
    //
    // 递归实现在进程表成环时会无限自调用直至栈溢出（整个应用崩溃）。
    // 注意：常见的「递归后 out.push、再判 !out.contains(p)」写法**挡不住环** ——
    // out 是后序写入，环上的节点在下降过程中还没进 out，contains 永远为假。
    // 必须像这里一样在「入栈时」就标记已访问。
    let procs = list_openp2p_processes();
    let mut visited: HashSet<u32> = HashSet::new();
    let mut stack: Vec<u32> = vec![pid];
    let mut order: Vec<u32> = Vec::new();
    visited.insert(pid);

    while let Some(parent) = stack.pop() {
        for (p, pp, _) in &procs {
            if *pp == parent && visited.insert(*p) {
                stack.push(*p);
                order.push(*p);
            }
        }
    }

    for child in order {
        let _ = terminate_pid(child);
    }
    let _ = terminate_pid(pid);
}

/// 仅清理「本应用数据目录下」因崩溃/强退残留的 openp2p 实例
fn kill_own_openp2p_instances() {
    for pid in own_openp2p_pids() {
        let _ = terminate_pid(pid);
    }
}

/// P2P 隧道服务是否在运行。
///
/// 先看本进程持有的子进程句柄；句柄不可用（应用崩溃/被任务管理器强杀后重开）时
/// **按进程核实** —— 我们目录下的 openp2p 仍在跑就说明隧道其实还活着。
/// 旧实现只看内存句柄，于是残留进程仍在转发时 UI 却报「服务待命中」，
/// 把「已连接」全部显示成「待命」。
/// `is_p2p_running()` 兜底路径（进程枚举）的短缓存。
///
/// P2P 面板每 3 秒会连续调用 `p2p_get_status` + `p2p_get_realtime_state`，
/// 两者在服务未运行时都会走到「枚举进程」这条兜底路径。本机实测（345 进程）
/// 一次 ToolHelp 全表快照约 14ms —— 两次就是 28ms / 3s 的主线程占用。
/// 1.5s TTL 让同一轮询周期内的两次调用共享一次快照，且远小于轮询间隔，
/// 不会掩盖真实状态变化；start/stop 会显式失效，点击按钮后状态立即准确。
static RUNNING_PROBE_CACHE: Mutex<Option<(std::time::Instant, bool)>> = Mutex::new(None);
const RUNNING_PROBE_TTL: std::time::Duration = std::time::Duration::from_millis(1500);

fn invalidate_running_probe_cache() {
    if let Ok(mut guard) = RUNNING_PROBE_CACHE.lock() {
        *guard = None;
    }
}

/// 按进程表核实「本应用目录下的 openp2p 是否在运行」（带短缓存）
fn probe_own_openp2p_running() -> bool {
    if let Ok(guard) = RUNNING_PROBE_CACHE.lock() {
        if let Some((at, val)) = guard.as_ref() {
            if at.elapsed() < RUNNING_PROBE_TTL {
                return *val;
            }
        }
    }

    let val = !own_openp2p_pids().is_empty();
    if let Ok(mut guard) = RUNNING_PROBE_CACHE.lock() {
        *guard = Some((std::time::Instant::now(), val));
    }
    val
}

pub fn is_p2p_running() -> bool {
    {
        let mut guard = ACTIVE_P2P_CHILD.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => return true,
                _ => {
                    *guard = None;
                }
            }
        }
    }

    probe_own_openp2p_running()
}

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

    // 兜底：清理本应用目录下因崩溃/强退残留的实例
    kill_own_openp2p_instances();

    // 刚杀完进程，缓存的「是否在运行」立刻失效，
    // 否则用户点「关闭所有服务」后 UI 最多还会显示 1.5s 的「运行中」。
    invalidate_running_probe_cache();

    Ok(true)
}

/// 应用退出路径的清理：整个进程只执行一次。
///
/// `window_close` / `app_quit` / `WindowEvent::Destroyed` 可能连续触发
/// （点关闭按钮会先走 window_close，再触发 Destroyed），没有这道闸就会跑两遍。
///
/// 这里刻意**不**加「本会话是否用过 P2P」的前置判断：应用被任务管理器强杀后
/// 重新打开、且用户不再进联机页时，上一轮残留的 openp2p 仍需在退出时清掉。
/// 代价是一次 ToolHelp 进程快照（本机实测约 11ms），远低于原先 spawn PowerShell
/// 的 446ms，无需为它牺牲正确性。
pub fn shutdown_p2p_once() {
    if P2P_SHUTDOWN_DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = stop_p2p();
}

/// 启动 openp2p 守护模式（房主或待命监听状态）
pub fn start_p2p_daemon() -> Result<bool, String> {
    stop_p2p()?;

    let exe_path = locate_openp2p_bin().ok_or_else(|| "未找到 openp2p.exe 组件，请检查 assets/tools 目录".to_string())?;
    let dir = get_p2p_dir();

    // 真正要拉起进程之前，才做一次清单修补（asInvoker）。
    // 此时 stop_p2p() 已跑完，二进制不会被占用，可安全回写；
    // MANIFEST_CHECKED 保证同一进程内每个路径最多只读盘扫描一次。
    ensure_binary_as_invoker(&exe_path);

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

    // 句柄已持有，is_p2p_running() 会直接返回 true；这里仍清一次缓存，
    // 避免句柄随后被回收（进程退出）时立刻读到启动前的旧值。
    invalidate_running_probe_cache();

    Ok(true)
}

/// 建立对端隧道（客机连接房主）
pub fn connect_tunnel(payload: P2pTunnelPayload) -> Result<P2pTunnelView, String> {
    // 锁住整段"读配置→改→写回"：并发 connect/remove 交错会导致隧道条目丢失
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
    let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cfg = read_current_config();
    let len_before = cfg.apps.len();
    cfg.apps.retain(|a| a.src_port != local_port);
    if cfg.apps.len() != len_before {
        save_config(&cfg)?;
        // 仅在隧道服务本来就在运行时重启加载；未运行时仅持久化配置，避免误唤醒守护进程
        if is_p2p_running() {
            start_p2p_daemon()?;
        }
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
        active_tunnels: if running {
            cfg.apps.iter().map(P2pTunnelView::from).collect()
        } else {
            Vec::new()
        },
        binary_path: exe.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        message: if running {
            "P2P 隧道服务正在运行中".to_string()
        } else {
            "P2P 隧道服务未启动".to_string()
        },
        version: read_deployed_openp2p_tag(),
    }
}

/// 读取日志文件末尾至多 `max_bytes` 字节并解码为字符串。
///
/// 用于 3 秒级轮询的打洞状态解析：日志可达数百 MB，绝不能整份读入。
/// 从末尾往前读，从第一个换行后开始切分（丢弃可能被截断的首行残留）。
/// 返回 `None` 表示文件不存在或读取失败。
fn read_log_tail(path: &std::path::Path, max_bytes: u64) -> Option<String> {
    use std::io::{Seek, SeekFrom};
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max_bytes);
    if start > 0 {
        file.seek(SeekFrom::Start(start)).ok()?;
    }
    let mut buf = Vec::with_capacity((len - start).min(max_bytes) as usize);
    file.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    // 非从头读取时，首个换行之前很可能是被截断的半行，丢掉它
    if start > 0 {
        if let Some(pos) = text.find('\n') {
            return Some(text[pos + 1..].to_string());
        }
    }
    Some(text)
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

    // 只读日志尾部：本函数每 3 秒被前端轮询一次（见 P2pNetworkingPanel 的 setInterval），
    // 而 openp2p.log 无轮转、长时间运行可达数百 MB。整份 read_to_string 会让每次轮询
    // 都做大分配并卡住界面。这里 seek 到末尾前 64KB 再读，最坏情况下首个残缺行也够用
    // （只取最后 30 行做关键字匹配）。
    let content = match read_log_tail(&log_file, 64 * 1024) {
        Some(c) => c,
        None => {
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

/// 解析 openp2p.log，提取"已连接的对端"列表（房主/客机共用）。
///
/// openp2p 未提供成员查询接口，但其日志会记录每次打洞/连接成功：
///   `... TCP4 Punch ok, ...` / `TCP6 connection ok` / `UDP4 connection ok`
///   / `retry app relay=xxxx`，以及带 `node=<16hex>`、`appID=<n>`、
///   `dstPort=<n>`（或 `srcPort=`）的上下文行。
/// 本函数只做"尽力而为"的解析：识别到即展示，识别不到就返回空，
/// **绝不因格式变化而误报**。
fn parse_p2p_peers(text: &str) -> Vec<P2pPeer> {
    use std::collections::BTreeMap;

    // node_id -> peer；同一对端多次连接合并（端口并集、时间取最新、传输方式取最新）
    let mut map: BTreeMap<String, P2pPeer> = BTreeMap::new();
    let mut cur_node: Option<String> = None;
    let mut cur_app: Option<u32> = None;
    let mut cur_port: Option<u16> = None;
    let mut cur_time = String::new();

    // 从一行里取 `key=值` 的数值（值到非数字/空白为止）
    fn field_u64(line: &str, key: &str) -> Option<u64> {
        let pos = line.find(key)?;
        let rest = &line[pos + key.len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() { None } else { digits.parse().ok() }
    }
    // 从一行里取 `node=<hex>` / `node: <hex>` / `relay=<hex>` 形式的节点 id
    fn field_node(line: &str) -> Option<String> {
        for key in ["node=", "node: ", "relay="] {
            if let Some(pos) = line.find(key) {
                let rest = &line[pos + key.len()..];
                let hex: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_hexdigit())
                    .collect();
                if hex.len() >= 8 {
                    return Some(hex.to_lowercase());
                }
            }
        }
        None
    }
    // 取行首时间戳（"2026/09/27 19:32:18.123456"）
    fn line_time(line: &str) -> String {
        let t = line.trim_start();
        if t.len() >= 19 && t.as_bytes().get(4) == Some(&b'/') && t.as_bytes().get(10) == Some(&b' ') {
            t[..19].to_string()
        } else {
            String::new()
        }
    }
    // 识别该行是否是"连接/打洞成功"事件，返回传输方式
    fn transport_of(line: &str) -> Option<&'static str> {
        if line.contains("TCP4 Punch ok") { return Some("TCP4"); }
        if line.contains("TCP6 Punch ok") { return Some("TCP6"); }
        if line.contains("UDP4 Punch ok") { return Some("UDP4"); }
        if line.contains("TCP4 connection ok") { return Some("TCP4"); }
        if line.contains("TCP6 connection ok") { return Some("TCP6"); }
        if line.contains("UDP4 connection ok") { return Some("UDP4"); }
        if line.contains("relay=") { return Some("relay"); }
        None
    }

    for line in text.lines() {
        // 先更新上下文：node/app/port 常出现在连接事件行的前面几行。
        // 关键：**不能**在遇到 node= 时清空 cur_port —— 打洞成功行本身也带 node=，
        // 清空会把上一行刚设置的 dstPort 一起抹掉（端口丢失）。
        if let Some(n) = field_node(line) {
            cur_node = Some(n);
            cur_time = line_time(line);
        }
        // appID 变化才重置端口上下文（端口属于某个 app 的上下文）
        if let Some(a) = field_u64(line, "appID=") {
            if cur_app != Some(a as u32) {
                cur_app = Some(a as u32);
                cur_port = None;
            }
        }
        if let Some(p) = field_u64(line, "dstPort=").or_else(|| field_u64(line, "srcPort=")) {
            cur_port = Some((p.min(u16::MAX as u64)) as u16);
        }

        let Some(transport) = transport_of(line) else { continue };
        // 事件行自带 node 时优先用行内 node（如 relay=<hex>），否则沿用上文 node
        let node = match field_node(line) {
            Some(n) => n,
            None => match cur_node.clone() {
                Some(n) => n,
                None => continue,
            },
        };

        // 方向判断：openp2p 明确记录"本机主动拨号"的只有 Dial/%s dial to/Dial %s:%d OK
        // 与 send tcp punch 这类字样；命中即为 out（我连别人），否则视为 in（别人连我）。
        // 说明：这是尽力而为的近似 —— 拿不准时归为 in（房主视角最常见的情形）。
        let lower = line.to_lowercase();
        let direction = if lower.contains("dial") || lower.contains("send tcp punch") {
            "out".to_string()
        } else {
            "in".to_string()
        };
        let time = line_time(line);
        let ts = if time.is_empty() { cur_time.clone() } else { time };

        let entry = map.entry(node.clone()).or_insert_with(|| P2pPeer {
            node_id: node.clone(),
            direction: direction.clone(),
            transport: transport.to_string(),
            ports: Vec::new(),
            last_seen: ts.clone(),
            app_id: cur_app.unwrap_or(0),
        });
        if transport == "relay" {
            entry.transport = "relay".to_string();
        }
        if let Some(p) = cur_port {
            if p > 0 && !entry.ports.contains(&p) {
                entry.ports.push(p);
            }
        }
        if !ts.is_empty() {
            entry.last_seen = ts;
        }
        if cur_app.unwrap_or(0) > 0 {
            entry.app_id = cur_app.unwrap_or(0);
        }
    }

    let mut out: Vec<P2pPeer> = map.into_values().collect();
    // 最近活跃的排在前面
    out.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    out
}

/// 获取当前已连接的对端列表（房主用于查看"谁连进来了"）
pub fn get_peers() -> Vec<P2pPeer> {
    if !is_p2p_running() {
        return Vec::new();
    }
    let log_file = get_p2p_dir().join("log").join("openp2p.log");
    // 只读尾部：日志无轮转，长时间运行可达数百 MB
    let Some(text) = read_log_tail(&log_file, 256 * 1024) else {
        return Vec::new();
    };
    parse_p2p_peers(&text)
}

/// 生成分享联机码 (CFD://Base64)
pub fn generate_share_code(    uid: &str,
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

/// 从 JSON 值取端口号并做 1-65535 范围校验。
/// 越界返回 None（调用方据此报错），绝不静默截断成另一个合法端口。
fn port_from_json(v: Option<&serde_json::Value>) -> Option<u16> {
    let n = v?.as_u64()?;
    if n == 0 || n > u16::MAX as u64 {
        return None;
    }
    Some(n as u16)
}

/// 解析分享联机码（向下兼容 CFD:// 与 OPL:// 格式，以及直接的 uid:port:protocol 分隔符格式）
pub fn parse_share_code(code_str: &str) -> Result<ParsedShareCode, String> {
    let trimmed = code_str.trim();

    // 1. 优先尝试直接的分隔符格式：uid:port 或 uid:port:protocol（非 Base64）
    if trimmed.contains(':') && !trimmed.contains("://") {
        let parts: Vec<&str> = trimmed.split(':').collect();
        if parts.len() >= 2 {
            let uid = parts[0].trim().to_lowercase();
            let remote_port = parts[1].trim().parse::<u16>().unwrap_or(0);
            let proto = if parts.len() >= 3 { parts[2].trim().to_lowercase() } else { "udp".to_string() };
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
    }

    // 前缀按大小写不敏感剥离：只枚举 CFD/cfd/OPL/opl 四种写法时，
    // 用户手打或某些输入法产生的 "Cfd://" / "Opl://" 会掉进「当裸 Base64 解码」分支，
    // 报出与真实原因无关的「Base64 格式无效」。
    let lower = trimmed.to_ascii_lowercase();
    let b64_part = if lower.starts_with("cfd://") {
        &trimmed["cfd://".len()..]
    } else if lower.starts_with("opl://") {
        &trimmed["opl://".len()..]
    } else {
        trimmed
    };

    // 过滤换行符、回车与空白，防止从聊天软件复制时引入多余换行导致 base64 解码报错
    let clean_b64: String = b64_part.chars().filter(|c| !c.is_whitespace()).collect();

    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(&clean_b64)
        .map_err(|_| "联机码 Base64 格式无效，请检查复制内容".to_string())?;

    let text = String::from_utf8(decoded_bytes)
        .map_err(|_| "联机码文本编码无效".to_string())?;

    // 优先尝试 JSON 格式
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
        let uid = v.get("uid").and_then(|u| u.as_str()).unwrap_or("").to_string();
        // 端口必须走 range 校验的转换：`as u16` 会把 70000 静默截断成 4464，
        // 生成一条指向错误端口的隧道而不是报错。越界/为 0 一律视为无效码。
        let remote_port = port_from_json(
            v.get("remotePort").or_else(|| v.get("Sport")).or_else(|| v.get("port")),
        )
        .ok_or_else(|| "联机码中的端口号非法（需为 1-65535）".to_string())?;
        let local_port = port_from_json(v.get("localPort").or_else(|| v.get("Cport")))
            .unwrap_or(remote_port);
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

    // 备用尝试 Base64 解码后的简单分隔符格式：uid:port:protocol
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

/// 同名规则是否存在 —— 只看 netsh **退出码**，不解析输出文本。
///
/// 实测 `netsh advfirewall firewall show rule name="<不存在>"` 输出
/// `No rules match the specified criteria.`（中文系统「没有与指定标准相匹配的规则。」）
/// 且 exit=1；规则存在时 exit=0。与界面语言无关。
/// 旧实现用 `stdout.contains("规则名称")` 判定，英文系统上表头是 `Rule Name`，
/// 必然恒为 false（即便规则已存在也会一直提示「未放行」）。
#[cfg(windows)]
fn firewall_rule_exists() -> bool {
    Command::new("netsh")
        .args(&["advfirewall", "firewall", "show", "rule", "name=ChunFengDu P2P"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// 检查 Windows 防火墙是否存在春风度 P2P 入站放行规则。
///
/// 「规则存在」不等于「放行的是当前引擎」：引擎在线升级 / 安装目录迁移后，
/// 同名规则可能还指向已失效的旧路径，也可能被禁用或改成「阻止」——
/// 这些情况下入站流量依然被丢弃，而只看规则名的旧实现会一路显示「已放行」。
/// 解析不出具体路径与生效状态时（异常输出）退回「存在即放行」，不制造假阴性。
pub fn check_firewall_rule() -> bool {
    #[cfg(windows)]
    {
        if !firewall_rule_exists() {
            return false;
        }

        if let Some(bin) = locate_openp2p_bin() {
            if let Some(matches) = existing_rule_program(&bin.to_string_lossy()) {
                return matches;
            }
        }

        true
    }

    #[cfg(not(windows))]
    false
}

/// 规范化 Windows 路径用于比较（统一分隔符、大小写并剔除首尾引号）。
#[cfg(windows)]
fn normalize_win_path(p: &str) -> String {
    p.trim().trim_matches('"').replace('/', "\\").to_lowercase()
}

/// 取规则值里 `key=value` 形式的字段值（去引号与首尾空白）。
///
/// 防火墙规则在注册表里是一条 `|` 分隔的字符串，形如：
/// `v2.30|Action=Allow|Active=TRUE|Dir=In|App=C:\...\openp2p.exe|Name=ChunFengDu P2P|`
/// 按 `|` 切分后整段比对键名，避免 `Name=ChunFengDu P2P` 与
/// `Name=ChunFengDu P2P Test` 这类前缀相同的字段互相误命中。
#[cfg(windows)]
fn rule_value_field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.split('|').find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        if !k.eq_ignore_ascii_case(key) {
            return None;
        }
        let v = v.trim().trim_matches('"');
        if v.is_empty() {
            None
        } else {
            Some(v)
        }
    })
}

/// 该规则值是否就是给定规则名的那一条。
#[cfg(windows)]
fn rule_value_is_named(text: &str, rule_name: &str) -> bool {
    rule_value_field(text, "Name") == Some(rule_name)
}

/// 规则是否真的放行入站流量：`Action=Allow` + `Dir=In` + `Active=TRUE`。
///
/// 被禁用或被改成「阻止」的同名规则，哪怕路径正确也不放行任何流量。
/// netsh 的中文输出里「已启用/操作」这些标签经 from_utf8_lossy 后已损毁，
/// 只有注册表原文能可靠判定，所以这项校验放在这里。
/// 字段缺失时视为满足：判定目标只是「能否断言规则未生效」，缺失不足以断言，
/// 宁可漏报也不能把生效中的规则误报成未放行（那会让用户反复弹 UAC）。
#[cfg(windows)]
fn rule_value_is_effective(text: &str) -> bool {
    let allowed = rule_value_field(text, "Action")
        .map(|a| a.eq_ignore_ascii_case("Allow"))
        .unwrap_or(true);
    let inbound = rule_value_field(text, "Dir")
        .map(|d| d.eq_ignore_ascii_case("In"))
        .unwrap_or(true);
    let active = rule_value_field(text, "Active")
        .map(|a| a.eq_ignore_ascii_case("TRUE"))
        .unwrap_or(true);
    allowed && inbound && active
}

/// 直接读注册表判定同名规则是否放行当前引擎。
///
/// Windows Defender 防火墙的规则原文就存在 HKLM 下，普通权限即可只读查询
/// （`BUILTIN\Users` 有 ReadKey），因此不必去解析 netsh 的本地化输出。
/// 本机实测单次查询约 10~17ms（取决于规则条数，本机 1000+ 条），
/// 只用在面板挂载与放行流程里，不在 3 秒状态轮询路径上。
///
/// - `Some(true)`：存在「入站 + 允许 + 已启用」的同名规则且指向该路径；
/// - `Some(false)`：同名规则存在，但没有任何一条既指向该路径又确实生效
///   （路径陈旧 / 被禁用 / 被改成阻止）；
/// - `None`：注册表不可读，或同名规则里没有一条是程序规则
///   （例如用户手工建的按端口规则）—— 无法据此断言，交由 netsh 兜底判定。
#[cfg(windows)]
fn query_firewall_rule_program_registry(rule_name: &str, bin_str: &str) -> Option<bool> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules")
        .ok()?;

    let want = normalize_win_path(bin_str);
    let mut seen_named_program_rule = false;

    for (_, val) in key.enum_values().filter_map(|v| v.ok()) {
        let text = val.to_string();
        if !rule_value_is_named(&text, rule_name) {
            continue;
        }

        let Some(app) = rule_value_field(&text, "App") else {
            // 同名但非程序规则：断言不了它是否放行本引擎，保持宽松，
            // 免得「一键放行」把用户自己手工建的规则删掉。
            continue;
        };
        seen_named_program_rule = true;

        // 同名的多条规则里只要有一条既指向当前引擎又确实生效就算放行成功，
        // 不能取第一条就下结论（枚举顺序不保证，陈旧规则可能排在前面）。
        if rule_value_is_effective(&text) && normalize_win_path(app) == want {
            return Some(true);
        }
    }

    if seen_named_program_rule {
        Some(false)
    } else {
        None
    }
}

/// 从 netsh verbose 输出的一行里提取程序路径。
///
/// netsh 走本地代码页输出（中文系统是 GBK），`程序:` 这类标签经 from_utf8_lossy
/// 后必然损毁成替换字符，按标签匹配是死代码；而盘符与 `:\` 是 ASCII，跨语言稳定，
/// 且 verbose 输出里只有「程序」这一行会出现 `X:\` 形态的路径。
#[cfg(windows)]
fn extract_program_path(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':' && bytes[i + 2] == b'\\' {
            let path = line[i..].trim().trim_matches('"').trim();
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }
    None
}

/// 从 netsh verbose 输出解析规则的程序路径并比对（纯函数，便于回归测试）。
///
/// 返回 `Some(false)` 的前提是「确实解析出了路径且与本机引擎不同」；
/// 目标路径含非 ASCII 字符时（中文用户名 / 中文安装目录），路径本身也已被
/// 本地代码页字节损毁，此时一律返回 `None` 交由调用方宽松处理 ——
/// 宁可漏报，也不能把一条生效中的规则误报成「未放行」而让用户反复弹 UAC。
#[cfg(windows)]
fn parse_netsh_rule_program(text: &str, bin_str: &str) -> Option<bool> {
    let want = normalize_win_path(bin_str);
    if !want.is_ascii() {
        return None;
    }

    let mut seen_program_rule = false;
    for line in text.lines() {
        if let Some(path) = extract_program_path(line) {
            seen_program_rule = true;
            // 精确比对：`...\openp2p.exe.bak` 这类前缀相同的旧路径不能被判成命中
            // （旧实现用全文 contains，会误判）。
            if normalize_win_path(&path) == want {
                return Some(true);
            }
        }
    }

    if seen_program_rule {
        Some(false)
    } else {
        None
    }
}

/// 兜底：读取 netsh verbose 输出交给 `parse_netsh_rule_program` 解析。
#[cfg(windows)]
fn query_firewall_rule_program_netsh(bin_str: &str) -> Option<bool> {
    let output = Command::new("netsh")
        .args(&[
            "advfirewall",
            "firewall",
            "show",
            "rule",
            "name=ChunFengDu P2P",
            "verbose",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_netsh_rule_program(&String::from_utf8_lossy(&output.stdout), bin_str)
}

/// 读取现有规则的放行指向：
/// - `Some(true)`：规则存在且确实放行当前引擎；
/// - `Some(false)`：规则存在，但没有一条既指向当前引擎又生效（路径陈旧 / 被禁用 / 改成阻止）；
/// - `None`：规则不存在，或因环境原因无法确定具体路径（调用方应退回宽松判定）。
#[cfg(windows)]
fn existing_rule_program(bin_str: &str) -> Option<bool> {
    if let Some(verdict) = query_firewall_rule_program_registry("ChunFengDu P2P", bin_str) {
        return Some(verdict);
    }

    query_firewall_rule_program_netsh(bin_str)
}

/// 规则是否已存在且放行当前引擎 —— 让「一键放行」保持幂等。
#[cfg(windows)]
fn firewall_rule_ok_for(bin_str: &str) -> bool {
    match existing_rule_program(bin_str) {
        Some(matches) => matches,
        // 无法判定路径时退回「存在即放行」。这里只跑一次 netsh 退出码门禁，
        // 不再走 check_firewall_rule —— 那会重复一次已有的路径查询。
        None => firewall_rule_exists(),
    }
}

/// 直接以参数数组跑一次 netsh（不经 shell），避免 Windows 命令行引号解析歧义。
/// 返回是否退出码为 0。
#[cfg(windows)]
fn run_netsh(args: &[&str]) -> bool {
    Command::new("netsh")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 先删同名旧规则、再按给定引擎路径重新添加（当前进程权限决定能否成功）。
#[cfg(windows)]
fn netsh_replace_rule(bin_str: &str) -> bool {
    let _ = run_netsh(&["advfirewall", "firewall", "delete", "rule", "name=ChunFengDu P2P"]);
    run_netsh(&[
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
}

/// 一次提权里要跑的命令行：先删同名旧规则，再按当前引擎路径重新添加。
///
/// 同名规则若已存在但 Program 指向旧路径，只 add 会失败（规则重名），
/// 因此必须先 delete；而一次提权只能弹一次 UAC，两条 netsh 必须挂在同一条命令行里。
#[cfg(windows)]
fn elevated_cmdline(bin_str: &str) -> String {
    format!(
        "netsh advfirewall firewall delete rule name=\"ChunFengDu P2P\" >nul 2>&1 & netsh advfirewall firewall add rule name=\"ChunFengDu P2P\" dir=in action=allow program=\"{}\" enable=yes",
        bin_str
    )
}

#[cfg(windows)]
fn fallback_powershell_allow(bin_str: &str) -> Result<(), String> {
    // 整条 cmd 命令行塞进 PowerShell 单引号字符串：只需转义单引号，
    // 参数里的双引号、`>`、`&` 都是字面量，不会被 PowerShell 抢先解释。
    let script = format!(
        "Start-Process cmd -ArgumentList '/c {}' -Verb RunAs -Wait -WindowStyle Hidden",
        elevated_cmdline(bin_str).replace('\'', "''")
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("启动提权进程失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("PowerShell 提权配置防火墙失败: {}", err.trim()))
    }
}

#[cfg(windows)]
fn allow_firewall_rule_elevated(bin_str: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, GetLastError, FALSE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();
    // 走 cmd.exe /c 而不是直接调 netsh.exe：同名规则若已存在但指向旧路径，
    // 必须先 delete 再 add 才能纠正 Program 字段，而一次提权只能弹一次 UAC。
    let file: Vec<u16> = OsStr::new("cmd.exe").encode_wide().chain(std::iter::once(0)).collect();
    let params_str = format!("/c {}", elevated_cmdline(bin_str));
    let params: Vec<u16> = OsStr::new(&params_str).encode_wide().chain(std::iter::once(0)).collect();

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE as i32;

    let success = unsafe { ShellExecuteExW(&mut info) };
    if success == FALSE {
        let err = unsafe { GetLastError() };
        if err == ERROR_CANCELLED {
            return Err("已取消管理员权限授权 (UAC)，防火墙放行未完成".to_string());
        }
        // 如果系统某些受限策略拦截了直接调起 netsh，使用 PowerShell 兜底
        return fallback_powershell_allow(bin_str);
    }

    if !info.hProcess.is_null() {
        unsafe {
            // 等待 netsh 执行完成，最多等待 15 秒
            let _ = WaitForSingleObject(info.hProcess, 15000);
            let mut exit_code: u32 = 0;
            let _ = GetExitCodeProcess(info.hProcess, &mut exit_code);
            CloseHandle(info.hProcess);

            if exit_code != 0 {
                // 如果退出码非 0，可能系统已有同名规则或有轻微告警，用 check_firewall_rule 最终确认
                if check_firewall_rule() {
                    return Ok(());
                }
                return Err(format!("防火墙配置未成功 (netsh 退出代码: {})", exit_code));
            }
        }
    }

    Ok(())
}

/// 自动向 Windows 防火墙添加入站规则放行 openp2p
///
/// 这条命令会**阻塞等待 UAC 提权子进程结束**（最长 15s），
/// 调用方必须放在阻塞线程里（Tauri 侧用 spawn_blocking），否则 UAC 弹窗期间界面会冻住。
pub fn allow_firewall_rule() -> Result<bool, String> {
    let bin = locate_openp2p_bin().ok_or_else(|| "未找到 openp2p 可执行文件".to_string())?;
    let bin_str = bin.to_string_lossy();

    #[cfg(windows)]
    {
        // 0. 幂等短路：规则已存在且确实放行当前引擎时直接返回，
        //    不重复弹 UAC、也不在管理员会话里反复 delete/add 触发安全软件告警。
        if firewall_rule_ok_for(&bin_str) {
            return Ok(true);
        }

        // 1. 已提权 / 本机策略允许时，直接以子进程执行（无弹窗、极速完成）。
        //    注意必须先删同名旧规则：引擎在线升级后路径变了、规则被禁用或改成阻止时，
        //    只 add 会因规则重名失败（或被禁用规则继续压着）。
        if netsh_replace_rule(&bin_str) && firewall_rule_ok_for(&bin_str) {
            return Ok(true);
        }

        // 2. 普通权限时走 Windows 原生 UAC 提权执行
        allow_firewall_rule_elevated(&bin_str)?;

        // 3. UAC 明确成功后校验结果：
        //    严格区分「确实放行(Some(true))」、「确凿未生效(Some(false))」与
        //    「环境无法提取路径/生效状态(None)」——后者只要规则存在即视为放行成功，
        //    严禁产生假阴性误报，否则用户会对着一条正确的规则反复弹 UAC。
        match existing_rule_program(&bin_str) {
            Some(true) => Ok(true),
            Some(false) => Err(
                "防火墙规则已存在但未生效（指向旧引擎路径，或被禁用/改为阻止），请手动删除该规则后重试"
                    .to_string(),
            ),
            None => {
                if check_firewall_rule() {
                    Ok(true)
                } else {
                    Err("未能确认防火墙入站放行结果，请检查系统安全软件或手动配置".to_string())
                }
            }
        }
    }

    #[cfg(not(windows))]
    Err("仅支持 Windows 平台防火墙配置".to_string())
}

/// 检测当前春风度进程是否以管理员权限运行
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }

            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;

            let success = GetTokenInformation(
                token,
                TokenElevation,
                &mut elevation as *mut _ as *mut _,
                size,
                &mut size,
            );

            CloseHandle(token);

            success != 0 && elevation.TokenIsElevated != 0
        }
    }

    #[cfg(not(windows))]
    false
}

/// 以管理员权限重新启动当前软件客户端
pub fn restart_as_admin() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_CANCELLED, FALSE, STILL_ACTIVE, WAIT_TIMEOUT,
        };
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
        use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;

        let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
        let exe_wide: Vec<u16> = exe_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let verb: Vec<u16> = OsStr::new("runas").encode_wide().chain(std::iter::once(0)).collect();

        let args: Vec<String> = std::env::args().skip(1).collect();
        let args_str = args.join(" ");
        let params_wide: Vec<u16> = OsStr::new(&args_str).encode_wide().chain(std::iter::once(0)).collect();

        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = exe_wide.as_ptr();
        if !args.is_empty() {
            info.lpParameters = params_wide.as_ptr();
        }
        info.nShow = SW_SHOW as i32;

        let success = unsafe { ShellExecuteExW(&mut info) };
        if success == FALSE {
            let err = unsafe { GetLastError() };
            if err == ERROR_CANCELLED {
                return Err("用户取消了管理员权限授权 (UAC)".to_string());
            }
            return Err(format!("以管理员权限重启失败 (错误代码: {})", err));
        }

        // 关键：必须确认新实例真的活着再退出自己。
        // 旧实现弹完 UAC 立刻 exit(0)，若新进程因为缺资源 / 被安全软件拦截而秒退，
        // 用户会看到「软件自己关了且没再打开」，且本轮 P2P 服务已被 shutdown 掉，
        // 等于用一次误操作换来彻底不可用。
        if !info.hProcess.is_null() {
            // 等待 2s：进程仍存活说明已经越过启动初期（UAC 已通过、未立即崩溃）
            let wait = unsafe { WaitForSingleObject(info.hProcess, 2000) };
            let mut exit_code: u32 = 0;
            let alive = wait == WAIT_TIMEOUT
                && unsafe { GetExitCodeProcess(info.hProcess, &mut exit_code) } != 0
                && exit_code == STILL_ACTIVE as u32;
            unsafe { CloseHandle(info.hProcess) };

            if !alive {
                return Err(
                    "已授权，但以管理员身份启动的新实例未能保持运行（可能被安全软件拦截）。当前窗口将继续运行。"
                        .to_string(),
                );
            }
        }

        // 清理本进程持有的 P2P 子进程，避免与提权新实例抢同一个 openp2p
        shutdown_p2p_once();

        // 新实例已确认存活，退出当前进程
        std::process::exit(0);
    }

    #[cfg(not(windows))]
    Err("该功能仅支持 Windows 系统".to_string())
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
    // 记录同步前隧道是否在跑：升级必须停引擎（否则 exe 被占用无法改名），
    // 但同步结束后必须**恢复原运行状态**，否则用户正在联机时点一下"同步"
    // 就会把隧道静默杀死、对端掉线，界面还显示"未启动"。
    let was_running = is_p2p_running();
    let _ = stop_p2p();

    let result = sync_openp2p_latest_inner();

    // 无论成功失败，只要同步前在运行就尝试恢复（失败也只提示一句，不掩盖主结果）
    if was_running {
        if let Err(e) = start_p2p_daemon() {
            let suffix = format!("（注意：同步后自动重启引擎失败，请手动重新连接：{}）", e);
            return Ok(match result {
                Ok(msg) => format!("{}{}", msg, suffix),
                Err(err) => format!("{} {}", err, suffix),
            });
        }
    }

    result
}

fn sync_openp2p_latest_inner() -> Result<String, String> {
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

#[cfg(test)]
mod p2p_peer_parse_tests {
    use super::*;

    #[test]
    fn parses_connected_peers_from_log() {
        let log = "2026/09/27 20:00:01.100000 1234 INFO node=d31a9b37f939caef, serverHost=api.openp2p.cn\n\
2026/09/27 20:00:05.200000 1234 INFO appID=1, dstPort=25565\n\
2026/09/27 20:00:05.300000 1234 INFO TCP4 Punch ok, node=d31a9b37f939caef\n\
2026/09/27 20:00:21.000000 1234 INFO retry app relay=ab5efca9169ed2f9\n\
2026/09/27 20:01:00.000000 1234 INFO UDP4 connection ok, node=ab5efca9169ed2f9\n";
        let peers = parse_p2p_peers(log);
        assert_eq!(peers.len(), 2, "应识别出 2 个对端，实际 {:?}", peers);
        // 端口必须归属到触发连接的对端（修复前会因 node= 行清空端口而丢失）
        let tcp = peers.iter().find(|p| p.node_id == "d31a9b37f939caef").expect("TCP4 对端");
        assert_eq!(tcp.transport, "TCP4");
        assert!(tcp.ports.contains(&25565), "端口应归属该对端: {:?}", tcp.ports);
        assert_eq!(tcp.app_id, 1);
        // relay= 里的 node 应归到自己名下，不能挂到上一个对端
        assert!(peers.iter().any(|p| p.node_id == "ab5efca9169ed2f9" && p.transport == "relay"));
    }

    #[test]
    fn no_connection_events_yields_empty() {
        // 只有启动/登录、没有任何打洞或连接事件时不得误报对端
        let log = "2026/09/27 20:00:01 INFO openp2p start. version: 3.25.11\n\
2026/09/27 20:00:02 INFO login ok. user=x, node=deadbeefdeadbeef\n";
        assert!(parse_p2p_peers(log).is_empty());
    }
}

#[cfg(all(test, windows))]
mod firewall_rule_parse_tests {
    use super::*;

    const BIN: &str = r"C:\Users\lenovo\AppData\Roaming\com.chunfengdu.app\openp2p\openp2p.exe";

    /// 还原中文 Windows 上 netsh 输出的真实形态：GBK 字节经 from_utf8_lossy 解码，
    /// `程序:` 必然损毁成替换字符 —— 这正是「按标签匹配」永远落空的原因。
    fn gbk_lossy(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    /// 「程序:」的 GBK 字节
    fn gbk_program_label() -> String {
        gbk_lossy(&[0xB3, 0xCC, 0xD0, 0xF2, 0x3A])
    }

    fn registry_value(app: &str, action: &str, active: &str, dir: &str, name: &str) -> String {
        format!(
            "v2.30|Action={}|Active={}|Dir={}|App={}|Name={}|",
            action, active, dir, app, name
        )
    }

    #[test]
    fn netsh_label_is_truly_unmatchable() {
        // 守住前提：中文标签经 lossy 解码后不可能再被 strip_prefix("程序:") 命中
        assert!(!gbk_program_label().starts_with("程序:"));
        assert!(gbk_program_label().contains('\u{FFFD}'));
    }

    #[test]
    fn netsh_zh_cn_output_with_ascii_path_is_a_match() {
        let text = format!("\r\n{}  {}\r\n", gbk_program_label(), BIN);
        assert_eq!(parse_netsh_rule_program(&text, BIN), Some(true));
    }

    #[test]
    fn netsh_english_output_is_a_match() {
        let text = format!("Program:      {}\r\n", BIN);
        assert_eq!(parse_netsh_rule_program(&text, BIN), Some(true));
    }

    #[test]
    fn netsh_stale_path_is_a_mismatch() {
        let text = format!("{}  C:\\OldInstall\\tools\\openp2p\\openp2p.exe\r\n", gbk_program_label());
        assert_eq!(parse_netsh_rule_program(&text, BIN), Some(false));
    }

    /// 回归：旧实现用全文 contains，`...openp2p.exe.bak` 这类前缀相同的路径会被判成命中
    #[test]
    fn netsh_longer_path_with_same_prefix_is_not_a_match() {
        let text = format!("{}  {}.bak\r\n", gbk_program_label(), BIN);
        assert_eq!(parse_netsh_rule_program(&text, BIN), Some(false));
    }

    /// 回归：中文用户名 / 中文目录下，路径本身也被代码页损毁。
    /// 此时必须返回 None（宽松放行），绝不能返回 Some(false) 把正确规则误报成未放行。
    #[test]
    fn netsh_non_ascii_engine_path_is_unknown_not_mismatch() {
        let cjk = r"C:\Users\张伟\AppData\Roaming\com.chunfengdu.app\openp2p\openp2p.exe";
        let text = format!("{}  {}\r\n", gbk_program_label(), cjk);
        assert_eq!(parse_netsh_rule_program(&text, cjk), None);
    }

    #[test]
    fn netsh_without_any_path_is_unknown() {
        let none_text = "没有与指定标准相匹配的规则。\r\n";
        assert_eq!(parse_netsh_rule_program(none_text, BIN), None);
        // 非程序规则（如按端口放行）也不该被认成路径
        let port_rule = format!(
            "{}  任何\r\n{}  任何\r\n{}  445\r\n",
            gbk_program_label(),
            gbk_lossy(&[0xB1, 0xBE, 0xB5, 0xD8, 0x3A]), // 「本地:」
            gbk_lossy(&[0xD0, 0xAD, 0xD2, 0xE9, 0x3A]), // 「协议:」
        );
        assert_eq!(parse_netsh_rule_program(&port_rule, BIN), None);
    }

    #[test]
    fn registry_value_fields_split_on_part_boundaries() {
        let v = registry_value(BIN, "Allow", "TRUE", "In", "ChunFengDu P2P");
        assert_eq!(rule_value_field(&v, "App"), Some(BIN));
        assert_eq!(rule_value_field(&v, "Action"), Some("Allow"));
        assert!(rule_value_is_named(&v, "ChunFengDu P2P"));

        // 前缀相同的规则名不能被误命中（旧实现靠 "Name=<名>|" 拼接，边界正确但脆弱）
        assert!(!rule_value_is_named(&v, "ChunFengDu"));
        assert!(!rule_value_is_named(&v, "ChunFengDu P2P Test"));

        // 带引号的 Name 形态同样要认
        let quoted = format!("v2.30|Action=Allow|Name=\"{}\"|", "ChunFengDu P2P");
        assert!(rule_value_is_named(&quoted, "ChunFengDu P2P"));
    }

    /// 回归：被禁用 / 改成阻止 / 方向为出站 的同名规则，即便路径正确也不放行入站流量
    #[test]
    fn disabled_blocking_or_outbound_rule_is_not_effective() {
        assert!(!rule_value_is_effective(&registry_value(BIN, "Allow", "FALSE", "In", "ChunFengDu P2P")));
        assert!(!rule_value_is_effective(&registry_value(BIN, "Block", "TRUE", "In", "ChunFengDu P2P")));
        assert!(!rule_value_is_effective(&registry_value(BIN, "Allow", "TRUE", "Out", "ChunFengDu P2P")));
        assert!(rule_value_is_effective(&registry_value(BIN, "Allow", "TRUE", "In", "ChunFengDu P2P")));
        // 字段缺失不足以断言未生效：保持宽松，避免误报未放行
        assert!(rule_value_is_effective("v2.30|App=C:\\p\\openp2p.exe|Name=ChunFengDu P2P|"));
    }

    #[test]
    fn path_normalization_ignores_case_slashes_and_quotes() {
        assert_eq!(
            normalize_win_path("  \"C:/Users/Lenovo/OpenP2P.EXE\"  "),
            r"c:\users\lenovo\openp2p.exe"
        );
    }
}
