use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 标志，避免子进程弹出黑框命令行
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Steam 原生接口（SteamClient）进程隔离执行器（优化 1）
///
/// 架构铁律与设计原则：
/// 1. 绝不在 Tauri GUI 主进程中直接通过 FFI 加载 steamclient.dll 或 steamclient64.dll；
/// 2. Valve 原生 DLL 包含强状态全局单例，在同一进程中初始化指定 AppID 后无法安全卸载与切换；
/// 3. 若在主进程直接加载，任何 C++ 异常、指针崩溃、DLL 损坏或 Steam 客户端退出均会导致 Tauri 窗口闪退；
/// 4. 本模块规范了独立 Worker 子进程隔离模式：主进程通过子进程唤起外部轻量 Worker 执行一次性任务，
///    子进程完成输出 JSON 后立即销毁并释放句柄，主界面 100% 免受任何底层崩溃影响。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRunResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub data: Option<serde_json::Value>,
    pub raw_output: String,
    pub error: Option<String>,
}

/// 执行隔离的 Steam 外部工作进程
pub fn run_isolated_steam_worker(
    worker_exe: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<WorkerRunResult, String> {
    if !worker_exe.exists() {
        return Err(format!("未找到指定的 Steam Worker 执行程序: {:?}", worker_exe));
    }

    let mut cmd = Command::new(worker_exe);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let start = std::time::Instant::now();
    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 Steam Worker 子进程失败: {}", e))?;

    // 带超时的子进程等待
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output()
                    .map_err(|e| format!("读取 Worker 输出失败: {}", e))?;

                let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

                let json_data = serde_json::from_str::<serde_json::Value>(stdout_str.trim()).ok();

                return Ok(WorkerRunResult {
                    success: status.success(),
                    exit_code: status.code(),
                    data: json_data,
                    raw_output: stdout_str,
                    error: if !stderr_str.trim().is_empty() {
                        Some(stderr_str)
                    } else if !status.success() {
                        Some(format!("Worker 异常退出，状态码: {:?}", status.code()))
                    } else {
                        None
                    },
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(format!("Steam Worker 执行超时（已超过 {:?}），强制终止子进程以防主界面受阻", timeout));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(format!("等待 Steam Worker 子进程异常: {}", e));
            }
        }
    }
}
