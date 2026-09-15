# 春风渡 SteamMaster v2.7.6 完整代码审阅报告

审阅日期：2026-09-15
审阅范围：前端（Vue 3 + Tauri 2）、Rust 侧（src-tauri）、服务端（Node/Express）、构建与发布链路
审阅方式：静态代码审阅 + 现有构建验证（`npx vue-tsc --noEmit` 通过、`npm --prefix server run build` 通过）

> 本报告仅描述问题与修复建议，**未改动任何源码**。

---

## 0. 结论速览

| 维度 | 结论 |
|---|---|
| 功能完整度 | 高。入库/联机/工具箱/卡密/邀请/公告/版本推送链路齐全，前后端 DTO 基本对齐 |
| 构建健康度 | 通过。`vue-tsc --noEmit` 与后端 `tsc` 均 0 错误 |
| 安全 | **存在 3 个必须立即处理的高危项**：授权私钥入库、仓库已提交真实密钥库、未认证 PBKDF2 阻塞 |
| 性能 | 中等偏弱。清单下载路径存在 16 路 × 50MB 并发无取消、缓存命中仍做同步全目录扫描、28 万条线性搜索 |
| 可维护性 | 中等。Lua 解析逻辑 4 份重复、DTO 包裹格式不统一、多处 `catch {}` 吞异常 |

---

## 1. 严重（建议 24h 内处理）

### S1 授权签名私钥硬编码入库，可离线伪造任意终身授权

- `server/src/services/licenseSignService.ts:16-18`

