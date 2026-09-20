use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::steam::is_steam_running;

// 内嵌 OST 核心二进制库（构建时打包进 EXE，零外部依赖）
const OST_DLL: &[u8] = include_bytes!("../assets/opensteam/OpenSteamTool.dll");
const DWMAPI_DLL: &[u8] = include_bytes!("../assets/opensteam/dwmapi.dll");
const XINPUT_DLL: &[u8] = include_bytes!("../assets/opensteam/xinput1_4.dll");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotInfo {
    pub depot_id: u32,
    pub name: Option<String>,
    pub depot_key: Option<String>,
    pub manifest_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockGamePayload {
    pub app_id: u32,
    pub name: String,
    pub name_zh: Option<String>,
    pub depots: Option<Vec<DepotInfo>>,
    pub dlcs: Option<Vec<u32>>,
    #[serde(default)]
    pub app_level_key: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    /// 版本锁定开关：true 时写入 setManifestid 钉死当前官方最新 GID（联机对版本用）；
    /// false/缺省不钉，OST 内核每次下载时向官方拉取当时最新清单，永远自动最新版
    #[serde(default)]
    pub lock_version: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearRulesResult {
    pub removed: usize,
    pub failed: usize,
    /// 非本工具生成的第三方规则脚本，已跳过保留
    pub skipped: usize,
}

pub fn deploy_core_binaries(steam_path: &Path) -> Result<(), String> {
    // Steam 运行中时核心 DLL 会被进程锁定，覆写必然失败；提前给出可行动的错误信息
    if is_steam_running() {
        return Err("Steam 客户端正在运行，核心 DLL 被进程锁定无法写入。请先退出 Steam（可在工具箱中一键结束进程）后重试。".to_string());
    }

    let targets = [
        ("OpenSteamTool.dll", OST_DLL),
        ("dwmapi.dll", DWMAPI_DLL),
        ("xinput1_4.dll", XINPUT_DLL),
    ];

    for (name, payload) in targets {
        let target = steam_path.join(name);
        fs::write(&target, payload).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                format!("写入 {} 失败: {}（权限不足，Steam 安装在受保护目录时请以管理员身份运行本程序）", name, e)
            } else {
                format!("写入 {} 失败: {}", name, e)
            }
        })?;
    }

    // 默认自愈：自动清理 depotcache 损坏的 0 字节坏清单，并刷新本地 DNS 解析
    crate::toolbox::clean_depotcache_garbage(steam_path);
    crate::steam::flush_dns();

    // 同步部署清单多节点调度脚本
    let _ = deploy_manifest_lua(steam_path);

    Ok(())
}

/// 部署官方与国内高速专线清单代码调度器 (manifest.lua)
/// 彻底根除因上游默认源超时、阻断或 403 导致的 Steam 报错“无互联网连接”。
/// 提取为模块常量：启动自愈时需比对现有文件是否与当前版本一致（缺失/过期则重部署）
pub const MANIFEST_LUA: &str = r#"-- ===== 清单请求码调度器 (由春风渡生成) =====
-- 重要: OST 内核是逐行增量编译本文件的 —— 每个语法完整的前缀都会被当作
-- 独立 chunk 立即执行, 而 Lua 的 local 作用域不跨 chunk。因此顶层一律使用
-- 全局变量, 绝对不能使用 local, 否则后面的函数会找不到它并报 nil 调用错误。
-- 校验方式: pwsh -File scripts/check_manifest_lua.ps1

-- 正缓存 gid -> {code=..., ts=...}。Steam 会针对同一 GID 反复查询(重试/续传/多分包共用),
-- 缓存能把重复请求降为 0 次网络往返。
--
-- 这里必须区分两个完全不同的概念, 混为一谈会得出错误的缓存策略:
--
--   * GID (manifest id) = Valve 为某个 depot 的文件树结构算出的内容指纹。
--     **只在 depot 内容真正更新时才变**, 是稳定值。实测本机 content_log 里
--     115 个 depot 中有 92 个在 17 天内 gid 一次未变; 变化的那些(如 depot 250900
--     出现 11 个 gid)确实是对应游戏发过版本更新。
--     推论: 用旧 gid 只会下到旧版本内容, 但**仍然下得动** —— 不会失败。
--
--   * CODE (清单请求码 / GMRC) = Steam 服务端签发的下载授权凭据。
--     **它与 gid 无关地按时间轮换** —— 实测 depot 281992 / gid 3306222774754384885
--     的码在 08:44~09:12 的 28 分钟里换了 6 次(约 5~6 分钟一次), 而 gid 全程未变:
--       08:44:02 12091008303184869312
--       08:49:10  4290150583116450900
--       08:56:12  8718528965540727549
--       09:01:39  5935441427713080969
--       09:06:30 15707427750034045965
--       09:12:38   248109835839928064
--
-- 所以「不能永久缓存」针对的是 **code**, 不是 gid。旧实现把 (gid, code) 绑定
-- 写死成「同一次 Steam 运行期内永久复用」, 码一轮换缓存就交出旧码, 后续所有
-- 分包都拉不到清单 —— 表现为入库即报「无网络连接」且只有重启 Steam 才可能恢复。
-- 故给正缓存加 TTL, 过期后重新取码; 而 gid 本身可以放心长期持有。
--
-- 失效边界有精确实测(2026-09-20 18:40, 直接向 Valve CDN 请求), 按码龄分桶:
--     0~15 分钟   27/27 可用
--    15~30 分钟    1/1  可用
--    45~60 分钟   10/27 可用
--   120 分钟以上    0/27 可用
--
-- 即「旧码能顶用」只在约半小时内成立。**旧码不是长期资产。**
-- 这条推翻了此前「历史码都返回过 200 所以旧码一直能用」的判断 —— 那些 200
-- 是「当时」的成功记录, 不等于「现在再用仍会成功」。
--
-- 另有一个未解释的异常: 少数 400 分钟以上的码仍返回 200(16/20)。分布不均匀,
-- 可能与该 depot 是否被反复请求有关, 机制未明。正因机制未明, 绝不能把它当作
-- 设计依据 —— 只能按最差情况(半小时)来定窗口。
--
-- 所以末位兜底与持久化码库的价值是「半小时内扛住上游抖动」, 而不是「永久兜底」。
if not CFD_CODE_OK then CFD_CODE_OK = {} end
-- 负缓存 gid -> 失败时间戳。短期抑制, 避免同一 GID 反复空等各源超时。
if not CFD_CODE_FAIL then CFD_CODE_FAIL = {} end
if not CFD_CODE_NEG_TTL then CFD_CODE_NEG_TTL = 120 end
if not CFD_CODE_TTL then CFD_CODE_TTL = 900 end

-- 源级熔断: name -> 最近一次瞬时故障时间戳。
--
-- 为什么必须有: 实测 2026-09-20 当天, 中继与 ManifestDeX 双双失效, 只有古韵的
-- index.php 能出码。但三个源是**串行**试的 —— 每个分包都要先白等中继(0.2s)
-- 再白等 ManifestDeX(0.65s), 才轮到能出码的那个。一个 35 分包的游戏, 19 个
-- 未缓存分包 x 0.85s 的纯浪费 ≈ 16 秒。
-- 有了它, 第一分包探明哪两个源是坏的, 后续分包直接跳过 —— 只剩 0.2s。
-- 60 秒后自动重试, 上游恢复了不会被永久跳过。
if not CFD_SRC_FAIL then CFD_SRC_FAIL = {} end
if not CFD_SRC_FAIL_TTL then CFD_SRC_FAIL_TTL = 60 end

-- 该源是否值得一试(未熔断)
function cfd_src_ok(name)
    local t = CFD_SRC_FAIL[name]
    if not t then return true end
    local now = cfd_now()
    if now > 0 and (now - t) >= CFD_SRC_FAIL_TTL then
        CFD_SRC_FAIL[name] = nil
        return true
    end
    return false
end

-- 标记瞬时故障; 成功则清标记(见 cfd_src_ok 内部)
function cfd_src_fail(name)
    CFD_SRC_FAIL[name] = cfd_now()
end

-- 读正缓存: 命中且未过期才返回 code, 过期即清除并返回 nil
function cfd_cache_get(gid)
    local entry = CFD_CODE_OK[gid]
    if not entry then return nil end
    -- 兼容旧格式(裸字符串): 无时间戳, 视为已过期, 强制重新取码
    if type(entry) == "string" then
        CFD_CODE_OK[gid] = nil
        return nil
    end
    local nowTs = cfd_now()
    if nowTs > 0 and entry.ts and (nowTs - entry.ts) >= CFD_CODE_TTL then
        CFD_CODE_OK[gid] = nil
        return nil
    end
    return entry.code
end

-- 写正缓存: 连同取码时间一起存, 供 cfd_cache_get 判定是否过期
function cfd_cache_put(gid, code)
    CFD_CODE_OK[gid] = { code = code, ts = cfd_now() }
