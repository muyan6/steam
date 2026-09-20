-- 复刻 OST 内核的 manifest.lua 增量编译行为，并对清单调度器做行为验证。
--
-- 背景（这是本脚本存在的唯一理由）：
--   OST 的 LuaConfig::ParseFile 是「逐行累积 → 凑成完整语法就 loadstring → 立即执行
--   → 清空累积缓冲」的循环。Lua 的 local 作用域不跨 chunk，所以文件顶层一旦出现
--   `local function foo()`，foo 会在该 chunk 结束时消失；后续 chunk 里的
--   `function bar() ... foo() ... end` 仍能编译通过（foo 被当作全局引用），
--   但一旦 bar 被调用就报 "attempt to call a nil value"，整个清单调度器静默失效。
--   静态扫描无法可靠区分「函数体内的 local」与「顶层 local」，故改为行为验证。
--
-- 用法: lua54.exe scripts/check_manifest_lua.lua <extracted_manifest.lua>
-- 退出码: 0 = 通过, 1 = 语法/运行时/符号/缓存 任一失败

local src_path = arg and arg[1]
if not src_path or src_path == '' then
    print('FAIL: missing argument <extracted_manifest.lua>')
    os.exit(1)
end

local fh = io.open(src_path, 'rb')
if not fh then
    print('FAIL: cannot open ' .. src_path)
    os.exit(1)
end
local content = fh:read('*a')
fh:close()

-- ===== 1. 复刻增量编译：逐行累积，能编译就立即执行，然后清空 =====
local chunk = ''
local lineNo = 0
local executedChunks = 0

-- 按行切分（兼容 CRLF）
for raw in (content .. '\n'):gmatch('([^\n]*)\n') do
    lineNo = lineNo + 1
    local line = raw:gsub('\r$', '')
    chunk = (chunk == '') and line or (chunk .. '\n' .. line)

    local fn, err = load(chunk)
    if fn then
        local ok, runErr = pcall(fn)
        if not ok then
            print(string.format('RUNTIME_ERROR at line %d: %s', lineNo, tostring(runErr)))
            os.exit(1)
        end
        chunk = ''
        executedChunks = executedChunks + 1
    elseif err and not err:match('<eof>') then
        -- 非「等待后续行」类的错误即为真实语法错误
        print(string.format('SYNTAX_ERROR at line %d: %s', lineNo, tostring(err)))
        os.exit(1)
    end
end

if chunk ~= '' then
    local fn, err = load(chunk)
    if not fn then
        print('SYNTAX_ERROR at EOF: ' .. tostring(err))
        os.exit(1)
    end
    local ok, runErr = pcall(fn)
    if not ok then
        print('RUNTIME_ERROR at EOF: ' .. tostring(runErr))
        os.exit(1)
    end
    executedChunks = executedChunks + 1
end

print(string.format('INCREMENTAL_COMPILE_OK chunks=%d lines=%d', executedChunks, lineNo))

-- ===== 2. 全局符号可见性：这一步专门捕获顶层 local 造成的 nil 调用 =====
for _, name in ipairs({ 'fetch_manifest_code', 'fetch_manifest_code_ex', 'cfd_pick_code', 'cfd_now' }) do
    if type(_G[name]) ~= 'function' then
        print(string.format('FAIL: global function %s is %s (likely a top-level `local` lost across chunks)', name, type(_G[name])))
        os.exit(1)
    end
end
print('GLOBAL_SYMBOLS_OK')

-- ===== 3. cfd_pick_code 单元验证 =====
local cases = {
    { body = '  12345\n', status = 200, want = '12345' },
    { body = '0',         status = 200, want = nil },
    { body = '',          status = 200, want = nil },
    { body = '12345',     status = 404, want = nil },
    { body = nil,         status = 200, want = nil },
    { body = 'abc',       status = 200, want = nil },
}
for i, c in ipairs(cases) do
    local got = cfd_pick_code(c.body, c.status)
    if got ~= c.want then
        print(string.format('FAIL: cfd_pick_code case %d -> %s (want %s)', i, tostring(got), tostring(c.want)))
        os.exit(1)
    end
