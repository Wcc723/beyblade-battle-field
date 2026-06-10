/**
 * Session cookie：HMAC-SHA256 簽名的 JSON payload（WebCrypto，無外部依賴）。
 * 格式：base64url(payload).base64url(hmac)
 */

export interface SessionData {
  uid: number;
  email: string;
  name: string;
  picture: string;
  /** unix 秒，過期時間 */
  exp: number;
}

export const SESSION_COOKIE = "bb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(data: SessionData, secret: string): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionData | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      b64urlDecode(sig).buffer as ArrayBuffer,
      enc.encode(payload),
    );
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as SessionData;
    if (typeof data.exp !== "number" || data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = request.headers.get("Cookie");
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function sessionCookieHeader(token: string, request: Request, maxAge = SESSION_TTL_SECONDS): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(request: Request): string {
  return sessionCookieHeader("", request, 0);
}

/** 從 request 取出已驗證的 session（無、壞、過期 → null）。 */
export async function getSession(request: Request, secret: string): Promise<SessionData | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  return verifySession(token, secret);
}