end

function cfd_now()
    local ok, t = pcall(os.time)
    if ok and type(t) == "number" then return t end
    return 0
end

-- 纯数字请求码提取: 容忍首尾空白与换行(不同源返回格式不一)
function cfd_pick_code(body, status)
    if status ~= 200 or not body then return nil end
    local code = body:match("^%s*(%d+)%s*$")
    if code and code ~= "0" then return code end
    return nil
end

-- 瞬时故障状态码: 这些代表「上游此刻过载/不可用」, 而不是「这个 gid 没有码」。
-- 对它们绝不写负缓存 —— 否则一次 429 抖动会把该 gid 冻结 CFD_CODE_NEG_TTL 秒,
-- 表现为「第一次点下载报无网络, 等一两分钟再点才行」, 而实际上游几秒后就恢复了。
function cfd_is_transient(status)
    if status == nil or status == 0 then return true end
    -- 403: Cloudflare 质询页(实测缺失专用 UA 或触发风控时出现), 换 UA / 稍后重试即可
    -- 429: 上游按 IP 限流(实测本机与中继出口 IP 都在限流窗口内)
    -- 5xx: 上游过载; 其中 503 也是中继的专用信号 —— 它已把上游 429 与网络异常
    --      统一映射为 503(见 server manifestController.getManifestCode),
    --      因此 503 必须视为瞬时, 绝不能当成「确认查不到」。
    return status == 403 or status == 429 or status == 500 or status == 502 or status == 503 or status == 504
end

-- 取码主入口。必须用 _ex 签名, 因为末位兜底源(古韵自有码库)需要 depot_id ——
-- 它的接口是 index.php/{depot_id}/{gid}, 只有 gid 根本查不了。
-- 而 Steam 调哪个签名取决于内核版本: 新版给 _ex, 老版只给 fetch_manifest_code。
-- 因此保留两个全局函数, 单参数那个把 depot_id 置 0 后转调 _ex。
--
-- 注意缓存键是 gid 而非 depot_id+gid: 内核回调时 gid 是唯一稳定的标识,
-- 且实测未观察到同一 gid 被两个 depot 共用的情况。depot_id 只用于末位兜底源
-- 的联合键查询, 不参与缓存。
function fetch_manifest_code_ex(app_id, depot_id, gid)
    local cached = cfd_cache_get(gid)
    if cached then return cached end

    local failedAt = CFD_CODE_FAIL[gid]
    if failedAt then
        local nowTs = cfd_now()
        if nowTs > 0 and (nowTs - failedAt) < CFD_CODE_NEG_TTL then return nil end
        CFD_CODE_FAIL[gid] = nil
    end

    local body, status, code
    local transient = false
    -- 「权威源明确回答没有这个 gid」—— 只有它为真才允许写负缓存。
    -- 必须与 transient 分开跟踪: 上游过载(429/5xx/403)与网络异常都只是
    -- 「现在问不到」, 并不代表这个 gid 没有码。把两者混为一谈会让一次
    -- 上游抖动被记成「该 gid 无码」并冻结 CFD_CODE_NEG_TTL 秒。
    local definitive_miss = false

    -- 第一优先级: 春风渡云端中继源。
    --
    -- 为什么中继排第一(而不是直连第一):
    -- ManifestDeX 对客户端侧限流很紧(官方文档写明 60 次/分钟), 而 Steam 是
    -- **逐分包**回调本函数的 —— 一个 28 分包的游戏点一次下载就是 28 次请求,
    -- 点两次 56 次, 第三次必然撞限流。每个客户端各自直连, 等于把限流额度
    -- 除以客户端数, 人一多就集体失败。
    -- 中继带 5 分钟正缓存, 能把「N 客户端 x M 分包」收敛成「每 gid 每 5 分钟
    -- 1 次上游请求」, 这是唯一能让多客户端共存的顺序。绕一跳的延迟远小于
    -- 撞限流后空等的代价。
    -- 中继这一跳的 UA 只是自我标识, **不是**准入门槛 —— 实测中继是裸 nginx
    -- (响应头 Server: nginx, 无 cf-ray), 对空 UA / 任意 UA 一视同仁。
    -- 真正必须卡 UA 的是下面那个 ManifestDeX 直连。
    if cfd_src_ok("relay") then
        -- 带上 depot_id: 中继的末位兜底源有两条路径, index.php/{depot}/{gid} 按
        -- (depot, gid) 联合键查自有库(实测正确组合 200, 错 depot 一律 502),
        -- 而 dex.php/{gid} 是实时聚合层(上游全挂时它自己就回 502)。
        -- 不传 depot_id 时中继只能退到后者 —— 在上游挂掉的当下等于必然失败。
        local relay_url = "https://steam.myil.top/api/manifests/code/" .. gid
        if depot_id and depot_id ~= 0 then
            relay_url = relay_url .. "?depotId=" .. depot_id
        end
        body, status = http_get(relay_url,
                                {["User-Agent"] = "ChunFengDu/1.0"})
        code = cfd_pick_code(body, status)
        if code then cfd_cache_put(gid, code); return code end
        if cfd_is_transient(status) then transient = true; cfd_src_fail("relay") end
        -- 中继的 404 语义是「它替我们问过权威源, 权威源说没有」, 属确认查不到;
        -- 而中继在上游不可用时回 503(落到上面的 transient 分支)。两种语义必须
        -- 分开, 否则一次上游抖动会被当成「该 gid 无码」并冻结两分钟。
        if status == 404 then definitive_miss = true end
    end

    -- 第二优先级: ManifestDeX 清单代码直供源(直连兜底)。
    -- 该源经 Cloudflare 保护, 必须携带专用 User-Agent, 缺失会被返回 403 质询页。
    if cfd_src_ok("manifestdex") then
        body, status = http_get("https://manifest.manifestdex.com/" .. gid,
                                {["User-Agent"] = "ManifestDeX/1.0"})
        code = cfd_pick_code(body, status)
        if code then cfd_cache_put(gid, code); return code end
        if cfd_is_transient(status) then transient = true; cfd_src_fail("manifestdex") end
        if status == 404 then definitive_miss = true end
    end

    -- 第三优先级(末位兜底): 古韵自有码库。
    --
    -- 为什么留这一条: 2026-09-20 ManifestDeX 的 manifest 子域整体 521
    -- (Cloudflare 连不上源站, 其文档站与 api 子域同时正常), 全链路取码断掉。
    -- 而实测 gmrc.guyunsq.com/index.php/{depot}/{gid} 仍稳定返回真实码 ——
    -- 拿它向 Valve CDN 请求清单得到 200 OK(content_log.txt 已留证),
    -- 说明这是真码不是伪造值。
    --
    -- 它排最后: ManifestDeX 一恢复就完全不走这里。
    --
    -- 接口签名必须带 depot_id —— 实测错 depot + 真 gid 返回 502,
    -- 真 depot + 假 gid 也 502, 说明 (depot, gid) 是它库里的联合键。
    -- 这也反证它不是转发 ManifestDeX(那边只认单个 gid)。
    --
    -- 它用 502 + "error: all upstreams failed" 表示「我库里没有且上游也挂了」,
    -- 属**瞬时**语义, 因此只置 transient, 绝不写负缓存。
    -- 注意: 这一源**不**参与源级熔断。它是末位兜底, 前两个源熔断时它就成了唯一
    -- 能出码的路径 —— 若也把它熔断掉, 整条链就彻底哑了。它的接口实测 20 次连打
    -- 全部 200 且零限流, 单次 0.2 秒, 代价可接受。
    if depot_id and depot_id ~= 0 and gid then
        body, status = http_get("https://gmrc.guyunsq.com/index.php/" .. depot_id .. "/" .. gid)
        code = cfd_pick_code(body, status)
        if code then cfd_cache_put(gid, code); return code end
        if cfd_is_transient(status) then transient = true end
    end

    -- 第四优先级: 20770407.xyz —— 与古韵**同源数据**的第二条命。
    --
    -- 为什么加: 实测两源在同一 (depot,gid) 上返回**逐字节相同**的码
    -- (10/10 组合一致), 且都对 Valve CDN 返回 200。它不提供任何新码 ——
    -- 10 组里 0 组是古韵没有的。它唯一的价值是「古韵域名挂掉/被封时还有一个
    -- 能出码的端点」, 即冗余而非覆盖。
    --
    -- 为什么排古韵之后: 古韵前置有缓存层(实测 X-Cache: HIT, 热请求 0.15 秒),
    -- 而它恒为 ~1.0 秒(cf-cache-status: DYNAMIC, 不缓存)。快 7 倍, 没理由让慢的先行。
    -- 另有迹象表明古韵是它的下游缓存(两源数据完全一致 + 古韵有 X-Cache 层),
    -- 若该推断成立, 古韵上游断供时会报错, 那时这一跳正好顶上 —— 顺序恰好正确。
    --
    -- 与第三源写成**平级**的 if, 而不是嵌在它内部: 两者虽然当前都只依赖
    -- depot_id, 但它们是独立的源。嵌在一起会让「以后给古韵加单独前置条件」
    -- 变成「连带跳过 20770407」, 那种耦合很难在 review 时看出来。
    --
    -- 接口同样是 (depot, gid) 联合键: 假 gid / 错 depot 一律 401 Unauthorized,
    -- depot 为 0 或空返回 400 Invalid Depot ID。这也再次反证它不是转发
    -- ManifestDeX(那边只认单个 gid)。
    --
    -- 401 语义要小心: 它表示「这个组合我库里没有」, 属**确认查不到**,
    -- 不能当瞬时故障 —— 否则每次未收录的 gid 都要白等一轮重试。
    -- 但也不写负缓存: 未收录 ≠ Steam 那边没有码, 我们仍有中继可以问。
    if depot_id and depot_id ~= 0 and gid then
        body, status = http_get("https://20770407.xyz/manifest/" .. depot_id .. "/" .. gid)
        code = cfd_pick_code(body, status)
        if code then cfd_cache_put(gid, code); return code end
        if cfd_is_transient(status) then transient = true end
    end

    -- 已移除 wudrm / steamrun 两个第三方源。
    -- 原因: 实测它们已不可用(wudrm 持续 503, steamrun 持续 502),
    -- 留着只会让每个分包都白等一轮超时。

    -- 写负缓存必须同时满足两条: 有源**确认**查不到, 且没有任何源报瞬时故障。
    -- 只要有一个源在报过载, 就说明我们其实不知道这个 gid 有没有码 —— 宁可
    -- 让 Steam 立刻重试(它本来就带 15 秒间隔重试), 也不能冻结两分钟。
    -- 实测本机与中继出口都在 ManifestDeX 的限流窗口内, 这条判断直接决定
    -- 「上游抖动」会不会被放大成「这个 gid 两分钟内谁都拿不到码」。
    if definitive_miss and not transient then
        CFD_CODE_FAIL[gid] = cfd_now()
    end
    return nil
