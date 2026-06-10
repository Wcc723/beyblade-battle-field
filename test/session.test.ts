import { describe, it, expect } from "vitest";
import { signSession, verifySession, type SessionData } from "../worker/session";

const SECRET = "test-secret-1234567890abcdef";

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    uid: 42,
    email: "player@example.com",
    name: "玩家",
    picture: "https://example.com/p.png",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe("session 簽章", () => {
  it("簽章後可驗證還原", async () => {
    const data = makeSession();
    const token = await signSession(data, SECRET);
    const verified = await verifySession(token, SECRET);
    expect(verified).toEqual(data);
  });

  it("payload 被竄改 → 驗證失敗", async () => {
    const token = await signSession(makeSession(), SECRET);
    const [payload, sig] = token.split(".");
    // 換掉 payload（偽造 email），沿用原簽章（同實作的 UTF-8 → base64url 編法）
    const bytes = new TextEncoder().encode(JSON.stringify(makeSession({ email: "admin@evil.com" })));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const forged = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it("錯誤密鑰 → 驗證失敗", async () => {
    const token = await signSession(makeSession(), SECRET);
    expect(await verifySession(token, "wrong-secret")).toBeNull();
  });

  it("過期 session → 驗證失敗", async () => {
    const token = await signSession(makeSession({ exp: Math.floor(Date.now() / 1000) - 10 }), SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("亂七八糟的 token → null 不丟例外", async () => {
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("abc", SECRET)).toBeNull();
    expect(await verifySession("a.b.c.d", SECRET)).toBeNull();
    expect(await verifySession("不是base64.也不是", SECRET)).toBeNull();
  });
});
