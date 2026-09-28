# 医联 · 自定义 RustDesk 客户端（源码构建）

在 [rustdesk/rustdesk](https://github.com/rustdesk/rustdesk) 源码基础上，自定义一个品牌为
**医联** 的 Windows 客户端（**医院信息科倾情打造，为更好处理电脑问题而做的远程控制软件**），
内置医院内网自建服务器地址，产出：

- **安装版**：`yilian-<版本>-x64.exe`（自解压 exe，运行即安装，注册系统服务、开机自启）；
- **绿色免安装版**：`yilian-<版本>-portable.zip`（解压即用，已预置服务器，双击 `启动-医联.bat` 连上内网 Docker 服务端）；
- **Windows 7/8/32 位版**：`yilian-<版本>-win7.exe`（Sciter 后端；Flutter 版在 Win7 会黑屏）。

> OSS 版「改应用名/图标」只能**重新编译**（运行时的自定义客户端配置需 RustDesk 私钥签名，
> 无法用配置绕过）。本套件通过补丁 + 官方构建链实现品牌化，**不修改其上流代码逻辑**，
> 仅改名称/图标/内置地址，并保留上游版权声明。RustDesk 遵循 **AGPL-3.0**，本补丁同样遵循。

---

## 一、两种构建方式

### 方案 1（推荐）：直接在 MediLink 仓库自动构建，无需 fork

已内置 [`.github/workflows/yilian-client.yml`](../.github/workflows/yilian-client.yml)，
会 checkout rustdesk 源码、内联生成 flutter-rust-bridge、内联编译 topmost DLL，再打补丁打包。

> 图文配置步骤（变量、触发、下载、排错）见 **[docs/yilian-build.md](../docs/yilian-build.md)**。

1. 在 MediLink 的 **Settings → Secrets and variables → Actions → Variables** 增加：
   - `YILIAN_SERVER`：服务端内网 IP，如 `10.0.0.10`
   - `YILIAN_RELAY`：中继，一般同上
   - `YILIAN_KEY`：服务端公钥（`E:\rustdesk\data\id_ed25519.pub` 内容）——**必填**
2. 打开 **Actions → Build Yilian Client → Run workflow**（可填版本号与 rustdesk 版本）；
   或推送 `yilian-v*` 标签自动构建并发布 Release。
3. 构建完成后在 **Artifacts** 或 **Releases** 下载 `yilian-*-x64.exe` 与 `yilian-*-portable.zip`。

> 首次构建约 40–70 分钟（Rust + Flutter + vcpkg）。若未配置 `YILIAN_KEY`，日志会出现告警，
> 生成的客户端将无法握手。未做代码签名，可按需接入。

### 方案 2：fork rustdesk，用其官方 CI 构建

1. **Fork** `rustdesk/rustdesk`。
2. 把 `rustdesk-custom/` 复制到 fork 根目录；把 `rustdesk-custom/workflows/yilian-windows.yml`
   复制到 fork 的 `.github/workflows/`。
3. 配置与方案 1 相同的 Variables；运行 **Build Yilian Windows Client**。
4. `rustdesk-custom/branding/app_icon.ico`（可选）放自定义图标。

> 方案 1 更省事、产物留在 MediLink；方案 2 更贴近上游、便于跟随 RustDesk 更新。

## 二、品牌补丁改了什么

`apply-branding.ps1` 在构建前修改（锚点校验，改不动会直接报错）：

| 文件 | 改动 |
|---|---|
| `libs/hbb_common/src/config.rs` | `APP_NAME`→医联、`ORG`→com.yilian、默认 `RENDEZVOUS_SERVERS`→你的服务器 |
| `src/common.rs` | 注入 `DEFAULT_SETTINGS`：`custom-rendezvous-server`/`relay-server`/`key`（安装即用，无需手填）；若提供密码，另注入 `HARD_SETTINGS.password` 作为**无人值守固定密码**，并设 `approve-mode=password`（免点“接受”） |
| `flutter/windows/runner/Runner.rc` | 产品名、文件描述（含信息科标语）、公司名、版权（保留 RustDesk 上游声明） |
| `flutter/windows/runner/resources/app_icon.ico`、`res/icon.ico` | 替换为你提供的图标 |

结果：客户端窗口标题与应用名显示为 **医联**，启动即连内网服务端，不再出现「RustDesk」字样与官方更新提示。

## 三、绿色版用法

解压 `yilian-<版本>-portable.zip` 到目标电脑任意目录，双击 **`启动-医联.bat`**（或 `rustdesk.exe`）。
脚本会把 `RustDesk2.toml` 写入 `%APPDATA%\RustDesk\config\` 作为兜底配置，然后启动——已内置地址，通常无需任何操作。

## 四、本地构建（可选，不用 CI）

前提：Windows + Rust 1.75 + Flutter 3.24.5 + vcpkg + LLVM 15 + 已生成 `flutter_rust_bridge`
（细节见 RustDesk 官方 *Build on Windows*）。核心命令：

```powershell
# 1) 应用品牌补丁（在 rustdesk 源码根目录）
powershell -ExecutionPolicy Bypass -File .\rustdesk-custom\apply-branding.ps1 `
  -Server 10.0.0.10 -Relay 10.0.0.10 -Key "服务端公钥" `
  -IconPath .\rustdesk-custom\branding\app_icon.ico -AllowUnsignedCustomClient

# 2) 编译（等价官方 build.py）
python3 .\build.py --portable --flutter --skip-portable-pack --hwcodec
```

## 五、常见问题

| 现象 | 处理 |
|---|---|
| CI 报锚点匹配失败 | RustDesk 版本变化，按提示核对 `config.rs`/`common.rs`/`Runner.rc` 对应行后微调脚本；本脚本锚点基于 **1.4.9** |
| 客户端仍显示 RustDesk | 品牌补丁步骤未执行成功，检查 Actions 日志中 “Apply 医联 branding” 是否通过 |
| 连不上服务器 | 确认 `YILIAN_KEY` 与 `id_ed25519.pub` 一致、`21116(TCP/UDP)`/`21117` 放行 |
| 想固定版本 | 手动 Run 时填 `rustdesk_ref`（默认 `1.4.9`） |
| 私库 Actions 分钟数 | 构建较重，注意私有仓库额度；可改为 fork rustdesk 用公开仓库构建 |