end

-- 单参数兼容入口: 老版内核只调 fetch_manifest_code。
-- depot_id 置 0 → 末位兜底源(需要 depot_id)自动跳过, 行为与加它之前完全一致。
function fetch_manifest_code(gid)
    return fetch_manifest_code_ex(0, 0, gid)
end
"#;

/// manifest.lua 的两份部署目标（config/lua 与 config/stplug-in）
fn manifest_lua_targets(steam_path: &Path) -> [PathBuf; 2] {
    [
        steam_path.join("config").join("lua").join("manifest.lua"),
        steam_path.join("config").join("stplug-in").join("manifest.lua"),
    ]
}

/// 动态清单调度器是否缺失或内容与当前版本不一致（只比对、不写盘，供启动自愈判断）
pub fn manifest_lua_stale(steam_path: &Path) -> bool {
    manifest_lua_targets(steam_path)
        .iter()
        .any(|t| fs::read_to_string(t).map(|s| s != MANIFEST_LUA).unwrap_or(true))
}

pub fn deploy_manifest_lua(steam_path: &Path) -> Result<(), String> {
    for target in manifest_lua_targets(steam_path) {
        if let Ok(existing) = fs::read_to_string(&target) {
            if existing == MANIFEST_LUA {
                continue;
            }
        }
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&target, MANIFEST_LUA);
    }
    Ok(())
}

/// opensteamtool.toml 读-改-写进程级互斥：generate_toml_config 整文件覆写、
/// update_toml_manifest_fields 字段级改写、ensure_auto_switch_default 的
/// 读-判-写序列可能来自不同线程（后台迁移线程 / 工具箱命令 / 入库命令），
/// 并发交错会导致配置互相覆盖丢失字段
pub static TOML_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// opensteamtool.toml 的默认清单节点。
///
/// 原为 "wudrm"，但该源已确认不可用（返回滞后码，会让分包拉不到清单），
/// 且 manifest.lua 的取码源是硬编码的、根本不读这两个字段 —— 留着只会误导排查。
pub const DEFAULT_MANIFEST_SERVER: &str = "manifestdex";

/// opensteamtool.toml 的清单请求超时（毫秒）。
///
/// 原为 3000/3000/5000/5000，而实测 ManifestDeX 的 ttfb 是 **4.5~18.6 秒** ——
/// 也就是上游还在计算，Lua 的 http_get 就已按 5 秒超时放弃。这是「中继几乎
/// 缓存不到码」和「首次下载报无网络」的直接成因之一，必须放宽到覆盖上游 P99。
///
/// 取值参照第三方修复包（DaKaR 的 Steam_Fix_Manifests）实测可用的
/// 5000/5000/10000/10000：解析与连接 5 秒足够（DNS+TCP+TLS 实测 <1 秒），
/// 收发放宽到 10 秒以覆盖上游慢响应。不宜再大 —— Steam 在下载路径上同步
/// 等待本回调，超时过长会让「上游真的挂了」时用户界面卡住更久。
pub const MANIFEST_TIMEOUT_RESOLVE_MS: u32 = 5000;
pub const MANIFEST_TIMEOUT_CONNECT_MS: u32 = 5000;
pub const MANIFEST_TIMEOUT_SEND_MS: u32 = 10000;
pub const MANIFEST_TIMEOUT_RECV_MS: u32 = 10000;

pub fn generate_toml_config(steam_path: &Path, manifest_server: &str) -> Result<(), String> {
    // 防注入校验：manifest_server 会被原样拼进 TOML 的双引号字符串，
    // 仅放行 URL 安全字符集 [A-Za-z0-9:./_-]，其余一律回退默认节点
    let server = manifest_server.trim();
    let server_is_safe = !server.is_empty()
        && server
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '.' | '/' | '_' | '-'));
    let server = if server_is_safe { server } else { DEFAULT_MANIFEST_SERVER };

    let toml_path = steam_path.join("opensteamtool.toml");
    let content = format!(
        "# OpenSteamTool Configuration generated by 春风渡\n\
        [inject]\n\
        enabled = true\n\n\
        [log]\n\
        level = \"debug\"\n\n\
        [remote]\n\
        url_template = \"https://cdn.jsdelivr.net/gh/OpenSteam001/steam-monitor@{{channel}}/{{component}}/{{sha256}}.toml\"\n\n\
        [manifest]\n\
        auto_switch = true\n\
        url = \"{}\"\n\
        server = \"{}\"\n\
        timeout_resolve_ms = {MANIFEST_TIMEOUT_RESOLVE_MS}\n\
        timeout_connect_ms = {MANIFEST_TIMEOUT_CONNECT_MS}\n\
        timeout_send_ms = {MANIFEST_TIMEOUT_SEND_MS}\n\
        timeout_recv_ms = {MANIFEST_TIMEOUT_RECV_MS}\n",
        server, server
    );
    // 整文件覆写同样必须持锁，避免与字段级更新交错丢字段
    let _guard = TOML_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    fs::write(toml_path, content).map_err(|e| format!("写入 opensteamtool.toml 失败: {}", e))?;
    let _ = deploy_manifest_lua(steam_path);
    Ok(())
}

