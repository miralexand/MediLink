/**
 * MediLink 被控端日志
 *
 * 同时输出到控制台与 %ProgramData%\MediLink\logs\agent.log，
 * 单文件超过 2MB 自动轮转，避免长期占满终端磁盘。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDataDir } from "./config.ts";

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function logFile(): string {
  return join(dataDir(), "logs", "agent.log");
}

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, file + ".1");
    }
  } catch {
    /* ignore */
  }
}

export function log(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (level === "ERROR") console.error(line);
  else console.log(line);
  try {
    ensureDataDir();
    const dir = join(dataDir(), "logs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = logFile();
    rotateIfNeeded(file);
    appendFileSync(file, line + "\r\n", "utf8");
  } catch {
    /* 日志写入失败不影响主流程 */
  }
}
