# 医联（MediLink）服务端部署指南

面向医院信息科，在医院内网 Linux 服务器上部署 MediLink 管理平台与 RustDesk 服务端。

## 一、总体架构

```text
       信息科控制端(Windows)                被控端(Windows 终端)
        medilink-console.exe                 medilink-agent.exe
                 \                              /
                  \        P2P 直连 / 中继       /
                   v                            v
              ┌──────────────────────────────────────┐
              │       医院内网 Linux 服务器            │
              │  hbbs(21116)  hbbr(21117)             │
              │  medilink 管理服务端(21120)           │
              └──────────────────────────────────────┘
```

- **hbbs / hbbr**：RustDesk 官方服务端，负责 ID 注册、信令与中继。
- **medilink**：本项目自研管理服务端，负责设备台账、审计、控制台与配置下发。

## 二、端口规划

| 端口 | 协议 | 归属 | 用途 |
|---|---|---|---|
| 21115 | TCP | hbbs | NAT 类型测试 |
| 21116 | TCP/UDP | hbbs | ID 注册与心跳 |
| 21117 | TCP | hbbr | 中继转发 |
| 21118 | TCP | hbbs | Web 客户端（可选） |
| 21119 | TCP | hbbr | Web 客户端（可选） |
| 21120 | TCP | medilink | 管理控制台与 API |

> 生产环境应通过防火墙/ACL 仅允许信息科网段与被控终端网段访问上述端口，禁止映射到公网。

## 三、前置条件

- Ubuntu 22.04 / Debian 12 / 麒麟等内网 Linux；
- Docker Engine 24+ 与 `docker compose` 插件；
- 固定内网 IP（示例 `10.0.0.10`）；
- 建议 2 核 CPU、2GB 内存、20GB 磁盘；
- 服务器时间与终端一致（`chrony`/`ntpd` 同步）。

## 四、部署步骤

```bash
git clone <你的仓库地址> medilink
cd medilink
cp .env.example .env
vi .env        # 至少修改 RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY
sudo bash scripts/deploy-server.sh
```

脚本会构建镜像、启动 hbbs/hbbr/medilink，并输出 RustDesk 服务端公钥。

