/**
 * MediLink 服务端入口
 *
 * - Bun.serve 提供 HTTP 服务
 * - /api/*       管理 API 与被控端 API
 * - /health      健康检查（供容器探针/监控使用）
 * - 其他路径     管理控制台单页应用
 */
import { config } from "./config.ts";
import { allSettings, setSetting } from "./db.ts";
import { ensureAdminSeed, purgeExpiredSessions } from "./auth.ts";
import { handleApi } from "./api.ts";
import { CORS_HEADERS } from "./utils.ts";

const indexPath = new URL("./web/index.html", import.meta.url).pathname;

function ensureSettingsSeed(): void {
  const defaults: Record<string, string> = {
    site_name: config.siteName,
    rendezvous_server: config.rendezvousServer,
    relay_server: config.relayServer,
    rustdesk_key: config.rustdeskKey,
    enrollment_key: config.enrollmentKey,
    allow_registration: config.allowRegistration ? "1" : "0",
    require_approval: config.requireApproval ? "1" : "0",
    default_readonly: config.defaultReadonly ? "1" : "0",
    audit_retention_days: String(config.auditRetentionDays),
  };
  const existing = allSettings();
  const missing = Object.entries(defaults).filter(([k]) => existing[k] === undefined);
  for (const [k, v] of missing) setSetting(k, v);
  if (missing.length) {
    console.log(`[医联] 已初始化 ${missing.length} 项默认设置`);
  }
}

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "medilink-server", version: config.version }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (url.pathname.startsWith("/api/")) {
      const res = await handleApi(req, url, server);
      if (res) return res;
      return new Response(JSON.stringify({ ok: false, error: "接口不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // 管理控制台（单页应用）
    if (req.method === "GET") {
      try {
        const html = await Bun.file(indexPath).text();
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
        });
      } catch {
        return new Response("医联 控制台资源缺失", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

await ensureAdminSeed();
ensureSettingsSeed();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000);

console.log(`
  ╭──────────────────────────────────────────────╮
  │  医联 医院内网远程协助服务端  v${config.version}     │
  ╰──────────────────────────────────────────────╯
  监听地址 : http://0.0.0.0:${config.port}
  管理控制台: http://<本机IP>:${config.port}/
  数据库   : ${config.dbPath}
  注册密钥 : ${config.enrollmentKey ? "已启用" : "未设置（内网测试模式）"}
  审计留存 : ${config.auditRetentionDays} 天
`);
