#!/usr/bin/env bash
# Update only the PM2 backend. Runtime data and signing keys are never copied or generated here.
set -Eeuo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SERVER_DIR/.." && pwd -P)"
APP=steammaster-server
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:1257/api/health}"
BRANCH="${UPDATE_BRANCH:-main}"
HEALTH_ATTEMPTS="${UPDATE_HEALTH_ATTEMPTS:-60}"
HEALTH_INTERVAL="${UPDATE_HEALTH_INTERVAL:-1}"
STAGE=''
BACKUP=''
PROMOTING=0
DONE=0
HAD_PROCESS=0

fail() { printf '更新失败：%s\n' "$*" >&2; exit 1; }
log() { printf '[服务端更新] %s\n' "$*"; }
for dependency in git node npm pm2 curl tar mktemp; do
    command -v "$dependency" >/dev/null 2>&1 || fail "缺少命令：$dependency"
done
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] && (( HEALTH_ATTEMPTS <= 120 )) || fail 'UPDATE_HEALTH_ATTEMPTS 必须是 1–120 的整数'
[[ "$HEALTH_INTERVAL" =~ ^(0|[1-9][0-9]*)$ ]] && (( HEALTH_INTERVAL <= 10 )) || fail 'UPDATE_HEALTH_INTERVAL 必须是 0–10 的整数'
[[ "$(git -C "$ROOT" rev-parse --is-inside-work-tree 2>/dev/null)" == true ]] || fail '未找到项目 Git 仓库'
[[ -z "$(git -C "$ROOT" rev-parse --show-prefix 2>/dev/null)" ]] || fail '服务端不在项目 Git 仓库根目录内'
[[ -f "$SERVER_DIR/.env" ]] || fail '缺少 server/.env；不会自动生成 JWT 或签名密钥'

SERVER_ITEMS=(src scripts dist node_modules package.json package-lock.json tsconfig.json ecosystem.config.cjs update.sh)
wait_for_health() {
    local limit="$1" attempt response
    for (( attempt=1; attempt<=limit; attempt++ )); do
        if response="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)" \
            && printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try{process.exit(JSON.parse(s).status==="ok"?0:1)}catch{process.exit(1)}})' >/dev/null 2>&1; then
            log "健康检查通过（第 $attempt 次）"
            return 0
        fi
        if (( attempt < limit )); then sleep "$HEALTH_INTERVAL"; fi
    done
    return 1
}
restore_previous() {
    local name
    log '新版本未通过，恢复上一个服务端版本……'
    for name in "${SERVER_ITEMS[@]}"; do
        # Every name is a fixed, audited entry immediately under SERVER_DIR.
        rm -rf -- "$SERVER_DIR/$name"
        if [[ -e "$BACKUP/server/$name" ]]; then
            mv -- "$BACKUP/server/$name" "$SERVER_DIR/$name"
        fi
    done
    rm -f -- "$ROOT/update.sh" "$ROOT/.gitignore"
    if [[ -f "$BACKUP/update.sh" ]]; then
        mv -- "$BACKUP/update.sh" "$ROOT/update.sh"
    fi
    if [[ -f "$BACKUP/.gitignore" ]]; then
        mv -- "$BACKUP/.gitignore" "$ROOT/.gitignore"
    fi
    if [[ "$HAD_PROCESS" == 1 ]]; then
        pm2 restart "$SERVER_DIR/ecosystem.config.cjs" --update-env || true
        if ! wait_for_health "$HEALTH_ATTEMPTS"; then
            log '旧版恢复后仍未通过健康检查；请查看 pm2 logs steammaster-server --lines 80 --nostream'
        fi
    else
        pm2 delete "$APP" >/dev/null 2>&1 || true
    fi
    log "旧代码已恢复；备份目录：$BACKUP"
}
on_exit() {
    local status=$?
    trap - EXIT
    if [[ "$PROMOTING" == 1 && "$DONE" == 0 ]]; then
        restore_previous
    fi
    if [[ -n "$STAGE" && -d "$STAGE" ]]; then
        rm -rf -- "$STAGE"
    fi
    exit "$status"
}
trap on_exit EXIT

