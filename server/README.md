# SteamMaster 商业版 - 云端后端服务器部署指南

本目录为 **SteamMaster** 的独立云端后端服务，负责承载 **18 万+ 游戏数据库、28 万+ DepotKey 密钥库、动态系统公告、客户端版本检测与强制升级** 等核心商业功能。默认服务端口已优化为 **1257**。

---

## ⚡ 极速全自动部署与更新 (推荐)

项目已内置高度自动化的部署与更新脚本，自动检测并安装 Node.js 20、PM2、依赖包，并配置开机自启：

### 1. 首次部署 (一键全自动)
上传项目到云服务器后，执行：
```bash
# 赋予执行权限并运行
chmod +x install.sh update.sh
bash install.sh
```
> **脚本会自动执行**：系统环境检测 -> Node.js 20 LTS 安装 -> 全局 PM2 安装 -> NPM 依赖安装 -> TypeScript 编译构建 -> PM2 后台守护启动 (端口 1257) -> 开机自启保存 -> 端口与健康检查。

### 2. 后续更新代码 (一键极速重载)
下次需要更新服务器代码时，**只需一条命令**：
```bash
bash update.sh
```
> **更新脚本会自动执行**：Git 远程代码拉取 -> 增量 NPM 依赖更新 -> TypeScript 重新编译 -> PM2 服务无缝热重载 -> 健康检查状态回显。

---

## 🛠️ 手动部署与常用运维指令

如果需要手动维护：

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs steammaster-server

# 重启后端服务
pm2 restart steammaster-server

# 停止后端服务
pm2 stop steammaster-server
```

---

## 🐳 部署方案二：Docker 一键部署

如果你的服务器已安装 Docker 与 Docker Compose：

```bash
# 一键构建并启动 (暴露 1257 端口)
docker compose up -d --build

# 查看运行日志
docker compose logs -f
```

---

## 🌐 管理员运营与维护接口 (Admin API)

请求管理接口时，请在 Header 中携带管理员密钥（默认密钥在 `ecosystem.config.cjs` 中配置为 `steammaster_admin_8888`）：

### 1. 发布 / 修改最新公告
* **URL**: `POST http://<你的服务器IP>:1257/api/admin/notice`
* **Header**: `x-admin-key: steammaster_admin_8888`
* **Body (JSON)**:
```json
{
  "title": "系统维护通知",
  "content": "为了提升服务质量，服务器将于今晚 24:00 进行临时维护，维护期间不影响已入库游戏。",
  "type": "popup",
  "enabled": true
}
```

### 2. 发布新版本 / 控制强制更新
* **URL**: `POST http://<你的服务器IP>:1257/api/admin/version`
* **Header**: `x-admin-key: steammaster_admin_8888`
* **Body (JSON)**:
```json
{
  "version": "1.1.0",
  "title": "SteamMaster 1.1.0 重磅升级",
  "changelog": [
    "修复部分游戏 DLC 关联失败的问题",
    "新增更多联机补丁预设"
  ],
  "downloadUrl": "https://your-domain.com/downloads/SteamMaster-1.1.0.exe",
  "forceUpdate": false,
  "minSupportedVersion": "1.0.0"
}
```

### 3. 一键同步上游最新游戏库与密钥
* **同步游戏**: `POST http://<你的服务器IP>:1257/api/admin/sync/games`
* **同步密钥**: `POST http://<你的服务器IP>:1257/api/admin/sync/depots`
