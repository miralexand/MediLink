/**
 * MediLink 被控端入口（Windows）
 *
 * 命令：
 *   run        常驻运行：配置 RustDesk、上报设备、定时心跳（服务/计划任务使用）
 *   once       执行一次同步后退出（排障用）
 *   install    写入配置并注册开机计划任务（需管理员）
 *   uninstall  移除计划任务（需管理员）
 *   status     查看当前状态
 *   configure  仅写入配置
 *   help       帮助
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_VERSION,
  dataDir,
  loadConfig,
  parseArgs,
  saveConfig,
  type AgentConfig,
} from "./config.ts";
import { log } from "./logger.ts";
import { collectInfo } from "./sysinfo.ts";
import {
  applyServerConfig,
  ensureService,
  findRustDesk,
  getDeviceId,
  isInstalled,
  runRustDesk,
  setPassword,
  silentInstall,
} from "./rustdesk.ts";
import { fetchSetup, registerDevice, sendHeartbeat } from "./api.ts";

const TASK_NAME = "MediLinkAgent";
const DEFAULT_INSTALL_DIR = join(process.env["ProgramFiles"] || "C:\\Program Files", "MediLink");

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

async function syncOnce(cfg: AgentConfig, quiet = false): Promise<Record<string, unknown>> {
  const existing = findRustDesk(cfg.rustdesk_exe);
  if (!existing) {
    // 若配置了安装包且尚未安装，则先静默安装
    if (cfg.install_package && existsSync(cfg.install_package)) {
      log(`未检测到 RustDesk，尝试静默安装：${cfg.install_package}`);
      if (cfg.install_package.toLowerCase().endsWith(".msi")) {
        Bun.spawnSync(["msiexec", "/i", cfg.install_package, "/qn", "/norestart"], { windowsHide: true });
      } else {
        silentInstall(cfg.install_package);
      }
    }
    if (!findRustDesk(cfg.rustdesk_exe)) {
      log("未找到 RustDesk 客户端，请先安装 RustDesk 或在配置中指定 rustdesk_exe", "WARN");
      return { ok: false, reason: "rustdesk-not-found" };
    }
  }
  const exe = findRustDesk(cfg.rustdesk_exe);

  if (cfg.manage_rustdesk) {
    // 确保服务已注册，保证无人值守可达
    ensureService(exe);
    const setup = await fetchSetup(cfg);
    if (setup) {
      applyServerConfig(exe, {
        host: setup.rendezvous_server,
        key: setup.rustdesk_key,
        relay: setup.relay_server,
      });
    } else {
      log("获取服务端接入参数失败，将使用本地 RustDesk 既有配置", "WARN");
    }
  }

  const rustdeskId = await getDeviceId(exe);
  if (!rustdeskId) {
    log("无法获取 RustDesk 设备 ID，请确认 RustDesk 服务正在运行", "ERROR");
    return { ok: false, reason: "no-device-id" };
  }

  const info = await collectInfo(cfg.report_user);
  const result = await registerDevice(cfg, rustdeskId, info, AGENT_VERSION);

  if (!result.ok) {
    log(`设备上报失败：${result.error ?? result.code ?? "未知错误"}`, "WARN");
    return { ok: false, reason: result.code ?? result.error, rustdesk_id: rustdeskId };
  }

  if (cfg.manage_rustdesk && result.unattended_password) {
    setPassword(exe, result.unattended_password);
  }

  if (!quiet) {
    log(`设备已登记：ID=${rustdeskId} 主机=${info.hostname} 科室=${cfg.department || "未分类"} IP=${info.ip}`);
  }
  return {
    ok: true,
    rustdesk_id: rustdeskId,
    hostname: info.hostname,
    username: info.username,
    ip: info.ip,
    department: cfg.department,
    device_id: result.device_id,
    unattended_password_set: !!result.unattended_password,
  };
}

async function runLoop(cfg: AgentConfig): Promise<void> {
  if (!cfg.server_url) {
    log("未配置 server_url，请先运行 medilink-agent install --server http://<服务器IP>:21120", "ERROR");
    process.exit(2);
  }
  log(`医联 被控端启动 v${AGENT_VERSION}，服务端：${cfg.server_url}，心跳间隔：${cfg.interval_seconds}s`);
  let id = "";
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopping = true;
      log("收到退出信号，正在停止…");
    });
  }

  // 首次同步失败时指数退避重试
  let delay = 5000;
  while (!stopping) {
    if (!id) {
      const r = await syncOnce(cfg);
      if (r.ok) {
        id = String(r.rustdesk_id ?? "");
        delay = cfg.interval_seconds * 1000;
      } else {
        delay = Math.min(delay * 2, 60000);
      }
    } else {
      const info = await collectInfo(cfg.report_user);
      const hb = await sendHeartbeat(cfg, id, info, AGENT_VERSION);
      if (!hb.ok) {
        log(`心跳失败：${hb.error ?? hb.code}`, "WARN");
        if (hb.code === "NOT_ENROLLED") {
          id = ""; // 服务端已删除设备，重新注册
        }
      } else {
        log(`心跳正常 ID=${id}`);
      }
      delay = cfg.interval_seconds * 1000;
    }
    await sleep(delay);
  }
}

function installTask(exePath: string): void {
  const tr = `"${exePath}" run`;
  const create = Bun.spawnSync([
    "schtasks",
    "/Create",
    "/TN",
    TASK_NAME,
    "/TR",
    tr,
    "/SC",
    "ONSTART",
    "/RU",
    "SYSTEM",
    "/RL",
    "HIGHEST",
    "/F",
  ]);
  if (create.exitCode === 0) {
    log("已注册开机自启计划任务（SYSTEM 权限）");
    Bun.spawnSync(["schtasks", "/Run", "/TN", TASK_NAME]);
  } else {
    log(`注册计划任务失败：${create.stdout.toString()}${create.stderr.toString()}`, "ERROR");
  }
}

function removeTask(): void {
  const r = Bun.spawnSync(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"]);
  log(r.exitCode === 0 ? "已移除计划任务" : "计划任务不存在或移除失败");
}

function selfInstall(exePath: string): string {
  const target = join(DEFAULT_INSTALL_DIR, "medilink-agent.exe");
  if (exePath.toLowerCase() === target.toLowerCase()) return target;
  try {
    if (!existsSync(DEFAULT_INSTALL_DIR)) mkdirSync(DEFAULT_INSTALL_DIR, { recursive: true });
    copyFileSync(exePath, target);
    log(`已复制被控端到 ${target}`);
    return target;
  } catch (e) {
    log(`复制到安装目录失败，将继续使用原路径：${e}`, "WARN");
    return exePath;
  }
}

function taskStatus(): string {
  const r = Bun.spawnSync(["schtasks", "/Query", "/TN", TASK_NAME]);
  return r.exitCode === 0 ? "已注册" : "未注册";
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);
  const cfg = loadConfig();

  // 允许安装时通过命令行覆盖配置
  if (typeof flags.server === "string") cfg.server_url = flags.server;
  if (typeof flags.key === "string") cfg.enrollment_key = flags.key;
  if (typeof flags.department === "string") cfg.department = flags.department;
  if (typeof flags.interval === "string") cfg.interval_seconds = Number(flags.interval) || 60;
  if (typeof flags["install-package"] === "string") cfg.install_package = flags["install-package"];
  if (flags["no-manage-rustdesk"] === true) cfg.manage_rustdesk = false;

  switch (command) {
    case "run":
      await runLoop(cfg);
      break;

    case "once": {
      const r = await syncOnce(cfg);
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "install": {
      if (!cfg.server_url) {
        log("缺少 --server 参数，例如：medilink-agent install --server http://10.0.0.10:21120 --key 注册密钥", "ERROR");
        process.exit(2);
      }
      const installed = selfInstall(process.execPath);
      saveConfig(cfg);
      log(`配置已写入 ${join(dataDir(), "agent.json")}`);
      installTask(installed);
      // 立即执行一次，便于信息科核对
      await syncOnce(cfg);
      break;
    }

    case "uninstall": {
      removeTask();
      break;
    }

    case "configure": {
      saveConfig(cfg);
      log(`配置已写入 ${join(dataDir(), "agent.json")}`);
      break;
    }

    case "status": {
      const exe = findRustDesk(cfg.rustdesk_exe);
      const id = exe ? await getDeviceId(exe, 1, 0) : "";
      console.log(JSON.stringify({
        version: AGENT_VERSION,
        config_file: join(dataDir(), "agent.json"),
        server_url: cfg.server_url || "(未配置)",
        department: cfg.department || "(未设置)",
        rustdesk_exe: exe || "(未找到)",
        rustdesk_id: id || "(未获取到)",
        service_task: taskStatus(),
        rustdesk_service: isInstalled(exe) ? "已安装" : "未安装",
        rustdesk_probe: isInstalled(exe) ? runRustDesk(exe, ["--get-id"], 8000).out : "",
      }, null, 2));
      break;
    }

    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`
医联（MediLink）被控端 v${AGENT_VERSION}

用法：medilink-agent <命令> [参数]

命令：
  install     写入配置并注册开机计划任务（需管理员）
              参数：--server <URL>  --key <注册密钥>  --department <科室>
              --interval <秒>  --install-package <RustDesk安装包路径>
  uninstall   移除计划任务（需管理员）
  run         常驻运行（计划任务/服务调用）
  once        执行一次同步并输出结果（排障）
  status      查看状态
  configure   仅写入配置
  help        显示帮助

配置目录：${dataDir()}
`);
}

await main();