> 没有 Linux 服务器时，可在内网 Windows 机器上用 WSL2 + Docker Desktop 部署，
> 见 [十一、在 Windows 上部署](#十一在-windows-上部署wsl2--docker-desktop)。

### 关键配置项（.env）

| 变量 | 说明 |
|---|---|
| `RENDEZVOUS_SERVER` | 被控端/控制端连接的 ID 服务器，如 `10.0.0.10:21116` |
| `RELAY_HOST` | 中继服务器地址，如 `10.0.0.10` |
| `MEDILINK_PORT` | 管理控制台对外端口，默认 `21120` |
| `MEDILINK_ADMIN_PASSWORD` | 初始管理员口令，首次登录后请立即修改 |
| `MEDILINK_ENROLLMENT_KEY` | 被控端注册密钥，生产环境务必设置为强随机串 |
| `MEDILINK_RUSTDESK_KEY` | RustDesk 服务端公钥，可部署后在控制台填写 |
| `MEDILINK_SECRET_KEY` | 数据库字段加密密钥（32 字节 base64），留空自动生成 |

## 五、获取并配置 Key

```bash
cat data/rustdesk/id_ed25519.pub
```

将输出粘贴到管理控制台 → **系统设置 → RustDesk Key**，保存即可。被控端会在下次同步时自动获取。

## 六、验证

```bash
docker compose ps
curl http://127.0.0.1:21120/health
docker compose logs -f hbbs
```

浏览器访问 `http://<服务器IP>:21120/`，使用 `.env` 中的管理员账号登录。

## 七、HTTPS 反向代理（可选，推荐）

内网等保环境可在前置 Nginx 上启用 TLS，将 `https://medilink.hospital.local` 反代到 `127.0.0.1:21120`：

```nginx
server {
    listen 443 ssl;
    server_name medilink.hospital.local;
    ssl_certificate     /etc/nginx/certs/medilink.crt;
    ssl_certificate_key /etc/nginx/certs/medilink.key;

    location / {
        proxy_pass http://127.0.0.1:21120;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

被控端安装时使用 `https://medilink.hospital.local` 作为 `-Server` 即可。

## 八、升级

```bash
git pull
docker compose pull
docker compose up -d --build
```

## 九、备份与恢复

```bash
sudo bash scripts/backup.sh /data/backup/medilink
```

- 备份文件包含 `data/`（RustDesk 密钥、台账与审计库）与 `.env`；
- 建议每日自动备份并转存至医院灾备存储；
- 恢复：停止服务后解压覆盖 `data/` 与 `.env`，再 `docker compose up -d`。

## 十、监控建议

- 监控容器状态：`docker compose ps`；
- 监控端口存活：21116、21117；
- 接入医院原有 Zabbix/Prometheus，对 `/health` 做健康检查；
- 关注磁盘与审计库增长，定期执行审计清理。

## 十一、在 Windows 上部署（WSL2 + Docker Desktop）

没有独立 Linux 服务器时，可在医院内网的一台 Windows 机器上部署服务端。
`hbbs` / `hbbr` / `medilink` 均为 Linux 容器，通过 Docker Desktop 的 WSL2 后端运行。

### 1. 前置条件

- Windows 10/11 或 Windows Server 2022+；
- 启用 WSL2：

  ```powershell
  wsl --install
  wsl -l -v          # 确认 VERSION 为 2
  ```

- 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，在
  **Settings → General** 勾选 *Use the WSL 2 based engine*，启动并保持运行；
- 固定内网 IP（示例 `10.0.0.10`），Windows 防火墙放行 `21116`、`21117`、`21120`；
- 建议服务器时间与终端一致。

### 2. 部署步骤

```powershell
git clone <你的仓库地址> medilink
cd medilink
copy .env.example .env
notepad .env       # 修改 RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY
powershell -ExecutionPolicy Bypass -File scripts\deploy-server.ps1
```

`deploy-server.ps1` 与 Linux 的 `deploy-server.sh` 等价：构建镜像、启动
`hbbs` / `hbbr` / `medilink`，并输出 RustDesk 服务端公钥。

### 3. 网络与 UDP 21116

hbbs 的 ID 注册与心跳依赖 **UDP 21116**。Docker Desktop 默认会把发布的容器端口
（含 UDP）转发到 Windows 主机，局域网终端通常可直接访问。若终端始终拿不到设备 ID：

1. 在 `%UserProfile%\.wslconfig` 中加入镜像网络：

   ```ini
   [wsl2]
   networkingMode=mirrored
   ```

2. 执行 `wsl --shutdown`，随后重新启动 Docker Desktop。

> 若改为在 WSL 发行版内直接安装 Docker（而不是 Docker Desktop），WSL2 默认 NAT
> 网络下 `netsh interface portproxy` 仅支持 TCP，UDP 21116 需借助镜像网络，或接受
> P2P 直连不可用、仅通过中继 `21117` 连接。

### 4. 数据、访问与维护

- 数据目录为仓库下的 `data\`（RustDesk 密钥、SQLite 台账与审计库）；
- 浏览器访问 `http://<Windows内网IP>:21120/`，被控端与控制端填写同一 IP；
- 在 Docker Desktop 设置中开启 *Start Docker Desktop when you sign in*，
  配合容器的 `restart: unless-stopped` 实现开机自启；
- 升级：`git pull` 后重新运行 `scripts\deploy-server.ps1`；
- 备份可手动打包 `data\` 与 `.env`，或从 WSL 内执行 `bash scripts/backup.sh`。

> 数据库性能提示：若将仓库放在 `E:\` 等 NTFS 盘且遇到 SQLite 锁或性能问题，
> 可把仓库放到 WSL 文件系统（如 `~/medilink`）后，从 WSL 内执行
> `sudo bash scripts/deploy-server.sh`。

## 十二、被控端接入检查清单（安装后必看）

被控端安装后，**终端侧一般无需人工配置**，但服务端需满足以下条件，否则设备会
登记失败或无法远程连接。**建议先配置好服务端 Key，再批量安装被控端。**

| 检查项 | 要求 | 位置 |
|---|---|---|
| RustDesk Key | 必须已填写，否则 RustDesk 连不上自建服务器 | 控制台 → 系统设置 → RustDesk Key，或 `.env` 的 `MEDILINK_RUSTDESK_KEY` |
| 注册密钥 | 安装参数 `/KEY=` 与服务端一致，否则返回 `BAD_ENROLLMENT_KEY` | 控制台 → 系统设置 → 注册密钥 |
| 允许自动注册 | 批量部署期间需开启，完成后可关闭 | 控制台 → 系统设置 |
| 科室命名 | 与 `/DEPARTMENT=` 一致，建议统一命名 | 控制台 → 设备台账 |
| 网络 | 终端可访问服务端 `21116`/`21117`/`21120`（TCP）与 `21116`（UDP） | 防火墙 / VLAN ACL |
| 时间同步 | 终端与服务端时间一致 | w32time / NTP |

终端侧由安装程序自动完成：RustDesk 静默安装与服务注册、下发 `host/key/relay`
配置、设置无人值守密码、注册 `MediLinkAgent` 开机计划任务。

**前提：终端需已安装 RustDesk。** 安装包仅在 `installer\payload\rustdesk.msi`
存在时才会随包静默安装；否则会报 `rustdesk-not-found`，可先用
`scripts\install-agent.ps1 -MsiPath <安装包>` 指定，或手动安装 RustDesk。

> 注意：被控端**仅在首次登记时**从服务端拉取 `host/key/relay`，之后只做心跳。
> 若在部署后才修改服务端 Key 或地址，需重启被控端任务以重新拉取：
>
> ```powershell
> schtasks /End /TN MediLinkAgent
> schtasks /Run /TN MediLinkAgent
> ```

被控端配置文件位置：exe 版为 `%ProgramData%\MediLink\agent.json`，
PowerShell 版为 `%ProgramData%\MediLink\agent-ps.json`。
