/**
 * MediLink 服务端通用工具：HTTP 响应、请求解析、校验、CSV 导出等。
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Key",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra },
  });
}

export function ok(data: unknown = {}, status = 200): Response {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return json({ ok: true, ...(data as Record<string, unknown>) }, status);
  }
  return json({ ok: true, data }, status);
}

export function fail(message: string, status = 400, code?: string): Response {
  return json({ ok: false, error: message, code }, status);
}

export function text(body: string, contentType = "text/plain; charset=utf-8", status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": contentType, ...CORS_HEADERS } });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      const t = await req.text();
      return (t ? JSON.parse(t) : {}) as T;
    }
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function str(v: unknown, max = 512): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, max);
}

export function boolish(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
  }
  return fallback;
}

export function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const head = cols.map(csvEscape).join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\r\n");
  // 加 BOM，方便 Excel 正确识别 UTF-8 中文
  return "\uFEFF" + head + (body ? "\r\n" + body : "") + "\r\n";
}

/** 获取真实客户端 IP（兼容反向代理） */
export function clientIp(req: Request, server?: { requestIP?: (r: Request) => { address: string } | null }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  try {
    if (server?.requestIP) {
      const info = server.requestIP(req);
      if (info?.address) return info.address;
    }
  } catch {
    /* ignore */
  }
  return "";
}
