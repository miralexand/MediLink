/**
 * MediLink 服务端 API
 *
 * 分为三类：
 *   1. 公开接口：健康检查、被控端接入参数
 *   2. 被控端接口（Agent）：注册、心跳（X-Agent-Key 校验）
 *   3. 管理接口：登录、设备台账、审计、设置（Bearer Token 校验）
 */
import { db, getSetting, nowIso, setSetting, allSettings, type DeviceRow } from "./db.ts";
import { config } from "./config.ts";
import {
  authenticate,
  changePassword,
  createSession,
  destroySession,
  verifyCredentials,
} from "./auth.ts";
import { decryptSecret, encryptSecret } from "./secret.ts";
import {
  boolish,
  clientIp,
  fail,
  json,
  ok,
  readJson,
  str,
  toCsv,
} from "./utils.ts";

type ServerLike = { requestIP?: (r: Request) => { address: string } | null };

const AGENT_ONLINE_WINDOW_MS = 90_000;

function genPassword(len = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

function deviceWithOnline(d: DeviceRow): DeviceRow & { online: boolean } {
  const online =
    d.status === "online" &&
    !!d.last_seen &&
    Date.now() - new Date(d.last_seen).getTime() < AGENT_ONLINE_WINDOW_MS;
  return { ...d, online };
}

function sanitizeDevice(d: DeviceRow & { online?: boolean }): Record<string, unknown> {
  const { unattended_password, ...rest } = d;
  return { ...rest, has_password: !!unattended_password, online: !!d.online };
}

function matchPattern(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]!);
    else if (p !== parts[i]) return null;
  }
  return params;
}

