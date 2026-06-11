/**
 * 計分賽制（共用模組）：前端回放結算顯示用、Battle Room DO 權威計分用。
 * 純函式、零瀏覽器/Env 相依（單元測試與 worker 都 import 得進來）。
 */
import type { ArenaConfig, SimResult } from "../physics/types";
import { rimScoreAt } from "../physics/arena";

/** 先到 N 分 */
export const WIN_SCORE = 3;

/**
 * 本回合得分：擊破 2、出界依場地分區（方形場角落 cornerScore / 圓形場 rim 落點）、
 * 停轉/時間到 1、平手 0。
 */
export function roundPoints(arena: ArenaConfig, r: SimResult): number {
  if (!r.winnerId) return 0;
  if (r.reason === "ko") return 2;
  if (r.reason === "ring-out") {
    if (arena.box) return arena.box.cornerScore ?? 2;
    return rimScoreAt(arena, r.ringOutAngle);
  }
  if (r.reason === "spin-out" || r.reason === "timeout") return 1;
  return 0;
}