end
print('PICK_CODE_OK')

-- ===== 4. 端到端行为验证：打桩 http_get，验证调度与缓存 =====
local httpCalls = 0
_G.http_get = function(_url, _headers)
    httpCalls = httpCalls + 1
    return '999888777', 200
end

local r1 = fetch_manifest_code('1000000000000000001')
if r1 ~= '999888777' then
    print('FAIL: fetch_manifest_code returned ' .. tostring(r1) .. ' (expected stubbed code)')
    os.exit(1)
end
if httpCalls ~= 1 then
    print(string.format('FAIL: expected 1 http_get call on first query, got %d', httpCalls))
    os.exit(1)
end
print('DISPATCH_OK')

-- 正缓存：第二次查询必须零网络请求直接命中
_G.http_get = function()
    httpCalls = httpCalls + 1
    return nil, 500
end
local r2 = fetch_manifest_code('1000000000000000001')
if r2 ~= '999888777' then
    print('FAIL: positive cache miss, got ' .. tostring(r2))
    os.exit(1)
end
if httpCalls ~= 1 then
    print(string.format('FAIL: positive cache not used (http_get called %d times)', httpCalls - 1))
    os.exit(1)
end
print('POSITIVE_CACHE_OK')

-- 正缓存 TTL：清单请求码会随时间轮换，缓存必须过期重新取码。
-- 打桩 cfd_now 以便在不等待真实时间的情况下验证过期行为。
local real_cfd_now = cfd_now
-- 同时保存 http_get 桩：后面的负缓存用例依赖上面那个「返回 nil, 500」的桩，
-- 本段结束后必须还原，否则会把负缓存用例一起带偏。
local real_http_get = _G.http_get
local fakeNow = 1000000
_G.cfd_now = function() return fakeNow end

local ttlGid = '3000000000000000003'
_G.http_get = function()
    httpCalls = httpCalls + 1
    return '111222333', 200
end
local t1 = fetch_manifest_code(ttlGid)
if t1 ~= '111222333' then
    print('FAIL: TTL case first fetch got ' .. tostring(t1))
    os.exit(1)
end
local callsAfterFirst = httpCalls

-- 未过期：第二次必须走缓存，零网络请求
local t2 = fetch_manifest_code(ttlGid)
if t2 ~= '111222333' or httpCalls ~= callsAfterFirst then
    print('FAIL: TTL case should hit cache before expiry')
    os.exit(1)
end

-- 推进到超过 CFD_CODE_TTL 之后：必须重新取码（这正是「请求码轮换后仍在用旧码」的回归保护）
fakeNow = fakeNow + CFD_CODE_TTL + 1
_G.http_get = function()
    httpCalls = httpCalls + 1
    return '444555666', 200
end
local t3 = fetch_manifest_code(ttlGid)
if t3 ~= '444555666' then
    print('FAIL: TTL case should refetch after expiry, got ' .. tostring(t3))
    os.exit(1)
end
if httpCalls ~= callsAfterFirst + 1 then
    print(string.format('FAIL: TTL expiry did not trigger a refetch (http_get total %d)', httpCalls))
    os.exit(1)
end
print('POSITIVE_CACHE_TTL_OK')

_G.cfd_now = real_cfd_now
_G.http_get = real_http_get

-- 负缓存（确定性未命中）：上游明确回答「没有这个码」时必须抑制重复请求。
-- 用 404 + 非数字响应体模拟 —— 它属于「确认查不到」，而非「上游过载」。
local callsBefore = httpCalls
_G.http_get = function()
    httpCalls = httpCalls + 1
    return 'not-a-code', 404
