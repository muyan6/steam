#!/usr/bin/env bash
# ManifestDeX 清单请求码接口探针 —— 在服务器上运行，用于给「拿不到码」归因
#
# 为什么不直接 curl：
#   1. manifest.manifestdex.com 只接受 User-Agent: ManifestDeX/1.0。
#      缺 UA 或换任何别的 UA 一律 403（0.5 秒内快速返回）——
#      所以「403」是没带对 UA，不是被封禁。
#   2. 各状态码归因完全不同，必须分开看：
#        200  取到码
#        403  UA 不在白名单 —— 请求方问题
#        404  该 gid 确实没有码 —— 权威源明确回答
#        429  按出口 IP 限流 —— 等几分钟自动恢复
#        521  Cloudflare 连不上源站 —— 对方故障，与我们无关
#        522  Cloudflare 连接超时 —— 同上
#   3. 服务器的出口 IP 与开发机不同，这可能是唯一能区分
#      「全局故障」与「单 IP 被区别对待」的手段。
#
# 用法:
#   bash probe_manifest_code.sh                     # 用文档示例 gid
#   bash probe_manifest_code.sh 8201652860178022455 # 指定 gid

set -u

UA='ManifestDeX/1.0'
HOST='https://manifest.manifestdex.com'
RELAY='https://steam.myil.top'
GID="${1:-5191741311888999039}"

probe() {
  local label="$1" url="$2" ua="${3-}"
  local out code t
  if [ -n "$ua" ]; then
    out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 40 -H "User-Agent: $ua" "$url")
  else
    out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 40 -H 'User-Agent:' "$url")
  fi
  code="${out%% *}"; t="${out##* }"
  printf '  %-14s UA=%-18s -> %-5s %ss\n' "$label" "${ua:-（无）}" "$code" "$t"
}

echo '=== 0. 本机出口 IP（关键）==='
curl -s --max-time 15 https://api.ipify.org || echo '（取不到）'
echo

echo '=== 1. UA 门槛验证：同一 URL，只换 UA ==='
probe 'whitelist'  "$HOST/health" "$UA"
probe 'self-made'  "$HOST/health" 'ChunFengDu/1.0'
probe 'browser'    "$HOST/health" 'Mozilla/5.0'
probe 'no-UA'      "$HOST/health" ''
echo

echo "=== 2. 取码实测 gid=$GID （白名单 UA，3 次，间隔 5 秒）==="
for i in 1 2 3; do
  code=$(curl -s -o /tmp/_mx.txt -w '%{http_code}' --max-time 40 -H "User-Agent: $UA" "$HOST/$GID")
  printf '  [%d] HTTP=%s  body=%s\n' "$i" "$code" "$(head -c 60 /tmp/_mx.txt 2>/dev/null)"
  [ "$i" -lt 3 ] && sleep 5
done
echo

echo '=== 3. 中继对照（我们自己的服务器，与上游 IP 无关）==='
for i in 1 2 3; do
  out=$(curl -s -o /tmp/_rl.txt -w '%{http_code} %{time_total}' --max-time 40 "$RELAY/api/manifests/code/$GID")
  printf '  [%d] HTTP=%s  body=%s\n' "$i" "${out%% *}" "$(head -c 60 /tmp/_rl.txt 2>/dev/null)"
done
echo

echo '=== 4. 同域对照路径（判断是源站整体挂还是仅 API 挂）==='
probe 'docs-site' 'https://manifestdex.com/docs' 'Mozilla/5.0'
probe 'dll-host'  'https://api.manifestdex.com/manifestdexcore.dll' "$UA"
echo
echo '完成。判读见文件头部注释。'
