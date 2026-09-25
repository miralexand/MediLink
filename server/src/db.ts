/**
 * MediLink 服务端数据库层
 *
 * 使用 bun:sqlite（零依赖、单文件、便于等保环境免运维）。
 * 表结构：
 *   users        管理员账号
 *   sessions     登录会话（Token 仅存哈希）
 *   devices      设备台账（被控端注册信息）
 *   audit_logs   会话审计日志
 *   settings     系统设置（键值对）
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

const dbDir = dirname(config.dbPath);
if (dbDir && dbDir !== ".") {
  mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  client_ip   TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  rustdesk_id          TEXT NOT NULL UNIQUE,
  hostname             TEXT,
  username             TEXT,
  department           TEXT,
  ip                   TEXT,
  mac                  TEXT,
  os                   TEXT,
  cpu                  TEXT,
  memory               TEXT,
  agent_version        TEXT,
  status               TEXT NOT NULL DEFAULT 'offline',
  last_seen            TEXT,
  unattended_password  TEXT,
  notes                TEXT,
  tags                 TEXT,
  enrolled_at          TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_status     ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_department ON devices(department);
CREATE INDEX IF NOT EXISTS idx_devices_hostname   ON devices(hostname);

CREATE TABLE IF NOT EXISTS audit_logs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         TEXT,
  operator           TEXT NOT NULL,
  action             TEXT NOT NULL,
  target_device_id   INTEGER,
  target_rustdesk_id TEXT,
  target_hostname    TEXT,
  started_at         TEXT NOT NULL,
  ended_at           TEXT,
  duration_seconds   INTEGER,
  result             TEXT,
  note               TEXT,
  client_ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_started  ON audit_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_audit_operator ON audit_logs(operator);
CREATE INDEX IF NOT EXISTS idx_audit_target   ON audit_logs(target_rustdesk_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT
);
`);

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  created_at: string;
}

export interface DeviceRow {
  id: number;
  rustdesk_id: string;
  hostname: string | null;
  username: string | null;
  department: string | null;
  ip: string | null;
  mac: string | null;
  os: string | null;
  cpu: string | null;
  memory: string | null;
  agent_version: string | null;
  status: string;
  last_seen: string | null;
  unattended_password: string | null;
  notes: string | null;
  tags: string | null;
  enrolled_at: string;
  updated_at: string;
}

export interface AuditRow {
  id: number;
  session_id: string | null;
  operator: string;
  action: string;
  target_device_id: number | null;
  target_rustdesk_id: string | null;
  target_hostname: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  result: string | null;
  note: string | null;
  client_ip: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 读取设置项，带默认值 */
export function getSetting(key: string, fallback = ""): string {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string | null }
    | null;
  if (!row || row.value === null) return fallback;
  return row.value;
}

export function setSetting(key: string, value: string): void {
  db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

export function allSettings(): Record<string, string> {
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string | null;
  }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value ?? "";
  return out;
}
