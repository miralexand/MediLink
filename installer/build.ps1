# MediLink 构建脚本：编译 Windows exe 并打包安装程序
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1 -SkipCompile
#
# 依赖：bun（编译 exe）、Inno Setup 6（打包安装程序）
# 可选：将 RustDesk 安装包放到 installer\payload\rustdesk.msi，将随被控端安装包一起分发

param(
    [switch]$SkipCompile,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$installer = $PSScriptRoot

function Find-Bun {
    $cmd = Get-Command bun -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw '未找到 bun，请先安装：https://bun.sh'
}

function Find-Iscc {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw '未找到 Inno Setup 6（ISCC.exe），请先安装：winget install JRSoftware.InnoSetup'
}

$bun = Find-Bun
$iscc = Find-Iscc
Write-Host "bun  : $bun"
Write-Host "ISCC : $iscc"

function Build-Exe($name, $dir) {
    $out = Join-Path $dir 'dist'
    $exe = Join-Path $out "$name.exe"
    if ($Force -or -not (Test-Path $exe)) {
        Write-Host "`n>>> 编译 $name.exe ..." -ForegroundColor Cyan
        Push-Location $dir
        try {
            & $bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile "dist\$name.exe"
            if ($LASTEXITCODE -ne 0) { throw "编译 $name 失败" }
        } finally { Pop-Location }
    } else {
        Write-Host "`n>>> 已存在 $exe，跳过编译（-Force 可强制重建）"
    }
}

if (-not $SkipCompile) {
    Build-Exe 'medilink-agent'   (Join-Path $root 'agent')
    Build-Exe 'medilink-console' (Join-Path $root 'console')
}

# 确保 payload 目录存在（可选放置 rustdesk.msi）
New-Item -ItemType Directory -Force -Path (Join-Path $installer 'payload') | Out-Null

Write-Host "`n>>> 打包被控端安装程序 ..." -ForegroundColor Cyan
& $iscc (Join-Path $installer 'agent.iss')
if ($LASTEXITCODE -ne 0) { throw '被控端安装包编译失败' }

Write-Host "`n>>> 打包控制端安装程序 ..." -ForegroundColor Cyan
& $iscc (Join-Path $installer 'console.iss')
if ($LASTEXITCODE -ne 0) { throw '控制端安装包编译失败' }

Write-Host "`n构建完成，产物位于：$installer\Output" -ForegroundColor Green
Get-ChildItem (Join-Path $installer 'Output') | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
