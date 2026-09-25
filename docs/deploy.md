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
