# MediLink 被控端心跳脚本
#
# 由 install-agent.ps1 注册的计划任务调用：
#   powershell -NoProfile -ExecutionPolicy Bypass -File agent-heartbeat.ps1 -Loop
#
# 单次执行：agent-heartbeat.ps1

[CmdletBinding()]
param([switch]$Loop)

$ErrorActionPreference = 'SilentlyContinue'
$AgentVersion = 'ps-1.0.0'
$ConfigFile = Join-Path $env:ProgramData 'MediLink\agent-ps.json'
$LogDir = Join-Path $env:ProgramData 'MediLink\logs'

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -Path (Join-Path $LogDir 'agent-ps.log') -Value $line -Encoding UTF8
}

if (-not (Test-Path $ConfigFile)) {
    Write-Log '未找到配置文件，退出。请先运行 install-agent.ps1'
    exit 1
}
$cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
$Server = $cfg.server.TrimEnd('/')
$rd = $cfg.rustdesk_exe
if (-not (Test-Path $rd)) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe')
    )
    $rd = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Send-Heartbeat([string]$DeviceId) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($cfg.enrollment_key) { $headers['X-Agent-Key'] = $cfg.enrollment_key }
    $body = @{
        rustdesk_id   = $DeviceId
        ip            = $ip
        username      = $user
        agent_version = $AgentVersion
    } | ConvertTo-Json
    return Invoke-RestMethod "$Server/api/agent/heartbeat" -Method Post -Headers $headers -Body $body
}

function Register-Device([string]$DeviceId) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($cfg.enrollment_key) { $headers['X-Agent-Key'] = $cfg.enrollment_key }
    $body = @{
        rustdesk_id   = $DeviceId
        hostname      = $env:COMPUTERNAME
        username      = $user
        department    = $cfg.department
        ip            = $ip
        agent_version = $AgentVersion
    } | ConvertTo-Json
    return Invoke-RestMethod "$Server/api/agent/register" -Method Post -Headers $headers -Body $body
}

function Get-DeviceId {
    if (-not (Test-Path $rd)) { return '' }
    $out = & $rd --get-id 2>$null
    if ($out -match '(\d{6,})') { return $Matches[1] }
    return ''
}

# 采集一次上下文
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' } |
    Select-Object -First 1).IPAddress
$user = ((Get-CimInstance Win32_ComputerSystem).UserName -split '\\')[-1]

$interval = [int]$cfg.interval_minutes
if ($interval -lt 1) { $interval = 5 }

while ($true) {
    $deviceId = Get-DeviceId
    if ($deviceId) {
        $hb = Send-Heartbeat $deviceId
        if ($hb.ok) {
            Write-Log "心跳正常 ID=$deviceId"
        } elseif ($hb.code -eq 'NOT_ENROLLED') {
            Write-Log "设备未登记，重新注册 ID=$deviceId"
            $reg = Register-Device $deviceId
            if ($reg.unattended_password -and (Test-Path $rd)) {
                & $rd --password $reg.unattended_password
            }
        } else {
            Write-Log "心跳失败：$($hb.error)"
        }
    } else {
        Write-Log '未获取到设备 ID'
    }
    if (-not $Loop) { break }
    Start-Sleep -Seconds ($interval * 60)
}