log "获取 origin/$BRANCH（不重置工作区）……"
git -C "$ROOT" fetch origin "$BRANCH"
COMMIT="$(git -C "$ROOT" rev-parse FETCH_HEAD)"
STAGE="$(mktemp -d "$ROOT/.server-update.XXXXXXXX")"
mkdir -p "$STAGE/server"
# Explicit allow-list: never check out frontend, server/data, .env or depot keys.
git -C "$ROOT" archive "$COMMIT" -- \
    server/src server/scripts server/package.json server/package-lock.json \
    server/tsconfig.json server/ecosystem.config.cjs server/update.sh update.sh .gitignore \
    | tar -xf - -C "$STAGE"
[[ -f "$STAGE/server/scripts/verifyDeployment.mjs" ]] || fail '远端版本缺少部署校验脚本'

log '在隔离目录安装依赖并编译服务端……'
(cd "$STAGE/server" && npm ci --include=dev --no-audit --no-fund && npm run build)
[[ -f "$STAGE/server/dist/server.js" ]] || fail '编译未生成 dist/server.js'

# Read the public key baked into this commit's client without changing any frontend file.
CLIENT_KEY="$(git -C "$ROOT" show "$COMMIT:src-tauri/src/license_verify.rs" \
    | sed -n '/DEFAULT_PUBKEY_HEX: &str = /{s/.*DEFAULT_PUBKEY_HEX: &str = "\([0-9a-f]*\)".*/\1/p;q;}')"
[[ "$CLIENT_KEY" =~ ^[0-9a-f]{64}$ ]] || fail '无法读取该版本客户端内置的授权公钥'
log '核对现有会员签名私钥、公钥和客户端公钥（不改写密钥）……'
EXPECTED_LICENSE_PUBLIC_KEY_HEX="$CLIENT_KEY" node "$STAGE/server/scripts/verifyDeployment.mjs" "$SERVER_DIR"

if pm2 describe "$APP" >/dev/null 2>&1; then HAD_PROCESS=1; fi
mkdir -p "$ROOT/.server-backups"
BACKUP="$(mktemp -d "$ROOT/.server-backups/server-XXXXXXXX")"
mkdir -p "$BACKUP/server"
log "切换服务端代码；原版备份：$BACKUP"
PROMOTING=1
for name in "${SERVER_ITEMS[@]}"; do
    if [[ -e "$SERVER_DIR/$name" ]]; then
        mv -- "$SERVER_DIR/$name" "$BACKUP/server/$name"
    fi
    if [[ -e "$STAGE/server/$name" ]]; then
        mv -- "$STAGE/server/$name" "$SERVER_DIR/$name"
    fi
done
if [[ -f "$ROOT/update.sh" ]]; then mv -- "$ROOT/update.sh" "$BACKUP/update.sh"; fi
mv -- "$STAGE/update.sh" "$ROOT/update.sh"
if [[ -f "$ROOT/.gitignore" ]]; then mv -- "$ROOT/.gitignore" "$BACKUP/.gitignore"; fi
mv -- "$STAGE/.gitignore" "$ROOT/.gitignore"

if [[ "$HAD_PROCESS" == 1 ]]; then
    pm2 restart "$SERVER_DIR/ecosystem.config.cjs" --update-env
else
    pm2 start "$SERVER_DIR/ecosystem.config.cjs" --update-env
fi
log "等待服务就绪（最多 $HEALTH_ATTEMPTS 次，每次间隔 $HEALTH_INTERVAL 秒）……"
wait_for_health "$HEALTH_ATTEMPTS" || fail '服务持续未就绪；请查看 pm2 logs steammaster-server --lines 80 --nostream'
DONE=1
log "更新成功：$COMMIT；健康状态 ok；server/data 和 server/.env 未改动"
log "旧版备份：$BACKUP"