/// 确保 opensteamtool.toml 具备国内 jsdelivr 镜像加速与官方规范配置（杜绝 raw.github 5秒超时卡顿）
pub fn ensure_toml_optimized(steam_path: &Path) -> Result<(), String> {
    let toml_path = steam_path.join("opensteamtool.toml");
    if !toml_path.exists() {
        return generate_toml_config(steam_path, DEFAULT_MANIFEST_SERVER);
    }
    let _guard = TOML_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let content = fs::read_to_string(&toml_path).unwrap_or_default();
    let mut updated = false;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    if !content.contains("url_template") {
        lines.push("\n[remote]".to_string());
        lines.push("url_template = \"https://cdn.jsdelivr.net/gh/OpenSteam001/steam-monitor@{channel}/{component}/{sha256}.toml\"".to_string());
        updated = true;
    }
    if !content.contains("[log]") {
        lines.push("\n[log]".to_string());
        lines.push("level = \"debug\"".to_string());
        updated = true;
    }
    if !content.contains("url =") {
        lines.push("\n[manifest]".to_string());
        lines.push("auto_switch = true".to_string());
        lines.push(format!("url = \"{}\"", DEFAULT_MANIFEST_SERVER));
        lines.push(format!("server = \"{}\"", DEFAULT_MANIFEST_SERVER));
        lines.push(format!("timeout_resolve_ms = {}", MANIFEST_TIMEOUT_RESOLVE_MS));
        lines.push(format!("timeout_connect_ms = {}", MANIFEST_TIMEOUT_CONNECT_MS));
        lines.push(format!("timeout_send_ms = {}", MANIFEST_TIMEOUT_SEND_MS));
        lines.push(format!("timeout_recv_ms = {}", MANIFEST_TIMEOUT_RECV_MS));
        updated = true;
    } else if !content.contains("auto_switch") {
        let mut new_lines = Vec::new();
        let mut inserted = false;
        for line in lines {
            let is_manifest = line.trim() == "[manifest]";
            new_lines.push(line);
            if is_manifest && !inserted {
                new_lines.push("auto_switch = true".to_string());
                inserted = true;
            }
        }
        if !inserted {
            new_lines.push("\n[manifest]".to_string());
            new_lines.push("auto_switch = true".to_string());
        }
        lines = new_lines;
        updated = true;
    }

    // 存量配置迁移：老版本写下的 `url/server = "wudrm"` 与 3000/3000/5000/5000 超时
    // 会一直留在用户机器上（上面的 `if !content.contains("url =")` 只在**缺失**时补写，
    // 已存在的坏值永远不会被纠正）。而实测上游 ttfb 达 4.5~18.6 秒，5 秒收发超时
    // 会让内核在拿到码之前就放弃 —— 必须就地改写，不能只对新装生效。
    //
    // 坏节点名单必须覆盖全部三个已确认不可用的源，而不只是 "wudrm"：
    // 实测 wudrm / 古韵 / steamrun 的刷新节奏都落后于权威源，同一 depot+gid
    // 在同一时刻会给出与 ManifestDeX 不同的值，用它的码会让 Steam 拉不到清单
    // （表现为入库即报「无网络连接 / 0 字节下载」）。用户机器上的实际值可能是
    // 其中任意一个 —— 只认 "wudrm" 会让 "steamrun" 永远留在配置里。
    const STALE_MANIFEST_NODES: [&str; 3] = ["wudrm", "steamrun", "guyun"];
    for line in lines.iter_mut() {
        let t = line.trim();
        let is_stale_node = STALE_MANIFEST_NODES.iter().any(|n| {
            t == format!("url = \"{}\"", n) || t == format!("server = \"{}\"", n)
        });
        if is_stale_node {
            *line = format!("{} = \"{}\"", t.split('=').next().unwrap_or("url").trim(), DEFAULT_MANIFEST_SERVER);
            updated = true;
        } else if t.starts_with("timeout_resolve_ms") && t != format!("timeout_resolve_ms = {}", MANIFEST_TIMEOUT_RESOLVE_MS) {
            *line = format!("timeout_resolve_ms = {}", MANIFEST_TIMEOUT_RESOLVE_MS);
            updated = true;
        } else if t.starts_with("timeout_connect_ms") && t != format!("timeout_connect_ms = {}", MANIFEST_TIMEOUT_CONNECT_MS) {
            *line = format!("timeout_connect_ms = {}", MANIFEST_TIMEOUT_CONNECT_MS);
            updated = true;
        } else if t.starts_with("timeout_send_ms") && t != format!("timeout_send_ms = {}", MANIFEST_TIMEOUT_SEND_MS) {
            *line = format!("timeout_send_ms = {}", MANIFEST_TIMEOUT_SEND_MS);
            updated = true;
        } else if t.starts_with("timeout_recv_ms") && t != format!("timeout_recv_ms = {}", MANIFEST_TIMEOUT_RECV_MS) {
            *line = format!("timeout_recv_ms = {}", MANIFEST_TIMEOUT_RECV_MS);
            updated = true;
        }
    }

    if updated {
        let _ = fs::write(&toml_path, lines.join("\n") + "\n");
    }
    let _ = deploy_manifest_lua(steam_path);
    Ok(())
}


pub fn ensure_lua_dir(steam_path: &Path) -> Result<PathBuf, String> {
    let lua_dir = steam_path.join("config").join("lua");
    if !lua_dir.exists() {
        fs::create_dir_all(&lua_dir).map_err(|e| format!("创建 Lua 目录失败: {}", e))?;
    }
    let depot_dir = steam_path.join("depotcache");
    if !depot_dir.exists() {
        if let Err(e) = fs::create_dir_all(&depot_dir) {
            // depotcache 目录创建失败会导致后续清单预缓存全部落盘失败，必须留下排查线索
            eprintln!("[OST] 创建 depotcache 目录失败: {}", e);
        }
    }
    Ok(lua_dir)
}

/// 与 manifests::is_valid_key 保持同一严格标准（长度≥32 且纯 hex 且非全 0）：
/// 两侧标准不一致时，同一密钥在合并阶段与 Lua 生成阶段结论可能不同
fn is_valid_key(key: &str) -> bool {
    key.len() >= 32
        && key.chars().all(|c| c.is_ascii_hexdigit())
        && !key.chars().all(|c| c == '0')
}

/// Lua 字符串字面量转义：游戏名/access_token 来自外部数据，
/// 含引号或换行会破坏 Lua 语法导致整条规则失效
fn lua_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', " ").replace('\r', " ")
}

/// 内核 manifest.lua 的清单请求码正缓存表名（实现细节耦合，刻意集中在此一处）。
///
/// manifest.lua 由 deploy_manifest_lua 在每次入库前同步部署，且 manifest_lua_stale
/// 会在启动自愈时比对新旧，因此生成规则时该表的结构必然与本常量一致。
/// 若日后内核改用别的表名，只需同步修改本常量与 MANIFEST_LUA 两处。
const MANIFEST_CODE_CACHE_TABLE: &str = "CFD_CODE_OK";

