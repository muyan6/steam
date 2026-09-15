# 校验 src-tauri/src/ost.rs 中内嵌的 MANIFEST_LUA。
#
# 做两件事：
#   1. 从 Rust 源码里提取 MANIFEST_LUA 原始字符串；
#   2. 交给 check_manifest_lua.lua，用真实 Lua 解释器复刻 OST 的增量编译行为
#      并做端到端行为验证（全局符号可见性 / 调度 / 正负缓存 / ManifestDeX 配置）。
#
# 为什么不能只靠 cargo check：Rust 编译期完全看不到 Lua 字符串内部的问题，
# 而顶层 `local` 会在 OST 增量编译时丢失作用域，导致清单调度器静默失效。
#
# 用法: powershell -File scripts/check_manifest_lua.ps1
# 退出码: 0 = 通过, 1 = 任一检查失败

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repoRoot = Split-Path -Parent $PSScriptRoot
$rustFile = Join-Path $repoRoot 'src-tauri\src\ost.rs'
$checker  = Join-Path $PSScriptRoot 'check_manifest_lua.lua'

if (-not (Test-Path $rustFile)) { Write-Host "EXTRACT_FAILED: cannot find $rustFile"; exit 1 }
if (-not (Test-Path $checker))  { Write-Host "MISSING_CHECKER: cannot find $checker"; exit 1 }

$src = Get-Content -Raw $rustFile
$m = [regex]::Match($src, 'pub const MANIFEST_LUA: &str = r#"(?s)(.*?)"#;')
if (-not $m.Success) { Write-Host 'EXTRACT_FAILED: MANIFEST_LUA definition not matched'; exit 1 }
$lua = $m.Groups[1].Value

$tmp = Join-Path $env:TEMP 'cfd_manifest_extracted.lua'
[System.IO.File]::WriteAllText($tmp, $lua, [System.Text.UTF8Encoding]::new($false))
Write-Host ("extracted lua_chars=" + $lua.Length + " -> " + $tmp)

# 定位 Lua 解释器（OST 内嵌 5.4，优先 5.4 以保持语义一致）
$luaExe = $null
foreach ($name in @('lua54', 'lua5.4', 'lua', 'luajit')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $luaExe = $cmd.Source; break }
}
if (-not $luaExe) {
    $fallback = 'C:\Program Files\lua\lua54.exe'
    if (Test-Path $fallback) { $luaExe = $fallback }
}
if (-not $luaExe) {
    Write-Host 'FAIL: no Lua interpreter found (need lua54 / lua5.4 / lua / luajit)'
    exit 1
}
Write-Host ("lua interpreter: " + $luaExe)

$fwdChecker = $checker -replace '\\', '/'
$fwdTmp     = $tmp     -replace '\\', '/'
$out = & $luaExe $fwdChecker $fwdTmp 2>&1
$out | ForEach-Object { Write-Host $_ }

if ($out -match 'ALL_CHECKS_PASSED') { exit 0 }
exit 1
