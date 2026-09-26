# 公共函数：读取配置、查找/下载 rustdesk.exe、管理员检测
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-Settings {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "找不到配置文件：$Path" }
    $cfg = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith(';') -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        $cfg[$k] = $v
    }
    return $cfg
}

function Resolve-SettingsPath {
    param([string]$Settings)
    $clientDir = Split-Path -Parent $PSScriptRoot
    if ($Settings) { return $Settings }
    $local = Join-Path $clientDir 'settings.ini'
    if (Test-Path -LiteralPath $local) { return $local }
    return (Join-Path $clientDir 'settings.example.ini')
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RustDeskExe {
    param([Parameter(Mandatory = $true)][string]$WorkDir)
    $local = Join-Path $WorkDir 'rustdesk.exe'
    if (Test-Path -LiteralPath $local) { return $local }

    Write-Host '未找到本机 rustdesk.exe，正在从 GitHub 下载官方最新版...' -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/rustdesk/rustdesk/releases/latest' `
            -Headers @{ 'User-Agent' = 'MediLink-RustDesk-Deploy' }
        $asset = $rel.assets | Where-Object { $_.name -match '^rustdesk-.*-x86_64\.exe$' } | Select-Object -First 1
        if (-not $asset) { throw '未找到 x86_64 安装包' }
        Write-Host ("下载：" + $asset.browser_download_url)
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $local -UseBasicParsing
    }
    catch {
        throw "自动下载失败（$($_.Exception.Message)）。请手动下载 RustDesk 官方 Windows x86_64 版，" +
              "重命名为 rustdesk.exe 放到：$WorkDir"
    }
    return $local
}
