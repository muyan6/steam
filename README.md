# SteamMaster - Steam 游戏一键入库与多模式联机管理工具

一款现代化、开源、高颜值（Win11 Fluent 深色风格）的 Steam 游戏入库与联机管理桌面端工具。

---

## 🌟 核心特性

1. **游戏检索与一键入库**
   - ⚡ **离线秒级匹配**：内置热门游戏数据库，支持中文名、拼音缩写（如 `wukong` / `heishenhua`）、英文名及 AppID 精确检索。
   - 🌐 **Steam 官方 API 联动**：自动拉取游戏高清封面横幅、中文描述、DLC 列表及元数据。
   - 🧩 **OpenSteamTool 内核驱动**：一键生成 `st_scripts/app_<id>.lua` 入库规则并支持热重载，无需频繁重启 Steam。
   - 🚀 **公用清单 API 智能调度**：内置对接 `opensteamtool` / `steamrun` / `wudrm` 公共上游，避免个人服务器带宽限制。

2. **多模式联机修复中心**
   - 🚀 **方案一：Steam 全局 `-onlinefix` 快捷模式**
     - 利用 OpenSteamTool 底层 Hook 机制，自动将大厅与 P2P 匹配伪装为 Valve 官方测试通道 **Spacewar (AppID 480)**。
     - **免改任何游戏文件**，可在 Steam 好友列表直接右键邀请加入游戏。
   - 💉 **方案二：单游戏目录联机补丁注入器**
     - **Spacewar (480) 官方大厅模式**：自动备份原版 `steam_api64.dll` 为 `steam_api64_o.dll`，生成 `OnlineFix.ini` 与 `steam_appid.txt`。
     - **Goldberg 离线/局域网模式**：自动配置 `steam_settings` 与自定义玩家昵称，支持局域网或 Radmin VPN / 蒲公英虚拟专网直连。
     - 🔄 **一键无损还原**：随时一键恢复游戏原版 DLL 与配置文件。

3. **Steam 环境治理与管理**
   - 自动查询 Windows 注册表定位 Steam 安装路径。
   - 实时监控 Steam 运行状态与已生效 Lua 规则数量。
   - 提供安全重启 Steam 快捷通道。

---

## 🛠️ 技术栈

* **桌面容器**：`Electron 34`
* **构建工具**：`Vite 6` + `TypeScript`
* **前端框架**：`Vue 3` (Composition API)
* **样式库**：`Tailwind CSS` + 磨砂毛玻璃（Glassmorphism）设计
* **辅助库**：`axios`、`pinyin-pro`、`lucide-vue-next`

---

## 🚀 获取与运行

### 1. 从 Gitee 仓库克隆代码
```bash
git clone https://gitee.com/muyan6/steam.git
cd steam
```

### 2. 安装依赖并启动开发环境
```bash
npm install
npm run dev
```

### 3. 编译与打包
```bash
npm run build
```
编译产物将输出在 `dist/` 与 `dist-electron/` 目录下。

---

## 📦 官方仓库
* **Gitee 仓库**: [https://gitee.com/muyan6/steam](https://gitee.com/muyan6/steam)

