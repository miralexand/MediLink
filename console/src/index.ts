/**
 * MediLink 控制端（信息科运维控制台）
 *
 * 本程序在信息科电脑上以 exe 运行：
 *   1. 启动一个仅监听 127.0.0.1 的本地服务，提供控制台页面；
 *   2. 自动打开浏览器进入控制台；
 *   3. 提供“一键拉起 RustDesk 并发起连接”的本地能力（浏览器无法直接调用 exe）。
 *
 * 设备台账、审计、登录等数据均来自内网 MediLink 管理服务端。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import indexHtmlRaw from "./web/index.html" with { type: "text" };

// Bun 将 .html 导入类型标注为 HTMLBundle，但使用 { type: "text" } 时运行时为字符串
const indexHtml = indexHtmlRaw as unknown as string;

interface ConsoleConfig {
  server_url: string;
  rustdesk_exe: string;
}

const CONSOLE_VERSION = "1.0.0";
const CONFIG_DIR = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "MediLink");
const CONFIG_FILE = join(CONFIG_DIR, "console.json");

function loadConfig(): ConsoleConfig {
  let cfg: ConsoleConfig = { server_url: "", rustdesk_exe: "" };
  try {
    if (existsSync(CONFIG_FILE)) cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    /* ignore */
  }
  if (process.env.MEDILINK_SERVER_URL) cfg.server_url = process.env.MEDILINK_SERVER_URL;
  return cfg;
}

function saveConfig(cfg: ConsoleConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

function findRustDesk(override = ""): string {
  const candidates = [
    override,
    join(process.env["ProgramFiles"] || "C:\\Program Files", "RustDesk", "rustdesk.exe"),
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "RustDesk", "rustdesk.exe"),
    join(process.env.LOCALAPPDATA || "", "Programs", "RustDesk", "rustdesk.exe"),
  ];
  for (const p of candidates) if (p && existsSync(p)) return p;
  try {
    const out = Bun.spawnSync([
      "reg",
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RustDesk",
      "/v",
      "InstallLocation",
    ]).stdout.toString();
    const m = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(out);
    if (m) {
      const c = join(m[1]!.trim(), "rustdesk.exe");
      if (existsSync(c)) return c;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function launchConnection(rustdeskId: string, password: string): { ok: boolean; error?: string; exe?: string } {
  const exe = findRustDesk();
  if (!exe) return { ok: false, error: "未在本机找到 RustDesk，请先安装控制端所需的 RustDesk 客户端" };
  const args = ["--connect", rustdeskId];
  if (password) args.push("--password", password);
  try {
    const proc = Bun.spawn({ cmd: [exe, ...args], stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: false });
    proc.unref();
    return { ok: true, exe };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function pickPort(preferred: number, attempt = 0): number {
  if (attempt > 20) return preferred;
  const port = preferred + attempt;
  try {
    const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    probe.stop(true);
    return port;
  } catch {
    return pickPort(preferred, attempt + 1);
  }
}

const preferredPort = Number(process.env.MEDILINK_CONSOLE_PORT || 18760);
const port = pickPort(preferredPort);
const openBrowser = !process.argv.includes("--no-browser");

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (url.pathname === "/local/health") {
      return json({ ok: true, service: "medilink-console", version: CONSOLE_VERSION });
    }

    if (url.pathname === "/local/config" && req.method === "GET") {
      const cfg = loadConfig();
      return json({ ok: true, ...cfg, rustdesk_detected: findRustDesk(cfg.rustdesk_exe) || "" });
    }

    if (url.pathname === "/local/config" && req.method === "POST") {
      const body = await readBody(req);
      const cfg = loadConfig();
      if (typeof body.server_url === "string") cfg.server_url = body.server_url.trim();
      if (typeof body.rustdesk_exe === "string") cfg.rustdesk_exe = body.rustdesk_exe.trim();
      saveConfig(cfg);
      return json({ ok: true, ...cfg, rustdesk_detected: findRustDesk(cfg.rustdesk_exe) || "" });
    }

    if (url.pathname === "/local/rustdesk") {
      const exe = findRustDesk(loadConfig().rustdesk_exe);
      return json({ ok: true, found: !!exe, exe });
    }

    if (url.pathname === "/local/connect" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.rustdesk_id ?? "").trim();
      const pwd = String(body.password ?? "");
      if (!id) return json({ ok: false, error: "缺少设备 ID" }, 400);
      const r = launchConnection(id, pwd);
      return json(r, r.ok ? 200 : 500);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
  },
});

const address = `http://127.0.0.1:${port}`;
console.log(`
  ╭──────────────────────────────────────────────╮
  │   医联 信息科控制端  v${CONSOLE_VERSION}                 │
  ╰──────────────────────────────────────────────╯
  控制台地址: ${address}
  配置文件  : ${CONFIG_FILE}
  按 Ctrl+C 退出。
`);

if (openBrowser) {
  try {
    Bun.spawn({ cmd: ["cmd", "/c", "start", "", address], stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    console.log(`请手动在浏览器打开 ${address}`);
  }
}

void server;
