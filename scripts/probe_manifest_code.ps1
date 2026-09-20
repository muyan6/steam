# 诊断清单请求码两个源的真实行为。
#
# 背景：客户端报「无许可 / Access Denied」，怀疑取码链路（ManifestDeX 直连 +
# 春风渡云端中继）至少有一条断掉。本脚本分别计时、打印状态码与响应体，
# 用「耗时」区分「真的转发到上游」与「本地立即拒绝」。
#
# 用法: pwsh -File scripts/probe_manifest_code.ps1

$ErrorActionPreference = 'Continue'

function Probe($label, $url, $ua) {
    Write-Host "=== $label ==="
    Write-Host "URL: $url"
    $args = @('-s', '-D', '-', '--max-time', '40', '-w', "`n__TIMING__ http=%{http_code} time=%{time_total}`n")
    if ($ua) { $args += @('-H', "User-Agent: $ua") }
    $args += $url
    $out = & curl.exe @args 2>&1 | Out-String
    Write-Host $out
    Write-Host ''
}

# 1) ManifestDeX 健康端点（应 200，证明服务活着）
Probe 'ManifestDeX /health' 'https://manifest.manifestdex.com/health' 'ManifestDeX/1.0'

# 2) ManifestDeX 文档自带的示例 GID（文档称应返回 11217026705559991727）
Probe 'ManifestDeX 文档示例 GID' 'https://manifest.manifestdex.com/5191741311888999039' 'ManifestDeX/1.0'

# 3) 无 UA（文档说必须带 ManifestDeX/1.0，缺失应 403）
Probe 'ManifestDeX 无 UA（对照）' 'https://manifest.manifestdex.com/5191741311888999039' $null

# 4) 云端中继：全新随机 GID。若它真的转发到 ManifestDeX，耗时应在数秒级；
#    若 0.2 秒就 404，说明它根本没发上游请求，是本地直接拒绝。
Probe '中继 随机 GID #1' 'https://steam.myil.top/api/manifests/code/7111222333444555666' $null
Probe '中继 随机 GID #2' 'https://steam.myil.top/api/manifests/code/8222333444555666777' $null

# 5) 中继：真实存在的 GID（Steam 日志里出现过的）
Probe '中继 真实 GID（Steam 日志）' 'https://steam.myil.top/api/manifests/code/4059800356804376977' $null