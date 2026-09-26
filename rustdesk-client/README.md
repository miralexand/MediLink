# RustDesk 客户端预置封装

配合 **[Windows + Docker 最简部署教程](../docs/rustdesk-windows.md)** 使用：
服务端已在内网 Windows 上跑起来后，用本目录把「服务端地址 + Key + 固定密码」预置进
RustDesk 客户端，目标电脑**打开即用**，无需人工填写。

## 一、先填配置

复制 `settings.example.ini` 为 `settings.ini`，修改：

```ini
Server=10.0.0.10          ; 服务端内网 IP
Relay=10.0.0.10           ; 中继（通常同上）
Key=服务端公钥             ; E:\rustdesk\data\id_ed25519.pub 的内容
Password=MediLink@123     ; 无人值守固定密码，可留空
```

> `settings.ini` 含密码，已在 `.gitignore` 中忽略，不要提交到仓库。

## 二、两种用法（任选）

### 方法 1：一键安装版（推荐，支持开机自启 / 无人值守）

双击 **`安装版-一键部署.bat`**，会自动请求管理员权限并完成：

1. 静默安装 RustDesk（本地有 `rustdesk.exe` 就用本地的，没有则自动从 GitHub 下载）；
2. 写入 ID 服务器、中继服务器、Key；
3. 设置固定无人值守密码；
4. 打印本机设备 ID。

装完即注册为系统服务，开机自动运行，锁屏/无人登录也能被远程。

### 方法 2：免安装便携版

双击 **`绿色版-制作便携包.bat`**，在 `dist\` 下生成：

```
dist\RustDesk便携版\      rustdesk.exe + RustDesk2.toml + 启动-RustDesk.bat
dist\RustDesk便携版.zip   可随手拷给别的电脑
```

把 zip 拷到目标电脑解压，双击 **`启动-RustDesk.bat`** 即可（会自动写入配置并启动）。
便携版无需安装，但**没有开机自启和锁屏控制**，适合临时/演示使用。

## 三、说明

- 脚本用官方 `rustdesk.exe --silent-install` / `--option` / `--password` 实现，不修改 RustDesk 源码，符合 AGPL。
- 如果已有一台配置好的客户端，可在其「设置 → 网络 → 导出服务器配置」得到配置串，
  填到 `settings.ini` 的 `ConfigString=`，一键安装脚本会优先使用它。
- `dist\`、`settings.ini`、`rustdesk.exe` 均不会提交到仓库。
