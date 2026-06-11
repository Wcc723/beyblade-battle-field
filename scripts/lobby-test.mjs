/**
 * 大廳測試：兩個使用者連 Lobby WS → 都按快速配對 → 應收到同一個房號。
 * 用法：node scripts/lobby-test.mjs <tokenA> <tokenB>
 */
import WebSocket from "ws";

const [, , tokenA, tokenB] = process.argv;
if (!tokenA || !tokenB) {
  console.error("用法：node scripts/lobby-test.mjs <tokenA> <tokenB>");
  process.exit(1);
}

const results = {};
let done = 0;

function client(name, token) {
  const ws = new WebSocket("ws://localhost:5173/api/lobby/ws", {
    headers: { Cookie: `bb_session=${token}` },
  });
  ws.on("open", () => console.log(`[${name}] connected`));
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "lobby") {
      console.log(`[${name}] lobby online=${msg.online} queue=${msg.queueSize} queued=${msg.queued} rooms=${msg.rooms.length}`);
    } else if (msg.type === "matched") {
      console.log(`[${name}] ✅ MATCHED → ${msg.code}`);
      results[name] = msg.code;
      done++;
      if (done === 2) {
        console.log(results.A === results.B ? `🎉 兩人配到同一房：${results.A}` : `❌ 房號不一致！${results.A} vs ${results.B}`);
        process.exit(results.A === results.B ? 0 : 1);
      }
    }
  });
  ws.on("error", (e) => console.log(`[${name}] error`, e.message));
  return ws;
}

const a = client("A", tokenA);
const b = client("B", tokenB);

setTimeout(() => a.send(JSON.stringify({ type: "queue" })), 800);
setTimeout(() => b.send(JSON.stringify({ type: "queue" })), 1400);
setTimeout(() => {
  console.log("TIMEOUT：沒配對成功");
  process.exit(2);
}, 15000);
