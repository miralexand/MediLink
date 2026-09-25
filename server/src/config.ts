/**
 * MediLink 服务端配置
 *
 * 所有配置均支持环境变量覆盖，便于 Docker 部署。
 * 敏感配置（管理员口令、RustDesk Key）不会写入代码库。
 */

function env(key: string, fallback = ""): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = Number.parseInt(env(key), 10);
  return Number.isFinite(v) ? v : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = env(key).toLowerCase();
  if (v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

export const config = {
  /** 服务监听端口（容器内默认 8080） */
  port: envInt("MEDILINK_PORT", 8080),

  /** SQLite 数据库路径 */
  dbPath: env("MEDILINK_DB_PATH", "./data/medilink.db"),

  /** 初始管理员账号（首次启动时写入数据库，之后以数据库为准） */
  adminUser: env("MEDILINK_ADMIN_USER", "admin"),
  adminPassword: env("MEDILINK_ADMIN_PASSWORD", "MediLink@2026"),

  /** 会话有效期（秒），默认 8 小时 */
  sessionTtl: envInt("MEDILINK_SESSION_TTL", 8 * 3600),

  /** RustDesk 服务端连接参数（下发给被控端/控制端） */
  rendezvousServer: env("MEDILINK_RENDEZVOUS_SERVER", "10.0.0.10:21116"),
  relayServer: env("MEDILINK_RELAY_SERVER", "10.0.0.10:21117"),
  rustdeskKey: env("MEDILINK_RUSTDESK_KEY", ""),

  /** 被控端注册密钥（enrollment key），为空则不校验，仅建议内网测试使用 */
  enrollmentKey: env("MEDILINK_ENROLLMENT_KEY", ""),

  /** 是否允许被控端自动注册 */
  allowRegistration: envBool("MEDILINK_ALLOW_REGISTRATION", true),

  /** 默认是否需要被控端确认 */
  requireApproval: envBool("MEDILINK_REQUIRE_APPROVAL", true),

  /** 默认是否只读 */
  defaultReadonly: envBool("MEDILINK_DEFAULT_READONLY", true),

  /** 审计日志留存天数（等保要求不少于 180 天） */
  auditRetentionDays: envInt("MEDILINK_AUDIT_RETENTION_DAYS", 180),

  /** 站点名称，用于控制台展示 */
  siteName: env("MEDILINK_SITE_NAME", "MediLink 医院内网远程协助平台"),

  /** 服务端版本 */
  version: "1.0.0",
};

export type Config = typeof config;
