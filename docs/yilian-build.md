# 配置「医联」自定义客户端自动构建

在 MediLink 仓库直接用 GitHub Actions 构建品牌为「医联」的 RustDesk 客户端。
本页只讲**配置与使用**；原理见 [`rustdesk-custom/README.md`](../rustdesk-custom/README.md)。

工作流文件：[`.github/workflows/yilian-client.yml`](../.github/workflows/yilian-client.yml)

---

## 一、准备三个值

在部署了 RustDesk 服务端的 Windows 机器上执行：

```powershell
# 1) 服务端/中继地址：就是这台机器的内网 IP
ipconfig | findstr IPv4

# 2) 服务端公钥（客户端 Key）
Get-Content E:\rustdesk\data\id_ed25519.pub
```

得到：

| 变量 | 含义 | 示例 |
|---|---|---|
| `YILIAN_SERVER` | ID 服务器（hbbs）地址 | `192.168.0.26` |
| `YILIAN_RELAY` | 中继（hbbr）地址，一般同上 | `192.168.0.26` |
| `YILIAN_KEY` | 服务端公钥 | `2AlMqc...NLo=` |
| `YILIAN_PASSWORD` | 被控端固定无人值守密码（会编译进客户端） | `MediLink@123` |

## 二、配置仓库变量（Variables）

> 工作流读取的是 **Variables**（`vars.*`），不是 Secrets。

1. 打开仓库 → **Settings**
2. 左侧 **Secrets and variables → Actions**
3. 切到 **Variables** 标签页
   - 直达：`https://github.com/<你的用户名>/MediLink/settings/variables/actions`
4. 点 **New repository variable**，依次新建 3 个（**名称必须完全一致，区分大小写**）：

| Name | Value |
|---|---|
| `YILIAN_SERVER` | `192.168.0.26` |
| `YILIAN_RELAY` | `192.168.0.26` |
| `YILIAN_KEY` | `2AlMqc...NLo=`（公钥原文，不要换行/空格） |
| `YILIAN_PASSWORD` | `MediLink@123`（无人值守固定密码） |

> `YILIAN_PASSWORD` 会**编译进客户端**，安装/解压后即具备固定的无人值守密码，
> 主控端连接时直接输入该密码即可，被控端**无需点“接受”**。因其本质是内置密码，
> 建议放在 **Secrets**（工作流也支持 `secrets.YILIAN_PASSWORD`）。不填则沿用随机临时密码。

> 提示：Key 是**公钥**，会随客户端分发，本身不算机密；但因仓库可能对外公开，
> 仍建议放 Variables，不要写进代码。如需更严，可改为 Secrets（见第五、六节）。

## 三、触发构建

1. 仓库 → **Actions**
2. 左侧选择 **Build Yilian Client**
3. 右侧 **Run workflow** → 分支选 `main`
   - `version`：产物版本号，默认 `1.0.0`
   - `rustdesk_ref`：rustdesk 源码版本，默认 `1.4.9`
4. 点 **Run workflow**

首次构建约 **40–70 分钟**（Rust + Flutter + vcpkg 依赖）。构建期间可在日志中确认：

- `Apply 医联 branding` 步骤成功，且打印 `Key : (已设置)`；
- `Build rustdesk (医联)`、`Build self-extract installer / portable exe` 成功。

## 四、下载产物

运行完成后（也可在该 Run 页面底部 **Artifacts**）：

| 产物 | 用途 |
|---|---|
| `yilian-<版本>-x64.exe` | 安装版（Win10/11，也可直接运行，等同便携自解压） |
| `yilian-<版本>-portable.zip` | 绿色免安装版（Win10/11，预置服务器，解压即用） |
| `yilian-<版本>-win7.exe` | **Windows 7/8 及 32 位系统专用**（Sciter 安装版） |
| `yilian-<版本>-win7-portable.zip` | **Win7/8 绿色免安装版**（解压双击 `启动-医联.bat`） |

> ⚠️ Flutter 版（x64）要求 **Windows 10+**，在 Win7 上打开会**黑屏**；Win7/8/32 位请用 `-win7.exe`（Sciter 后端）。

## 五、使用

- **安装版**：把 `yilian-<版本>-x64.exe` 拷到目标电脑，右键以管理员运行 → 安装为系统服务、开机自启、锁屏可连。
- **绿色版**：解压 `yilian-<版本>-portable.zip`，双击 **`启动-医联.bat`**（或 `rustdesk.exe`）即连内网服务端，无需安装。

两版均已内置服务器地址与 Key，正常情况**无需任何手填**。

## 六、发布 Release（可选）

打一个 `yilian-v*` 标签即可自动构建并发布到 Releases：

```powershell
git tag yilian-v1.0.0
git push origin yilian-v1.0.0
```

> 注意：MediLink 原有 `v*` 标签的发布/镜像工作流**不会**被 `yilian-v*` 触发，互不影响。

## 七、改用 Secrets 保存 Key（可选，更严）

若想用 **Secrets** 而非 Variables 保存 Key，需同步改工作流第 4 行的键名：

1. 在 **Secrets and variables → Actions → Secrets** 新建 `YILIAN_KEY`；
2. 把 `yilian-client.yml` 里的 `${{ vars.YILIAN_KEY }}` 改为 `${{ secrets.YILIAN_KEY }}`（共 2 处：`env` 与打包步骤）。

## 八、常见问题

| 现象 | 处理 |
|---|---|
| 找不到 **Settings** | 你不是仓库管理员；请让管理员配置，或直接改工作流 `env` 默认值 |
| 日志出现 `未配置仓库变量 YILIAN_KEY` 告警 | 没建 `YILIAN_KEY`；补上后重跑 |
| `Apply 医联 branding` 报锚点匹配失败 | rustdesk 源码版本变了；把 `rustdesk_ref` 改回 `1.4.9`，或按报错行微调 `rustdesk-custom/apply-branding.ps1` |
| 客户端仍显示 RustDesk | 品牌补丁步骤失败，检查该步骤日志 |
| 客户端连不上服务器 | `YILIAN_KEY` 与 `id_ed25519.pub` 不一致；或服务端 `21116(TCP/UDP)`/`21117` 未放行 |
| 私库 Actions 额度不足 | 构建较重；可改用 fork rustdesk 的方案（见 `rustdesk-custom/README.md` 方案 2） |
