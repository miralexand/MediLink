# MediLink 被控端卸载脚本
#
# 用法：
#   .\uninstall-agent.ps1                 # 仅移除 MediLink 心跳任务与配置
#   .\uninstall-agent.ps1 -RemoveRustDesk # 同时卸载 RustDesk（谨慎）

[CmdletBinding()]
param([switch]$RemoveRustDesk)

$ErrorActionPreference = 'Continue'

Write-Host '正在停止并移除 MediLink 计划任务…'
schtasks.exe /End /TN MediLinkAgent 2>$null | Out-Null
schtasks.exe /Delete /TN MediLinkAgent /F 2>$null | Out-Null

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*agent-heartbeat.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$dataDir = Join-Path $env:ProgramData 'MediLink'
if (Test-Path $dataDir) {
    Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
    Write-Host "已删除配置目录：$dataDir"
}

if ($RemoveRustDesk) {
    Write-Host '正在卸载 RustDesk…'
    $rd = @(
        (Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'RustDesk\rustdesk.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($rd) {
        & $rd --uninstall 2>$null
        Start-Sleep -Seconds 5
    }
    $uninst = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk' -ErrorAction SilentlyContinue
    if ($uninst -and $uninst.UninstallString) {
        Start-Process cmd.exe -ArgumentList "/c `"$($uninst.UninstallString)`" /S" -Wait -ErrorAction SilentlyContinue
    }
}

Write-Host 'MediLink 被控端卸载完成。' -ForegroundColor Green
