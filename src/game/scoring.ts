/**
 * 計分賽制（共用模組）：前端回放結算顯示用、Battle Room DO 權威計分用。
 * 純函式、零瀏覽器/Env 相依（單元測試與 worker 都 import 得進來）。
 */
import type { ArenaConfig, SimResult } from "../physics/types";

/** 先到 N 分 */
export const WIN_SCORE = 3;

/**
 * 本回合得分（新制）：擊破 ko 1、停轉 spin-out 1、出界 ring-out 一律 2
 * （不再依場地分區 cornerScore / rim 落點）、timeout 有勝者 1、平手 0。
 * arena 參數保留簽名相容（DO 與前端共用呼叫端不必改），目前計分不再讀場地。
 */
export function roundPoints(_arena: ArenaConfig, r: SimResult): number {
  if (!r.winnerId) return 0;
  if (r.reason === "ring-out") return 2;
  if (r.reason === "ko" || r.reason === "spin-out" || r.reason === "timeout") return 1;
  return 0;
}
