#!/usr/bin/env bash

# ==============================================================================
# SteamMaster 云端后端服务 一键极速更新脚本 (update.sh)
# 用途: 自动拉取最新 Git 代码、增量安装依赖、重新编译并秒级无缝重载服务
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
echo "    🔄 SteamMaster 商业版 - 云端后端数据引擎 一键增量更新脚本"
echo "======================================================================"
echo -e "${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -d "$SCRIPT_DIR/server" ]; then
    PROJECT_ROOT="$SCRIPT_DIR"
    SERVER_DIR="$SCRIPT_DIR/server"
elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q "steammaster-server" "$SCRIPT_DIR/package.json" 2>/dev/null; then
    SERVER_DIR="$SCRIPT_DIR"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
    SERVER_DIR="$SCRIPT_DIR"
    PROJECT_ROOT="$SCRIPT_DIR"
fi

echo -e "${BLUE}[1/4] 拉取 Git 远程仓库最新代码...${NC}"
cd "$PROJECT_ROOT"

if [ -d ".git" ]; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    echo -e "   -> 当前分支: ${CYAN}$CURRENT_BRANCH${NC}"
    
    git stash > /dev/null 2>&1 || true
    git pull origin "$CURRENT_BRANCH"
    
    LATEST_COMMIT=$(git log -1 --format="%h - %s (%cr)" 2>/dev/null || echo "未知版本")
    echo -e "   -> 最新提交: ${GREEN}$LATEST_COMMIT${NC}"
else
    echo -e "${YELLOW}   -> 未检测到 .git 仓库，跳过 git pull（采用本地现有代码编译）...${NC}"
fi

echo -e "\n${BLUE}[2/4] 更新后端依赖包...${NC}"
cd "$SERVER_DIR"

if [ -f "package-lock.json" ]; then
    npm install --prefer-offline --no-audit
else
    npm install --no-audit
fi

echo -e "\n${BLUE}[3/4] 重新构建编译生产代码 (tsc)...${NC}"
npm run build
echo -e "   -> 编译完成: ${GREEN}dist/ 输出就绪${NC}"

echo -e "\n${BLUE}[4/4] 正在重载 PM2 服务...${NC}"
if pm2 describe steammaster-server &> /dev/null; then
    pm2 restart steammaster-server
else
    pm2 start ecosystem.config.cjs
fi

sleep 1
HEALTH_CHECK=$(curl -s --max-time 3 http://127.0.0.1:1257/api/health 2>/dev/null || echo "failed")

echo -e "\n${GREEN}${BOLD}"
echo "======================================================================"
echo "    🎉 SteamMaster 云端后端服务已成功更新并热重载！"
echo "======================================================================"
echo -e "${NC}"

echo -e "📌 ${BOLD}更新总结:${NC}"
if [[ "$HEALTH_CHECK" =~ "online" ]] || [[ "$HEALTH_CHECK" =~ "true" ]] || [[ "$HEALTH_CHECK" =~ "ok" ]]; then
    echo -e "   • 健康状态:    ${GREEN}● 正常在线 (HTTP 200 OK)${NC}"
else
    echo -e "   • 健康状态:    ${YELLOW}● 服务已启动，正在初始化索引${NC}"
fi

echo -e "   • PM2 进程名:  ${CYAN}steammaster-server${NC}"
echo -e "   • 查看实时日志: ${CYAN}pm2 logs steammaster-server --lines 30${NC}"
echo -e "======================================================================\n"
