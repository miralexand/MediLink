/**
 * MediLink 服务端认证与会话
 *
 * - 口令使用 Argon2id 哈希（Bun.password）
 * - 登录后签发随机 Token，数据库仅保存 SHA-256 哈希，防拖库冒用
 * - 会话具备有效期，支持主动登出与过期清理
 */
import { db, nowIso, type UserRow } from "./db.ts";
import { config } from "./config.ts";
import { randomToken, sha256Hex } from "./utils.ts";

export async function ensureAdminSeed(): Promise<void> {
  const count = db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) return;
  const hash = await Bun.password.hash(config.adminPassword, { algorithm: "argon2id" });
  db.query(
    "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(config.adminUser, hash, "系统管理员", "admin", nowIso());
  console.log(
    `[医联] 已创建初始管理员账号: ${config.adminUser}（请首次登录后立即修改口令）`,
  );
}

export async function verifyCredentials(username: string, password: string): Promise<UserRow | null> {
  const user = db.query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null;
  if (!user) return null;
  const good = await Bun.password.verify(password, user.password_hash);
  return good ? user : null;
}

export async function changePassword(userId: number, newPassword: string): Promise<void> {
  const hash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
  db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
}

export function createSession(userId: number, clientIp: string): { token: string; expiresAt: string } {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionTtl * 1000).toISOString();
  db.query(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, client_ip) VALUES (?, ?, ?, ?, ?)",
  ).run(sha256Hex(token), userId, nowIso(), expiresAt, clientIp);
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256Hex(token));
}

export interface AuthContext {
  user: UserRow;
  token: string;
}

export function authenticate(req: Request): AuthContext | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const token = m[1]!.trim();
  const hash = sha256Hex(token);
  const row = db
    .query(
      `SELECT u.*, s.expires_at AS s_expires
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hash) as (UserRow & { s_expires: string }) | null;
  if (!row) return null;
  if (new Date(row.s_expires).getTime() < Date.now()) {
    db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  return { user: row, token };
}

export function purgeExpiredSessions(): void {
  db.query("DELETE FROM sessions WHERE expires_at < ?").run(nowIso());
}
