import { describe, it, expect } from "vitest";
import { decodeJwtPayload } from "../worker/jwt";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeJwt(payload: object): string {
  const enc = new TextEncoder();
  return `${b64url(enc.encode('{"alg":"RS256"}'))}.${b64url(enc.encode(JSON.stringify(payload)))}.fakesig`;
}

describe("decodeJwtPayload", () => {
  it("中文姓名正確解碼（防回歸：atob 直接 parse 會亂碼）", () => {
    const jwt = fakeJwt({
      iss: "https://accounts.google.com",
      aud: "client-id",
      exp: 9999999999,
      sub: "sub-1",
      email: "player@example.com",
      name: "玩家王小明",
      picture: "https://example.com/p.png",
    });
    const payload = decodeJwtPayload(jwt);
    expect(payload?.name).toBe("玩家王小明");
    expect(payload?.email).toBe("player@example.com");
  });

  it("格式不對回 null 不丟例外", () => {
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
    expect(decodeJwtPayload("a.不是base64.c")).toBeNull();
  });
});
