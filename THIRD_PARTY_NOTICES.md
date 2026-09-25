# 第三方组件与许可证声明

MediLink 自身代码以 MIT 许可证发布（见根目录 `LICENSE`）。本项目在运行时或
分发物中集成了以下第三方组件，其版权与许可证归各自作者所有。

## 1. RustDesk

- 项目：https://github.com/rustdesk/rustdesk
- 用途：远程桌面通道（客户端 CLI、hbbs/hbbr 服务端）
- 许可证：**GNU AGPL-3.0**
- 说明：本项目通过官方 CLI 与官方 Docker 镜像使用 RustDesk，未修改其源码。
  被控端安装包可选择将官方 RustDesk 安装包作为可选负载一并分发；
  如对 RustDesk 进行修改并对外分发，须自行履行 AGPL 开源义务。

## 2. Bun

- 项目：https://github.com/oven-sh/bun
- 用途：服务端运行时、被控端/控制端单文件 exe 编译运行时
- 许可证：MIT

## 3. Inno Setup

- 项目：https://jrsoftware.org/isinfo.php
- 用途：Windows 安装程序打包（仅构建期使用）
- 许可证：Inno Setup License（允许自由分发安装程序，详见官网）

## 4. Inno Setup 简体中文语言文件

- 来源：https://github.com/jrsoftware/issrc （Files/Languages/ChineseSimplified.isl）
- 用途：安装向导中文本地化
- 许可证：随 Inno Setup 项目发布

## 5. SQLite

- 项目：https://sqlite.org
- 用途：内嵌数据库（通过 Bun 内置 `bun:sqlite` 使用）
- 许可证：Public Domain

---

如对以上组件的使用有合规疑问，请咨询医院信息安全管理部门与法务。
