# 医联（MediLink）新手安装部署教程

> 面向零基础运维人员：从一台内网服务器、几台 Windows 终端开始，完成
> **服务端 → 控制台 → 被控端 → 控制端** 的完整部署。
> 全程约 30～60 分钟。文中命令均可直接复制，示例内网 IP 为 `10.0.0.10`，
> 请替换为你自己的实际 IP。

---

## 目录

- [0. 部署前必读](#0-部署前必读)
- [1. 部署服务端](#1-部署服务端)
- [2. 初始化管理控制台（最关键）](#2-初始化管理控制台最关键)
- [3. 安装被控端](#3-安装被控端)
- [4. 安装控制端并发起协助](#4-安装控制端并发起协助)
- [5. 部署完成检查清单](#5-部署完成检查清单)
- [6. 日常运维](#6-日常运维)
- [7. 排障速查表](#7-排障速查表)
- [附录 A：从源码构建 Windows 安装包](#附录-a从源码构建-windows-安装包)

---

## 0. 部署前必读

### 0.1 系统由三部分组成

```text
   信息科控制端 (Windows)                 被控端 (Windows 终端)
   medilink-console.exe                   medilink-agent.exe
            \                                /
             \       P2P 直连 / 中继         /
              v                              v
      ┌────────────────────────────────────────────────┐
      │            医院内网服务器 (Docker)               │
      │  hbbs :21116   hbbr :21117                      │
      │  medilink :21120  (API + 台账 + 审计 + 控制台)  │
      └────────────────────────────────────────────────┘
```

| 组件 | 安装在哪 | 作用 |
|---|---|---|
| **服务端** | 内网服务器（Linux 或 Windows） | RustDesk 信令/中继 + 管理平台 |
| **被控端 Agent** | 各科室 Windows 终端 | 自动登记设备、下发配置、定时心跳 |
| **控制端 Console** | 信息科 Windows 电脑 | 查看台账、一键发起远程协助、审计 |

### 0.2 需要准备的机器与信息

| 角色 | 建议 | 示例 | 说明 |
|---|---|---|---|
| 服务端 | 2 核 / 2GB / 20GB，固定内网 IP | `10.0.0.10` | 需装 Docker |
| 被控端 | Windows 10/11 | 自动分配 | 各科室终端 |
| 控制端 | Windows 10/11 | `10.0.0.20` | 信息科电脑 |

用 `ipconfig`（Windows）或 `ip addr`（Linux）确认服务端内网 IP，后面所有配置都用它。

### 0.3 端口规划（务必在防火墙放行）

| 端口 | 协议 | 用途 | 是否必须 |
|---|---|---|---|
| 21116 | **TCP + UDP** | hbbs ID 注册与心跳 | ✅ 必须（UDP 尤其重要） |
| 21117 | TCP | hbbr 中继转发 | ✅ 必须 |
| 21120 | TCP | MediLink 控制台与 API | ✅ 必须 |
| 21115 | TCP | hbbs NAT 类型测试 | 建议 |
| 21118 / 21119 | TCP | Web 客户端（可选） | 可不开 |

> **安全红线**：以上端口只允许信息科网段与终端网段访问，**严禁映射到公网**。

### 0.4 正确的部署顺序（很重要）

```text
① 部署服务端  →  ② 取出 RustDesk Key  →  ③ 控制台填写 Key
        ↓
④ 安装被控端  →  ⑤ 安装控制端  →  ⑥ 发起远程协助
```

> **为什么一定要先做 ③？** 被控端在**第一次登记时**才会从服务端拉取
> `host / key / relay` 配置，之后只做心跳、不会重新拉取。如果先装了被控端再填 Key，
> 被控端会拿到空 Key 而连不上服务器，需要重启被控端任务才能重新拉取（见
> [3.5](#35-验证被控端是否登记成功)）。

---

## 1. 部署服务端

### 1.1 安装 Docker

#### Linux（Ubuntu / Debian / 麒麟）

```bash
# 一键安装 Docker（含 compose 插件）
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# 校验
docker --version
docker compose version
```

#### Windows（WSL2 + Docker Desktop）

1. 以管理员打开 PowerShell，安装 WSL2 并重启：

   ```powershell
   wsl --install
   wsl -l -v          # 确认 VERSION 为 2
   ```

2. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，
   在 **Settings → General** 勾选 *Use the WSL 2 based engine*，启动并保持运行。
3. 在 PowerShell 中确认：

   ```powershell
   docker --version
   docker compose version
   ```

> Windows 方案细节（含 UDP 21116 镜像网络）见 [`deploy.md`](deploy.md) 第十一节。

### 1.2 获取代码

```bash
# Linux / WSL / Git Bash
git clone https://github.com/miralexand/MediLink.git medilink
cd medilink
```

```powershell
# Windows PowerShell
git clone https://github.com/miralexand/MediLink.git medilink
cd medilink
```

### 1.3 配置 `.env`

生成两份随机密钥（**生产环境必须设置**）：

```bash
# Linux：注册密钥 + 数据库加密密钥（各执行一次）
openssl rand -base64 24     # 复制结果，作为 MEDILINK_ENROLLMENT_KEY
openssl rand -base64 32     # 复制结果，作为 MEDILINK_SECRET_KEY
```

```powershell
# Windows PowerShell：注册密钥
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)     # → MEDILINK_ENROLLMENT_KEY

# Windows PowerShell：数据库加密密钥（必须 32 字节）
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)     # → MEDILINK_SECRET_KEY
```

复制配置模板并编辑：

```bash
cp .env.example .env
vi .env
```

```powershell
copy .env.example .env
notepad .env
```

`.env` 最少需要修改这几项（其余可保持默认）：

```ini
# 服务端内网 IP：被控端/控制端据此连接
RENDEZVOUS_SERVER=10.0.0.10:21116
RELAY_HOST=10.0.0.10

# 管理控制台初始口令（首次启动写入数据库，之后请在控制台修改）
MEDILINK_ADMIN_PASSWORD=改成你的强口令

# 被控端注册密钥（与安装被控端时的 --key / -EnrollmentKey 必须一致）
MEDILINK_ENROLLMENT_KEY=粘贴上面生成的24字节随机串

# 数据库字段加密密钥（32 字节 base64）
MEDILINK_SECRET_KEY=粘贴上面生成的32字节base64

# RustDesk 服务端公钥，可先留空，稍后从控制台填写
MEDILINK_RUSTDESK_KEY=
```

`.env` 变量速查：

| 变量 | 作用 | 默认值 |
|---|---|---|
| `RENDEZVOUS_SERVER` | 下发给客户端连接的 ID 服务器 | `10.0.0.10:21116` |
| `RELAY_HOST` | hbbs 中继地址 + 下发的 relay | `10.0.0.10` |
| `HBBS_IP` / `MEDILINK_BIND_IP` | 绑定网卡（生产建议改成内网 IP） | `0.0.0.0` |
| `MEDILINK_PORT` | 控制台对外端口 | `21120` |
| `MEDILINK_ADMIN_USER` / `MEDILINK_ADMIN_PASSWORD` | 初始管理员 | `admin` / `MediLink@2026` |
| `MEDILINK_ENROLLMENT_KEY` | 被控端注册密钥 | 空（不校验，仅测试） |
| `MEDILINK_RUSTDESK_KEY` | RustDesk 服务端公钥 | 空 |
| `MEDILINK_SECRET_KEY` | 数据库字段加密密钥 | 空（自动生成并存库） |
| `MEDILINK_REQUIRE_APPROVAL` | 连接需被控端确认 | `true` |
| `MEDILINK_DEFAULT_READONLY` | 连接默认只读 | `true` |
| `MEDILINK_AUDIT_RETENTION_DAYS` | 审计留存天数 | `180` |

> ⚠️ **重要：`.env` 只在首次启动时写入数据库。** 服务端首次启动后，这些值会
> 存进数据库，之后再改 `.env` **不会覆盖**已有设置。后续修改请到控制台
> 「系统设置」里改（或删除 `data/medilink/medilink.db` 重建，但会丢失台账）。

### 1.4 启动服务端

#### Linux

```bash
sudo bash scripts/deploy-server.sh
```

若提示“已生成 .env，请编辑后重新运行”，说明是首次运行，编辑完 `.env` 再执行一次即可。

#### Windows（Docker Desktop）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1
```

脚本会构建并启动 `hbbs`、`hbbr`、`medilink` 三个容器，并等待输出 RustDesk 公钥。

### 1.5 取出 RustDesk Key 并验证

```bash
# 查看公钥（被控端/控制端要用）
cat data/rustdesk/id_ed25519.pub

# 查看容器状态，三个都应为 Up
docker compose ps

# 健康检查，应返回 {"ok":true,...}
curl http://127.0.0.1:21120/health
```

Windows 下把 `cat` 换成 `Get-Content data\rustdesk\id_ed25519.pub`，
`curl` 换成 `Invoke-RestMethod http://127.0.0.1:21120/health`。

把输出的 Key 复制下来，下一步要用。

---

## 2. 初始化管理控制台（最关键）

### 2.1 登录

浏览器打开：

```text
http://10.0.0.10:21120/
```

默认账号口令（来自 `.env`）：

```text
账号：admin
口令：MediLink@2026（若你改过 .env 则以 .env 为准）
```

### 2.2 立即修改管理员口令

**系统设置 → 修改管理员口令**：输入原口令和新口令（≥ 8 位）→ 点击「修改口令」。
修改后需要重新登录。

### 2.3 填写接入设置

进入 **系统设置 → RustDesk 与接入设置**，逐项填写后点「保存设置」：

| 设置项 | 填写内容 |
|---|---|
| 站点名称 | 医院名称，如 `XX医院医联平台` |
| ID 服务器 (hbbs) | `10.0.0.10:21116` |
| 中继服务器 (hbbr) | `10.0.0.10:21117` |
| **RustDesk Key（服务端公钥）** | 粘贴 1.5 步复制的公钥 |
| 被控端注册密钥 | 与 `.env` 的 `MEDILINK_ENROLLMENT_KEY` 一致 |
| 审计日志留存天数 | `180`（等保建议 ≥180） |
| 允许被控端自动注册 | ✅ 开启（批量部署期间；装完可关闭） |
| 连接需被控端确认 | ✅ 开启（生产建议） |
| 默认只读，操作权限按需申请 | ✅ 开启 |

> 这一步的 **RustDesk Key 必须填写正确**，否则被控端连不上自建服务器、
> 拿不到设备 ID。

---

## 3. 安装被控端

被控端有三种安装方式，任选一种。**前提是终端上要有 RustDesk**：

- 推荐：把官方 `rustdesk.msi` 放到 `installer\payload\rustdesk.msi` 后再打包安装程序，
  安装包会一并静默安装 RustDesk；
- 或先用 `install-agent.ps1 -MsiPath` 指定安装包；
- 或提前在终端手动装好 RustDesk。

### 3.1 方式一：安装包静默部署（推荐，适合批量）

从 GitHub Releases 下载 `MediLink-Agent-Setup-1.0.0.exe`（或按
[附录 A](#附录-a从源码构建-windows-安装包) 自行构建），以**管理员**运行：

```powershell
MediLink-Agent-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART `
  /SERVER=http://10.0.0.10:21120 /KEY=你的注册密钥 /DEPARTMENT=门诊
```

参数说明：

| 参数 | 说明 |
|---|---|
| `/SERVER=` | MediLink 服务端地址 |
| `/KEY=` | 注册密钥（与服务端一致，可留空则服务端不校验） |
| `/DEPARTMENT=` | 科室名称，如 `门诊`、`检验科` |

批量推送可配合 GPO 登录脚本、SCCM 或终端管理系统。

### 3.2 方式二：安装包图形界面

双击 `MediLink-Agent-Setup-1.0.0.exe`，在向导页填写**服务端地址**、
**注册密钥**、**科室**，一路下一步即可。

### 3.3 方式三：PowerShell 轻量版（体积小，无需编译 exe）

在管理员 PowerShell 中：

```powershell
cd medilink
.\scripts\install-agent.ps1 -Server http://10.0.0.10:21120 `
  -EnrollmentKey "你的注册密钥" -Department 门诊 -MsiPath D:\rustdesk.msi
```

常用参数：

| 参数 | 说明 |
|---|---|
| `-Server` | 服务端地址（必填） |
| `-EnrollmentKey` | 注册密钥 |
| `-Department` | 科室 |
| `-MsiPath` | 本地 RustDesk 安装包（`.msi` 或 `.exe`），未安装时用 |
| `-IntervalMinutes` | 心跳间隔（分钟，默认 5） |
| `-NoTask` | 只登记，不创建计划任务 |

### 3.4 安装程序自动做了什么

- 安装/复用 RustDesk，并注册 RustDesk 系统服务（保证无人值守可达）；
- 从服务端拉取 `host / key / relay` 并下发到 RustDesk；
- 采集设备 ID、计算机名、使用人、IP、MAC、系统等并登记台账；
- 设置服务端下发的无人值守密码；
- 注册名为 `MediLinkAgent` 的开机计划任务，定时心跳。

安装位置与配置：

| 内容 | 路径 |
|---|---|
| 程序目录 | `C:\Program Files\MediLink` |
| 配置（exe 版） | `%ProgramData%\MediLink\agent.json` |
| 配置（PS 版） | `%ProgramData%\MediLink\agent-ps.json` |
| PS 版日志 | `%ProgramData%\MediLink\logs\agent-ps.log` |
| 计划任务 | `MediLinkAgent`（SYSTEM，开机自启） |

### 3.5 验证被控端是否登记成功

1. 在控制台 **设备台账** 页刷新，应看到该终端，状态为「在线」；
2. 或在终端上检查：

   ```powershell
   # exe 版
   & "C:\Program Files\MediLink\medilink-agent.exe" status
   # 手动执行一次同步，输出 JSON 便于排障
   & "C:\Program Files\MediLink\medilink-agent.exe" once
   ```

   PS 版日志：

   ```powershell
   Get-Content "$env:ProgramData\MediLink\logs\agent-ps.log" -Tail 30
   ```

> **若之前漏填了 Key**：到控制台补填后，需重启被控端任务让其重新拉取配置：
>
> ```powershell
> schtasks /End /TN MediLinkAgent
> schtasks /Run /TN MediLinkAgent
> ```

---

## 4. 安装控制端并发起协助

### 4.1 安装控制端

在信息科电脑以管理员运行 `MediLink-Console-Setup-1.0.0.exe`
（或 `MediLink-Console-Setup-1.0.0.exe /VERYSILENT /NORESTART /SERVER=http://10.0.0.10:21120`）。
安装后会启动控制端，自动打开浏览器。

**前提**：控制端电脑也要安装 RustDesk（用于拉起远程连接）。

### 4.2 配置服务端地址

在控制端页面右上角点 **设置**，填写：

- 服务端地址：`http://10.0.0.10:21120`
- 本机 RustDesk 路径：一般会自动探测，未探测到再手动填写

配置保存在 `%APPDATA%\MediLink\console.json`，本地端口默认 `18760`。

### 4.3 发起远程协助

1. 用管理员账号登录控制端；
2. 在 **设备台账** 顶部搜索框按设备 ID / 计算机名 / 使用人 / IP / 科室查找目标；
3. 点击该行的 **发起远程协助**：
   - 服务端创建审计记录并返回无人值守密码；
   - 控制端自动调用本机 RustDesk 连接目标设备并填充密码；
   - 若目标开启“连接需确认”，终端用户会看到确认提示；
4. 协助结束，在 **主动会话** 面板点击 **结束会话**，记录本次时长。

### 4.4 其他常用功能

- **设备台账**：编辑科室/备注/标签、手动新增设备、导出 CSV；
- **会话审计**：查看登录、发起协助、结束会话、改密、改设置等记录，导出 CSV；
- **系统设置 → 审计日志维护**：清理超期日志。

---

## 5. 部署完成检查清单

| ✅ | 检查项 | 通过标准 |
|---|---|---|
| ☐ | 服务端容器 | `docker compose ps` 三个容器均 Up |
| ☐ | 健康检查 | 访问 `/health` 返回 `ok:true` |
| ☐ | 管理员口令 | 已从默认口令改为强口令 |
| ☐ | RustDesk Key | 控制台已填写且与 `id_ed25519.pub` 一致 |
| ☐ | 注册密钥 | 服务端与控制台、被控端安装参数一致 |
| ☐ | 被控端登记 | 设备台账出现终端，状态「在线」 |
| ☐ | 控制端连接 | 能成功发起一次远程协助并正常结束 |
| ☐ | 审计记录 | 会话审计页能看到本次连接记录 |
| ☐ | 自动注册 | 批量部署完成后可关闭「允许被控端自动注册」 |
| ☐ | 数据备份 | 已配置 `data/` 与 `.env` 的备份 |

---

## 6. 日常运维

### 6.1 更换/轮换无人值守密码

设备台账中点击 **换密码**，被控端下次心跳后生效。建议对服务器、收费、检验等关键终端定期轮换。

### 6.2 备份与恢复

```bash
# 备份（包含 data/ 与 .env）
sudo bash scripts/backup.sh /data/backup/medilink
```

恢复：停止服务 → 解压覆盖 `data/` 与 `.env` → `docker compose up -d`。

### 6.3 升级

```bash
git pull
docker compose up -d --build
```

Windows 下重新运行 `scripts\deploy-server.ps1` 即可。

### 6.4 卸载被控端

```powershell
# 仅移除任务与配置
.\scripts\uninstall-agent.ps1
# 同时卸载 RustDesk（谨慎）
.\scripts\uninstall-agent.ps1 -RemoveRustDesk
```

也可通过控制面板卸载，或运行安装目录下的 `unins000.exe`。

### 6.5 更换服务端 IP

1. 修改 `.env` 的 `RENDEZVOUS_SERVER` / `RELAY_HOST`；
2. 控制台「系统设置」同步修改 ID/中继服务器与 Key；
3. `docker compose up -d` 重启；
4. 被控端重启 `MediLinkAgent` 任务以重新拉取配置；控制端在「设置」中更新地址。

---

## 7. 排障速查表

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 浏览器打不开控制台 | 容器未起 / 防火墙拦截 / 端口占用 | `docker compose ps`、放行 `21120`、`docker compose logs -f medilink` |
| 被控端拿不到设备 ID | hbbs 未运行、`21116` UDP 未放行、Key 未填、时间不同步 | 检查容器、放行 TCP+UDP 21116、控制台补 Key 后重启任务、同步时间 |
| 登记失败 `BAD_ENROLLMENT_KEY` | 安装密钥与服务端不一致 | 统一 `MEDILINK_ENROLLMENT_KEY` 与 `/KEY=` |
| 登记失败 `服务端已关闭自动注册` | 关闭了自动注册 | 控制台开启「允许被控端自动注册」 |
| 报 `rustdesk-not-found` | 终端未安装 RustDesk | 用 `-MsiPath` 指定安装包或先手动安装 |
| P2P 直连失败 | VLAN ACL / 主机防火墙拦截 | 确保双方可达 `21117`，RustDesk 会自动降级中继 |
| 控制端点“发起远程协助”没反应 | 控制端未装 RustDesk | 安装 RustDesk，或在「设置」中手动指定路径 |
| 改 Key 后被控端仍连不上 | 被控端只在首次登记拉取配置 | 重启 `MediLinkAgent` 任务（见 3.5） |
| 审计导出 CSV 乱码 | 编码问题 | 文件已带 UTF-8 BOM，用 Excel 直接打开；仍乱码则用 WPS/记事本另存 |
| 忘记管理员口令 | —— | 删除 `data/medilink/medilink.db` 重置为初始口令（会丢台账与审计，先备份） |

---

## 附录 A：从源码构建 Windows 安装包

仅在需要自行生成 `MediLink-Agent-Setup` / `MediLink-Console-Setup` 时使用。

### A.1 安装依赖

- [Bun](https://bun.sh) ≥ 1.1；
- [Inno Setup 6](https://jrsoftware.org/isinfo.php)（或 `winget install JRSoftware.InnoSetup`）。

### A.2 一键构建

```powershell
# 可选：先放入 RustDesk 安装包，随被控端一起分发
copy D:\rustdesk.msi installer\payload\rustdesk.msi

# 编译 exe 并打包安装程序，产物在 installer\Output\
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

产物：

```text
installer\Output\MediLink-Agent-Setup-1.0.0.exe
installer\Output\MediLink-Console-Setup-1.0.0.exe
```

### A.3 单独编译 exe

```bash
cd agent   && bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/medilink-agent.exe
cd console && bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/medilink-console.exe
```

> 编译后的 exe 内嵌 Bun 运行时，约 110 MB；若需极小体积，可改用
> `scripts/install-agent.ps1` 纯脚本方案连接同一服务端。

---

**医联 MediLink** · 其他资料：[部署指南](deploy.md) ·
[信息科使用手册](admin-guide.md) · [安全与合规](security.md) · [常见问题](faq.md)
