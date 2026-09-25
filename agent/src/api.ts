/**
 * MediLink 被控端 —— 与管理服务端通信
 */
import type { AgentConfig } from "./config.ts";
import type { SystemInfo } from "./sysinfo.ts";

export interface SetupInfo {
  rendezvous_server: string;
  relay_server: string;
  rustdesk_key: string;
  enrollment_required: boolean;
  registration_open: boolean;
  require_approval: boolean;
}

export interface RegisterResult {
  ok: boolean;
  device_id?: number;
  unattended_password?: string;
  config?: { rendezvous_server: string; relay_server: string; rustdesk_key: string };
  error?: string;
  code?: string;
}

function baseUrl(cfg: AgentConfig): string {
  return cfg.server_url.replace(/\/+$/, "");
}

export async function fetchSetup(cfg: AgentConfig): Promise<SetupInfo | null> {
  try {
    const r = await fetch(`${baseUrl(cfg)}/api/public/setup`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return (await r.json()) as SetupInfo;
  } catch {
    return null;
  }
}

export async function registerDevice(
  cfg: AgentConfig,
  rustdeskId: string,
  info: SystemInfo,
  agentVersion: string,
): Promise<RegisterResult> {
  try {
    const r = await fetch(`${baseUrl(cfg)}/api/agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.enrollment_key ? { "X-Agent-Key": cfg.enrollment_key } : {}),
      },
      body: JSON.stringify({
        rustdesk_id: rustdeskId,
        hostname: info.hostname,
        username: info.username,
        department: cfg.department,
        ip: info.ip,
        mac: info.mac,
        os: info.os,
        cpu: info.cpu,
        memory: info.memory,
        agent_version: agentVersion,
      }),
      signal: AbortSignal.timeout(15000),
    });
    return (await r.json()) as RegisterResult;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function sendHeartbeat(
  cfg: AgentConfig,
  rustdeskId: string,
  info: Pick<SystemInfo, "ip" | "username">,
  agentVersion: string,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  try {
    const r = await fetch(`${baseUrl(cfg)}/api/agent/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.enrollment_key ? { "X-Agent-Key": cfg.enrollment_key } : {}),
      },
      body: JSON.stringify({
        rustdesk_id: rustdeskId,
        ip: info.ip,
        username: info.username,
        agent_version: agentVersion,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return (await r.json()) as { ok: boolean; code?: string; error?: string };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
