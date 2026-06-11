/**
 * 線上對戰房測試 bot：以指定 session token 連進房間，瞄準階段自動發射。
 * 用法：node scripts/bot-player.mjs <房號> <session-token> [名字] [--driver]
 *   --driver：回合結束後負責按「下一回合」（兩隻 bot 對打時給其中一隻）
 *
 * 開發測試工具：驗證 Battle Room DO 的完整協定（join/loadout/launch/round/next/finished）。
 */
import WebSocket from "ws";

const [, , code, token, name = "BOT", flag] = process.argv;
const isDriver = flag === "--driver" || name === "--driver";
if (!code || !token) {
  console.error("用法：node scripts/bot-player.mjs <房號> <token> [名字] [--driver]");
  process.exit(1);
}

const log = (...a) => console.log(`[${name}]`, ...a);
// BOT_QUERY="?bot=1" → 測試「跟內建 BOT 對戰」的房間
const ws = new WebSocket(`ws://localhost:5173/api/room/${code}/ws${process.env.BOT_QUERY ?? ""}`, {
  headers: { Cookie: `bb_session=${token}` },
});

let you = null;
let pendingLaunch = false;

const TIMEOUT_MS = Number(process.env.BOT_TIMEOUT_MS ?? 90_000);
setTimeout(() => {
  log(`TIMEOUT ${TIMEOUT_MS / 1000}s，結束`);
  process.exit(2);
}, TIMEOUT_MS);

ws.on("open", () => log("connected"));
ws.on("close", (c, r) => {
  log("closed", c, String(r));
  process.exit(0);
});
ws.on("error", (e) => log("error", e.message));

ws.on("message", (data) => {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (msg.type === "room") {
    you = msg.you;
    const s = msg.snapshot;
    const p = (side) => {
      const pl = s.players[side];
      return pl ? `${pl.nickname}${pl.connected ? "" : "(離線)"}${pl.launched ? "✓" : "…"}` : "—";
    };
    log(`room phase=${s.phase} you=${you} A=${p("A")} B=${p("B")} 比分=${s.scoreA}:${s.scoreB} R${s.roundNum}`);

    if (s.phase === "aiming" && you && s.players[you] && !s.players[you].launched && !pendingLaunch) {
      pendingLaunch = true;
      setTimeout(() => {
        const dirY = you === "A" ? 1 : -1; // A 由下往上打、B 由上往下
        // 加隨機性：完全鏡像的發射會打出完全對稱的對戰 → 永遠平手（確定性引擎）
        const aim = {
          x: (you === "A" ? -40 : 40) + (Math.random() * 120 - 60),
          y: -dirY * (110 + Math.random() * 80),
          dirX: Math.random() * 0.6 - 0.3,
          dirY,
          power: 0.55 + Math.random() * 0.45,
        };
        ws.send(JSON.stringify({ type: "launch", aim }));
        log("🚀 launched", JSON.stringify(aim));
      }, 600);
    }
    if (s.phase === "finished") {
      log(`🏆 MATCH OVER winner=${s.winnerSide} 比分=${s.scoreA}:${s.scoreB}`);
      setTimeout(() => process.exit(0), 800);
    }
  } else if (msg.type === "round") {
    pendingLaunch = false;
    const o = msg.payload.outcome;
    const spins = msg.payload.inits.map((i) => `${i.id}:${i.spinDir === 1 ? "右" : "左"}`).join(" ");
    log(
      `🎬 ROUND R${o.roundNum}: winner=${o.winnerSide || "平手"} reason=${o.reason} +${o.points} → ${o.scoreA}:${o.scoreB} matchOver=${o.matchOver} (seed=${msg.payload.seed}, 旋向 ${spins})`,
    );
    if (!o.matchOver && isDriver) {
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "next-round" }));
        log("→ next-round");
      }, 1000);
    }
  } else if (msg.type === "opponent-launched") {
    log("👀 對手已發射");
  } else if (msg.type === "error") {
    log("❌ ERR", msg.code);
  }
});