/// 生成 Lua 入库规则（双方言兼容，最大化内嵌 DLL 版本适配面）：
/// - 密钥同时以 `addappid(id, 1, "key")` 与 `setDepotKey(id, "key")` 双写：
///   第二参数沿用实测可用的 1；setDepotKey 是 37a6d0e 版本验证过可解密的挂载方式
/// - `addtoken` 提供 PICS 访问令牌，`setManifestid` 固定清单 GID
/// - `codes` 为可选预取结果（gid -> 清单请求码）：非空时预填内核的 CFD_CODE_OK
///   正缓存，使 Steam 首次下载取码零网络往返；空表则完全不写该段
pub fn generate_lua_script(payload: &UnlockGamePayload, codes: &BTreeMap<String, String>) -> String {
    let app_id = payload.app_id;
    let name = payload.name_zh.as_deref().unwrap_or(&payload.name);

    let mut lines = Vec::new();
    lines.push(format!("-- Game: {} (AppID: {})", lua_escape(name), app_id));
    lines.push("-- Generated by 春风渡 OST Engine".to_string());
    lines.push("if not setDepotKey then setDepotKey = function(...) end end".to_string());

    // 1. 主游戏入库（带 appLevelKey 时以密钥形式挂载）
    match payload.app_level_key.as_deref() {
        Some(k) if is_valid_key(k.trim()) => {
            lines.push(format!("addappid({}, 1, \"{}\")", app_id, k.trim()));
            lines.push(format!("setDepotKey({}, \"{}\")", app_id, k.trim()));
        }
        _ => lines.push(format!("addappid({}, 1)", app_id)),
    }

    // 2. 分包挂载与 Depot 密钥（仅挂载具备有效解密密钥的分包，跳过与本体重复的 depotId）
    // 铁律：绝不挂载无解密密钥的内容分包，无密钥分包挂载会导致 Steam 解密失败报错“内容仍然处于加密状态”
    let mut seen: Vec<u32> = vec![app_id];
    if let Some(depots) = &payload.depots {
        for depot in depots {
            if seen.contains(&depot.depot_id) {
                continue;
            }
            match depot.depot_key.as_deref() {
                Some(k) if is_valid_key(k.trim()) => {
                    // 铁律：所有具备有效解密密钥的分包，100% 写入 setDepotKey 与 addappid
                    // 绝不能因为清单 GID 暂未缓存就漏写密钥，否则 Steam 必定弹窗报错“无许可”！
                    seen.push(depot.depot_id);
                    lines.push(format!("addappid({}, 1, \"{}\")", depot.depot_id, k.trim()));
                    lines.push(format!("setDepotKey({}, \"{}\")", depot.depot_id, k.trim()));
                }
                _ => {
                    // 无有效密钥的分包绝不写入 addappid，防止触发 Steam 无法解密的加密状态假死
                }
            }
        }
    }

    // 3. PICS Access Token
    if let Some(t) = payload.access_token.as_deref() {
        let t = t.trim();
        if !t.is_empty() && t.chars().all(|c| c.is_ascii_hexdigit()) {
            lines.push(format!("addtoken({}, \"{}\")", app_id, t));
        }
    }

    // 4. DLC 挂载（升序去重，排除本体与分包中已挂载过的 AppID，避免覆盖已注入的密钥参数）
    //
    // 关键：必须排除**全部** depot id，而不只是 `seen`（已成功挂载密钥的那些）。
    //
    // 实测事故（AppID 2054970）：服务端 dlcIds 里混入了本身就是分包的 id ——
    // 2757100 同时出现在 depots（无密钥）与 dlcIds 中。它在第 2 步被正确地跳过了
    // （无密钥不挂载），于是也不在 seen 里；结果第 4 步又把它当普通 DLC
    // `addappid(2757100)` 挂了上去。Steam 随即要求初始化该分包并索取解密密钥，
    // 而密钥根本不存在：
    //   Failed to initialize depot 2757100, manifest 2163371650537928331
    //   (Missing decryption key)
    //   AppID 2054970 update canceled ... (Missing decryption key)
    // 整个游戏被一个无密钥的 DLC 分包拖垮，表现为「已入库却提示内容仍处于加密状态」。
    // 因此凡是出现在 depots 里的 id，一律归第 2 步管辖：有密钥才挂，无密钥彻底不碰。
    let mut all_depot_ids: Vec<u32> = vec![app_id];
    if let Some(depots) = &payload.depots {
        for depot in depots {
            if !all_depot_ids.contains(&depot.depot_id) {
                all_depot_ids.push(depot.depot_id);
            }
        }
    }

    let mut dlcs: Vec<u32> = payload.dlcs.clone().unwrap_or_default();
    dlcs.retain(|d| *d != app_id && !seen.contains(d) && !all_depot_ids.contains(d));
    dlcs.sort_unstable();
    dlcs.dedup();
    for dlc_id in &dlcs {
        lines.push(format!("addappid({})", dlc_id));
    }

    // 5. 清单 GID 绑定 —— 仅「锁定版本」模式写入，默认不写。
    //
    // 默认（lock_version 非 true）：跟随官方最新。不写 setManifestid，Steam 会通过
    // manifest.lua 的 fetch_manifest_code 动态向各清单码源取当前 GID，再直连 Valve CDN
    // 拉取当时最新清单 —— 天然支持实时更新与创意工坊，且无需预置任何实体清单文件。
    //
    // 锁定版本（lock_version = true）：显式钉死 GID，Steam 直接载入 depotcache/ 中
    // 对应的解密清单实体，零请求绕过 Valve CM 风控。该模式必须配套预缓存实体清单，
    // 仅供联机对版本等明确需要固定版本的场景使用。
    if payload.lock_version == Some(true) {
        if let Some(depots) = &payload.depots {
            for depot in depots {
                if let Some(man) = depot.manifest_id.as_deref() {
                    let man = man.trim();
                    if !man.is_empty() && man != "0" && man.chars().all(|c| c.is_ascii_digit()) {
                        lines.push(format!("setManifestid({}, \"{}\", 0)", depot.depot_id, man));
                    }
                }
            }
        }
    }

    // 6. 清单请求码预置 —— 只在「跟随官方最新」模式且确有预取结果时写入。
    //
    // 为什么必须放在最后、且用裸全局赋值（不带 local）：OST 内核是**逐行增量
    // 编译**本规则文件的，每个语法完整的前缀都会被立即执行；而 manifest.lua
    // 对该表用的是 `if not CFD_CODE_OK then CFD_CODE_OK = {} end` 惰性建表 ——
    // 因此本文件无论先于还是晚于 manifest.lua 加载，两者引用的都是同一张全局表：
    // 先加载则 manifest.lua 复用它，后加载则直接往里补写。两种顺序都安全。
    // 一旦某个 GID 命中该表，fetch_manifest_code 就直接返回、零网络往返 ——
    // 这正是用户「第二次点击下载」时才有的状态，现在提前到第一次点击之前。
    //
    // 只写码、不写 setManifestid、不落任何清单实体：默认模式依旧由 Steam 经
    // Valve CDN 动态拉取当前最新清单，自动更新与创意工坊能力完全不受影响。
    //
    // 锁定版本模式跳过：该模式已钉死 GID 并预缓存实体，本就不走取码路径，
    // 写进去反而是无害但多余的噪声。
    if payload.lock_version != Some(true) && !codes.is_empty() {
        lines.push("-- 预置清单请求码缓存（入库时预取，使首次下载零网络往返）".to_string());
        lines.push(format!("if not {} then {} = {{}} end", MANIFEST_CODE_CACHE_TABLE, MANIFEST_CODE_CACHE_TABLE));

        // ts 必须写「我们真正取到码的那一刻」，绝不能写「本文件被内核载入的那一刻」。
        //
        // 内核的过期判定是 `nowTs - entry.ts >= CFD_CODE_TTL`（900 秒）。若 ts 取
        // 载入时刻，则无论码多老，它在每次 Steam 启动时都显得「刚取的」—— 于是
        // 「今天入库、明天才点下载」这条最常见的路径，会把一天前的码当成新鲜码
        // 喂给 Steam。而同一 depot+gid 的码实测 5~6 分钟就轮换一次，旧码必然拉
        // 不到清单（表现为「无网络连接」，且要等 900 秒 TTL 走完才自愈）。
        //
        // 写真实取码时刻的代价是：文件放置超过 900 秒后预置自然失效、内核回退到
        // 现场取码 —— 那正是本次改动之前的既有行为，属**安全**退化；
        // 写成载入时刻则是**危险**退化（用已轮换的错码顶替正确码），两者不可混谈。
        //
        // 当前 Unix 秒，与内核 cfd_now() 的 os.time() 同单位。SystemTime 早于
        // UNIX_EPOCH（异常时钟）时退回 0 —— 内核把 ts=0 判为过期并回退现场取码，
        // 同样是安全降级。
        fn unix_now_secs() -> u64 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        }
        let fetched_at = unix_now_secs();

        for (gid, code) in codes {
            // 双保险：即便上游返回了脏值也绝不写进 Lua，避免破坏规则文件语法
            if gid.chars().all(|c| c.is_ascii_digit()) && code.chars().all(|c| c.is_ascii_digit()) {
                lines.push(format!(
                    "{0}[\"{1}\"] = {{ code = \"{2}\", ts = {3} }}",
                    MANIFEST_CODE_CACHE_TABLE, gid, code, fetched_at
                ));
            }
        }
    }

    lines.join("\n") + "\n"
}

pub struct SaveRuleResult {
    pub lua_path: PathBuf,
    pub depot_count: usize,
    pub key_count: usize,
    pub manifest_count: usize,
    /// 已随规则预置的清单请求码数量（仅「跟随官方最新」模式可能 > 0）。
    /// 它是「首次点击下载不再报无网络」的直接依据：每个已预置的码都省掉一次
    /// Steam 首次下载时 2~7 秒的冷路径取码，故需透传到 UI 供用户确认。
    pub warmed_codes: usize,
    pub dlc_count: usize,
    pub metadata_ok: bool,
    pub metadata: Option<crate::manifests::AppMetadata>,
    /// 云端元数据获取失败/被拒原因（如未激活、免费额度耗尽）
    pub metadata_message: Option<String>,
}

/// 以服务端元数据为准（密钥库 + SteamCMD 清单 GID + accessToken），与前端传入数据合并
fn merge_with_server_metadata(payload: &UnlockGamePayload) -> (UnlockGamePayload, bool, Option<crate::manifests::AppMetadata>, Option<String>) {
    let mut by_id: std::collections::BTreeMap<u32, DepotInfo> = std::collections::BTreeMap::new();
    for d in payload.depots.iter().flatten() {
        by_id.entry(d.depot_id).or_insert_with(|| d.clone());
    }
    let mut dlcs: Vec<u32> = payload.dlcs.clone().unwrap_or_default();
    let mut app_level_key = payload.app_level_key.clone();
    let mut access_token = payload.access_token.clone();
    let mut metadata_ok = false;
    let mut metadata = None;
    let mut metadata_message: Option<String> = None;

    // GID 的两种用途必须分开，否则会掉进「预取静默空转」的坑：
    //
    // - 锁定版本：需要 GID 去写 setManifestid，且必须经 ManifestHub3 社区对齐，
    //   确保钉死的实体在镜像里真实存在。走 parse_metadata(app_id, true)。
    // - 默认「跟随最新」：Lua 不写 setManifestid，但**入库预取清单请求码需要
    //   manifestGid 这个数字去换码**。此前这里传 need_gid=false，服务端命中
    //   dlc_index 时会 skipUpstream，而索引里刻意不存 GID，于是响应里 GID 全空、
    //   预取一个码都拿不到（实测 2054970 的规则文件 warmed=0）。
    //   现在改走 parse_metadata_with_gids：要 GID，但**不做** Hub3 对齐
    //   （省下 2.5~4 秒纯探测），也绝不触发任何实体清单下载。
    let need_gid = payload.lock_version == Some(true);
    let meta_result = if need_gid {
        crate::manifests::parse_metadata(payload.app_id, true)
    } else {
        crate::manifests::parse_metadata_with_gids(payload.app_id)
    };
    match meta_result {
        Ok(meta) => {
            metadata_ok = true;
            for m in &meta.depots {
                let id: u32 = match m.depot_id.parse() {
                    Ok(v) if v > 0 => v,
                    _ => continue,
                };
                let entry = by_id.entry(id).or_insert_with(|| DepotInfo {
                    depot_id: id,
                    name: None,
                    depot_key: None,
                    manifest_id: None,
                });
                if let Some(g) = &m.manifest_gid {
                    if !g.is_empty() && g != "0" {
                        entry.manifest_id = Some(g.clone());
                    }
                }
                if let Some(k) = &m.depot_key {
                    if is_valid_key(k) {
                        entry.depot_key = Some(k.clone());
                    }
                }
            }
            for dlc in &meta.dlc_ids {
                if *dlc != payload.app_id && !dlcs.contains(dlc) {
                    dlcs.push(*dlc);
                }
            }
            // 服务端 appLevelKey 优先（绝不使用全 0 占位符）
            if let Some(k) = &meta.app_level_key {
                if is_valid_key(k) {
                    app_level_key = Some(k.clone());
                }
            }
            if let Some(t) = &meta.access_token {
                if !t.is_empty() {
                    access_token = Some(t.clone());
                }
            }
            metadata = Some(meta);
        }
        Err(e) => {
            // 记录云端拒绝/失败原因（如免费额度耗尽），随结果透传给前端提示
            metadata_message = Some(e);
        }
    }

    let merged = UnlockGamePayload {
        app_id: payload.app_id,
        name: payload.name.clone(),
        name_zh: payload.name_zh.clone(),
        depots: Some(by_id.into_values().collect()),
        dlcs: Some(dlcs),
        app_level_key,
        access_token,
        lock_version: payload.lock_version,
    };
    (merged, metadata_ok, metadata, metadata_message)
}

