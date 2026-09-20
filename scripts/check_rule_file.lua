-- 对「实际部署在 Steam 目录里的规则文件」做增量编译验证。
--
-- 用法: lua54.exe scripts/check_rule_file.lua <rule.lua> [more.lua ...]
-- 退出码: 0 = 全部可增量编译, 1 = 有文件出现语法/运行时错误
--
-- 为什么需要它：
--   OST 的 LuaConfig::ParseFile 是逐行累积、凑成完整语法就立即执行的循环
--   （见 check_manifest_lua.lua 的背景说明）。某个 chunk 一旦出现语法错误，
--   它之后的语句就不会被应用 —— 表现正是「密钥没注入」，Steam 报「无许可 /
--   No License」。这与「无网络」（取码慢、清单拉不下来）是完全不同的症状，
--   必须能分开定位。
--
--   本脚本复刻该循环，并打桩 addappid / setDepotKey / addtoken / setManifestid
--   来统计**真正被执行**的调用数，同时报告 CFD_CODE_OK 里预置了多少个码。

local function incremental_compile(content)
    local chunk, lineNo, chunks = '', 0, 0
    local errs = {}
    for raw in (content .. '\n'):gmatch('([^\n]*)\n') do
        lineNo = lineNo + 1
        local line = raw:gsub('\r$', '')
        chunk = (chunk == '') and line or (chunk .. '\n' .. line)

        local fn, err = load(chunk)
        if fn then
            local ok, runErr = pcall(fn)
            if not ok then
                errs[#errs + 1] = string.format('RUNTIME line %d: %s', lineNo, tostring(runErr))
            end
            chunk = ''
            chunks = chunks + 1
        elseif err and not err:match('<eof>') then
            -- 真实语法错误：该 chunk 连同其后的语句都不会生效
            errs[#errs + 1] = string.format('SYNTAX line %d: %s', lineNo, tostring(err))
            chunk = ''
        end
    end
    if chunk ~= '' then
        local fn, err = load(chunk)
        if not fn then
            errs[#errs + 1] = 'SYNTAX EOF: ' .. tostring(err)
        else
            local ok, runErr = pcall(fn)
            if not ok then
                errs[#errs + 1] = 'RUNTIME EOF: ' .. tostring(runErr)
            end
            chunks = chunks + 1
        end
    end
    return chunks, lineNo, errs
end

local function count_table(t)
    if type(t) ~= 'table' then return 0 end
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

local all_ok = true

local function check(path)
    local fh = io.open(path, 'rb')
    if not fh then
        print(string.format('SKIP %s (cannot open)', path))
        return
    end
    local content = fh:read('*a')
    fh:close()

    -- 每次检查前重置计数与全局表，避免上一个文件的残留污染
    local nApp, nAppKeyed, nAppBare, nSetKey, nTok, nManifest = 0, 0, 0, 0, 0, 0
    _G.CFD_CODE_OK = nil
    _G.CFD_CODE_FAIL = nil
    _G.addappid = function(_id, _flag, key)
        nApp = nApp + 1
        if key and #tostring(key) >= 32 then
            nAppKeyed = nAppKeyed + 1
        else
            nAppBare = nAppBare + 1
        end
    end
    _G.setDepotKey = function(_id, key)
        if key and #tostring(key) >= 32 then nSetKey = nSetKey + 1 end
    end
    _G.addtoken = function() nTok = nTok + 1 end
    _G.setManifestid = function() nManifest = nManifest + 1 end

    local chunks, lines, errs = incremental_compile(content)
    local warmed = count_table(_G.CFD_CODE_OK)

    print(string.format(
        '%s\n   lines=%d chunks=%d addappid=%d(带密钥 %d / 裸挂载 %d) setDepotKey=%d addtoken=%d setManifestid=%d 预置码=%d',
        path, lines, chunks, nApp, nAppKeyed, nAppBare, nSetKey, nTok, nManifest, warmed))

    if #errs > 0 then
        all_ok = false
        for _, e in ipairs(errs) do
            print('   !! ' .. e)
        end
    end
end

if not arg or #arg == 0 then
    print('FAIL: 需要至少一个规则文件路径')
    os.exit(1)
end

for i = 1, #arg do
    check(arg[i])
end

if all_ok then
    print('ALL_RULE_FILES_COMPILE_OK')
    os.exit(0)
end
print('SOME_RULE_FILES_BROKEN')
os.exit(1)
