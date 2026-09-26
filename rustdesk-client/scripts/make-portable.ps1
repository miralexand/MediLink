# 方法 2：制作免安装便携包（解压双击即用，预置好服务器信息）
[CmdletBinding()]
param([string]$Settings)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$clientDir = Split-Path -Parent $PSScriptRoot
$Settings = Resolve-SettingsPath $Settings
$cfg = Read-Settings $Settings

$server = [string]$cfg['Server']
$relay = [string]$cfg['Relay']
$key = [string]$cfg['Key']

if ([string]::IsNullOrWhiteSpace($server)) { throw '配置项 Server 不能为空，请编辑 settings.ini' }

function ConvertTo-TomlValue {
    param([string]$Value)
    return $Value.Replace("'", "''")
}

$exe = Get-RustDeskExe -WorkDir $clientDir

$out = Join-Path $clientDir 'dist\RustDesk便携版'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $out 'rustdesk.exe') -Force

$toml = @()
$toml += '[options]'
$toml += "custom-rendezvous-server = '" + (ConvertTo-TomlValue $server) + "'"
if (-not [string]::IsNullOrWhiteSpace($relay)) {
    $toml += "relay-server = '" + (ConvertTo-TomlValue $relay) + "'"
}
if (-not [string]::IsNullOrWhiteSpace($key)) {
    $toml += "key = '" + (ConvertTo-TomlValue $key) + "'"
}
[IO.File]::WriteAllText((Join-Path $out 'RustDesk2.toml'), ($toml -join "`r`n"), (New-Object Text.UTF8Encoding($false)))

$launcher = @'
@echo off
chcp 65001 >nul
setlocal
set HERE=%~dp0
set CFGDIR=%APPDATA%\RustDesk\config
if not exist "%CFGDIR%" mkdir "%CFGDIR%"
taskkill /IM rustdesk.exe /F >nul 2>&1
copy /Y "%HERE%RustDesk2.toml" "%CFGDIR%\RustDesk2.toml" >nul
start "" "%HERE%rustdesk.exe"
'@
[IO.File]::WriteAllText((Join-Path $out '启动-RustDesk.bat'), $launcher, (New-Object Text.UTF8Encoding($false)))

$zip = Join-Path $clientDir 'dist\RustDesk便携版.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip -Force

Write-Host ''
Write-Host '================ 便携包已生成 ================' -ForegroundColor Green
Write-Host "目录 : $out"
Write-Host "压缩 : $zip"
Write-Host "ID服务器 : $server"
Write-Host "中继     : $relay"
Write-Host '=============================================' -ForegroundColor Green
Write-Host '把 zip 拷到目标电脑，解压后双击“启动-RustDesk.bat”即可。'
