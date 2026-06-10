/**
 * JWT payload 解碼（不驗簽——id_token 走 TLS 直連 Google 取得，見 auth.ts 註解）。
 * 獨立成無 Env 相依的純模組：單元測試（root tsconfig 無 workers 全域型別）才 import 得進來。
 */
import { b64urlDecode } from "./session";

export interface GoogleIdTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export function decodeJwtPayload(jwt: string): GoogleIdTokenPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    // 注意：不能 JSON.parse(atob(...))——atob 把 UTF-8 位元組當 Latin-1，
    // 中文姓名會無聲變亂碼。要先解成 bytes 再 TextDecoder。
    return JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as GoogleIdTokenPayload;
  } catch {
    return null;
  }
}