```ts
const DEFAULT_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIPMnembY+F7yq+HpTfNcUCF7VpcjTdN9gHV87FK5//Ez
-----END PRIVATE KEY-----`;
```

- 使用点：同文件 `:50` `process.env.LICENSE_PRIVATE_KEY || DEFAULT_PRIVATE_KEY_PEM`
- 客户端固化对应公钥：`src-tauri/src/license_verify.rs:9`
  `DEFAULT_PUBKEY_HEX = "34c2a8ab59b1d134bd32091c62525aa392c6bada97d4480f9d21abf0b9eae5a4"`
- 已实测验证：由该内置 PEM 导出的公钥指纹与客户端固化值**完全一致**，且与 `server/data/license_ed25519_public.hex` 一致。

**影响**：签名规范 `buildCanonicalString`（`:74-84`）完全公开，任何拿到源码的人可离线签发 `isLifetime=true` 的授权，客户端离线验签会通过。所有部署共用同一私钥，一次泄露等于全部失效。

**修复**：
1. 删除 `DEFAULT_PRIVATE_KEY_PEM` 与 `|| DEFAULT_PRIVATE_KEY_PEM` 兜底；
2. 改为 `LICENSE_PRIVATE_KEY` 缺失时 `process.exit(1)`（可复用 `config/index.ts:44 requireSecret`）；
3. 立即轮换密钥对，同步更新 `license_verify.rs` 公钥常量与客户端发版；
4. 旧公钥加入客户端吊销列表。

---

### S2 `.gitignore` 声明忽略的密钥文件实际已被 git 跟踪

实测 `git ls-files` 命中：

```
server/data/admin_credentials.json
server/data/afdian_config.json
server/data/steam_depot_keys.json      # 18MB，28.8 万条真实 DepotKey
server/data/steam_tokens.json          # Steam access token
src-tauri/assets/opensteam/*.debug-bak # ~12MB 调试符号
```

而 `.gitignore:20/24/25` 明确写了忽略这三项 —— **忽略规则对已跟踪文件无效**。

**修复**：
1. `git rm --cached server/data/{admin_credentials,afdian_config,steam_depot_keys,steam_tokens}.json`；
2. 立即轮换 Steam token 与管理员口令（`admin_credentials.json` 内含 PBKDF2 hash + salt）；
3. 用 `git filter-repo` 清理历史（仅删除 HEAD 无用，历史仍可检出）；
4. `.gitignore` 补 `*.pem`、`*.key`、`afdian_config.json`、`toolbox_repair_logs.json`、`*.debug-bak`。

---

### S3 未认证的 PBKDF2 同步阻塞 —— 全站 DoS

- `server/src/services/authService.ts:30-32`

```ts
return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
```

- 调用点 `:264-270`：**在比对用户名之前**就执行 210000 次 PBKDF2。
- 路由 `server/src/routes/index.ts:169` 为公开接口，仅 20 次/15 分钟限流（按 IP）。

**影响**：单次登录阻塞事件循环数百毫秒。用任意不存在的用户名即可打满 CPU 使全站停摆；配合 S5 的 XFF 伪造可无限放大。

**修复**：改用异步 `crypto.pbkdf2`（promisify）；用户名先比对，不匹配时对固定假哈希做等时比较；登录限流叠加账号维度。

---

### S4 邀请码泄露设备码 → 可枚举窃取授权

- `server/src/services/inviteService.ts:77-82`

```ts
export function deriveInviteCode(deviceId: string): string {
  const hex = deviceIdToHex(deviceId);
  if (hex.length < INVITE_TAIL_HEX) return '';
  const tail = hex.slice(-INVITE_TAIL_HEX);   // 取设备码后 12 位
  return `${tail.slice(0,4)}-${tail.slice(4,8)}-${tail.slice(8,12)}`;
}
```

- 公开返回：`server/src/routes/index.ts:400` `GET /invite/status`
- 而 `deviceId` 是密钥类接口的唯一凭据：`routes/index.ts:268` `licenseService.verify(deviceId)`

**影响**：设备码共 16 位 hex，暴露后 12 位后仅剩 4 位（65536 种）。攻击者拿邀请码即可枚举出完整 deviceId，进而调用 `/api/depots/:appId`、`/api/manifests/:appId` 等接口冒用他人授权，并可通过 `/api/license/status/:deviceId` 探测。

**修复**：邀请码改为与设备码无关的随机值或 `HMAC(secret, deviceId)`；deviceId 不作为唯一凭据，激活时下发不可猜测的 client secret。

---

### S5 免费配额可被并发绕过

- 检查：`server/src/routes/index.ts:288` `freeQuotaService.checkAllowed(...)`
- 扣减：`:305-309` `res.on('finish', ...) => freeQuotaService.commit(...)`
- `freeQuotaService.ts:164-192` `checkAllowed` **只读不占位**

**影响**：同一 deviceId 并发发起 N 个不同 appId 请求，全部通过检查并拿到密钥/清单，`commit()` 中的 `if (q.used >= this.limit) return;` 只能拦计数，收不回已下发数据。

**修复**：`checkAllowed` 内同步预占（返回 reservation id），失败时在 `res.on('close')` 释放；或改为「提交成功后才允许读取密钥」的两阶段原子占位。

---

### S6 `TRUST_PROXY=true` 时 XFF 可伪造，绕过全部限流与锁定

- `server/src/config/index.ts:62-69`

```ts
if (v === 'true' || v === '1') return true;   // 信任任意层代理
```

- 所有限流与锁定都基于 `req.ip`：`server.ts:36`、`routes/index.ts:274`、`authService.ts:234`

**影响**：误配 `TRUST_PROXY=true` 后，每个请求换一个 `X-Forwarded-For` 即可绕过登录锁定、激活限流、配额 IP 限制。

**修复**：只接受具体 IP/CIDR 或数字跳数；对 `true` 打高危告警或直接拒绝启动。

---

### S7 OST 内核同步可被第三方镜像投递未校验 DLL

- `src-tauri/src/ost.rs:1144-1150` 仅在 `expected_sha256` 存在时强校验；
- 重定向回退路径 `:1012-1017` 与服务器中转 `:1050` 的 `digest` 为 `None`；
- `:1095` 仅凭 `buf.starts_with(b"MZ")`，随后 `:1204-1207` 直接写入 Steam 根目录。

**修复**：无摘要时 fail-closed 拒绝部署；或对三件套（dwmapi/xinput1_4/OpenSteamTool）内置固定哈希白名单。

---

### S8 清单码源使用明文 HTTP

- `src-tauri/src/ost.rs:137`（内嵌 `MANIFEST_LUA`）：`http_get("http://gmrc.wudrm.com/manifest/" .. gid)`
- `src-tauri/tauri.conf.json:27` connect-src 亦放行 `http://gmrc.wudrm.com`

**影响**：MITM 可返回任意 GID，使 Steam 载入被篡改清单。

**修复**：删除该 http 源，仅保留 https。

---

### S9 发布脚本静默失败 + 硬编码本地代理

- `scripts/uploadRelease.mjs:22-23`

```js
process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:7897';
```

- 失败吞掉：`:354-356`、`:367-369` 仅 `console.error` 后继续，`:387-390` 顶层 catch 才置 1。

**影响**：GitHub Actions（`.github/workflows/release.yml:41-44`）上所有请求指向不存在的本地代理；上传失败 job 仍为绿色；全脚本无 checksum。

**修复**：删除硬编码默认值；任一渠道失败即 `process.exitCode = 1`；生成并上传 `.sha256`，上传后回读校验。

---

### S10 Docker 部署硬编码管理员密钥 + 数据目录烤进镜像

- `server/docker-compose.yml:15` `- ADMIN_SECRET=steammaster_admin_8888`
- `:10-11` `ports: - "1257:1257"` 绑定 0.0.0.0
- `server/Dockerfile:29` `npm install --only=production`（应为 `npm ci --omit=dev`）、全程 root、无 HEALTHCHECK、`:33` `COPY data ./data` 把含密钥的数据目录打进镜像。

**修复**：改 `${ADMIN_SECRET:?}` 或 docker secrets；端口绑 `127.0.0.1` 交反代；`USER node` + `HEALTHCHECK`；数据目录改 volume。

---

## 2. 中等（建议本迭代处理）

### 服务端

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| M1 | `server.ts:26-33` | 无 helmet/CSP/X-Frame-Options，`/admin` 可被点击劫持 | `app.use(helmet())`，`/admin` 加 `frame-ancestors 'none'` |
| M2 | `routes/index.ts:124` | `POST /online-rules/sync-charts` 公开无独立限流，可反复触发外部抓取 | 移入 `/admin` 保护并限流 |
| M3 | `atomicJson.ts:16-29` | `writeFileSync + renameSync` 在请求路径同步写全量 JSON（卡密/邀请/设备/审计） | 改 `fs.promises` + 写队列 |
| M4 | `atomicJson.ts:21` | 临时文件名 `.${basename}.${pid}.${Date.now()}.tmp` 同毫秒并发会撞名 | 加 `crypto.randomBytes(4)` |
| M5 | `atomicJson.ts:23-24` + `server.ts:1377-1384` | 无 fsync；`uncaughtException` 直接 exit，防抖数据（审计 3s/设备 10s/配额 30s）丢失 | rename 前 `fsyncSync`，退出前同步 flush |
| M6 | `freeQuotaService.ts:188-191` | 无 appId 分支硬编码 100 上限，与后台可配 `limit` 无关 | 统一用 `this.limit` 或独立配置 |
| M7 | `licenseController.ts:147-155` | `getDeviceLicenseStatus` 缺长度校验（`verifyLicense` 有） | 补 `≤128` 与类型校验 |
| M8 | `authService.ts:15,238-245` | `loginAttempts` 无上限，每次 login 全表遍历 | 容量上限 + TTL 定时清理 |
| M9 | `authService.ts:203` | `tokenVersion` 用 `<` 而非严格相等，凭据回滚后旧 token 仍有效 | 改严格相等 |
| M10 | `routes/index.ts:152-156` + `deviceService.ts:163-167` | 心跳可覆盖 `licenseCode`/`steamPath` 等展示字段，可伪造成他人卡密 | 以 `licenseService.verify` 为准 |
| M11 | `routes/index.ts:209-250` | 字典下载仅凭 deviceId，20 次/日可轮换 deviceId 绕过 | 叠加 IP 维度限次 |
| M12 | `inviteService.ts:164-190` | 邀请人反查每次全表扫描 + 逐条字符串运算，5 万设备即 5 万次 | 维护 `inviteTailHex -> deviceId` 增量索引 |
| M13 | `inviteService.ts:237-339` | 邀请奖励可自刷：心跳接口公开可伪造 deviceId，批量注册后绑定自己邀请码无限白拿 | 邀请人须持在期卡密；被邀请设备做 IP 聚类 + 每日上限；奖励延迟到账 |
| M14 | `deviceService.ts:298-391` | 设备列表/统计逐台调 `licenseService.verify`，dirty 时整文件落盘 | 增量/定时快照 |
| M15 | `licenseSignService.ts:60-62` | 私钥文件默认 umask（通常 0644） | `mode: 0o600` 并校验既有权限 |
| M16 | `onlineRulesController.ts:33`、`sponsorController.ts:33` | 异常信息回显客户端，透出上游 URL 与 axios 细节 | 固定文案，细节只进服务端日志 |
| M17 | `adminController.ts:12`、`authController.ts:7` 等 | 审计用 `req.socket.remoteAddress`，限流用 `req.ip`，反代下审计 IP 失真 | 统一 `req.ip` |
| M18 | `licenseController.ts:234/266/309/332` | 管理端入参缺长度上限（`remark` 可到 1MB body，`code` 未限长） | `remark ≤ 128`、`code ≤ 64` |
| M19 | `deviceService.ts:261`、`inviteService.ts:169-172` | 空 `catch {}` 吞异常，授权同步失败无日志 | 至少 warn + 计数 |
| M20 | 多服务 | 多实例/PM2 cluster 下 JSON 全量覆盖写无锁，卡密与邀请记录会静默丢失 | 单实例约束 + proper-lockfile，或迁 SQLite |

### 清单/元数据子系统

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| M21 | `gameService.ts:97-113` | `isLoaded` 仅在成功分支置位；JSON 损坏后每个搜索/详情请求都同步重读 8MB | catch 中也置 `isLoaded = true`，降级空库 + 告警（参照 `depotService.ts:37-49` 的正确写法） |
| M22 | `manifestService.ts:922-951` | 单次回源并发 16 路 × 50MB，`Promise.any` 不 abort 败者，最坏 750MB 下行 | AbortController，首个成功即取消其余 |
| M23 | `manifestService.ts:601-680` | zip 炸弹防护按 `header.size`（可伪造为 0）校验，且无 `MAX_ZIP_ENTRIES` | 按 `fileData.length` 真实长度累计；入口先判条目数 |
| M24 | `manifestService.ts:51-160` | `/api/manifests/:appId` 无结果缓存与 in-flight 去重，每请求重跑整条上游链 | 加 TTL 缓存 + 单航班去重 |
| M25 | `metadataController.ts:327-354` + `manifestService.ts:1074-1118` | 缓存命中仍做 N 次同步 `readdirSync` + open/read/close | 内存 `Set<fileName>` 索引，O(1) 查找 |
| M26 | `manifestService.ts:1123-1142` + `manifestController.ts:50-62` | 非原子写 + 边写边读，并发会写坏正在下发的响应 | 写临时文件 + rename（二进制版 `writeStringAtomic`） |
| M27 | `depotService.ts:90-110` | appId+0..100 启发式把相邻游戏 depot 一并匹配并下发 | 默认只返回权威分包，启发式需显式 `?heuristic=1` |
| M28 | `metadataController.ts:727` | `filter(d => isValidKey(d.depotKey))` 静默丢弃无密钥的合法分包，响应随上游抖动跳变 | 保留分包，`keyMissing: true` |
| M29 | `metadataController.ts:174-177,246` | 负缓存把上游暂时失败固化为 6 小时 null | null 结果用 30-60s 短 TTL 或不入缓存 |
| M30 | `manifestService.ts:1149-1176` | 淘汰只统计根目录，子目录 `manifests/<appId>/` 双写且永不淘汰 | 递归统计或去重双写 |
| M31 | `metadataController.ts:761-765` | 每个 depot 起一路后台沉淀，100 分包瞬间上百路回源 | 全局信号量（2-4）+ 队列 |
| M32 | `dlcIndexService.ts:188-192` | 淘汰非 LRU（Map 对已存在 key `set` 不改插入序）；无退出钩子，2s 窗口崩溃丢数据 | `delete`+`set` 实现 LRU；注册 `SIGINT/beforeExit` |
| M33 | `manifestService.ts:52` + `depotController.ts:19` | 未传 `skipRemoteHeader`，每请求白等 Store API 4s 超时 | 一律传 `{ skipRemoteHeader: true }` |
| M34 | `manifestService.ts` 多处 + `gameService.ts:461-548` | 28 万条线性扫描 + 逐条 `toLowerCase`，无匹配时扫满 | 预建小写名索引 + 倒排；数字走 `matchNumeric` |
| M35 | `manifestService.ts:468/636/829`、`metadataController.ts:89-128` | Lua 解析 4 份重复，正则不一致（`\"(\\d{5,})\"` vs `\"(\\d+)\"`），GID 随命中源漂移 | 抽到 utils 单一实现 |
| M36 | `manifestService.ts:1202-1267` | `/api/manifests/code/:gid` 公开无鉴权，负结果不缓存，随机 gid 可打上游 | 负结果 60s TTL + 接口限流 |

### Rust / Tauri

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| M37 | `lib.rs:1367-1372` | `repair_game_steamless(game_path)` 路径来自前端无白名单，递归 3 层扫描并覆盖任意目录 exe | 用 `localgames::get_steam_library_paths()` 做前缀校验 |
| M38 | `lib.rs:1330-1338` / `:138-150` | `zip_extract` 的 `dest_dir` 任意写；`open_path` 仅检查存在性 | 同上，路径只来自后端目录选择器 |
| M39 | `onlinefix.rs:14` + `:869-914` | `ARCHIVE_PASSWORD` 硬编码，且 `deploy_patch_entries` 目标目录来自前端未校验 | 校验 `game_path` |
| M40 | `capabilities/default.json:6-20` | `opener:default` 使 webview 可任意 `open_url`/`open_path` | 移除，改显式 `opener:allow-open-url` + scope |
| M41 | `tauri.conf.json:27` | `img-src` 放行任意 http/https；connect-src 列 20+ 第三方镜像 | 收敛到已知 CDN 最小集合 |
| M42 | `manifests.rs:27` | `.expect("构建 HTTP 客户端失败")` 在 `OnceLock` 内，TLS 异常即 panic | 返回 `Result` 降级 |
| M43 | `lib.rs:765-771` | `spawn_blocking` 内再 `block_on`，嵌套阻塞 | 该命令整体 async 化 |
| M44 | `install.sh:9` 等 4 个脚本 | 仅 `set -e`，缺 `set -u`/`pipefail`；`install.sh:74` 无校验以 root 执行远端脚本；`update.sh:65-66` detached HEAD 必失败；`server/update.sh:47-53` 未经确认改写 origin + 静默 stash | `set -euo pipefail`；改 `npm ci`；去掉自动改远端与静默 stash |
| M45 | `release.yml:32-43` | 无 typecheck / cargo test / rust-cache，未 `--locked`；结合 S9 失败不变红 | 补校验 + 缓存 + 哈希产物 |
| M46 | `ecosystem.config.cjs:20` | `JWT_SECRET` 未加载 .env 时注入 `undefined`；`install.sh` 无校验 | 启动时强制校验（`requireSecret` 已具备） |

### 前端

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| M47 | `App.vue:1082-1085` | 15s/30s/3min 三个轮询定时器常驻；`onUnmounted` 已正确清理，但窗口最小化时仍持续 IPC | 加 `document.hidden` 判断跳过轮询 |
| M48 | `tauriBridge.ts:40-53,92-109` | `getJson`/`postJson` 失败静默返回 `null`，调用方难以区分「网络失败」与「空数据」 | 返回 `{ok, data, error}` 或抛出结构化错误 |
| M49 | 各 View | 大列表（搜索/库/联机）未见虚拟滚动，数千条时渲染压力大 | 引入 `vue-virtual-scroller` 或分页 |
| M50 | 多 View | 重复的 HTTP/IPC 调用与 loading/error 状态样板，组件过大（`OnlineFixView.vue` 83KB） | 抽 composable（`useGameSearch` 等）并拆分视图 |

---

## 3. 低（择机优化）

- **L1** `atomicJson.ts:35-46` `readJsonOrThrow` 把 ENOENT 也包装成「数据文件损坏」 —— 区分文件不存在与解析失败。
- **L2** `config/index.ts:77-91` 凭据文件已存在时仍每次启动生成随机密码并打印整段告警 —— 仅在真正初始化时生成。
- **L3** `routes/index.ts:316` `/quota/status` 无限流且可判断任意 deviceId 是否激活 —— 叠加限流。
- **L4** `server.ts:51` 请求日志含 `?deviceId=` —— query 脱敏。
- **L5** `server.ts:28-31` CORS 直接取环境变量作 origin —— 显式白名单 + `credentials: false`。
- **L6** `metadataController.ts:375-388` 命中缓存直接返回引用未深拷贝，后续就地修改会污染缓存 —— 返回浅拷贝。
- **L7** DTO 包裹格式不统一：`manifestController.ts:20-21` 无 `data` 包裹、`source` 用下划线风格；`metadataController.ts:783-788` `appId:number` 但 `dlcIds:string[]` —— 统一 `{success,data}` + camelCase。
- **L8** `manifestService.ts:506-530` `encodeManifestHubUKCipher` 硬编码 `SECRET_KEY` —— 移入环境变量。
- **L9** `gameService.ts:197-199,589-608` `allGamesById`/`libraryCache` 懒构建无 in-flight 去重 —— 共享 Promise。
- **L10** `tokenService.ts:74` `Object.keys(this.tokensDb).length` 每次分配 30 万字符串数组 —— 维护计数。
- **L11** `manifestService.ts:1012-1041` `isValidManifestBuffer` protobuf 分支判定过宽 —— 校验结构头。
- **L12** `src-tauri/assets/opensteam/*.debug-bak` 已提交 ~12MB 调试符号；`.gitignore` 的 `*.exe` 与已跟踪的 `Steamless.CLI.exe` 矛盾。
- **L13** `Cargo.toml` `name="app"/version="0.1.0"/authors=["you"]` 与 `tauri.conf.json` 的 `2.7.6` 脱节。
- **L14** `steam.rs:377-393` `launch_steam` 的 `extra_args` 由前端传入并原样透传 —— 白名单化。
- **L15** `toolbox.rs:302-306` 下载 CloudRedirectCLI 仅校验 `len > 10000` 后直接执行 —— 固定哈希校验。
- **L16** `README.md:57` 写着 `npm run build`，但 `package.json` 只有 `build:web`；`:59` 提到 `dist-electron/`（项目已无 Electron）—— 文档与实现脱节。
- **L17** `server/scripts/build-game-dict.mjs:40-41` 源缺失时静默返回 `[]` 并 `:92` 无条件写盘 —— 0 条目时拒绝写入。
- **L18** `server/scripts/importManifests.mjs:135` `symlinkSync` 可让运行时目录指向任意外部路径。
- **L19** `tauriBridge.ts:455` `password: 'online-fix.me'` 明文（低敏）。

---

## 4. 已核实「不存在」的问题（避免误报）

- **无用户可控参数导致的命令注入**：Rust 侧全部 `std::process::Command` 使用 `.arg()/.args()`；唯一拼接是 `localgames.rs:1010-1036` 生成的 bat，已过滤 `&|^<>%"!` 并在含特殊字符时回退 `steam://`。
- **无 SSRF**：无 `axios.get(req.query.*)` 命中；`ostController.ts:9,45` 的 tag/asset 有白名单。
- **清单下载无路径穿越**：`manifestController.ts:33` 与 `manifestService.ts:1125` 双重 `/^\d+$/` 校验；zip 落盘文件名由 `${depotId}_${manifestId}` 拼成，不来自 entry 名。
- **无全 0 占位密钥覆盖真实密钥**：`depotService.ts:148`、`metadataController.ts:100/149`、`syncService.ts:148` 均过滤 `/^0+$/`；`saveDepotKeys` 为增量合并。
- **前端 v-for 全部带 key**：已全量扫描 45 处 `v-for`，0 处缺失 `:key`。
- **构建健康**：`npx vue-tsc --noEmit` 与 `npm --prefix server run build` 均 0 错误。

---

## 5. 建议修复顺序

**第一批（24h，安全）**
1. S1 轮换授权密钥 + 删除内置私钥
2. S2 `git rm --cached` 敏感文件 + 轮换 token/口令
3. S3 PBKDF2 改异步 + 用户名前置比对
4. S10 docker-compose 去掉硬编码密钥

**第二批（本周，可用性）**
5. S5 配额原子占位
6. S6 TRUST_PROXY 收紧
7. S9 发布脚本退出码 + 去掉硬编码代理
8. M21 `isLoaded` catch 置位（改动极小，收益极大）

**第三批（下迭代，性能）**
9. M22/M31 清单回源信号量 + AbortController
10. M25 manifest 路径内存索引
11. M26 二进制原子写
12. M34 搜索索引化

**第四批（择机，架构）**
13. M35 Lua 解析统一
14. M36/M2 公开端点限流与鉴权
15. M20 迁移 SQLite 替代 JSON 全量写

---

## 6. 附：本次审阅的执行记录

- 已运行并通过：`npx vue-tsc --noEmit`、`npm --prefix server run build`
- 已执行验证：由内置 PEM 导出的公钥指纹与客户端 `DEFAULT_PUBKEY_HEX` 一致（确认 S1 可利用）
- 已执行验证：`git ls-files` 确认 S2 中 4 个敏感文件确实被跟踪
- 未修改任何文件，未执行 `git add/commit/push`
