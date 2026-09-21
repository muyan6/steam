use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

static WATCHER_RUNNING: std::sync::OnceLock<Arc<AtomicBool>> = std::sync::OnceLock::new();

/// 启动 config/lua 目录的后台防抖监听服务（优化 2）
///
/// 功能：
/// 1. 监听 steam/config/lua 及其子目录（含 Disable/）；
/// 2. 仅捕获 .lua 文件的创建、修改、重命名与删除事件；
/// 3. 内置 400ms 防抖队列（Debounce），在连续文件写入平息后向前端推送一次 lua-files-changed 事件；
/// 4. 彻底消除用户手动刷新需求，且零 CPU/IO 轮询浪费。
pub fn start_lua_watcher(app_handle: AppHandle, steam_path: &Path) {
    let lua_dir = match crate::lua_manager::ensure_lua_dirs(steam_path) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[LuaWatcher] 初始化监听目录失败: {}", e);
            return;
        }
    };

    let stop_signal = Arc::new(AtomicBool::new(false));
    if WATCHER_RUNNING.set(Arc::clone(&stop_signal)).is_err() {
        // 已经运行，避免重复启动多个线程
        return;
    }

    let dir_to_watch = lua_dir.clone();
    let thread_stop = Arc::clone(&stop_signal);

    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();

        let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let is_lua = event.paths.iter().any(|p| {
                    p.extension()
                        .and_then(|e| e.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("lua"))
                        .unwrap_or(false)
                });
                if is_lua {
                    let _ = tx.send(());
                }
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[LuaWatcher] 创建文件监听器失败: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&dir_to_watch, RecursiveMode::Recursive) {
            eprintln!("[LuaWatcher] 监听目录 {:?} 失败: {}", dir_to_watch, e);
            return;
        }

        println!("[LuaWatcher] 后台防抖文件监听已就绪，正在监听: {:?}", dir_to_watch);

        let debounce_duration = Duration::from_millis(400);

        while !thread_stop.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(_) => {
                    // 收到事件，启动防抖平息计时
                    let mut last_event_time = Instant::now();

                    // 平息窗口内持续排空后续涌入的事件
                    while last_event_time.elapsed() < debounce_duration {
                        let remaining = debounce_duration.saturating_sub(last_event_time.elapsed());
                        if rx.recv_timeout(remaining).is_ok() {
                            last_event_time = Instant::now();
                        }
                    }

                    // 变动平息，向前端推送事件
                    println!("[LuaWatcher] 检测到规则文件变动已平息，推送 lua-files-changed 事件");
                    let _ = app_handle.emit(
                        "lua-files-changed",
                        serde_json::json!({
                            "timestamp": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis())
                                .unwrap_or(0)
                        }),
                    );
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // 超时无事件，循环等待
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }

        println!("[LuaWatcher] 文件监听线程已安全退出");
    });
}
