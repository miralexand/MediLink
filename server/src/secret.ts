/**
 * MediLink 敏感数据加密
 *
 * 无人值守密码在数据库中以 AES-256-GCM 加密存储，密钥保存在
 * settings.secret_key（首次启动自动生成）或环境变量 MEDILINK_SECRET_KEY。
 * 满足等保“重要数据存储保密性”要求。
 */
import { getSetting, setSetting } from "./db.ts";

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const envKey = process.env.MEDILINK_SECRET_KEY ?? "";
  let raw: Uint8Array<ArrayBuffer>;

  if (envKey) {
    raw = base64ToBytes(envKey);
    if (raw.length !== 32) throw new Error("MEDILINK_SECRET_KEY 必须为 32 字节的 base64");
  } else {
    let stored = getSetting("secret_key", "");
    if (!stored) {
      const buf = new Uint8Array(32);
      crypto.getRandomValues(buf);
      stored = bytesToBase64(buf);
      setSetting("secret_key", stored);
      console.log("[MediLink] 已生成数据库加密密钥（settings.secret_key）");
    }
    raw = base64ToBytes(stored);
  }

  cachedKey = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return "";
  const key = await getKey();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ct))}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  if (!payload) return "";
  try {
    if (!payload.startsWith("v1:")) return payload; // 兼容历史明文
    const [, ivB64, ctB64] = payload.split(":");
    const key = await getKey();
    const iv = base64ToBytes(ivB64!);
    const ct = base64ToBytes(ctB64!);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
