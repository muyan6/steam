-- 验证「入库时预置清单请求码」这一改动的 Lua 侧语义。
--
-- 为什么需要这个脚本：
--   该改动把取码结果写进规则文件里的 CFD_CODE_OK 表，与 manifest.lua 的
--   fetch_manifest_code 共用同一张全局表。这里有三处只能靠运行验证的风险：
--     1) OST 的 LuaConfig::ParseFile 是逐行增量编译（见 check_manifest_lua.lua
--        的背景说明），顶层 local 会跨 chunk 丢失 —— 预置段必须全用全局赋值；
--     2) 规则文件与 manifest.lua 的加载顺序不确定，预置段必须对两种顺序都成立；
--     3) 预置的 ts 必须让内核 900 秒 TTL 判定为「未过期」，否则预置等于没写。
--
-- 用法: lua54.exe scripts/check_warmed_codes.lua
-- 退出码: 0 = 通过, 1 = 任一断言失败

local OST_RS = 'src-tauri/src/ost.rs'

local function read_file(p)
    local fh = io.open(p, 'rb')
    if not fh then
        print('FAIL: cannot open ' .. p)
        os.exit(1)
    end
    local c = fh:read('*a')
    fh:close()
    return c
end

-- ===== 0. 从 ost.rs 抽取真正会被部署的 MANIFEST_LUA =====
local ost = read_file(OST_RS)
local marker = 'pub const MANIFEST_LUA: &str = r#"'
local s = ost:find(marker, 1, true)
if not s then
    print('FAIL: MANIFEST_LUA marker not found in ost.rs')
    os.exit(1)
end
local body_start = s + #marker
local e = ost:find('"#;', body_start, true)
if not e then
    print('FAIL: MANIFEST_LUA terminator not found in ost.rs')
    os.exit(1)
