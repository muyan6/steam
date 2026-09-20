-- 验证「入库时预置清单请求码」这一改动的 Lua 侧语义。
--
-- 为什么需要这个脚本：
--   该改动把取码结果写进规则文件里的 CFD_CODE_OK 表，与 manifest.lua 的
--   fetch_manifest_code 共用同一张全局表。这里有四处只能靠运行验证的风险：
--     1) OST 的 LuaConfig::ParseFile 是逐行增量编译（见 check_manifest_lua.lua
--        的背景说明），顶层 local 会跨 chunk 丢失 —— 预置段必须全用全局赋值；
--     2) 规则文件与 manifest.lua 的加载顺序不确定，预置段必须对两种顺序都成立；
--     3) 刚写入的 ts 必须让内核 900 秒 TTL 判定为「未过期」，否则预置等于没写；
--     4) **过期的预置必须失效并回退现场取码** —— ts 若写成「文件被载入的时刻」
--        而不是「取到码的时刻」，一天前的旧码会伪装成新码喂给 Steam，
--        比不预置更糟（码已轮换，必然拉不到清单）。
--
-- 用法: lua scripts/check_warmed_codes.lua
-- 退出码: 0 = 通过, 1 = 任一断言失败
--
-- 诊断同时写入 warmed_report.txt：本仓库的验证环境偶尔会截断/错排
-- 子进程的多行 stdout，只靠 print 定位失败原因不可靠。

