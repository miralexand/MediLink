# MediLink 服务端部署脚本（Windows / WSL2 + Docker Desktop）
#
# 与 scripts/deploy-server.sh 等价：构建并启动 hbbs / hbbr / medilink 三个容器，
# 并输出 RustDesk 服务端公钥。三个镜像均为 Linux 容器，由 Docker Desktop 运行。
#
# 用法（需已安装并启动 Docker Desktop）：
#   1. 首次运行会自动从 .env.example 生成 .env 并退出；
#   2. 编辑 .env（RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY）；
#   3. 重新运行：
#        powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# 切换到仓库根目录（脚本位于 scripts\）
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command 'docker')) {
    Write-Error '未检测到 docker，请先安装并启动 Docker Desktop（WSL2 后端）：https://www.docker.com/products/docker-desktop/'
    exit 1
}
docker compose version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error '未检测到 docker compose 插件，请升级 Docker Desktop 后重试。'
    exit 1
}

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host '未找到 .env，已从 .env.example 生成。' -ForegroundColor Yellow
    Write-Host '请编辑 .env，至少修改 RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY 后重新运行。' -ForegroundColor Yellow
    exit 0
}

# UDP 21116 提示：Docker Desktop 默认转发容器端口（含 UDP）到 Windows 主机；
# 若终端始终拿不到 ID，可启用 WSL 镜像网络。
$wslConfig = Join-Path $HOME '.wslconfig'
$mirrored = $false
if (Test-Path -LiteralPath $wslConfig) {
    $mirrored = [bool](Select-String -Path $wslConfig -Pattern 'networkingMode\s*=\s*mirrored' -Quiet)
}
if (-not $mirrored) {
    Write-Host '提示：未检测到 WSL 镜像网络。多数情况下 Docker Desktop 可正常转发（含 UDP 21116）。' -ForegroundColor Yellow
    Write-Host '      若局域网终端无法注册设备 ID，可在 %UserProfile%\.wslconfig 加入 networkingMode=mirrored，' -ForegroundColor Yellow
    Write-Host '      执行 wsl --shutdown 后重启 Docker Desktop。详见 docs\deploy.md。' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path 'data\rustdesk', 'data\medilink' | Out-Null

Write-Host '>>> 构建并启动服务 ...'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Error 'docker compose 启动失败，请检查上方日志。'
    exit 1
}

Write-Host '>>> 等待 hbbs 生成密钥 ...'
$pubFile = 'data\rustdesk\id_ed25519.pub'
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Path -LiteralPath $pubFile) { break }
    Start-Sleep -Seconds 1
}

if (Test-Path -LiteralPath $pubFile) {
    $key = (Get-Content -LiteralPath $pubFile -Raw).Trim()
    Write-Host ''
    Write-Host '======================================================'
    Write-Host ' RustDesk 服务端公钥（Key）：'
    Write-Host "   $key"
    Write-Host ' 请在 MediLink 控制台「系统设置」中填入该 Key，'
    Write-Host ' 或写入 .env 的 MEDILINK_RUSTDESK_KEY 后重启容器。'
    Write-Host ' 建议先设置 Key，再部署被控端。'
    Write-Host '======================================================'
} else {
    Write-Warning '尚未生成 id_ed25519.pub，请查看日志：docker compose logs -f hbbs'
}

# 解析对外端口
$port = '21120'
$m = Select-String -Path '.env' -Pattern '^MEDILINK_PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($m) { $port = $m.Matches[0].Groups[1].Value }

# 取本机内网 IPv4（优先 10.x / 192.168.x）
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Sort-Object -Property @{ Expression = { if ($_.IPAddress -like '10.*') { 0 } elseif ($_.IPAddress -like '192.168.*') { 1 } else { 2 } } } |
    Select-Object -First 1).IPAddress
if (-not $ip) { $ip = '<本机内网IP>' }

docker compose ps
Write-Host ''
Write-Host "管理控制台：http://${ip}:${port}/"
Write-Host '被控端/控制端请使用该内网 IP 作为服务端地址。'