end
local manifest_lua = ost:sub(body_start, e - 1)
print(string.format('EXTRACTED manifest.lua bytes=%d', #manifest_lua))

-- ===== 1. 复刻增量编译（与 check_manifest_lua.lua 完全一致） =====
local function incremental_compile(content, label)
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
                print(string.format('FAIL[%s]: RUNTIME_ERROR at line %d: %s', label, lineNo, tostring(runErr)))
                os.exit(1)
            end
            chunk = ''
        elseif err and not err:match('<eof>') then
            print(string.format('FAIL[%s]: SYNTAX_ERROR at line %d: %s', label, lineNo, tostring(err)))
            os.exit(1)
        end
    end
    if chunk ~= '' then
        local fn, err = load(chunk)
        if not fn then
            print(string.format('FAIL[%s]: SYNTAX_ERROR at EOF: %s', label, tostring(err)))
            os.exit(1)
        end
        local ok, runErr = pcall(fn)
        if not ok then
            print(string.format('FAIL[%s]: RUNTIME_ERROR at EOF: %s', label, tostring(runErr)))
            os.exit(1)
        end
    end
    print(string.format('INCREMENTAL_OK[%s] lines=%d', label, lineNo))
end

-- 与 Rust 端 generate_lua_script 的格式串一一对应。
-- 若 Rust 端格式漂移，第 6 段的 DRIFT 断言会失败。
local function build_preset_block(codes)
    local t = {
        '-- 预置清单请求码缓存（入库时预取，使首次下载零网络往返）',
        'if not CFD_CODE_OK then CFD_CODE_OK = {} end',
        'CFD_CODE_OK_TS = (function() local ok, t = pcall(function() return os.time() end);'
            .. ' if ok and type(t) == "number" then return t end; return 0 end)()',
    }
    for gid, code in pairs(codes) do
        t[#t + 1] = string.format('CFD_CODE_OK["%s"] = { code = "%s", ts = CFD_CODE_OK_TS }', gid, code)
    end
    return table.concat(t, '\n') .. '\n'
end

local PRESET_GID = '2613374344895573127'
local PRESET_CODE = '16792007641517249214'
local OTHER_GID = '9999999999999999999'
local codes = { [PRESET_GID] = PRESET_CODE }

-- ===== 2. 顺序 A：manifest.lua 先加载，预置段后加载（实际部署顺序） =====
_G.http_get = function()
    print('FAIL: fetch_manifest_code made a network call for a pre-warmed GID')
    os.exit(1)
end
incremental_compile(manifest_lua, 'manifest.lua')
incremental_compile(build_preset_block(codes), 'preset-after')

local got = fetch_manifest_code(PRESET_GID)
if got ~= PRESET_CODE then
    print(string.format('FAIL: warmed GID returned %s (want %s) with ZERO network', tostring(got), PRESET_CODE))
    os.exit(1)
end
print('WARMED_HIT_ZERO_NETWORK_OK')

-- ===== 3. 顺序 B：预置段先加载，manifest.lua 后加载 =====
-- 必须同样成立 —— 加载顺序由 OST 决定，我们无法假定。
local block_first = build_preset_block(codes)
local f1 = assert(load(block_first))
f1()
-- 增量编译 manifest.lua：其惰性建表 `if not CFD_CODE_OK then ... end`
-- 必须复用预置段已建好的表，而不是把它覆盖成空表
incremental_compile(manifest_lua, 'manifest-after')

local gotB = fetch_manifest_code(PRESET_GID)
if gotB ~= PRESET_CODE then
    print(string.format('FAIL: order B lost the preset (got %s) — manifest.lua overwrote CFD_CODE_OK', tostring(gotB)))
    os.exit(1)
end
print('ORDER_INDEPENDENCE_OK')

-- ===== 4. 未预置的 GID 仍必须走网络（证明没有把取码链路整体短路） =====
local netCalls = 0
_G.http_get = function()
    netCalls = netCalls + 1
    return '555666777', 200
end
local other = fetch_manifest_code(OTHER_GID)
if other ~= '555666777' then
    print(string.format('FAIL: non-warmed GID should still fetch from network, got %s', tostring(other)))
    os.exit(1)
end
if netCalls ~= 1 then
    print(string.format('FAIL: expected exactly 1 network call for non-warmed GID, got %d', netCalls))
    os.exit(1)
end
print('UNWARMED_FALLBACK_OK')

-- ===== 5. ts 必须是「未过期」的真实时间戳而非 0 =====
-- ts=0 时内核走 `nowTs > 0 and (nowTs - 0) >= TTL` 判过期并删除条目，
-- 等于预置完全失效（静默退化为改动前行为，用户看到的还是「首次无网络」）。
local nowTs = cfd_now()
if type(nowTs) == 'number' and nowTs > 0 then
    local entryTs = CFD_CODE_OK[PRESET_GID] and CFD_CODE_OK[PRESET_GID].ts
    if type(entryTs) ~= 'number' or entryTs <= 0 then
        print(string.format('FAIL: preset ts must be a live timestamp when os.time works, got %s', tostring(entryTs)))
        os.exit(1)
    end
    if math.abs(nowTs - entryTs) > 60 then
        print('FAIL: preset ts is not the load-time timestamp (TTL window would be wrong)')
        os.exit(1)
    end
    print('TIMESTAMP_LIVE_OK')
else
    -- os 不可用：预置 ts=0，同时内核 cfd_now() 也返回 0，`nowTs > 0` 为假
    -- → 缓存仍命中。这是有意的安全降级，此处显式确认它确实命中。
    print('OS_TIME_UNAVAILABLE_GRACEFUL_PATH_OK')
end

-- ===== 6. Rust 端格式漂移检测 =====
-- 上面的 build_preset_block 是手写的镜像。这里反向确认 ost.rs 里确实存在
-- 同形状的格式串，避免「测试与实现各自漂移却都自洽」。
local function contains(needle)
    return ost:find(needle, 1, true) ~= nil
end

-- 刻意只匹配无转义符的片段，避免本脚本自身的转义与 Rust 源码转义互相混淆
local drift_checks = {
    { 'if not {} then {} = {{}} end', 'CFD_CODE_OK lazy-init format string' },
    { '_TS = (function() local ok, t = pcall(function() return os.time() end)', 'load-time timestamp format string' },
    { 'ts = {0}_TS }}', 'per-GID assignment format string' },
    { 'const MANIFEST_CODE_CACHE_TABLE: &str = "CFD_CODE_OK"', 'cache table name constant' },
    { 'payload.lock_version != Some(true) && !codes.is_empty()', 'lock-mode guard on the preset block' },
}
for _, c in ipairs(drift_checks) do
    if not contains(c[1]) then
        print('FAIL[DRIFT]: ost.rs lost the ' .. c[2])
        os.exit(1)
    end
end
print('NO_FORMAT_DRIFT_OK')

print('ALL_WARMED_CODE_CHECKS_PASSED')
os.exit(0)