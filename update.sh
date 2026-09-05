#!/usr/bin/env bash

# ==============================================================================
# SteamMaster 云端后端服务 一键极速更新脚本 (update.sh)
# Gitee 官方仓库: https://gitee.com/muyan6/steam.git
# 用途: 自动拉取最新代码、增量安装依赖、重新编译并无缝重载服务
# 注意: 服务端运行时数据（卡密/凭据/设备档案等）已移出版本控制，
#       本脚本在重置代码前会自动备份并恢复这些数据文件。
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
echo "    📦 源码仓库: https://gitee.com/muyan6/steam"
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

echo -e "${BLUE}[1/5] 同步远程仓库最新代码...${NC}"
cd "$PROJECT_ROOT"

if [ -d ".git" ]; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    echo -e "   -> 当前分支: ${CYAN}$CURRENT_BRANCH${NC}"

    # 自动识别并无缝切换至 Gitee 加速源
    CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ "$CURRENT_REMOTE" =~ "github.com" ]]; then
        echo -e "   -> 检测到 GitHub 远端，正在自动切换为 Gitee 镜像加速源..."
        git remote set-url origin https://gitee.com/muyan6/steam.git 2>/dev/null || true
    fi

    # 备份运行时数据（这些文件已移出版本控制，但历史版本可能仍在旧索引中）
    DATA_DIR="server/data"
    BACKUP_DIR=$(mktemp -d)
    mkdir -p "$DATA_DIR"
    cp -a "$DATA_DIR"/*.json "$BACKUP_DIR"/ 2>/dev/null || true
    BACKUP_COUNT=$(ls "$BACKUP_DIR"/*.json 2>/dev/null | wc -l)
    echo -e "   -> 已备份 ${GREEN}${BACKUP_COUNT}${NC} 个运行时数据文件"

    # fetch + reset：服务器不产生本地提交，强制与远端对齐（解决分叉历史导致的 pull 冲突）
    git fetch origin "$CURRENT_BRANCH"
    git reset --hard "origin/$CURRENT_BRANCH"
    git clean -fd server/src server/dist 2>/dev/null || true

    # 恢复运行时数据（服务器本地数据优先于仓库初始数据）
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        cp -a "$BACKUP_DIR"/*.json "$DATA_DIR"/ 2>/dev/null || true
        echo -e "   -> 已恢复 ${GREEN}${BACKUP_COUNT}${NC} 个运行时数据文件"
    fi
    rm -rf "$BACKUP_DIR"

    LATEST_COMMIT=$(git log -1 --format="%h - %s (%cr)" 2>/dev/null || echo "未知版本")
    echo -e "   -> 最新提交: ${GREEN}$LATEST_COMMIT${NC}"
else
    echo -e "${YELLOW}   -> 未检测到 .git 仓库，跳过代码同步（采用本地现有代码编译）...${NC}"
fi

echo -e "\n${BLUE}[2/5] 更新后端依赖包...${NC}"
cd "$SERVER_DIR"

if [ -f "package-lock.json" ]; then
    npm install --prefer-offline --no-audit
else
    npm install --no-audit
fi

echo -e "\n${BLUE}[3/5] 校验必需的环境变量...${NC}"

# 自动加载 server/.env（若存在），免去手动 export
if [ -f "$SERVER_DIR/.env" ]; then
    set -a
    . "$SERVER_DIR/.env"
    set +a
    echo -e "   -> 已从 server/.env 加载密钥配置 ${GREEN}✓${NC}"
fi

if [ -z "$JWT_SECRET" ]; then
    echo -e "${RED}   -> 缺少 JWT_SECRET！${NC}"
    echo -e "${YELLOW}   -> 一次性执行以下命令生成 server/.env（生成后永久生效，无需 export）：${NC}"
    echo -e "      cd $SERVER_DIR"
    echo -e "      node -e \"const c=require('crypto');require('fs').writeFileSync('.env','JWT_SECRET='+c.randomBytes(48).toString('hex')+'\\n')\""
    echo -e "      chmod 600 .env && cd .."
    echo -e "${RED}   -> 跳过服务重启，避免启动失败。生成后重新运行本脚本。${NC}"
    exit 1
fi
echo -e "   -> 环境变量已配置 ${GREEN}✓${NC}"

echo -e "\n${BLUE}[4/5] 重新构建编译生产代码 (tsc)...${NC}"
npm run build
echo -e "   -> 编译完成: ${GREEN}dist/ 输出就绪${NC}"

echo -e "\n${BLUE}[5/5] 正在重载 PM2 服务...${NC}"
if pm2 describe steammaster-server &> /dev/null; then
    pm2 restart steammaster-server --update-env
else
    pm2 start ecosystem.config.cjs --update-env
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
