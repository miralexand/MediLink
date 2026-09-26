# 医联（Yilian）自定义 RustDesk 客户端 —— 品牌补丁脚本
#
# 在【rustdesk 源码根目录】上运行，把官方源码改成「医联」，并内置内网自建服务器地址与无人值守密码。
# 只改必要文件，锚点校验失败会中止，避免误改。
#
# 用法（在 rustdesk 仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File .\rustdesk-custom\apply-branding.ps1 `
#     -Server 10.0.0.10 -Relay 10.0.0.10 -Key "服务端公钥" -Password "MediLink@123" `
#     -IconPath .\rustdesk-custom\branding\app_icon.ico
#
# 说明：
# - 品牌名/图标属重新编译，符合 AGPL；本脚本保留 RustDesk 上游版权声明，仅追加信息科署名。
# - 默认服务器通过内置 DEFAULT_SETTINGS 注入；无人值守密码通过内置 HARD_SETTINGS 预置（preset），
#   安装版与绿色版都无需再手填、无需被控端点“接受”。
[CmdletBinding()]
param(
    [string]$RepoRoot = (Get-Location).Path,
    [string]$AppName = '医联',
    [string]$Org = 'com.yilian',
    [string]$Company = '医院信息科',
    [string]$Tagline = '医院信息科倾情打造，为更好处理电脑问题而做的远程控制软件',
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$Relay = '',
    [string]$Key = '',
    [string]$Password = '',
    [string]$IconPath = '',
    [switch]$AllowUnsignedCustomClient
)

$ErrorActionPreference = 'Stop'

