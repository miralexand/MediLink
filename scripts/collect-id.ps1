# MediLink 设备 ID 采集脚本（一次性）
#
# 用途：批量盘点时快速采集本机 RustDesk 设备 ID 与基础信息。
# 用法：
#   .\collect-id.ps1                                    # 仅本机输出
#   .\collect-id.ps1 -Server http://10.0.0.10:21120     # 同时登记到服务端
#   .\collect-id.ps1 -Server http://10.0.0.10:21120 -EnrollmentKey xxxx -Department 门诊 -Csv D:\ledger.csv

[CmdletBinding()]
param(
    [string]$Server = "",
    [string]$EnrollmentKey = "",
    [string]$Department = "",
    [string]$Csv = ""
)

$ErrorActionPreference = 'Continue'

$rd = @(
    (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$deviceId = ''
if ($rd) {
    $out = & $rd --get-id 2>$null
    if ($out -match '(\d{6,})') { $deviceId = $Matches[1] }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' } | Select-Object -First 1).IPAddress
$user = ((Get-CimInstance Win32_ComputerSystem).UserName -split '\\')[-1]

$record = [PSCustomObject]@{
    设备ID    = $deviceId
    计算机名  = $env:COMPUTERNAME
    使用人    = $user
    科室      = $Department
    IP地址    = $ip
    采集时间  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
}

$record | Format-List
if ($Csv) { $record | Export-Csv -Path $Csv -Append -NoTypeInformation -Encoding UTF8 }

if ($Server -and $deviceId) {
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($EnrollmentKey) { $headers['X-Agent-Key'] = $EnrollmentKey }
    $body = @{
        rustdesk_id = $deviceId
        hostname    = $env:COMPUTERNAME
        username    = $user
        department  = $Department
        ip          = $ip
        agent_version = 'collect-id'
    } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod "$($Server.TrimEnd('/'))/api/agent/register" -Method Post -Headers $headers -Body $body
        Write-Host "已登记到服务端，设备记录号：$($r.device_id)" -ForegroundColor Green
    } catch {
        Write-Warning "登记失败：$_"
    }
}
