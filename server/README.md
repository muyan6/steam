# SteamMaster 商业版 - 云端后端服务器部署指南

本目录为 **SteamMaster** 的独立云端后端服务，负责承载 **18 万+ 游戏数据库、28 万+ DepotKey 密钥库、动态系统公告、客户端版本检测与强制升级** 等核心商业功能。

---

## 🚀 部署方案一：直接运行 Node.js + PM2 (最省内存，推荐)

适合内存较小（如 1核1G / 1核2G）的 Linux 或 Windows 云服务器，常驻内存仅 **~50MB**。

### 1. 服务器环境准备
在服务器上安装 Node.js 18+ 与 PM2：
```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
sudo npm install -g pm2
```

### 2. 上传代码并启动
把 `server` 文件夹上传到服务器（例如 `/opt/steammaster-server`），然后执行：
```bash
cd /opt/steammaster-server

# 1. 安装依赖并编译
npm install
npm run build

# 2. 使用 PM2 后台守护启动
pm2 start ecosystem.config.cjs

# 3. 设置开机自启
pm2 save
pm2 startup
```

### 3. 查看运行状态
```bash
pm2 status                  # 查看运行状态
pm2 logs steammaster-server # 查看实时日志
pm2 restart steammaster-server # 重启服务
```

---

## 🐳 部署方案二：Docker 一键部署 (最简单)

如果你的服务器已安装 Docker 与 Docker Compose：

```bash
cd /opt/steammaster-server

# 一键构建并启动
docker compose up -d --build

# 查看运行日志
docker compose logs -f
```

---

## 🛠️ 管理员运营与维护接口 (Admin API)

请求管理接口时，请在 Header 中携带管理员密钥（默认密钥在 `ecosystem.config.cjs` 中配置为 `steammaster_admin_8888`）：

### 1. 发布 / 修改最新公告
* **URL**: `POST http://<你的服务器IP>:3000/api/admin/notice`
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
* **URL**: `POST http://<你的服务器IP>:3000/api/admin/version`
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
* **同步游戏**: `POST http://<你的服务器IP>:3000/api/admin/sync/games`
* **同步密钥**: `POST http://<你的服务器IP>:3000/api/admin/sync/depots`
