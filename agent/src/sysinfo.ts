/**
 * MediLink 被控端系统信息采集
 *
 * 采集计算机名、当前登录用户、IP、MAC、操作系统、CPU、内存等，
 * 供设备台账使用，便于信息科在控制台按科室/使用人点选连接。
 */
import os from "node:os";
import { $ } from "bun";

export interface SystemInfo {
  hostname: string;
  username: string;
  ip: string;
  mac: string;
  os: string;
  cpu: string;
  memory: string;
}

function pickPrimaryInterface(): { ip: string; mac: string } {
  const ifaces = os.networkInterfaces();
  const candidates: { ip: string; mac: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      let score = 0;
      if (a.address.startsWith("10.")) score = 3;
      else if (a.address.startsWith("192.168.")) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score = 2;
      if (/wlan|wi-fi|wireless/i.test(name)) score += 1;
      candidates.push({ ip: a.address, mac: a.mac, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  return candidates[0] ?? { ip: "", mac: "" };
}

async function consoleUserName(): Promise<string> {
  try {
    const out = await $`query user`.quiet().text();
    for (const line of out.split(/\r?\n/)) {
      // 当前会话行以 ">" 开头
      if (line.trim().startsWith(">")) {
        const parts = line.trim().slice(1).trim().split(/\s+/);
        if (parts[0]) return parts[0];
      }
      if (/^\s*\S+\s+\d+\s+/.test(line) && !/USERNAME|用户名/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] && parts[0] !== ">") return parts[0];
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.USERNAME || process.env.USER || "";
}

async function osCaption(): Promise<string> {
  try {
    const out = await $`powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_OperatingSystem).Caption"`.quiet().text();
    const cap = out.trim();
    if (cap) return cap;
  } catch {
    /* ignore */
  }
  return `${os.type()} ${os.release()}`;
}

export async function collectInfo(includeUser = true): Promise<SystemInfo> {
  const net = pickPrimaryInterface();
  const user = includeUser ? await consoleUserName() : "";
  return {
    hostname: os.hostname(),
    username: user,
    ip: net.ip,
    mac: net.mac,
    os: await osCaption(),
    cpu: os.cpus()?.[0]?.model?.trim() ?? "",
    memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
  };
}
