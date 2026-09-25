/**
 * MediLink 被控端 —— RustDesk 集成
 *
 * 基于 RustDesk 官方 CLI 契约（1.2+）：
 *   rustdesk.exe --silent-install            静默安装
 *   rustdesk.exe --install-service           注册为系统服务（无人值守）
 *   rustdesk.exe --get-id                    获取设备 ID
 *   rustdesk.exe --config "host=...,key=...,relay=..."   下发自建服务器配置
 *   rustdesk.exe --password <pwd>            设置无人值守密码
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.ts";

export interface RustDeskServerConfig {
  host: string;
  key: string;
  relay: string;
}

const COMMON_PATHS = [
  join(process.env["ProgramFiles"] || "C:\\Program Files", "RustDesk", "rustdesk.exe"),
  join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "RustDesk", "rustdesk.exe"),
  join(process.env.LOCALAPPDATA || "", "Programs", "RustDesk", "rustdesk.exe"),
  "C:\\Program Files\\RustDesk\\rustdesk.exe",
];

export function findRustDesk(override = ""): string {
  if (override && existsSync(override)) return override;
  for (const p of COMMON_PATHS) {
    if (p && existsSync(p)) return p;
  }
  // 从注册表卸载信息中查询安装位置
  try {
    const proc = Bun.spawnSync([
      "reg",
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RustDesk",
      "/v",
      "InstallLocation",
    ]);
    const out = proc.stdout.toString();
    const m = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(out);
    if (m) {
      const candidate = join(m[1]!.trim(), "rustdesk.exe");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 同步执行 RustDesk 命令，返回 { code, out } */
export function runRustDesk(exe: string, args: string[], timeoutMs = 30000): { code: number; out: string } {
  try {
    const proc = Bun.spawnSync({
      cmd: [exe, ...args],
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      windowsHide: true,
    });
    const out = (proc.stdout.toString() + proc.stderr.toString()).trim();
    return { code: proc.exitCode ?? -1, out };
  } catch (e) {
    return { code: -1, out: String(e) };
  }
}

export function isInstalled(exe: string): boolean {
  return !!exe && existsSync(exe);
}

export function ensureService(exe: string): void {
  const r = runRustDesk(exe, ["--install-service"], 60000);
  log(`RustDesk 服务注册: code=${r.code} ${r.out}`);
}

export function silentInstall(exe: string): void {
  const r = runRustDesk(exe, ["--silent-install"], 120000);
  log(`RustDesk 静默安装: code=${r.code} ${r.out}`);
}

/** 下发自建服务器配置。等价于 RustDesk 官方 --config 参数。 */
export function applyServerConfig(exe: string, cfg: RustDeskServerConfig): boolean {
  const parts: string[] = [];
  if (cfg.host) parts.push(`host=${cfg.host}`);
  if (cfg.key) parts.push(`key=${cfg.key}`);
  if (cfg.relay) parts.push(`relay=${cfg.relay}`);
  if (!parts.length) return false;
  const configString = parts.join(",");
  const r = runRustDesk(exe, ["--config", configString], 30000);
  const okFlag = r.code === 0;
  log(`下发服务器配置 ${okFlag ? "成功" : "结束"}（code=${r.code}）: ${configString.replace(/key=[^,]+/, "key=***")}`);
  return okFlag;
}

export function setPassword(exe: string, password: string): boolean {
  if (!password) return false;
  const r = runRustDesk(exe, ["--password", password], 30000);
  log(`设置无人值守密码: code=${r.code}`);
  return r.code === 0;
}

/** 读取设备 ID，带重试（服务首次启动时可能尚未就绪） */
export async function getDeviceId(exe: string, retries = 6, delayMs = 4000): Promise<string> {
  for (let i = 0; i < retries; i++) {
    const r = runRustDesk(exe, ["--get-id"], 15000);
    const m = /(\d{6,})/.exec(r.out);
    if (m) return m[1]!;
    await Bun.sleep(delayMs);
  }
  return "";
}
