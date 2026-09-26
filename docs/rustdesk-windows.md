# 最简化：Windows + Docker 部署 RustDesk 服务端

只搭 RustDesk 自己的服务端（hbbs + hbbr），其它电脑装官方 RustDesk 客户端即可。
不部署 MediLink 管理平台。

## 一、准备

- 一台长期开机的内网 Windows 电脑，固定内网 IP（示例 `10.0.0.10`）；
- 装好 **Docker Desktop**（Settings → General 勾选 *Use the WSL 2 based engine*），保持运行。

## 二、启动服务端（两条命令）

```powershell
mkdir E:\rustdesk\data

docker run -d --name hbbs --restart unless-stopped -p 21115:21115 -p 21116:21116 -p 21116:21116/udp -p 21118:21118 -v E:/rustdesk/data:/root rustdesk/rustdesk-server hbbs

docker run -d --name hbbr --restart unless-stopped -p 21117:21117 -p 21119:21119 -v E:/rustdesk/data:/root rustdesk/rustdesk-server hbbr
```

> 用 `-v E:/rustdesk/data:/root`（正斜杠），密钥会生成在 `E:\rustdesk\data`，方便备份。

## 三、放行防火墙

以管理员 PowerShell 执行：

```powershell
netsh advfirewall firewall add rule name="RustDesk-Server" dir=in action=allow protocol=TCP localport=21115-21119
netsh advfirewall firewall add rule name="RustDesk-Server-UDP" dir=in action=allow protocol=UDP localport=21116
```

## 四、取出 Key

```powershell
Get-Content E:\rustdesk\data\id_ed25519.pub
```

输出的这一串就是 **Key**，客户端要用（不要带到换行/空格）。

## 五、客户端设置（每台要远程的电脑）

安装官方 RustDesk 客户端，进入 **设置 → 网络 → ID/中继服务器**：

| 项 | 填写 |
|---|---|
| ID 服务器 | `10.0.0.10:21116` |
| 中继服务器 | `10.0.0.10:21117` |
| Key | 第四步输出的公钥 |

保存后重启客户端，客户端会显示 `10.0.0.10` 分配的 ID，即可互相连接。

### 批量/省事：用预置封装（打开即用）

不想每台手填？仓库里的 [`rustdesk-client/`](../rustdesk-client/README.md) 提供两种封装，
把 `Server / Relay / Key / 密码` 预先写进 `settings.ini` 后：

- **安装版**：双击 `安装版-一键部署.bat`，自动静默安装 + 写入服务器信息 + 固定密码，
  并注册系统服务、开机自启、锁屏可连（推荐）；
- **便携版**：双击 `绿色版-制作便携包.bat` 生成 `RustDesk便携版.zip`，
  拷到目标电脑解压后双击 `启动-RustDesk.bat` 即用（免安装，但无开机自启）。

> 原理是官方 `rustdesk.exe --silent-install` / `--option`（ID 服务器、中继、Key）/ `--password`，
> 不修改 RustDesk 源码。也可先在任意一台客户端「设置 → 网络 → 导出服务器配置」，
> 把配置串填入 `settings.ini` 的 `ConfigString=` 后一键套用。

### 进阶：品牌为「医联」的自定义客户端（源码编译）

需要客户端界面直接显示「医联」而不再是 RustDesk、且安装/解压即连内网服务端时，
可用 [`rustdesk-custom/`](../rustdesk-custom/README.md)：fork `rustdesk/rustdesk` 源码，
运行品牌补丁脚本（改名/图标/内置服务器），复用 RustDesk 官方 CI 构建，产出安装版与绿色免安装版。

## 六、开机自启

Docker Desktop 设置里勾选 *Start Docker Desktop when you sign in*；
上面命令已带 `--restart unless-stopped`，开机后容器会自动拉起。

## 七、常见问题

- 客户端拿不到 ID：确认 `hbbs` 在运行、`21116`（TCP+UDP）已放行、Key 正确。
- P2P 直连失败：确保双方可达 `21117`，RustDesk 会自动走中继。
- UDP 21116 不通（Docker Desktop 默认转发异常时）：在 `%UserProfile%\.wslconfig`
  加入以下内容后 `wsl --shutdown` 并重启 Docker Desktop：

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```
