#!/usr/bin/env bash

# ==============================================================================
# SteamMaster 云端后端服务 一键极速更新脚本 (update.sh)
# Gitee 官方仓库: https://gitee.com/muyan6/steam.git
# 用途: 自动拉取 Gitee 最新代码、增量安装依赖、重新编译并秒级无缝重载服务
# ==============================================================================

set -e
# 管道中任一环失败即整体失败（原脚本只 set -e，`git log | head` 这类管道会吞掉左侧错误）
set -o pipefail

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

echo -e "${BLUE}[1/4] 拉取 Gitee 远程仓库最新代码...${NC}"
cd "$PROJECT_ROOT"

if [ -d ".git" ]; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    # detached HEAD 时 --abbrev-ref 返回字面量 HEAD，拿去 fetch 必然失败，回退到 main
    if [ "$CURRENT_BRANCH" = "HEAD" ]; then
        CURRENT_BRANCH="main"
    fi
    echo -e "   -> 当前分支: ${CYAN}$CURRENT_BRANCH${NC}"

    # 远端切换默认关闭：仓库主远端是 GitHub，静默改写 origin 会让后续推送落到意外仓库。
    # 需要走 Gitee 镜像时以 AUTO_SWITCH_REMOTE=1 显式开启。
    CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
    if [[ "$CURRENT_REMOTE" =~ "github.com" && "${AUTO_SWITCH_REMOTE:-0}" = "1" ]]; then
        echo -e "   -> 检测到 GitHub 远端，AUTO_SWITCH_REMOTE=1 已开启，切换为 Gitee 镜像加速源..."
        git remote set-url origin https://gitee.com/muyan6/steam.git 2>/dev/null || true
    fi

    # 运行时数据备份：admin_credentials.json / steam_depot_keys.json / steam_tokens.json /
    # steam_all_games.json 等虽在 .gitignore 中，但历史上曾被提交过，git 跟踪状态可能残留。
    # 原实现用 `git stash` + `git pull`，且从未 stash pop —— 线上真实运行数据会被仓库旧快照
    # 覆盖后永久滞留 stash，表现为管理员密码、密钥库、游戏库集体回退。
    # 现改为显式备份 → reset --hard 对齐远端 → 恢复运行时数据（不含版本发布数据）。
    DATA_DIR="server/data"
    BACKUP_DIR=$(mktemp -d)
    mkdir -p "$DATA_DIR"
    cp -a "$DATA_DIR"/*.json "$BACKUP_DIR"/ 2>/dev/null || true
    # 版本发布数据默认跟随仓库：version.json / versions.json 随每次发版一起提交，
    # 若被本地旧副本盖回，会出现「代码已最新、云端下发的仍是旧版本号」，
    # 用户永远收不到更新提示。
    # 若发布流程完全依赖后台控制台写库，以 KEEP_LOCAL_VERSION_DATA=1 保留旧行为。
    if [ "${KEEP_LOCAL_VERSION_DATA:-0}" = "1" ]; then
        echo -e "   -> ${YELLOW}KEEP_LOCAL_VERSION_DATA=1，版本数据保留本地副本${NC}"
    else
        rm -f "$BACKUP_DIR/version.json" "$BACKUP_DIR/versions.json"
    fi
    # 用 find 而非 ls | wc：空目录时 ls 返回非 0，配合刚开启的 pipefail + set -e 会直接中断
    BACKUP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.json' | wc -l)
    echo -e "   -> 已备份 ${GREEN}${BACKUP_COUNT}${NC} 个运行时数据文件"

    # fetch + reset：服务器不产生本地提交，强制与远端对齐，避免分叉历史导致 pull 冲突
    git fetch origin "$CURRENT_BRANCH"
    git reset --hard "origin/$CURRENT_BRANCH"
    git clean -fd server/src server/dist 2>/dev/null || true

    if [ "$BACKUP_COUNT" -gt 0 ]; then
        cp -a "$BACKUP_DIR"/*.json "$DATA_DIR"/ 2>/dev/null || true
        echo -e "   -> 已恢复 ${GREEN}${BACKUP_COUNT}${NC} 个运行时数据文件"
    fi
    rm -rf "$BACKUP_DIR"

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
# --update-env：ecosystem.config.cjs 的 JWT_SECRET/TRUST_PROXY 取自 process.env，
# 不带该参数重启会沿用 PM2 缓存的旧环境，改了 .env 也不生效
if pm2 describe steammaster-server &> /dev/null; then
    pm2 restart steammaster-server --update-env
else
    pm2 start ecosystem.config.cjs --update-env
fi

sleep 1
HEALTH_CHECK=$(curl -s --max-time 3 http://127.0.0.1:1257/api/health 2>/dev/null || echo "failed")

echo -e "\n${GREEN}${BOLD}"
echo "======================================================================"
echo "    🎉 SteamMaster 云端后端服务已成功从 Gitee 更新并热重载！"
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