end
local r3 = fetch_manifest_code('2000000000000000002')
if r3 ~= nil then
    print('FAIL: expected nil on definitive miss, got ' .. tostring(r3))
    os.exit(1)
end
local callsAfterFirstMiss = httpCalls - callsBefore
if callsAfterFirstMiss < 1 then
    print('FAIL: expected at least 1 http_get on a cold miss')
    os.exit(1)
end
local r4 = fetch_manifest_code('2000000000000000002')
if r4 ~= nil then
    print('FAIL: negative cache should still return nil')
    os.exit(1)
end
if (httpCalls - callsBefore) ~= callsAfterFirstMiss then
    print('FAIL: definitive-miss negative cache not used, extra http_get calls were made')
    os.exit(1)
end
print('NEGATIVE_CACHE_OK')

-- 瞬时故障（429/5xx）**绝不**写负缓存。
-- 这是「第一次点下载报无网络、等一两分钟再点才行」的根因：一次 429 抖动会把
-- 该 gid 冻结 CFD_CODE_NEG_TTL 秒。改成不缓存后，第二次调用必须重新发起网络
-- 请求，而不是直接返回上一次缓存的 nil。
local transientBefore = httpCalls
_G.http_get = function()
    httpCalls = httpCalls + 1
    return nil, 429
end
local t429a = fetch_manifest_code('4000000000000000004')
if t429a ~= nil then
    print('FAIL: expected nil on 429, got ' .. tostring(t429a))
    os.exit(1)
end
local callsAfter429 = httpCalls - transientBefore
_G.http_get = function()
    httpCalls = httpCalls + 1
    return nil, 429
end
local t429b = fetch_manifest_code('4000000000000000004')
if t429b ~= nil then
    print('FAIL: expected nil on second 429, got ' .. tostring(t429b))
    os.exit(1)
end
if (httpCalls - transientBefore) <= callsAfter429 then
    print('FAIL: 429 must NOT be negative-cached (second call should retry the network)')
    os.exit(1)
end
print('TRANSIENT_NOT_NEGATIVE_CACHED_OK')

-- ===== 5. 关键源与请求头存在性 =====
if not content:find('manifest%.manifestdex%.com') then
    print('FAIL: ManifestDeX endpoint missing')
    os.exit(1)
end
if not content:find('ManifestDeX/1%.0', 1, false) then
    print('FAIL: ManifestDeX User-Agent missing')
    os.exit(1)
end
print('MANIFESTDEX_CONFIG_OK')

-- 源优先级：云端中继必须排在 ManifestDeX 直连**之前**。
--
-- 为什么这条是回归保护（与旧断言相反，属有意反转）：
-- Steam 是**逐分包**回调 fetch_manifest_code 的 —— 一个 28 分包的游戏点一次
-- 下载就是 28 次请求，点两次 56 次，而 ManifestDeX 按 IP 限流实测 60 次/分钟。
-- 每个客户端各自直连，等于把限流额度除以客户端数，人一多就集体 429
-- （实测 429/502/200 交替出现）。中继带 5 分钟正缓存 + 单航班去重，能把
-- 「N 客户端 x M 分包」收敛成「每 gid 每 5 分钟 1 次上游请求」，
-- 这是唯一能让多客户端共存的顺序；绕一跳的延迟远小于撞限流后空等的代价。
local dexPos = content:find('manifest.manifestdex.com', 1, true)
local cloudPos = content:find('steam.myil.top/api/manifests/code', 1, true)
if not dexPos then
    print('FAIL: ManifestDeX endpoint missing (needed as direct fallback)')
    os.exit(1)
end
if not cloudPos then
    print('FAIL: cloud relay endpoint missing (must be first priority)')
    os.exit(1)
end
if cloudPos > dexPos then
    print('FAIL: cloud relay must be tried BEFORE ManifestDeX direct (order inverted)')
    os.exit(1)
end
print('SOURCE_ORDER_OK')

print('ALL_CHECKS_PASSED')
os.exit(0)