export async function handleApi(
  req: Request,
  url: URL,
  server: ServerLike,
): Promise<Response | null> {
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","devices","3"]
  const method = req.method.toUpperCase();
  const ip = clientIp(req, server);

  const route = (m: string, pattern: string, handler: (p: Record<string, string>) => Promise<Response> | Response) => {
    if (method === m) {
      const params = matchPattern(pattern.split("/").filter(Boolean), parts);
      if (params) return handler(params);
    }
    return null;
  };

  const requireAuth = () => {
    const auth = authenticate(req);
    if (!auth) return null;
    return auth;
  };

  let res: Response | Promise<Response> | null;

  // ---------- 公开接口 ----------
  res = route("GET", "health", () =>
    json({ ok: true, service: "medilink-server", version: config.version, time: nowIso() }),
  );
  if (res) return await res;

  res = route("GET", "api/public/setup", () => {
    return json({
      ok: true,
      site_name: getSetting("site_name", config.siteName),
      server_version: config.version,
      rendezvous_server: getSetting("rendezvous_server", config.rendezvousServer),
      relay_server: getSetting("relay_server", config.relayServer),
      rustdesk_key: getSetting("rustdesk_key", config.rustdeskKey),
      enrollment_required: getSetting("enrollment_key", config.enrollmentKey) !== "",
      registration_open: getSetting("allow_registration", config.allowRegistration ? "1" : "0") === "1",
      require_approval: getSetting("require_approval", config.requireApproval ? "1" : "0") === "1",
      default_readonly: getSetting("default_readonly", config.defaultReadonly ? "1" : "0") === "1",
    });
  });
  if (res) return await res;

  // ---------- 被控端接口 ----------
  res = route("POST", "api/agent/register", async () => {
    if (getSetting("allow_registration", config.allowRegistration ? "1" : "0") !== "1") {
      return fail("服务端已关闭自动注册", 403);
    }
    const requiredKey = getSetting("enrollment_key", config.enrollmentKey);
    if (requiredKey) {
      const provided = req.headers.get("x-agent-key") ?? "";
      if (provided !== requiredKey) return fail("注册密钥无效", 401, "BAD_ENROLLMENT_KEY");
    }

    const body = await readJson<any>(req);
    const rustdeskId = str(body.rustdesk_id, 64);
    if (!rustdeskId) return fail("缺少 rustdesk_id");

    const ts = nowIso();
    const existing = db
      .query("SELECT * FROM devices WHERE rustdesk_id = ?")
      .get(rustdeskId) as DeviceRow | null;

    let deviceId: number;
    let plainPassword = "";

    if (existing) {
      db.query(
        `UPDATE devices SET hostname=?, username=?, department=?, ip=?, mac=?, os=?, cpu=?,
           memory=?, agent_version=?, status='online', last_seen=?, updated_at=? WHERE id=?`,
      ).run(
        str(body.hostname, 128) || existing.hostname,
        str(body.username, 128) || existing.username,
        str(body.department, 128) || existing.department,
        str(body.ip, 64) || existing.ip,
        str(body.mac, 64) || existing.mac,
        str(body.os, 128) || existing.os,
        str(body.cpu, 128) || existing.cpu,
        str(body.memory, 64) || existing.memory,
        str(body.agent_version, 32) || existing.agent_version,
        ts,
        ts,
        existing.id,
      );
      deviceId = existing.id;
      if (existing.unattended_password) {
        plainPassword = await decryptSecret(existing.unattended_password);
      } else {
        plainPassword = genPassword();
        db.query("UPDATE devices SET unattended_password=? WHERE id=?").run(
          await encryptSecret(plainPassword),
          deviceId,
        );
      }
    } else {
      plainPassword = genPassword();
      const info = db
        .query(
          `INSERT INTO devices
           (rustdesk_id, hostname, username, department, ip, mac, os, cpu, memory,
            agent_version, status, last_seen, unattended_password, enrolled_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'online', ?, ?, ?, ?)`,
        )
        .run(
          rustdeskId,
          str(body.hostname, 128),
          str(body.username, 128),
          str(body.department, 128),
          str(body.ip, 64),
          str(body.mac, 64),
          str(body.os, 128),
          str(body.cpu, 128),
          str(body.memory, 64),
          str(body.agent_version, 32),
          ts,
          await encryptSecret(plainPassword),
          ts,
          ts,
        );
      deviceId = Number(info.lastInsertRowid);
    }

    const device = db.query("SELECT * FROM devices WHERE id = ?").get(deviceId) as DeviceRow;
    return json({
      ok: true,
      device_id: deviceId,
      server_time: ts,
      unattended_password: plainPassword, // 下发/确认无人值守密码，供被控端写入 RustDesk
      config: {
        rendezvous_server: getSetting("rendezvous_server", config.rendezvousServer),
        relay_server: getSetting("relay_server", config.relayServer),
        rustdesk_key: getSetting("rustdesk_key", config.rustdeskKey),
        require_approval: getSetting("require_approval", "1") === "1",
        default_readonly: getSetting("default_readonly", "1") === "1",
      },
      device: sanitizeDevice({ ...device, online: true }),
    });
  });
  if (res) return await res;

  res = route("POST", "api/agent/heartbeat", async () => {
    const body = await readJson<any>(req);
    const rustdeskId = str(body.rustdesk_id, 64);
    if (!rustdeskId) return fail("缺少 rustdesk_id");
    const ts = nowIso();
    const info = db
      .query(
        `UPDATE devices SET status='online', last_seen=?,
           ip = COALESCE(NULLIF(?, ''), ip),
           username = COALESCE(NULLIF(?, ''), username),
           agent_version = COALESCE(NULLIF(?, ''), agent_version),
           updated_at=?
         WHERE rustdesk_id=?`,
      )
      .run(ts, str(body.ip, 64), str(body.username, 128), str(body.agent_version, 32), ts, rustdeskId);
    if (info.changes === 0) return fail("设备未注册", 404, "NOT_ENROLLED");
    return ok({ server_time: ts });
  });
  if (res) return await res;

  // ---------- 登录 ----------
  res = route("POST", "api/auth/login", async () => {
    const body = await readJson<any>(req);
    const username = str(body.username, 64);
    const password = str(body.password, 256);
    const user = await verifyCredentials(username, password);
    if (!user) return fail("用户名或口令错误", 401, "BAD_CREDENTIALS");
    const { token, expiresAt } = createSession(user.id, ip);
    db.query(
      "INSERT INTO audit_logs (operator, action, started_at, result, client_ip, note) VALUES (?,?,?,?,?,?)",
    ).run(user.display_name || user.username, "login", nowIso(), "success", ip, "管理员登录");
    return json({
      ok: true,
      token,
      expires_at: expiresAt,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    });
  });
  if (res) return await res;

  // ---------- 需要认证的接口 ----------
  if (parts[1] === "auth" || parts[1] === "devices" || parts[1] === "audit" || parts[1] === "settings" || parts[1] === "stats" || parts[1] === "users") {
    // 所有后续接口均需认证
  } else {
    return null;
  }

  const auth = requireAuth();
  if (!auth) return fail("未登录或会话已过期", 401, "UNAUTHORIZED");
  const operatorName = auth.user.display_name || auth.user.username;

  res = route("POST", "api/auth/logout", () => {
    destroySession(auth.token);
    return ok();
  });
  if (res) return await res;

  res = route("GET", "api/auth/me", () =>
    json({
      ok: true,
      user: {
        id: auth.user.id,
        username: auth.user.username,
        display_name: auth.user.display_name,
        role: auth.user.role,
      },
    }),
  );
  if (res) return await res;

  res = route("POST", "api/auth/password", async () => {
    const body = await readJson<any>(req);
    const oldPwd = str(body.old_password, 256);
    const newPwd = str(body.new_password, 256);
    if (newPwd.length < 8) return fail("新口令长度不得少于 8 位");
    const check = await verifyCredentials(auth.user.username, oldPwd);
    if (!check) return fail("原口令错误", 400);
    await changePassword(auth.user.id, newPwd);
    db.query("DELETE FROM sessions WHERE user_id = ?").run(auth.user.id);
    db.query(
      "INSERT INTO audit_logs (operator, action, started_at, result, client_ip, note) VALUES (?,?,?,?,?,?)",
    ).run(operatorName, "change_password", nowIso(), "success", ip, "修改管理员口令");
    return ok();
  });
  if (res) return await res;

  // ---------- 设备台账 ----------
  res = route("GET", "api/devices", () => {
    const q = (url.searchParams.get("q") ?? "").trim();
    const dept = (url.searchParams.get("department") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim();

    const where: string[] = [];
    const params: any[] = [];
    if (q) {
      where.push("(rustdesk_id LIKE ? OR hostname LIKE ? OR username LIKE ? OR ip LIKE ? OR notes LIKE ? OR tags LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like);
    }
    if (dept) {
      where.push("department = ?");
      params.push(dept);
    }
    if (status === "online") {
      where.push("status = 'online' AND last_seen >= ?");
      params.push(new Date(Date.now() - AGENT_ONLINE_WINDOW_MS).toISOString());
    } else if (status === "offline") {
      where.push("(status != 'online' OR last_seen < ?)");
      params.push(new Date(Date.now() - AGENT_ONLINE_WINDOW_MS).toISOString());
    }

    const sql =
      "SELECT * FROM devices" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY (department IS NULL), department, hostname, rustdesk_id";
    const rows = db.query(sql).all(...params) as DeviceRow[];
    const items = rows.map((d) => sanitizeDevice({ ...deviceWithOnline(d) }));
    return json({ ok: true, total: items.length, items });
  });
  if (res) return await res;

  res = route("GET", "api/devices/export.csv", () => {
    const rows = db.query("SELECT * FROM devices ORDER BY department, hostname").all() as DeviceRow[];
    const flat = rows.map((d) => ({
      设备ID: d.rustdesk_id,
      计算机名: d.hostname ?? "",
      使用人: d.username ?? "",
      科室: d.department ?? "",
      IP地址: d.ip ?? "",
      MAC地址: d.mac ?? "",
      操作系统: d.os ?? "",
      状态: d.status === "online" ? "在线" : "离线",
      最后在线: d.last_seen ?? "",
      标签: d.tags ?? "",
      备注: d.notes ?? "",
      登记时间: d.enrolled_at,
    }));
    return new Response(toCsv(flat), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="medilink-devices-${Date.now()}.csv"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
  if (res) return await res;

  res = route("POST", "api/devices", async () => {
    const body = await readJson<any>(req);
    const rustdeskId = str(body.rustdesk_id, 64);
    if (!rustdeskId) return fail("缺少设备 ID");
    const exists = db.query("SELECT id FROM devices WHERE rustdesk_id = ?").get(rustdeskId);
    if (exists) return fail("该设备 ID 已存在", 409);
    const ts = nowIso();
    const info = db
      .query(
        `INSERT INTO devices (rustdesk_id, hostname, username, department, ip, notes, tags, status, enrolled_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'offline', ?, ?)`,
      )
      .run(
        rustdeskId,
        str(body.hostname, 128),
        str(body.username, 128),
        str(body.department, 128),
        str(body.ip, 64),
        str(body.notes, 1000),
        str(body.tags, 256),
        ts,
        ts,
      );
    return ok({ id: Number(info.lastInsertRowid) }, 201);
  });
  if (res) return await res;

  res = route("GET", "api/devices/:id", (p) => {
    const d = db.query("SELECT * FROM devices WHERE id = ?").get(Number(p.id)) as DeviceRow | null;
    if (!d) return fail("设备不存在", 404);
    return json({ ok: true, device: sanitizeDevice(deviceWithOnline(d)) });
  });
  if (res) return await res;

  res = route("PUT", "api/devices/:id", async (p) => {
    const id = Number(p.id);
    const d = db.query("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | null;
    if (!d) return fail("设备不存在", 404);
    const body = await readJson<any>(req);
    db.query(
      `UPDATE devices SET hostname=?, username=?, department=?, ip=?, notes=?, tags=?, updated_at=? WHERE id=?`,
    ).run(
      body.hostname !== undefined ? str(body.hostname, 128) : d.hostname,
      body.username !== undefined ? str(body.username, 128) : d.username,
      body.department !== undefined ? str(body.department, 128) : d.department,
      body.ip !== undefined ? str(body.ip, 64) : d.ip,
      body.notes !== undefined ? str(body.notes, 1000) : d.notes,
      body.tags !== undefined ? str(body.tags, 256) : d.tags,
      nowIso(),
      id,
    );
    return ok();
  });
  if (res) return await res;

  res = route("DELETE", "api/devices/:id", (p) => {
    const id = Number(p.id);
    db.query("DELETE FROM devices WHERE id = ?").run(id);
    db.query(
      "INSERT INTO audit_logs (operator, action, started_at, result, client_ip, note) VALUES (?,?,?,?,?,?)",
    ).run(operatorName, "device_delete", nowIso(), "success", ip, `删除设备 #${id}`);
    return ok();
  });
  if (res) return await res;

  res = route("POST", "api/devices/:id/rotate-password", async (p) => {
    const id = Number(p.id);
    const d = db.query("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | null;
    if (!d) return fail("设备不存在", 404);
    const pwd = genPassword();
    db.query("UPDATE devices SET unattended_password=?, updated_at=? WHERE id=?").run(
      await encryptSecret(pwd),
      nowIso(),
      id,
    );
    db.query(
      "INSERT INTO audit_logs (operator, action, target_device_id, target_rustdesk_id, target_hostname, started_at, result, client_ip, note) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(operatorName, "rotate_password", id, d.rustdesk_id, d.hostname, nowIso(), "success", ip, "轮换无人值守密码");
    return ok({ password: pwd });
  });
  if (res) return await res;

  // ---------- 审计与会话 ----------
  res = route("POST", "api/audit/connect", async () => {
    const body = await readJson<any>(req);
    const id = Number(body.device_id);
    const d = db.query("SELECT * FROM devices WHERE id = ?").get(id) as DeviceRow | null;
    if (!d) return fail("设备不存在", 404);
    const sessionId = crypto.randomUUID();
    const password = await decryptSecret(d.unattended_password ?? "");
    const info = db
      .query(
        `INSERT INTO audit_logs (session_id, operator, action, target_device_id, target_rustdesk_id, target_hostname, started_at, result, client_ip, note)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        sessionId,
        operatorName,
        "connect",
        d.id,
        d.rustdesk_id,
        d.hostname,
        nowIso(),
        "initiated",
        ip,
        str(body.note, 500),
      );
    return ok({
      session_id: sessionId,
      audit_id: Number(info.lastInsertRowid),
      device: {
        id: d.id,
        rustdesk_id: d.rustdesk_id,
        hostname: d.hostname,
        department: d.department,
        username: d.username,
      },
      unattended_password: password,
      rustdesk_uri: `rustdesk://${d.rustdesk_id}`,
      connect_command: `rustdesk --connect ${d.rustdesk_id}`,
      config: {
        rendezvous_server: getSetting("rendezvous_server", config.rendezvousServer),
        relay_server: getSetting("relay_server", config.relayServer),
        rustdesk_key: getSetting("rustdesk_key", config.rustdeskKey),
      },
    });
  });
  if (res) return await res;

  res = route("POST", "api/audit/session/:id/end", async (p) => {
    const sessionId = p.id;
    const row = db
      .query("SELECT * FROM audit_logs WHERE session_id = ? ORDER BY id DESC LIMIT 1")
      .get(sessionId) as any;
    if (!row) return fail("会话不存在", 404);
    const body = await readJson<any>(req).catch(() => ({}));
    const ended = nowIso();
    const duration = Math.max(0, Math.round((new Date(ended).getTime() - new Date(row.started_at).getTime()) / 1000));
    db.query(
      "UPDATE audit_logs SET ended_at=?, duration_seconds=?, result=?, note=COALESCE(NULLIF(?, ''), note) WHERE id=?",
    ).run(ended, duration, str(body.result, 32) || "ended", str(body.note, 500), row.id);
    return ok({ duration_seconds: duration });
  });
  if (res) return await res;

  res = route("GET", "api/audit", () => {
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 1000);
    const where: string[] = [];
    const params: any[] = [];
    if (q) {
      where.push("(operator LIKE ? OR target_rustdesk_id LIKE ? OR target_hostname LIKE ? OR action LIKE ? OR note LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const sql =
      "SELECT * FROM audit_logs" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    const items = db.query(sql).all(...params);
    return json({ ok: true, items });
  });
  if (res) return await res;

  res = route("GET", "api/audit/export.csv", () => {
    const rows = db.query("SELECT * FROM audit_logs ORDER BY id DESC").all() as any[];
    const flat = rows.map((r) => ({
      时间: r.started_at,
      操作人: r.operator,
      动作: r.action,
      目标设备ID: r.target_rustdesk_id ?? "",
      目标计算机: r.target_hostname ?? "",
      开始时间: r.started_at,
      结束时间: r.ended_at ?? "",
      时长秒: r.duration_seconds ?? "",
      结果: r.result ?? "",
      来源IP: r.client_ip ?? "",
      备注: r.note ?? "",
    }));
    return new Response(toCsv(flat), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="medilink-audit-${Date.now()}.csv"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
  if (res) return await res;

  res = route("POST", "api/audit/cleanup", () => {
    const days = Number(getSetting("audit_retention_days", String(config.auditRetentionDays))) || 180;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const info = db.query("DELETE FROM audit_logs WHERE started_at < ?").run(cutoff);
    return ok({ removed: info.changes, cutoff });
  });
  if (res) return await res;

  // ---------- 设置 ----------
  res = route("GET", "api/settings", () => json({ ok: true, settings: allSettings() }));
  if (res) return await res;

  res = route("PUT", "api/settings", async () => {
    const body = await readJson<any>(req);
    const editable = [
      "site_name",
      "rendezvous_server",
      "relay_server",
      "rustdesk_key",
      "enrollment_key",
      "allow_registration",
      "require_approval",
      "default_readonly",
      "audit_retention_days",
    ];
    const booleanKeys = ["allow_registration", "require_approval", "default_readonly"];
    for (const key of editable) {
      if (body[key] === undefined) continue;
      if (booleanKeys.includes(key)) setSetting(key, boolish(body[key]) ? "1" : "0");
      else setSetting(key, String(body[key]).trim());
    }
    db.query(
      "INSERT INTO audit_logs (operator, action, started_at, result, client_ip, note) VALUES (?,?,?,?,?,?)",
    ).run(operatorName, "update_settings", nowIso(), "success", ip, "更新系统设置");
    return json({ ok: true, settings: allSettings() });
  });
  if (res) return await res;

  // ---------- 统计 ----------
  res = route("GET", "api/stats", () => {
    const total = (db.query("SELECT COUNT(*) n FROM devices").get() as any).n;
    const online = (
      db
        .query("SELECT COUNT(*) n FROM devices WHERE status='online' AND last_seen >= ?")
        .get(new Date(Date.now() - AGENT_ONLINE_WINDOW_MS).toISOString()) as any
    ).n;
    const departments = (
      db.query("SELECT COUNT(DISTINCT department) n FROM devices WHERE department IS NOT NULL AND department != ''").get() as any
    ).n;
    const sessionsToday = (
      db.query("SELECT COUNT(*) n FROM audit_logs WHERE action='connect' AND started_at >= ?").get(
        new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      ) as any
    ).n;
    const auditTotal = (db.query("SELECT COUNT(*) n FROM audit_logs").get() as any).n;
    return json({
      ok: true,
      stats: {
        devices_total: total,
        devices_online: online,
        devices_offline: total - online,
        departments,
        sessions_today: sessionsToday,
        audit_total: auditTotal,
      },
    });
  });
  if (res) return await res;

  return null;
}
