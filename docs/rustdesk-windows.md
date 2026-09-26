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

> 想在多台客户端批量统一配置，可把上面三项写进 RustDesk 安装时的自定义配置，
> 或部署后手动设置一次即可（局域网内通常只需设置一次）。

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
