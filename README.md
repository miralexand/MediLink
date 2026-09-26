# 医联（MediLink）医院内网远程协助系统

> ## ⭐ 最简单方案（优先推荐）
>
> 只想快速用起来？**只在内网 Windows 上用 Docker 部署 RustDesk 服务端，其它电脑装官方
> RustDesk 客户端**即可，不需要 MediLink 管理平台。
>
> **👉 [Windows + Docker 最简部署教程](docs/rustdesk-windows.md)**（两条命令 + 客户端填 ID/Key）
>
> 客户端不想手填？用 [`rustdesk-client/`](rustdesk-client/README.md) 一键预置服务端地址、
> Key 与固定密码，生成「安装版」或「免安装便携版」，目标电脑打开即用。

---

> 面向医院信息科的内网远程运维平台：**Docker 自托管 + 被控端 Agent + 信息科控制端**。
> 数据不出内网、批量静默部署、设备台账、会话审计、等保合规友好。

医联（MediLink）不重复造远程桌面协议，而是复用开源项目 **RustDesk** 成熟的屏幕采集、
编码、P2P 直连与中继能力，在其之上构建信息科真正需要的「管理层」：

- 被控端自动登记设备 ID、计算机名、使用人、科室、IP；
- 控制端一键搜索台账并拉起远程协助，自动记录审计；
- 无人值守密码集中管理、加密存储、可轮换；
- 服务端 Docker 化，内网自托管，升级迁移简单。

---

## 目录

