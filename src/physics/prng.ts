/**
 * 確定性偽隨機數產生器 (mulberry32)。
 * 目前引擎本體為純確定性，不依賴亂數；此檔保留供未來加入
 * 「發射抖動」「暴擊判定」等需要可重現亂數的玩法時使用。
 * 同一 seed → 同一串輸出，確保伺服器與回放一致。
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