pub fn save_lua_rule(steam_path: &Path, payload: &UnlockGamePayload) -> Result<SaveRuleResult, String> {
    let (merged, metadata_ok, metadata, metadata_message) = merge_with_server_metadata(payload);
    let key_count = merged
        .depots
        .iter()
        .flatten()
        .filter(|d| d.depot_key.as_deref().map(|k| is_valid_key(k.trim())).unwrap_or(false))
        .count()
        + merged
            .app_level_key
            .as_deref()
            .map(|k| is_valid_key(k.trim()))
            .unwrap_or(false) as usize;
    let manifest_count = merged
        .depots
        .iter()
        .flatten()
        .filter(|d| {
            d.manifest_id
                .as_deref()
                .map(|m| !m.trim().is_empty() && m.trim() != "0")
                .unwrap_or(false)
        })
        .count();
    let depot_count = merged.depots.as_ref().map(|d| d.len()).unwrap_or(0);
    let dlc_count = merged.dlcs.as_ref().map(|d| d.len()).unwrap_or(0);

    // 严密防线：如果云端与备用源均未收录该游戏（无元数据且无任何密钥），坚决不写无效空规则，直接返回提示
    if !metadata_ok && key_count == 0 && manifest_count == 0 {
        return Err(metadata_message.unwrap_or_else(|| {
            format!("暂时没有这款游戏（云端暂未收录 AppID {} 的解密数据）", payload.app_id)
        }));
    }

    // 清单请求码预取：在写规则之前把每个分包的码取回来，随规则一起下发。
    //
    // 只服务「跟随官方最新」模式：锁定版本模式 Lua 已钉死 GID 并预缓存实体清单，
    // Steam 走 depotcache 本地文件、根本不经过 fetch_manifest_code，
    // 此时预取纯属浪费一轮网络往返，故直接跳过。
    //
    // 失败不抛错（prefetch_manifest_codes 内部吞掉所有错误并返回部分结果）：
    // 缺席的 GID 在 Steam 首次请求时仍会由 manifest.lua 现场取码，即改动前的行为。
    let codes = if merged.lock_version == Some(true) {
        BTreeMap::new()
    } else {
        // 清洗/去重/限量在 prefetch_manifest_codes 内完成。
        // 必须连 depot_id 一起传：末位兜底源（古韵自有码库）的接口签名是
        // index.php/{depot}/{gid}，(depot, gid) 是它库里的联合键，光有 gid 查不了。
        let raw_pairs: Vec<(u32, String)> = merged
            .depots
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|d| d.manifest_id.clone().map(|g| (d.depot_id, g)))
            .collect();
        crate::manifests::prefetch_manifest_codes(&raw_pairs)
    };
    let warmed_codes = codes.len();

    let lua_dir = ensure_lua_dir(steam_path)?;
    let lua_file = lua_dir.join(format!("{}.lua", payload.app_id));
    let content = generate_lua_script(&merged, &codes);
    fs::write(&lua_file, &content).map_err(|e| format!("写入 Lua 规则失败: {}", e))?;

    // 双轨兼容：镜像到 st_scripts/（旧模式目录）
    let legacy_dir = steam_path.join("st_scripts");
    if !legacy_dir.exists() {
        let _ = fs::create_dir_all(&legacy_dir);
    }
    let _ = fs::write(legacy_dir.join(format!("{}.lua", payload.app_id)), &content);

    // GreenLuma (AppList) 双轨同步
    sync_greenluma_app_list(steam_path);

    Ok(SaveRuleResult {
        lua_path: lua_file,
        depot_count,
        key_count,
        manifest_count,
        warmed_codes,
        dlc_count,
        metadata_ok,
        metadata,
        metadata_message,
    })
}

/// 扫描一行中的 `addappid(<digits>` 提取 AppID（纯字节级扫描，中文注释行安全）
fn extract_addappid_ids(content: &str) -> Vec<u32> {
    const NEEDLE: &[u8] = b"addappid";
    let bytes = content.as_bytes();
    let mut ids = Vec::new();
    let mut i = 0;
    while i + NEEDLE.len() <= bytes.len() {
        if bytes[i..i + NEEDLE.len()].eq_ignore_ascii_case(NEEDLE) {
            let mut j = i + NEEDLE.len();
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'(' {
                j += 1;
                let start = j;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j > start {
                    if let Ok(id) = content[start..j].parse::<u32>() {
                        ids.push(id);
                    }
                }
            }
        }
        i += 1;
    }
    ids
}

/// 判断 Lua 内容中是否含有效 Depot 密钥（32 位以上非全 0 hex，兼容新旧两种方言）
pub fn lua_has_valid_key(content: &str) -> bool {
    for line in content.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.contains("addappid") && !lower.contains("setdepotkey") {
            continue;
        }
        if let Some(start) = line.find('"') {
            if let Some(end) = line[start + 1..].find('"') {
                let key = &line[start + 1..start + 1 + end];
                if is_valid_key(key.trim()) {
                    return true;
                }
            }
        }
    }
    false
}

/// 双轨兼容：将全部已入库 AppID（本体/DLC/Depot）同步到 GreenLuma AppList 目录。
/// 仅清理本工具通过 .cfd_managed.json 写入的文件，用户手动维护的条目不受影响。
pub fn sync_greenluma_app_list(steam_path: &Path) {
    let app_list_dir = steam_path.join("AppList");
    if !app_list_dir.exists() {
        let _ = fs::create_dir_all(&app_list_dir);
    }
    let lua_dir = steam_path.join("config").join("lua");

    let mut all_ids: std::collections::HashSet<u32> = std::collections::HashSet::new();
    if let Ok(entries) = fs::read_dir(&lua_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(id) = stem.parse::<u32>() else {
                continue;
            };
            if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("lua")) != Some(true) {
                continue;
            }
            all_ids.insert(id);
            if let Ok(content) = fs::read_to_string(&path) {
                for id in extract_addappid_ids(&content) {
                    all_ids.insert(id);
                }
            }
        }
    }
    let mut all_ids: Vec<u32> = all_ids.into_iter().collect();
    all_ids.sort_unstable();

    // 清理此前由本工具写入的 AppList 文件
    let managed_file = app_list_dir.join(".cfd_managed.json");
    if let Ok(text) = fs::read_to_string(&managed_file) {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(&text) {
            for name in list {
                let _ = fs::remove_file(app_list_dir.join(name));
            }
        }
    }

    let written: Vec<String> = all_ids
        .iter()
        .enumerate()
        .map(|(idx, id)| {
            let name = format!("{}.txt", idx);
            let _ = fs::write(app_list_dir.join(&name), id.to_string());
            name
        })
        .collect();
    let _ = fs::write(&managed_file, serde_json::to_string_pretty(&written).unwrap_or_default());
}

pub fn get_unlocked_app_ids(steam_path: &Path) -> Vec<u32> {
    let lua_dir = steam_path.join("config").join("lua");
    if !lua_dir.exists() {
        return Vec::new();
    }

    let mut ids = Vec::new();
    if let Ok(entries) = fs::read_dir(lua_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "lua").unwrap_or(false) {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if let Ok(id) = stem.parse::<u32>() {
                        ids.push(id);
                    }
                }
            }
        }
    }
    ids
}