- [系统组成](#系统组成)
- [技术架构](#技术架构)
- [端口规划](#端口规划)
- [快速开始](#快速开始)
- [被控端批量部署](#被控端批量部署)
- [控制端使用](#控制端使用)
- [开发与构建](#开发与构建)
- [目录结构](#目录结构)
- [安全与合规](#安全与合规)
- [常见问题](#常见问题)
- [路线图](#路线图)
- [许可证与致谢](#许可证与致谢)

---

## 系统组成

| 组件 | 形态 | 说明 |
|---|---|---|
| **服务端** | Docker（hbbs + hbbr + medilink） | RustDesk 信令/中继 + 自研管理平台（API、台账、审计、Web 控制台） |
| **被控端 Agent** | Windows exe / PowerShell | 部署到各科室终端，自动配置 RustDesk、上报设备、定时心跳 |
| **控制端 Console** | Windows exe | 信息科使用，本地 Web 控制台 + 一键拉起 RustDesk 发起协助 |
| **安装程序** | Inno Setup exe | 被控端与控制端的可视化/静默安装包 |

## 技术架构

```text
   信息科控制端 (Windows)                 被控端 (Windows 终端)
   medilink-console.exe                   medilink-agent.exe
            \                                /
             \       P2P 直连 / 中继         /
              v                              v
      ┌────────────────────────────────────────────────┐
      │            医院内网 Linux 服务器                 │
      │  hbbs :21116   hbbr :21117                      │
      │  medilink :21120  (API + 台账 + 审计 + 控制台)  │
      └────────────────────────────────────────────────┘
```

- **hbbs**：设备 ID 注册、心跳、信令交换（RustDesk 官方）。
- **hbbr**：P2P 失败时中继转发（RustDesk 官方）。
- **medilink**：Bun + TypeScript + SQLite 自研服务端，提供设备台账、会话审计、
  接入配置下发、无人值守密码托管与管理控制台。

## 端口规划

| 端口 | 协议 | 用途 |
|---|---|---|
| 21115 | TCP | hbbs NAT 类型测试 |
| 21116 | TCP/UDP | hbbs ID 注册与心跳 |
| 21117 | TCP | hbbr 中继 |
| 21118 | TCP | hbbs Web 客户端（可选） |
| 21119 | TCP | hbbr Web 客户端（可选） |
| 21120 | TCP | MediLink 管理控制台与 API |

> 生产环境请通过防火墙/ACL 仅放行信息科网段与终端网段，禁止映射到公网。

---

## 快速开始

> 第一次部署请阅读 **[新手安装部署教程](docs/getting-started.md)**（含服务端、被控端、
> 控制端的完整步骤与检查清单）。以下为精简版。

### 1. 部署服务端（医院内网 Linux / Windows）

```bash
git clone <你的仓库地址> medilink
cd medilink
cp .env.example .env
vi .env                 # 修改 RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY
sudo bash scripts/deploy-server.sh
```

脚本会启动 `hbbs`、`hbbr`、`medilink` 三个容器，并输出 RustDesk 服务端公钥。

没有 Linux 服务器时，可在内网 Windows 机器上用 WSL2 + Docker Desktop 部署：

```powershell
copy .env.example .env
notepad .env            # 同上，修改三项配置
powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1
```

详见 [`docs/deploy.md`](docs/deploy.md)。

### 2. 配置 Key

从控制台登录 `http://<服务器IP>:21120/`（默认账号见 `.env`，请立即改密），
在 **系统设置** 中填写服务端公钥（`data/rustdesk/id_ed25519.pub` 内容）。

### 3. 部署被控端

使用安装包（推荐）：

```powershell
MediLink-Agent-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART `
  /SERVER=http://10.0.0.10:21120 /KEY=<注册密钥> /DEPARTMENT=门诊
```

或使用 PowerShell 轻量版：

```powershell
.\scripts\install-agent.ps1 -Server http://10.0.0.10:21120 -EnrollmentKey <密钥> -Department 门诊
```

被控端会自动安装/复用 RustDesk、下发内网服务器配置、登记设备并定时心跳。

### 4. 安装控制端

在信息科电脑运行 `MediLink-Console-Setup-1.0.0.exe`，安装后自动打开控制台，
在“设置”中确认服务端地址即可。

### 5. 发起远程协助

在控制台设备台账中搜索目标终端 → 点击 **发起远程协助**，控制端会调用本机
RustDesk 发起连接并自动填充无人值守密码；结束后点击 **结束会话** 记录时长。

---

## 被控端批量部署

安装包支持通过 GPO 登录脚本、SCCM、终端管理系统静默推送：

```text
MediLink-Agent-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SERVER=http://10.0.0.10:21120 /KEY=xxx /DEPARTMENT=检验科
```

| 参数 | 说明 |
|---|---|
| `/SERVER=` | MediLink 管理服务端地址 |
| `/KEY=` | 被控端注册密钥 |
| `/DEPARTMENT=` | 科室名称（后续可在控制台修改） |

也可将官方 `rustdesk.msi` 放入 `installer/payload/`，安装包会一并静默安装 RustDesk。

## 控制端使用

- 仅信息科授权电脑安装；
- 通过设备台账搜索设备（支持设备 ID、计算机名、使用人、IP、科室）；
- 一键发起协助，自动记录操作人、目标设备、起止时间；
- 支持查看最近会话审计与导出 CSV。

操作细节见 [`docs/admin-guide.md`](docs/admin-guide.md)。

---

## 开发与构建

### 环境要求

- [Bun](https://bun.sh) ≥ 1.1（服务端、被控端、控制端）
- Docker + Docker Compose（服务端部署）
- [Inno Setup 6](https://jrsoftware.org/isinfo.php)（打包安装程序）

### 自动构建（GitHub Actions）

- 推送到 `main` / 提交 PR：自动安装依赖、类型检查并编译两个 exe，产物在 Actions Artifacts 下载；
- 打 `v*` 标签：自动构建并发布被控端、控制端安装包到 Releases；
- 同时自动构建服务端镜像并推送到 `ghcr.io/<owner>/medilink-server:latest`。

服务端也可直接使用 CI 构建的镜像，在 `docker-compose.yml` 中将 `build:` 换成：

```yaml
image: ghcr.io/<owner>/medilink-server:latest
```

### 本地运行服务端

```bash
cd server
MEDILINK_PORT=8080 MEDILINK_DB_PATH=./data/medilink.db bun run src/index.ts
# 浏览器打开 http://127.0.0.1:8080/
```

### 运行被控端 / 控制端（开发模式）

```bash
cd agent   && bun run src/index.ts status      # 查看状态
cd console && bun run src/index.ts --no-browser
```

### 编译 exe 与安装包

```powershell
# 一键编译 exe 并打包安装程序，产物在 installer\Output\
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

单独编译：

```bash
cd agent   && bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/medilink-agent.exe
cd console && bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile dist/medilink-console.exe
```

> 提示：编译后的 exe 内嵌 Bun 运行时，约 110MB。若需极小体积，可改用
> `scripts/install-agent.ps1` 纯脚本方案连接同一服务端。

---

## 目录结构

```text
medilink/
├── docker-compose.yml           # hbbs + hbbr + medilink 编排
├── .env.example                 # 服务端部署配置模板
├── server/                      # 管理服务端（Bun + TS + SQLite）
│   ├── src/
│   │   ├── index.ts             # 入口与路由
│   │   ├── api.ts               # 被控端/管理 API
│   │   ├── auth.ts              # 认证与会话
│   │   ├── db.ts                # 数据库与表结构
│   │   ├── secret.ts            # 敏感字段加密
│   │   └── web/index.html       # 管理控制台
│   └── Dockerfile
├── agent/                       # 被控端（Windows）
│   └── src/{index,rustdesk,api,sysinfo,config,logger}.ts
├── console/                     # 控制端（Windows）
│   ├── src/index.ts             # 本地服务 + 拉起 RustDesk
│   └── src/web/index.html       # 控制台页面
├── installer/                   # Inno Setup 安装包脚本与构建
│   ├── agent.iss
│   ├── console.iss
│   ├── build.ps1
│   └── languages/ChineseSimplified.isl
├── scripts/                     # 部署与运维脚本
│   ├── deploy-server.sh
│   ├── install-agent.ps1
│   ├── agent-heartbeat.ps1
│   ├── collect-id.ps1
│   ├── uninstall-agent.ps1
│   └── backup.sh
├── docs/
│   ├── deploy.md
│   ├── security.md
│   ├── admin-guide.md
│   └── faq.md
└── .github/workflows/release.yml
```

---

## 安全与合规

- **数据不出内网**：hbbs/hbbr 与管理服务端均部署在内网，不使用公网穿透；
- **强身份鉴别**：管理员 Argon2id 口令 + 会话 Token（库中仅存哈希），被控端注册密钥；
- **最小权限**：默认只读、连接需被控端确认；
- **会话审计**：记录操作人、目标设备、起止时间、时长、结果、来源 IP，默认留存 180 天；
- **加密存储**：无人值守密码使用 AES-256-GCM 加密；
- **合规友好**：满足等保 2.0 三级对远程运维通道的基本要求。

完整说明与等保对照见 [`docs/security.md`](docs/security.md)。

> RustDesk 客户端与服务端遵循 AGPL-3.0；MediLink 自身代码遵循 MIT。
> 详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

---

## 常见问题

**Q：P2P 直连失败？** 检查 VLAN ACL 与主机防火墙，RustDesk 会自动降级中继，确保 `21117` 可达。

**Q：客户端无法获取 ID？** 检查 hbbs 运行状态、`21116` 放行、Key 正确、时间同步。

**Q：被控端 exe 为什么很大？** 内嵌 Bun 运行时；可改用 PowerShell 轻量方案。

更多见 [`docs/faq.md`](docs/faq.md)。

---

## 路线图

- [x] RustDesk 服务端内网自托管（Docker）
- [x] 设备台账与自动登记
- [x] 会话审计与导出
- [x] 被控端 / 控制端安装包
- [x] 无人值守密码托管与轮换
- [ ] 与 ITSM 工单系统集成
- [ ] 接入医院统一身份认证（LDAP/OIDC）
- [ ] 远程会话录像与操作回放
- [ ] 多角色权限（只读审计员 / 运维员 / 管理员）

---

## 许可证与致谢

- MediLink 自身代码：[MIT](LICENSE)
- 远程通道：[RustDesk](https://github.com/rustdesk/rustdesk)（AGPL-3.0）
- 运行时与打包：[Bun](https://bun.sh)（MIT）、[Inno Setup](https://jrsoftware.org/isinfo.php)
- 第三方声明详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

---

**医联 MediLink** · **维护：医院信息科**
