/**
 * MediLink 被控端（Agent）配置
 *
 * 配置文件位于 %ProgramData%\MediLink\agent.json，
 * 安装脚本会写入 server_url / enrollment_key / department。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentConfig {
  /** MediLink 管理服务端地址，例如 http://10.0.0.10:21120 */
  server_url: string;
  /** 被控端注册密钥，需与服务端一致 */
  enrollment_key: string;
  /** 科室（可留空，后续在控制台修正） */
  department: string;
  /** 心跳间隔（秒） */
  interval_seconds: number;
  /** RustDesk 可执行文件路径，留空则自动探测 */
  rustdesk_exe: string;
  /** 是否自动下发 RustDesk 服务器配置与无人值守密码 */
  manage_rustdesk: boolean;
  /** 可选：RustDesk 安装包路径（.msi 或 .exe），安装时如未检测到则自动静默安装 */
  install_package: string;
  /** 是否上报当前登录用户 */
  report_user: boolean;
}

export const DEFAULT_CONFIG: AgentConfig = {
  server_url: "",
  enrollment_key: "",
  department: "",
  interval_seconds: 60,
  rustdesk_exe: "",
  manage_rustdesk: true,
  install_package: "",
  report_user: true,
};

export const AGENT_VERSION = "1.0.0";

export function dataDir(): string {
  const base = process.env.ProgramData || "C:\\ProgramData";
  return join(base, "MediLink");
}

export function configPath(): string {
  return join(dataDir(), "agent.json");
}

export function ensureDataDir(): string {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadConfig(): AgentConfig {
  let cfg: AgentConfig = { ...DEFAULT_CONFIG };
  try {
    if (existsSync(configPath())) {
      cfg = { ...cfg, ...JSON.parse(readFileSync(configPath(), "utf8")) };
    }
  } catch (e) {
    console.error("[配置] 读取 agent.json 失败，使用默认配置:", e);
  }
  // 环境变量优先级最高，便于脚本临时覆盖
  if (process.env.MEDILINK_SERVER_URL) cfg.server_url = process.env.MEDILINK_SERVER_URL;
  if (process.env.MEDILINK_ENROLLMENT_KEY) cfg.enrollment_key = process.env.MEDILINK_ENROLLMENT_KEY;
  if (process.env.MEDILINK_DEPARTMENT) cfg.department = process.env.MEDILINK_DEPARTMENT;
  if (process.env.MEDILINK_RUSTDESK_EXE) cfg.rustdesk_exe = process.env.MEDILINK_RUSTDESK_EXE;
  return cfg;
}

export function saveConfig(cfg: AgentConfig): void {
  ensureDataDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
}

export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  let command = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = a;
    }
  }
  if (!command) command = "run";
  return { command, flags };
}
