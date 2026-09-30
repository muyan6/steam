// 直接编译生产纯模块，避免 Tauri/WebView2 DLL 对单元测试的无关启动依赖。
#[path = "../../../src-tauri/src/p2p_log.rs"]
pub mod p2p_log;
#[path = "../../../src-tauri/src/update_validation.rs"]
pub mod update_validation;
#[path = "../../../src-tauri/src/rule_cleanup.rs"]
pub mod rule_cleanup;

#[path = "../../../src-tauri/src/file_restore.rs"]
pub mod file_restore;
