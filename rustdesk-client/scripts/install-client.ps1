# 方法 1：一键安装客户端并预置服务器信息（静默安装 + 开机自启 + 无人值守）
[CmdletBinding()]
param([string]$Settings)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$clientDir = Split-Path -Parent $PSScriptRoot
$Settings = Resolve-SettingsPath $Settings

if (-not (Test-Admin)) {
    Write-Host '需要管理员权限，正在请求提权...' -ForegroundColor Yellow
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Settings "{1}"' -f $PSCommandPath, $Settings
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argLine
    exit
}

$cfg = Read-Settings $Settings
$server = [string]$cfg['Server']
$relay = [string]$cfg['Relay']
$key = [string]$cfg['Key']
$pw = [string]$cfg['Password']
$cfgStr = [string]$cfg['ConfigString']

if ([string]::IsNullOrWhiteSpace($server)) { throw '配置项 Server 不能为空，请编辑 settings.ini' }

$exe = Get-RustDeskExe -WorkDir $clientDir
Write-Host "使用安装包：$exe"

Write-Host '正在静默安装 RustDesk...'
Start-Process -FilePath $exe -ArgumentList '--silent-install' -Wait

$installed = Join-Path $env:ProgramFiles 'RustDesk\rustdesk.exe'
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Path -LiteralPath $installed) { break }
    Start-Sleep -Seconds 2
}
if (-not (Test-Path -LiteralPath $installed)) { throw '安装失败：未找到 rustdesk.exe' }

Write-Host '等待 RustDesk 后台服务就绪...'
Start-Sleep -Seconds 8

function Invoke-RdOption {
    param([string]$Name, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    & $installed --option $Name $Value | Out-Null
    Start-Sleep -Milliseconds 500
}

if (-not [string]::IsNullOrWhiteSpace($cfgStr)) {
    Write-Host '应用“导出服务器配置”字符串...'
    & $installed --config $cfgStr | Out-Null
}
else {
    Write-Host '写入 ID 服务器 / 中继服务器 / Key...'
    Invoke-RdOption 'custom-rendezvous-server' $server
    Invoke-RdOption 'relay-server' $relay
    Invoke-RdOption 'key' $key
}

if (-not [string]::IsNullOrWhiteSpace($pw)) {
    Write-Host '设置无人值守固定密码...'
    & $installed --password $pw | Out-Null
}

Start-Sleep -Seconds 2
$id = (& $installed --get-id 2>$null) -join ''

Write-Host ''
Write-Host '================ 部署完成 ================' -ForegroundColor Green
Write-Host "设备 ID  : $id"
Write-Host "服务器   : $server"
Write-Host "中继     : $relay"
Write-Host "密码     : $pw"
Write-Host '=========================================' -ForegroundColor Green
Write-Host '如客户端未立即显示 ID，请重启 RustDesk 或稍候片刻。'