function Read-Text([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
function Write-Text([string]$p, [string]$t) {
    [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($false)))
}
function Esc-Rust([string]$s) { return $s.Replace('\', '\\').Replace('"', '\"') }
function Set-Anchor {
    param([string]$Text, [string]$Old, [string]$New, [string]$What)
    if ($Text.Contains($New)) { Write-Host "  = 已是目标值：$What" -ForegroundColor DarkGray; return $Text }
    $c = ([regex]::Matches($Text, [regex]::Escape($Old))).Count
    if ($c -ne 1) { throw "锚点匹配失败：$What（匹配 $c 次，应为 1）。源码版本可能不同，已中止，请核对。" }
    Write-Host "  + 替换：$What" -ForegroundColor Green
    return $Text.Replace($Old, $New)
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if ([string]::IsNullOrWhiteSpace($Relay)) { $Relay = $Server }
if ([string]::IsNullOrWhiteSpace($Key)) { Write-Host '!! 未提供 -Key，客户端将无法与自建服务器握手，请务必补齐。' -ForegroundColor Yellow }
if ([string]::IsNullOrWhiteSpace($Password)) { Write-Host '!! 未提供 -Password，被控端将没有固定无人值守密码（需手动设置）。' -ForegroundColor Yellow }

$cfgPath = Join-Path $RepoRoot 'libs\hbb_common\src\config.rs'
$commonPath = Join-Path $RepoRoot 'src\common.rs'
$rcPath = Join-Path $RepoRoot 'flutter\windows\runner\Runner.rc'
foreach ($p in @($cfgPath, $commonPath, $rcPath)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "找不到文件：$p（请在 rustdesk 源码根目录运行）" }
}

Write-Host '== 1/4 品牌名与默认服务器（hbb_common/config.rs）==' -ForegroundColor Cyan
$t = Read-Text $cfgPath
$t = Set-Anchor $t 'RwLock::new("com.carriez".to_owned())' ("RwLock::new(`"$Org`".to_owned())") 'ORG'
$t = Set-Anchor $t 'RwLock::new("RustDesk".to_owned())' ("RwLock::new(`"$AppName`".to_owned())") 'APP_NAME'
$t = Set-Anchor $t '&["rs-ny.rustdesk.com"]' ("&[`"$Server`"]") 'RENDEZVOUS_SERVERS'
Write-Text $cfgPath $t

Write-Host '== 2/4 内置服务器与无人值守密码（src/common.rs）==' -ForegroundColor Cyan
$t = Read-Text $commonPath
$body = New-Object System.Collections.Generic.List[string]
$body.Add('    let mut d = config::DEFAULT_SETTINGS.write().unwrap();')
$body.Add('    d.entry(keys::OPTION_CUSTOM_RENDEZVOUS_SERVER.to_string()).or_insert_with(|| "' + (Esc-Rust $Server) + '".to_owned());')
$body.Add('    d.entry("relay-server".to_string()).or_insert_with(|| "' + (Esc-Rust $Relay) + '".to_owned());')
$body.Add('    d.entry("key".to_string()).or_insert_with(|| "' + (Esc-Rust $Key) + '".to_owned());')
if (-not [string]::IsNullOrWhiteSpace($Password)) {
    $body.Add('    d.entry("approve-mode".to_string()).or_insert_with(|| "password".to_owned());')
    $body.Add('    d.entry("verification-method".to_string()).or_insert_with(|| "use-both-passwords".to_owned());')
    $body.Add('    d.entry("remove-preset-password-warning".to_string()).or_insert_with(|| "Y".to_owned());')
    $body.Add('    drop(d);')
    $body.Add('    {')
    $body.Add('        let mut h = config::HARD_SETTINGS.write().unwrap();')
    $body.Add('        h.entry("password".to_string()).or_insert_with(|| "' + (Esc-Rust $Password) + '".to_owned());')
    $body.Add('    }')
}
$fnText = "// YILIAN_BRANDING: 内置医院内网自建服务器与无人值守密码，安装即用`nfn apply_yilian_defaults() {`n" +
          ($body -join "`n") + "`n}`n`npub fn load_custom_client() {`n    apply_yilian_defaults();"
$t = Set-Anchor $t 'pub fn load_custom_client() {' $fnText 'load_custom_client 注入默认配置'

if ($AllowUnsignedCustomClient) {
    $oldVerify = @"
    let Ok(data) = sign::verify(&data, &pk) else {
        log::error!("Failed to dec custom client config");
        return;
    };
"@
    $newVerify = @"
    // YILIAN_UNSIGNED: 医联自建客户端允许未签名的 custom.txt 配置
    let data = match sign::verify(&data, &pk) {
        Ok(d) => d,
        Err(_) => data,
    };
"@
    $t = Set-Anchor $t $oldVerify $newVerify '允许未签名 custom.txt'
}
Write-Text $commonPath $t

Write-Host '== 3/4 Windows 文件属性（Runner.rc）==' -ForegroundColor Cyan
$t = Read-Text $rcPath
$t = Set-Anchor $t 'VALUE "ProductName", "RustDesk" "\0"' ('VALUE "ProductName", "' + $AppName + '" "\0"') 'ProductName'
$t = Set-Anchor $t 'VALUE "FileDescription", "RustDesk Remote Desktop" "\0"' ('VALUE "FileDescription", "' + $Tagline + '" "\0"') 'FileDescription'
$t = Set-Anchor $t 'VALUE "CompanyName", "Purslane Tech Pte. Ltd." "\0"' ('VALUE "CompanyName", "' + $Company + '" "\0"') 'CompanyName'
$oldCopy = 'VALUE "LegalCopyright", "Copyright © 2026 Purslane Tech Pte. Ltd. All rights reserved." "\0"'
$newCopy = 'VALUE "LegalCopyright", "Copyright © 2026 ' + $Company + '. 基于 RustDesk（AGPL-3.0），Copyright © Purslane Tech Pte. Ltd." "\0"'
$t = Set-Anchor $t $oldCopy $newCopy 'LegalCopyright'
Write-Text $rcPath $t

Write-Host '== 4/4 图标 ==' -ForegroundColor Cyan
if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
    $ico = (Resolve-Path -LiteralPath $IconPath).Path
    foreach ($rel in @('flutter\windows\runner\resources\app_icon.ico', 'res\icon.ico')) {
        $dst = Join-Path $RepoRoot $rel
        if (Test-Path -LiteralPath (Split-Path -Parent $dst)) {
            Copy-Item -LiteralPath $ico -Destination $dst -Force
            Write-Host "  + 图标 -> $rel" -ForegroundColor Green
        }
    }
} else {
    Write-Host '  ! 未提供有效 -IconPath，沿用官方图标。建议放入 .ico 后重试。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '品牌补丁完成：' -ForegroundColor Cyan
Write-Host ("  应用名   : " + $AppName)
Write-Host ("  组织     : " + $Org)
Write-Host ("  服务器   : " + $Server)
Write-Host ("  中继     : " + $Relay)
Write-Host ("  Key      : " + $(if ($Key) { '(已设置)' } else { '(空)' }))
Write-Host ("  无人值守密码: " + $(if ($Password) { '(已内置)' } else { '(未设置)' }))
Write-Host '下一步：提交到你的 rustdesk fork，然后运行 .github/workflows/yilian-windows.yml。'