/// 移除单个游戏的入库规则，返回 (已删除数, 删除失败数)。
/// 失败通常因 Steam 正在运行锁定了规则文件，调用方需向用户透出部分失败提示
pub fn remove_unlocked_rule(steam_path: &Path, app_id: u32) -> Result<(usize, usize), String> {
    // 与 Electron 版 removeLuaScript 一致：清理全部 4 处规则落点
    let paths = [
        steam_path.join("config").join("lua").join(format!("{}.lua", app_id)),
        steam_path.join("st_scripts").join(format!("{}.lua", app_id)),
        steam_path.join("st_scripts").join(format!("app_{}.lua", app_id)),
        steam_path.join("config").join("stplug-in").join(format!("app_{}.lua", app_id)),
    ];
    let mut removed = 0;
    let mut failed = 0;
    for p in paths {
        if p.exists() {
            if fs::remove_file(&p).is_ok() {
                removed += 1;
            } else {
                failed += 1;
            }
        }
    }
    sync_greenluma_app_list(steam_path);
    Ok((removed, failed))
}

/// 本工具生成规则的标记（见 generate_lua_script 首部注释）：
/// 清空操作只删带此标记的文件，用户/第三方脚本一律保留
const GENERATED_RULE_MARKER: &str = "Generated by 春风渡";

pub fn clear_all_rules(steam_path: &Path) -> Result<ClearRulesResult, String> {
    let dirs = [
        steam_path.join("config").join("lua"),
        steam_path.join("st_scripts"),
        steam_path.join("config").join("stplug-in"),
    ];
    let mut removed = 0;
    let mut failed = 0;
    let mut skipped = 0;
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.extension().map(|e| e == "lua").unwrap_or(false) {
                    // 只删除本工具生成的规则：第三方脚本（如内核自带/用户手写）
                    // 不含生成标记，一律跳过保留。读取失败（非 UTF-8/被占用）
                    // 时按无标记处理，宁可漏删不可误删
                    let is_ours = fs::read_to_string(&p)
                        .map(|c| c.contains(GENERATED_RULE_MARKER))
                        .unwrap_or(false);
                    if !is_ours {
                        skipped += 1;
                        continue;
                    }
                    if fs::remove_file(&p).is_ok() {
                        removed += 1;
                    } else {
                        failed += 1;
                    }
                }
            }
        }
    }
    sync_greenluma_app_list(steam_path);
    Ok(ClearRulesResult { removed, failed, skipped })
}

pub fn uninstall_injection_files(steam_path: &Path) -> Result<Vec<String>, String> {
    let files = [
        "OpenSteamTool.dll",
        "dwmapi.dll",
        "xinput1_4.dll",
        "opensteamtool.toml",
    ];
    let mut failed = Vec::new();
    for file_name in files {
        let p = steam_path.join(file_name);
        if p.exists() {
            if let Err(e) = fs::remove_file(&p) {
                failed.push(format!("{}: {}（可能被正在运行的 Steam 锁定）", file_name, e));
            }
        }
    }
    if failed.is_empty() {
        Ok(Vec::new())
    } else {
        Err(failed.join("; "))
    }
}

// ==================== 游戏版本更新检测 ====================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotGidChange {
    pub depot_id: u32,
    pub old_gid: Option<String>,
    pub new_gid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameUpdateStatus {
    pub app_id: u32,
    /// 是否成功取到云端实时元数据；false 时 hasUpdate 无意义，message 给出原因
    pub checked: bool,
    /// Lua 规则是否钉死了清单版本（setManifestid）。false = 跟随官方最新版，
    /// 每次下载自动拉取当时最新清单，不存在"落后"一说
    pub pinned: bool,
    pub has_update: bool,
    pub changed_depots: Vec<DepotGidChange>,
    pub message: Option<String>,
}

/// 从 Lua 规则文本中提取 `setManifestid(depot, "gid", 0)` 固定的清单 GID
pub fn extract_manifest_gids(lua_content: &str) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    for line in lua_content.lines() {
        let t = line.trim();
        if !(t.starts_with("setManifestid(") || t.starts_with("setManifestId(")) {
            continue;
        }
        let inner = match (t.find('('), t.rfind(')')) {
            (Some(a), Some(b)) if b > a => &t[a + 1..b],
            _ => continue,
        };
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() < 2 {
            continue;
        }
        let depot: u32 = match parts[0].trim().parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let gid = parts[1].trim().trim_matches('"').trim();
        if !gid.is_empty() && gid != "0" && gid.chars().all(|c| c.is_ascii_digit()) {
            out.push((depot, gid.to_string()));
        }
    }
    out
}

/// 对比单个游戏 Lua 规则中钉死的 GID 与云端实时元数据。
/// 必须在 spawn_blocking 线程调用（parse_metadata 内部有阻塞 IO）。
pub fn check_game_update_status(steam_path: &Path, app_id: u32) -> GameUpdateStatus {
    let lua_path = steam_path.join("config").join("lua").join(format!("{}.lua", app_id));
    let old_map: std::collections::BTreeMap<u32, String> = std::fs::read_to_string(&lua_path)
        .map(|c| extract_manifest_gids(&c).into_iter().collect())
        .unwrap_or_default();

    // 未钉版本的规则 = 跟随官方最新版，无须查询云端即可下结论
    if old_map.is_empty() {
        return GameUpdateStatus {
            app_id,
            checked: true,
            pinned: false,
            has_update: false,
            changed_depots: Vec::new(),
            message: None,
        };
    }

    // 版本检查的本质就是比对「钉死的 GID」与云端最新 GID，必须拿真实 GID
    match crate::manifests::parse_metadata(app_id, true) {
        Ok(meta) => {
            let mut changed = Vec::new();
            for d in &meta.depots {
                let Some(g) = d.manifest_gid.as_deref().map(str::trim) else { continue };
                if g.is_empty() || g == "0" || !g.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                let Ok(id) = d.depot_id.parse::<u32>() else { continue };
                if id == 0 {
                    continue;
                }
                match old_map.get(&id) {
                    Some(old) if old == g => {}
                    // 旧规则缺失该 depot 的 GID（如入库时服务端无数据）也视为可更新补全
                    old => changed.push(DepotGidChange {
                        depot_id: id,
                        old_gid: old.cloned(),
                        new_gid: g.to_string(),
                    }),
                }
            }
            GameUpdateStatus {
                app_id,
                checked: true,
                pinned: true,
                has_update: !changed.is_empty(),
                changed_depots: changed,
                message: None,
            }
        }
        Err(e) => GameUpdateStatus {
            app_id,
            checked: false,
            pinned: true,
            has_update: false,
            changed_depots: Vec::new(),
            message: Some(e),
        },
    }
}

// ==================== OST 内核在线同步 ====================
// OpenSteamTool 内核在 GitHub 发布（OpenSteam001/OpenSteamTool），
// 内嵌 DLL 只是首次安装种子；本模块在运行时从官方 release 拉取最新版
// 覆盖部署到 Steam 目录（与 deploy_core_binaries 同一套写入目标），
// 使用户不必等春风渡发版就能用上内核修复与新特性。

pub const OST_REPO: &str = "OpenSteam001/OpenSteamTool";
const OST_META_FILE: &str = "opensteamtool_meta.json";
// 打包时内嵌的内核种子：取自官方 1.4.8 Release 构建分发包（与 Release.zip 内
// 三件套字节级一致）。Release 构建体积小、经优化，是官方推荐分发版本；
// 后续新版本经 sync_ost_latest 在线同步覆盖部署
const EMBEDDED_OST_TAG: &str = "1.4.8";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OstSyncInfo {
    /// 已部署版本：meta 文件记录的 tag；从未在线同步过则为 "内置版本"
    pub current_tag: String,
    pub latest_tag: Option<String>,
    pub published_at: Option<String>,
    pub update_available: bool,
    pub steam_running: bool,
    pub message: Option<String>,
}

