# 医联（MediLink）常见问题（FAQ）

## 部署与网络

**Q：P2P 直连失败怎么办？**
A：检查被控端与控制端之间是否被 VLAN ACL 或主机防火墙拦截。RustDesk 会自动降级中继，确保 hbbr 的 `21117` 可从双方网段访问即可。

**Q：必须设置中继服务器吗？**
A：当被控端与服务端第一次成功握手后，RustDesk 会自动获知中继地址。若网络固定，仍建议在服务端 `hbbs` 启动参数中显式指定 `-r <relay>:21117`，本项目 `docker-compose.yml` 已默认配置。

**Q：客户端无法获取 ID？**
A：依次检查：hbbs 是否运行、`21116` TCP/UDP 是否放行、控制台系统设置中的 Key 是否正确、终端与服务端时间是否同步、RustDesk 服务是否在运行。

**Q：如何更换服务端 IP？**
A：修改 `.env` 中 `RENDEZVOUS_SERVER` / `RELAY_HOST` 与 `docker-compose.yml`，重启服务；被控端会在下次同步自动获取新配置。控制端只需在“设置”中更新服务端地址。

**Q：能不能不用 Docker？**
A：可以，RustDesk 服务端提供二进制包。但 Docker 方式升级与迁移更简单，推荐优先使用。

## 客户端与部署

**Q：被控端 exe 体积为什么有一百多 MB？**
A：该 exe 内嵌了 Bun 运行时，便于零依赖部署。若追求轻量，可使用 `scripts/install-agent.ps1`（纯 PowerShell 方案，体积为 KB 级），二者连接同一服务端 API。

**Q：如何批量部署到几百台终端？**
A：推荐使用被控端安装包静默部署：

```powershell
MediLink-Agent-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART `
  /SERVER=http://10.0.0.10:21120 /KEY=你的注册密钥 /DEPARTMENT=门诊
```

可配合 GPO 登录脚本、SCCM/终端管理系统推送。

**Q：被控端安装在哪个目录？**
A：程序位于 `C:\Program Files\MediLink`，配置与日志位于 `C:\ProgramData\MediLink`，开机计划任务名为 `MediLinkAgent`。

**Q：如何卸载被控端？**
A：通过控制面板卸载，或在安装目录运行 `unins000.exe`；也可执行 `scripts/uninstall-agent.ps1`。

## 使用与控制台

**Q：控制端点击“发起远程协助”没反应？**
A：控制端电脑需安装 RustDesk 且能被自动探测；在控制台右上角“设置”中可手动指定 `rustdesk.exe` 路径。点击后会调用 `rustdesk --connect <ID>` 并自动填充无人值守密码。

**Q：审计导出 CSV 中文乱码？**
A：导出文件已带 UTF-8 BOM，请用 Excel 直接打开；若仍乱码，用记事本另存为 UTF-8 或使用 WPS。

**Q：忘记了管理员口令？**
A：删除 `data/medilink/medilink.db` 会重置为 `.env` 中的初始口令（同时丢失台账与审计数据），请谨慎操作。建议先备份。

## 兼容性

**Q：是否支持 macOS / Linux 终端？**
A：RustDesk 本身支持多平台，但医院内通常以 Windows 终端为主。本项目被控端与安装脚本目前针对 Windows，可按需扩展。

**Q：RustDesk 升级会不会影响配置？**
A：被控端每次启动都会重新下发服务器配置与无人值守密码，RustDesk 升级后一般无需人工干预。
