#!/usr/bin/env bash

# ==============================================================================
# SteamMaster 云端后端服务 一键全自动部署脚本 (install.sh)
# 支持环境: Ubuntu / Debian / CentOS / RockyLinux / AlmaLinux / RHEL / Fedora
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "======================================================================"
echo "    ⚡ SteamMaster 商业版 - 云端后端数据引擎 一键自动部署脚本"
echo "======================================================================"
echo -e "${NC}"

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$CURRENT_DIR/server" ]; then
    SERVER_DIR="$CURRENT_DIR/server"
elif [ -f "$CURRENT_DIR/package.json" ] && grep -q "steammaster-server" "$CURRENT_DIR/package.json" 2>/dev/null; then
    SERVER_DIR="$CURRENT_DIR"
else
    SERVER_DIR="$CURRENT_DIR"
fi

echo -e "${BLUE}[1/5] 检查运行路径...${NC}"
echo -e "   -> 后端目录定位为: ${CYAN}$SERVER_DIR${NC}"

echo -e "\n${BLUE}[2/5] 检查系统环境与基础依赖...${NC}"

PKG_MANAGER=""
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
fi

if ! command -v curl &> /dev/null || ! command -v git &> /dev/null; then
    echo -e "${YELLOW}   -> 正在安装 curl / git...${NC}"
    if [ "$PKG_MANAGER" = "apt" ]; then
        sudo apt-get update -y && sudo apt-get install -y curl git
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        sudo $PKG_MANAGER install -y curl git
    fi
fi

NODE_NEED_INSTALL=false
if command -v node &> /dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -lt 18 ]; then
        echo -e "${YELLOW}   -> 检测到 Node.js 版本 (v$NODE_VER) 过低，需要升级至 Node.js 20 LTS...${NC}"
        NODE_NEED_INSTALL=true
    else
        echo -e "   -> Node.js 已安装: ${GREEN}$(node -v)${NC}"
    fi
else
    NODE_NEED_INSTALL=true
fi

if [ "$NODE_NEED_INSTALL" = true ]; then
    echo -e "${YELLOW}   -> 正在自动安装 Node.js 20 LTS 环境...${NC}"
    if [ "$PKG_MANAGER" = "apt" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo $PKG_MANAGER install -y nodejs
    else
        echo -e "${RED}无法识别的包管理器，请手动安装 Node.js 18+ 后重新运行本脚本。${NC}"
        exit 1
    fi
    echo -e "   -> Node.js 安装完成: ${GREEN}$(node -v)${NC}"
fi

if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}   -> 正在全局安装 PM2 进程守护工具...${NC}"
    sudo npm install -g pm2
    echo -e "   -> PM2 安装成功: ${GREEN}$(pm2 -v)${NC}"
else
    echo -e "   -> PM2 已安装: ${GREEN}v$(pm2 -v)${NC}"
fi

echo -e "\n${BLUE}[3/5] 安装后端依赖并编译 TypeScript...${NC}"
cd "$SERVER_DIR"

if [ -f "package-lock.json" ]; then
    npm ci || npm install
else
    npm install
fi

echo -e "   -> 正在执行 TypeScript 生产构建..."
npm run build

echo -e "\n${BLUE}[4/5] 启动 PM2 守护服务...${NC}"

if pm2 describe steammaster-server &> /dev/null; then
    echo -e "   -> 检测到现有进程，正在重载服务配置..."
    pm2 restart ecosystem.config.cjs --update-env
else
    echo -e "   -> 正在使用 ecosystem.config.cjs 启动新服务..."
    pm2 start ecosystem.config.cjs
fi

pm2 save

echo -e "\n${BLUE}[5/5] 服务健康状态检查...${NC}"
sleep 2

SERVER_IP=$(curl -s --max-time 3 ifconfig.me || curl -s --max-time 3 ipinfo.io/ip || echo "127.0.0.1")

echo -e "${GREEN}${BOLD}"
echo "======================================================================"
echo "    🎉 SteamMaster 云端后端服务部署成功！"
echo "======================================================================"
echo -e "${NC}"

echo -e "📌 ${BOLD}服务运行信息:${NC}"
echo -e "   • 进程名称:    ${CYAN}steammaster-server${NC}"
echo -e "   • 服务端口:    ${CYAN}1257${NC} (可于 ecosystem.config.cjs 修改)"
echo -e "   • 管理控制台:  ${GREEN}http://${SERVER_IP}:1257/dashboard${NC}"
echo -e "   • 健康检查API: ${GREEN}http://${SERVER_IP}:1257/api/health${NC}"
echo -e "   • 客户端对接:  在客户端 appConfig.ts 中填入: ${YELLOW}http://${SERVER_IP}:1257${NC}"

echo -e "\n🛠️ ${BOLD}常用维护指令:${NC}"
echo -e "   • 查看运行状态: ${CYAN}pm2 status${NC}"
echo -e "   • 查看实时日志: ${CYAN}pm2 logs steammaster-server${NC}"
echo -e "   • 重启服务:     ${CYAN}pm2 restart steammaster-server${NC}"
echo -e "   • 下次更新代码: ${GREEN}bash update.sh${NC}"

echo -e "\n🔒 ${YELLOW}${BOLD}安全提示:${NC}"
echo -e "   若无法通过外网访问，请确认云服务器安全组已放行 ${BOLD}TCP 1257${NC} 端口："
echo -e "   • Ubuntu (UFW):    ${CYAN}sudo ufw allow 1257/tcp${NC}"
echo -e "   • CentOS (Firewall): ${CYAN}sudo firewall-cmd --add-port=1257/tcp --permanent && sudo firewall-cmd --reload${NC}"
echo -e "======================================================================\n"