fn read_deployed_ost_tag(steam_path: &Path) -> String {
    std::fs::read_to_string(steam_path.join(OST_META_FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("tag").and_then(|t| t.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| EMBEDDED_OST_TAG.to_string())
}

fn write_deployed_ost_tag(steam_path: &Path, tag: &str) {
    let meta = serde_json::json!({
        "tag": tag,
        "syncedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    });
    let _ = std::fs::write(steam_path.join(OST_META_FILE), meta.to_string());
}

/// 查询 OST 最新 release（tag + Release.zip 资产名 + GitHub 提供的 sha256 摘要）。
/// api.github.com 直连失败时回退解析 github.com releases/latest 的重定向地址
/// （该回退与服务器中转都无法保证提供摘要，此时摘要为 None）
fn fetch_latest_ost_release() -> Result<(String, Option<String>, String, Option<String>), String> {
    let api_url = format!("https://api.github.com/repos/{}/releases/latest", OST_REPO);
    if let Ok(resp) = crate::manifests::block_on(
        crate::manifests::http_client()
            .get(&api_url)
            .timeout(std::time::Duration::from_secs(10))
            .header("User-Agent", "chunfengdu")
            .header("Accept", "application/vnd.github+json")
            .send(),
    ) {
        if let Ok(json) = crate::manifests::block_on(resp.json::<serde_json::Value>()) {
            if let Some(tag) = json.get("tag_name").and_then(|t| t.as_str()) {
                let published = json
                    .get("published_at")
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());
                // 优先取体积小的 Release 包（Debug 包 28MB 且非分发用途）
                let assets = json.get("assets").and_then(|a| a.as_array());
                let picked = assets.and_then(|list| {
                    let by_name = |want_release: bool| {
                        list.iter().find(|a| {
                            a.get("name")
                                .and_then(|n| n.as_str())
                                .map(|n| {
                                    if want_release {
                                        n.contains("Release.zip") && !n.contains("Debug")
                                    } else {
                                        n.ends_with(".zip")
                                    }
                                })
                                .unwrap_or(false)
                        })
                    };
                    by_name(true).or_else(|| by_name(false))
                });
                if let Some(asset) = picked {
                    let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    // GitHub API 的 digest 形如 "sha256:<64hex>"；缺失时为 None
                    let digest = asset
                        .get("digest")
                        .and_then(|d| d.as_str())
                        .and_then(|d| d.strip_prefix("sha256:"))
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
                    if !name.is_empty() {
                        return Ok((tag.to_string(), published, name, digest));
                    }
                }
            }
        }
    }

    // 回退：releases/latest 302 重定向的 Location 末段即 tag
    let redirect_url = format!("https://github.com/{}/releases/latest", OST_REPO);
    let no_redirect = crate::manifests::http_client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))?;
    if let Ok(resp) = crate::manifests::block_on(
        no_redirect
            .get(&redirect_url)
            .timeout(std::time::Duration::from_secs(10))
            .header("User-Agent", "chunfengdu")
            .send(),
    ) {
        if let Some(loc) = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|l| l.to_str().ok())
        {
            let tag = loc.trim_end_matches('/').rsplit('/').next().unwrap_or("");
            if !tag.is_empty() && tag != "latest" {
                return Ok((
                    tag.to_string(),
                    None,
                    format!("OpenSteamTool-{}-Release.zip", tag),
                    None,
                ));
            }
        }
    }

    // 最终回退：经春风渡服务器中转查询（服务器可达 GitHub，任何客户端网络环境可用）
    let relay_url = format!("{}/api/ost/latest", crate::manifests::SERVER_API);
    if let Ok(resp) = crate::manifests::block_on(
        crate::manifests::http_client()
            .get(&relay_url)
            .timeout(std::time::Duration::from_secs(12))
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
                        let published = json
                            .get("publishedAt")
                            .and_then(|p| p.as_str())
                            .map(|s| s.to_string());
                        // 服务器中转同样透传 GitHub 摘要（可能缺失），供客户端强校验
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

    Err("无法连接 GitHub 查询最新版本（可检查网络或稍后再试）".to_string())
}

fn ost_release_zip_url(tag: &str, asset: &str) -> String {
    format!("https://github.com/{}/releases/download/{}/{}", OST_REPO, tag, asset)
}

/// 从 release zip 中提取核心三件套（OpenSteamTool.dll / dwmapi.dll / xinput1_4.dll），
/// 校验非空且为合法 PE（MZ 头），其余 .lib/.exp 编译附属物一律忽略
fn extract_ost_core_from_zip(zip_bytes: &[u8]) -> Result<Vec<(&'static str, Vec<u8>)>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| format!("release 压缩包解析失败: {}", e))?;
    let wanted = ["OpenSteamTool.dll", "dwmapi.dll", "xinput1_4.dll"];
    let mut out: Vec<(&'static str, Vec<u8>)> = Vec::new();
    for name in wanted {
        let mut found: Option<Vec<u8>> = None;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
            if entry.is_dir() {
                continue;
            }
            let fname = entry.name().rsplit('/').next().unwrap_or("");
            if fname.eq_ignore_ascii_case(name) {
                // 单条目体积防护：用 take 限制实际读取量，不信任压缩包声明的大小
                // （Vec::with_capacity(entry.size()) 会被伪造的巨大声明触发巨额分配）
                let cap = crate::manifests::MAX_ASSET_DOWNLOAD_BYTES;
                let mut buf = Vec::new();
                std::io::Read::take(&mut entry, cap + 1)
                    .read_to_end(&mut buf)
                    .map_err(|e| format!("读取 {} 失败: {}", name, e))?;
                if buf.len() as u64 > cap {
                    return Err(format!(
                        "{} 解压后体积超过上限 {} 字节，压缩包可能异常或为 zip 炸弹",
                        name, cap
                    ));
                }
                if buf.len() > 1024 && buf.starts_with(b"MZ") {
                    found = Some(buf);
                }
                break;
            }
        }
        out.push((
            name,
            found.ok_or_else(|| format!("release 包中未找到有效的 {}", name))?,
        ));
    }
    Ok(out)
}

/// 从多个镜像链下载 release zip（官方直链 ➔ ghfast.top ➔ gh-proxy.com ➔ 服务器中转）。
/// expected_sha256 为 GitHub 提供的摘要；存在时对下载内容做强校验，
/// 防止第三方镜像（或链路中间人）投递被替换的内核 DLL。
fn download_ost_release_zip(
    tag: &str,
    asset: &str,
    expected_sha256: Option<&str>,
) -> Result<Vec<u8>, String> {
    let target = ost_release_zip_url(tag, asset);
    let mirrors = [
        target.clone(),
        format!("https://ghfast.top/{}", target),
        format!("https://gh-proxy.com/{}", target),
        // 最终兜底：经春风渡服务器中转下载（客户端 GitHub 完全不可达时仍可同步）
        format!(
            "{}/api/ost/download/{}/{}",
            crate::manifests::SERVER_API, tag, asset
        ),
    ];
    let mut last_err = String::from("未尝试任何镜像");
    for url in &mirrors {
        match crate::manifests::block_on(
            crate::manifests::http_client()
                .get(url)
                .timeout(std::time::Duration::from_secs(120))
                .header("User-Agent", "chunfengdu")
                .send(),
        ) {
            Ok(resp) if resp.status().is_success() => {
                match crate::manifests::read_body_limited_blocking(
                    resp,
                    crate::manifests::MAX_ASSET_DOWNLOAD_BYTES,
                ) {
                    Ok(bytes) if bytes.len() > 100 * 1024 => {
                        // 有权威摘要时必须校验：不一致则该镜像内容不可信，尝试下一个
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
    Err(format!("所有镜像均下载失败，最后错误：{}", last_err))
}

/// 检查内核同步状态（当前部署 tag vs GitHub 最新 tag）。须在 spawn_blocking 调用
pub fn check_ost_sync_status(steam_path: &Path) -> OstSyncInfo {
    let current_tag = read_deployed_ost_tag(steam_path);
    let steam_running = is_steam_running();
    match fetch_latest_ost_release() {
        Ok((latest_tag, published_at, _asset, _digest)) => OstSyncInfo {
            update_available: latest_tag != current_tag,
            current_tag,
            latest_tag: Some(latest_tag),
            published_at,
            steam_running,
            message: None,
        },
        Err(e) => OstSyncInfo {
            current_tag,
            latest_tag: None,
            published_at: None,
            update_available: false,
            steam_running,
            message: Some(e),
        },
    }
}

/// 在线同步最新内核：下载 release zip、校验三件套、覆盖部署到 Steam 目录并记录版本。
/// 须在 spawn_blocking 调用；Steam 运行中时 DLL 被锁定，必须先退出
pub fn sync_ost_latest(steam_path: &Path) -> Result<String, String> {
    if is_steam_running() {
        return Err("Steam 客户端正在运行，核心 DLL 被锁定无法替换。请先退出 Steam（可在工具箱一键结束进程）后重试。".to_string());
    }

    let (tag, _published, asset, digest) = fetch_latest_ost_release()?;
    let current_tag = read_deployed_ost_tag(steam_path);
    if tag == current_tag {
        return Ok(format!("内核已是最新版本（{}），无需同步。", tag));
    }

    let zip_bytes = download_ost_release_zip(&tag, &asset, digest.as_deref())?;
    let core = extract_ost_core_from_zip(&zip_bytes)?;

    for (name, bytes) in &core {
        std::fs::write(steam_path.join(name), bytes)
            .map_err(|e| format!("写入 {} 失败: {}（权限不足时请以管理员身份运行本程序）", name, e))?;
    }
    write_deployed_ost_tag(steam_path, &tag);

    Ok(format!(
        "已同步 OpenSteamTool 内核 {} → {}（{} 个核心组件已部署）！重新启动 Steam 后生效。",
        current_tag, tag, core.len()
    ))
}