local REPORT = {}
local function say(s)
    REPORT[#REPORT + 1] = s
    print(s)
end
local function flush_report()
    local fh = io.open('warmed_report.txt', 'wb')
    if fh then
        fh:write(table.concat(REPORT, '\n') .. '\n')
        fh:close()
    end
end
local function die(msg)
    say('FAIL: ' .. msg)
    flush_report()
    os.exit(1)
end

local OST_RS = 'src-tauri/src/ost.rs'

local function read_file(p)
    local fh = io.open(p, 'rb')
    if not fh then die('cannot open ' .. p) end
    local c = fh:read('*a')
    fh:close()
    return c
end

-- ===== 0. 从 ost.rs 抽取真正会被部署的 MANIFEST_LUA =====
local ost = read_file(OST_RS)
local marker = 'pub const MANIFEST_LUA: &str = r#"'
local s = ost:find(marker, 1, true)
if not s then die('MANIFEST_LUA marker not found in ost.rs') end
local body_start = s + #marker
local e = ost:find('"#;', body_start, true)
if not e then die('MANIFEST_LUA terminator not found in ost.rs') end
local manifest_lua = ost:sub(body_start, e - 1)
say(string.format('EXTRACTED manifest.lua bytes=%d', #manifest_lua))

-- ===== 1. 复刻增量编译（与 check_manifest_lua.lua 完全一致） =====
-- 返回 true 或 false+原因；不使用 os.exit，便于上层给出更精确的诊断。
local function incremental_compile(content)
    local chunk = ''
    local lineNo = 0
    for raw in (content .. '\n'):gmatch('([^\n]*)\n') do
        lineNo = lineNo + 1
        local line = raw:gsub('\r$', '')
        chunk = (chunk == '') and line or (chunk .. '\n' .. line)

        local fn, err = load(chunk)
        if fn then
            local ok, runErr = pcall(fn)
            if not ok then
                return false, string.format('RUNTIME at line %d: %s', lineNo, tostring(runErr))
            end
            chunk = ''
        elseif err and not err:match('<eof>') then
            return false, string.format('SYNTAX at line %d: %s', lineNo, tostring(err))
        end
    end
    if chunk ~= '' then
        local fn, err = load(chunk)
        if not fn then return false, 'SYNTAX at EOF: ' .. tostring(err) end
        local ok, runErr = pcall(fn)
        if not ok then return false, 'RUNTIME at EOF: ' .. tostring(runErr) end
    end
    return true
end

-- 与 Rust 端 generate_lua_script 的格式串一一对应。
-- ts 由 Rust 侧在写盘时求得、写成字面量整数（见 ost.rs 预置段注释：
-- 写成「载入时刻」会让旧码伪装成新码）。
local function build_preset_block(codes, ts)
    local t = {
        '-- 预置清单请求码缓存（入库时预取，使首次下载零网络往返）',
        'if not CFD_CODE_OK then CFD_CODE_OK = {} end',
    }
    for gid, code in pairs(codes) do
        t[#t + 1] = string.format('CFD_CODE_OK["%s"] = { code = "%s", ts = %d }', gid, code, ts)
    end
    return table.concat(t, '\n') .. '\n'
end

local PRESET_GID = '2613374344895573127'
local PRESET_CODE = '16792007641517249214'
local OTHER_GID = '9999999999999999999'
local codes = { [PRESET_GID] = PRESET_CODE }
-- 模拟「刚刚取到码」：与内核 cfd_now() 同源（os.time）
local NOW_TS = os.time()

-- ===== 2. 顺序 A：manifest.lua 先加载，预置段后加载（实际部署顺序） =====
_G.http_get = function()
    die('fetch_manifest_code made a network call for a pre-warmed GID')
end
local okA, errA = incremental_compile(manifest_lua)
if not okA then die('manifest.lua compile failed: ' .. errA) end
local okB1, errB1 = incremental_compile(build_preset_block(codes, NOW_TS))
if not okB1 then die('preset block compile failed: ' .. errB1) end

local got = fetch_manifest_code(PRESET_GID)
if got ~= PRESET_CODE then
    die(string.format('warmed GID returned %s (want %s) with ZERO network', tostring(got), PRESET_CODE))
end
say('WARMED_HIT_ZERO_NETWORK_OK')

-- ===== 3. 顺序 B：预置段先加载，manifest.lua 后加载 =====
-- 必须同样成立 —— 加载顺序由 OST 决定，我们无法假定。
-- 先清空，确保本段是唯一的来源（否则会误用顺序 A 的残留而假通过）。
CFD_CODE_OK = nil
CFD_CODE_FAIL = nil
local f1 = assert(load(build_preset_block(codes, NOW_TS)))
f1()
local okB2, errB2 = incremental_compile(manifest_lua)
if not okB2 then die('manifest.lua compile (order B) failed: ' .. errB2) end

local gotB = fetch_manifest_code(PRESET_GID)
if gotB ~= PRESET_CODE then
    die(string.format('order B lost the preset (got %s) — manifest.lua overwrote CFD_CODE_OK', tostring(gotB)))
end
say('ORDER_INDEPENDENCE_OK')

-- ===== 4. 未预置的 GID 仍必须走网络（证明没有把取码链路整体短路） =====
local netCalls = 0
_G.http_get = function()
    netCalls = netCalls + 1
    return '555666777', 200
end
local other = fetch_manifest_code(OTHER_GID)
if other ~= '555666777' then
    die(string.format('non-warmed GID should still fetch from network, got %s', tostring(other)))
end
if netCalls ~= 1 then
    die(string.format('expected exactly 1 network call for non-warmed GID, got %d', netCalls))
end
say('UNWARMED_FALLBACK_OK')

-- ===== 5. ts 语义：必须是「取码时刻」，且过期预置必须失效 =====
-- 这是本改动最容易搞反的一点，两个方向都要验证：
--   刚写入（ts=now）→ 必须命中，且零网络往返；
--   已过期（ts 落在 TTL 之外）→ 必须被丢弃，并回退到现场取码。
local entryTs = CFD_CODE_OK[PRESET_GID] and CFD_CODE_OK[PRESET_GID].ts
if type(entryTs) ~= 'number' then
    die('preset entry lost its ts field (type=' .. type(entryTs) .. ')')
end
if math.abs(NOW_TS - entryTs) > 5 then
    die(string.format('preset ts must be the fetch time (%d), got %s', NOW_TS, tostring(entryTs)))
end
say('TIMESTAMP_IS_FETCH_TIME_OK')

local STALE_GID = '8888888888888888888'
local staleCalls = 0
_G.http_get = function()
    staleCalls = staleCalls + 1
    return '111222333', 200
end
-- 过期基准必须取**当前**内核时钟，不能复用脚本开头捕获的 NOW_TS：
-- 本脚本自身运行若干秒后，NOW_TS 与 cfd_now() 之间会出现偏移，
-- 导致「NOW_TS - 901」实际只比当前时刻早几秒，断言随之失真。
local STALE_BASE = cfd_now()
if not (type(STALE_BASE) == 'number' and STALE_BASE > 0) then
    die('cfd_now() unusable for the staleness case (got ' .. tostring(STALE_BASE) .. ')')
end
-- 901 秒 > CFD_CODE_TTL(900)：内核必须判它过期
local okStale, errStale = incremental_compile(build_preset_block({ [STALE_GID] = '999888777' }, STALE_BASE - 901))
if not okStale then die('stale preset block compile failed: ' .. errStale) end
local staleEntryTs = (CFD_CODE_OK[STALE_GID] or {}).ts
if not (type(staleEntryTs) == 'number' and (STALE_BASE - staleEntryTs) >= 900) then
    die(string.format('stale fixture is not actually stale (base=%s ts=%s)', tostring(STALE_BASE), tostring(staleEntryTs)))
end
local staleGot = fetch_manifest_code(STALE_GID)
if staleGot ~= '111222333' then
    die(string.format('stale preset must be discarded (got %s, want the live code)', tostring(staleGot)))
end
if staleCalls ~= 1 then
    die(string.format('stale preset should trigger exactly 1 live fetch, got %d', staleCalls))
end
say('STALE_PRESET_EXPIRES_OK')

-- ===== 6. Rust 端格式漂移检测 =====
-- 上面的 build_preset_block 是手写的镜像。这里反向确认 ost.rs 里确实存在
-- 同形状的格式串，避免「测试与实现各自漂移却都自洽」。
local function contains(needle)
    return ost:find(needle, 1, true) ~= nil
end

-- 刻意只匹配无转义符的片段，避免本脚本自身的转义与 Rust 源码转义互相混淆
local drift_checks = {
    { 'if not {} then {} = {{}} end', 'CFD_CODE_OK lazy-init format string' },
    { 'ts = {3} }}', 'per-GID assignment carrying a literal fetch timestamp' },
    { 'fn unix_now_secs() -> u64', 'Rust-side fetch-time helper' },
    { 'const MANIFEST_CODE_CACHE_TABLE: &str = "CFD_CODE_OK"', 'cache table name constant' },
    { 'payload.lock_version != Some(true) && !codes.is_empty()', 'lock-mode guard on the preset block' },
}
for _, c in ipairs(drift_checks) do
    if not contains(c[1]) then
        die('DRIFT: ost.rs lost the ' .. c[2])
    end
end
say('NO_FORMAT_DRIFT_OK')

say('ALL_WARMED_CODE_CHECKS_PASSED')
flush_report()
os.exit(0)
