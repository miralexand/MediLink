# MediLink 被控端安装脚本（PowerShell 轻量版）
#
# 适用于信息科批量部署：不依赖 compiled exe，直接安装 RustDesk、
# 下发自建服务器配置、采集设备 ID 并登记到 MediLink 管理服务端。
#
# 用法（管理员 PowerShell）：
#   .\install-agent.ps1 -Server http://10.0.0.10:21120 -EnrollmentKey "xxxx" -Department "门诊"
#   .\install-agent.ps1 -Server http://10.0.0.10:21120 -MsiPath D:\rustdesk.msi -Department "检验科"
#
# 参数：
#   -Server          MediLink 管理服务端地址（必填）
#   -EnrollmentKey   被控端注册密钥（与服务端一致）
#   -Department      科室名称
#   -MsiPath         本地 RustDesk 安装包（.msi 或 .exe），留空则检测已装/尝试下载
#   -DownloadUrl     可选，RustDesk 安装包直链
#   -IntervalMinutes 心跳间隔（分钟，默认 5）
#   -NoTask          只登记，不创建计划任务

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$EnrollmentKey = "",
    [string]$Department = "",
    [string]$MsiPath = "",
    [string]$DownloadUrl = "",
    [int]$IntervalMinutes = 5,
    [switch]$NoTask
)

$ErrorActionPreference = 'Stop'
$AgentVersion = 'ps-1.0.0'
$DataDir = Join-Path $env:ProgramData 'MediLink'
$ConfigFile = Join-Path $DataDir 'agent-ps.json'
$TaskName = 'MediLinkAgent'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '请以管理员身份运行本脚本。'
    }
}

function Get-RustDeskExe {
    $paths = @(
        (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\RustDesk\rustdesk.exe')
    )
    foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
    $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk' -ErrorAction SilentlyContinue
    if ($reg -and $reg.InstallLocation) {
        $c = Join-Path $reg.InstallLocation 'rustdesk.exe'
        if (Test-Path $c) { return $c }
    }
    return ''
}

function Install-RustDesk {
    param([string]$Path, [string]$Url)
    if ($Path) {
        if (-not (Test-Path $Path)) { throw "RustDesk 安装包不存在：$Path" }
        Write-Host "正在安装 RustDesk：$Path"
        if ($Path.ToLower().EndsWith('.msi')) {
            Start-Process msiexec.exe -ArgumentList "/i `"$Path`" /qn /norestart" -Wait
        } else {
            Start-Process $Path -ArgumentList '--silent-install' -Wait
        }
    } elseif ($Url) {
        $tmp = Join-Path $env:TEMP 'rustdesk-setup.exe'
        Write-Host "正在下载 RustDesk：$Url"
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
        Start-Process $tmp -ArgumentList '--silent-install' -Wait
    }
}

Assert-Admin
$Server = $Server.TrimEnd('/')
Write-Host "MediLink 被控端安装开始，服务端：$Server"

# 1. 确保 RustDesk 已安装
if (-not (Get-RustDeskExe)) {
    Install-RustDesk -Path $MsiPath -Url $DownloadUrl
    Start-Sleep -Seconds 15
}
$rd = Get-RustDeskExe
if (-not $rd) { throw '未检测到 RustDesk，请通过 -MsiPath 指定安装包后重试。' }
Write-Host "RustDesk 路径：$rd"

# 2. 获取服务端接入参数并下发配置
$setup = Invoke-RestMethod "$Server/api/public/setup"
if ($setup.rustdesk_key) {
    & $rd --config "host=$($setup.rendezvous_server),key=$($setup.rustdesk_key),relay=$($setup.relay_server)"
} else {
    & $rd --config "host=$($setup.rendezvous_server),relay=$($setup.relay_server)"
}

# 3. 注册服务（无人值守）
& $rd --install-service
$svc = Get-Service -Name RustDesk -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne 'Running') { Start-Service RustDesk }
    while ((Get-Service RustDesk).Status -ne 'Running') { Start-Sleep -Seconds 3 }
}

# 4. 采集设备 ID
$deviceId = ''
for ($i = 0; $i -lt 10; $i++) {
    $out = & $rd --get-id 2>$null
    if ($out -match '(\d{6,})') { $deviceId = $Matches[1]; break }
    Start-Sleep -Seconds 4
}
if (-not $deviceId) { throw '无法获取 RustDesk 设备 ID，请确认 RustDesk 服务已运行。' }

# 5. 采集系统信息
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Sort-Object -Property @{Expression = { if ($_.IPAddress -like '10.*') { 0 } elseif ($_.IPAddress -like '192.168.*') { 1 } else { 2 } } } |
    Select-Object -First 1).IPAddress
$mac = (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object -First 1).MacAddress
$os = (Get-CimInstance Win32_OperatingSystem).Caption
$user = ((Get-CimInstance Win32_ComputerSystem).UserName -split '\\')[-1]
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$mem = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)

# 6. 登记到 MediLink
$headers = @{ 'Content-Type' = 'application/json' }
if ($EnrollmentKey) { $headers['X-Agent-Key'] = $EnrollmentKey }
$body = @{
    rustdesk_id   = $deviceId
    hostname      = $env:COMPUTERNAME
    username      = $user
    department    = $Department
    ip            = $ip
    mac           = $mac
    os            = $os
    cpu           = $cpu
    memory        = "$mem GB"
    agent_version = $AgentVersion
} | ConvertTo-Json
$resp = Invoke-RestMethod "$Server/api/agent/register" -Method Post -Headers $headers -Body $body
Write-Host "设备登记成功：ID=$deviceId 设备记录号=$($resp.device_id)"

# 7. 设置无人值守密码
if ($resp.unattended_password) {
    & $rd --password $resp.unattended_password
    Write-Host '已下发无人值守密码。'
}

# 8. 保存本地配置（供心跳脚本使用）
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
@{
    server          = $Server
    enrollment_key  = $EnrollmentKey
    department      = $Department
    rustdesk_exe    = $rd
    interval_minutes = $IntervalMinutes
} | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8

# 9. 注册开机计划任务，定时心跳
if (-not $NoTask) {
    $script = Join-Path $PSScriptRoot 'agent-heartbeat.ps1'
    if (Test-Path $script) {
        $action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Loop"
        schtasks.exe /Create /TN $TaskName /TR $action /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
        Write-Host "已注册开机自启计划任务：$TaskName（每 $IntervalMinutes 分钟心跳）"
        Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    } else {
        Write-Warning "未找到 agent-heartbeat.ps1，已跳过心跳任务注册。"
    }
}

Write-Host 'MediLink 被控端安装完成。' -ForegroundColor Green
