/**
 * 場地幾何查詢層（純函式、零瀏覽器/Cloudflare 相依、確定性）。
 *
 * 把「地圖特性」的查詢集中在這一層，引擎（engine.ts）與前端（BattleViz.vue）共用同一份解析，
 * 確保「物理判定」「計分」「畫面」三者對同一塊地圖看到一致的數值。
 *
 * P1：邊緣分區 rim（本檔）。
 * 之後 P2 障礙物 / P3 地面分區 / P4 非圓形場也會掛進這個檔，介面同樣回傳「某位置的有效屬性」。
 */
import type { ArenaConfig, RimSegment, SoftWall } from "./types";

/** 解析後（套完 kind 預設 + 段內覆寫）的某段護牆有效屬性。 */
export interface RimProps {
  kind: "wall" | "pocket" | "break";
  /** 反彈係數 */
  wallBounce: number;
  /** 出界門檻：向外速度超過才衝出護牆。破口為 0 → 一碰邊就出界。 */
  ringOutSpeed: number;
  /** 從此段飛出的計分 */
  score: number;
}

/**
 * 舊存檔 / 預設場（rim 為 undefined）的相容預設：
 * 上(+y)、下(-y) 兩個高分缺口，半寬 0.42、計分 2，但 ringOutSpeed 沿用全域，
 * → 與舊版「缺口只計分、物理不變」完全一致（不影響既有平衡）。
 */
export const LEGACY_DEFAULT_RIM: readonly RimSegment[] = [
  { angle: Math.PI / 2, half: 0.42, kind: "pocket", score: 2 },
  { angle: -Math.PI / 2, half: 0.42, kind: "pocket", score: 2 },
];

/** 取最短弧的角度差（0 ~ π）。 */
function angleDist(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = Math.abs(a - b) % TAU;
  if (d > Math.PI) d = TAU - d;
  return d;
}

/** kind 對應的預設有效屬性（未被段內數值覆寫時使用）。 */
function kindDefaults(kind: RimSegment["kind"], arena: ArenaConfig): RimProps {
  switch (kind) {
    case "break":
      // 真·物理破口：門檻 0（一碰邊就出界）、預設高分
      return { kind: "break", wallBounce: arena.wallBounce, ringOutSpeed: 0, score: 2 };
    case "pocket":
      // 高分區但物理同一般牆（相容舊缺口）
      return { kind: "pocket", wallBounce: arena.wallBounce, ringOutSpeed: arena.ringOutSpeed, score: 2 };
    default:
      return { kind: "wall", wallBounce: arena.wallBounce, ringOutSpeed: arena.ringOutSpeed, score: 1 };
  }
}

/** 實際生效的分區清單：未設 → 相容預設（上下兩缺口）；設了（含 []）→ 照用。 */
export function effectiveRim(arena: ArenaConfig): readonly RimSegment[] {
  return arena.rim ?? LEGACY_DEFAULT_RIM;
}

/**
 * 查某個世界角度落在哪段護牆，回傳解析後的有效屬性。
 * 若有多段重疊，取「半寬最小（最具體）」的那段；都沒涵蓋 → 一般牆。
 */
export function rimAt(arena: ArenaConfig, angle: number): RimProps {
  const rim = effectiveRim(arena);
  let best: RimSegment | null = null;
  for (const seg of rim) {
    if (angleDist(angle, seg.angle) <= seg.half) {
      if (!best || seg.half < best.half) best = seg;
    }
  }
  if (!best) {
    return { kind: "wall", wallBounce: arena.wallBounce, ringOutSpeed: arena.ringOutSpeed, score: 1 };
  }
  const d = kindDefaults(best.kind ?? "wall", arena);
  return {
    kind: d.kind,
    wallBounce: best.wallBounce ?? d.wallBounce,
    ringOutSpeed: best.ringOutSpeed ?? d.ringOutSpeed,
    score: best.score ?? d.score,
  };
}

/** 計分輔助：從某出界角度可得幾分（前端回合計分用）。角度無效 → 1 分。 */
export function rimScoreAt(arena: ArenaConfig, angle: number | null): number {
  if (angle == null || !Number.isFinite(angle)) return 1;
  return rimAt(arena, angle).score;
}

/* =========================================================================
 * 綠色內牆（M 形 Xtreme Line）幾何 —— 手繪 SVG 同款「直線腿相切圓弧拱 + 水平凹底」。
 * （此模組只管「形狀」；牆是實體/軟牆、貼地擋/騰空越，皆由 engine.ts 決定。）
 * 構圖（世界座標，凹口在 topAngle，預設 +y）：基準半徑 R 的外圈大弧（底部 ~252°）
 *   + 兩條從外圈接縫到圓拱的直線腿 + 兩個外凸圓拱（半徑 cR）+ 頂端兩拱間的水平凹底線段（寬 ~5% 直徑）。
 * 接點：腿↔圓拱為 C1「相切」（平滑無切角，使用者要的）；圓拱↔水平凹底為刻意的凹角（C0，反彈用段法線處理）；
 *   外圈↔腿在接縫亦為 C0 折角。此曲線為「星形」（每條從中心射線只交界線一次）→ 仍以 r(θ) 介面供引擎查詢，engine.ts 零改動。
 * 比例預設 = 已定案手繪稿（canvas R=228 換算，原稿存於 art/softwall/）。純函式、確定性。
 * ========================================================================= */

const TAU = Math.PI * 2;

/** 角度正規化到 (−π, π]。 */
function swWrap(a: number): number {
  a = (((a + Math.PI) % TAU) + TAU) % TAU;
  return a - Math.PI;
}

/** 手繪定案 M 形比例（相對基準半徑 radius；seamAngle 為弧度）。 */
const DEFAULT_MNOTCH = {
  crownRadius: 92 / 228, // 圓拱半徑 ≈ 0.4035·R
  crownSep: 60 / 228, // 圓拱圓心離中軸 x ≈ 0.2632·R
  crownHeight: 152 / 228, // 圓拱圓心往凹口方向高 ≈ 0.6667·R
  seamAngle: (54 * Math.PI) / 180, // 外圈接縫離頂角 ≈ 0.9425
  notchHalf: 11.4 / 228, // 水平凹底半長 ≈ 0.05·R（5% 直徑）
};

/** 預先建好的 M 形界線（依角度升冪排序的點 + 每段外法線），快取於 swOutlineCache。 */
interface SwOutline {
  n: number;
  ang: number[]; // 各界線點角度（升冪）
  px: number[];
  py: number[];
  nx: number[]; // 段 i（點 i→i+1）的單位外法線
  ny: number[];
}

const swOutlineCache = new WeakMap<SoftWall, SwOutline>();

/** 依 sw 數值建構 M 形界線取樣點（純函式：同數值 → 同結果 → 確定性）。 */
function buildSwOutline(sw: SoftWall): SwOutline {
  const R = sw.radius;
  const cR = (sw.crownRadius ?? DEFAULT_MNOTCH.crownRadius) * R;
  const cSep = (sw.crownSep ?? DEFAULT_MNOTCH.crownSep) * R;
  const cY = (sw.crownHeight ?? DEFAULT_MNOTCH.crownHeight) * R;
  const seam = sw.seamAngle ?? DEFAULT_MNOTCH.seamAngle;
  const nHalf = (sw.notchHalf ?? DEFAULT_MNOTCH.notchHalf) * R;
  const rot = (sw.topAngle ?? Math.PI / 2) - Math.PI / 2; // 把「頂」從 +y 轉到 topAngle

  // 凹口在 +y 的構圖（最後整體旋轉 rot）
  const KR = { x: cSep, y: cY };
  const KL = { x: -cSep, y: cY };
  const SR = { x: R * Math.sin(seam), y: R * Math.cos(seam) }; // 右接縫（外圈上）
  const SL = { x: -R * Math.sin(seam), y: R * Math.cos(seam) }; // 左接縫
  // 外點 S 對圓 K（半徑 cR）的切點（sign 選兩切點之一）
  const tanFrom = (S: { x: number; y: number }, K: { x: number; y: number }, sign: number) => {
    const ksx = S.x - K.x;
    const ksy = S.y - K.y;
    const d = Math.hypot(ksx, ksy) || 1e-6;
    const g = Math.acos(Math.min(1, cR / d));
    const ux = ksx / d;
    const uy = ksy / d;
    const c = Math.cos(sign * g);
    const s = Math.sin(sign * g);
    return { x: K.x + cR * (ux * c - uy * s), y: K.y + cR * (ux * s + uy * c) };
  };
  // 腿相切於圓拱「靠拱頂（y 較大）那側」的切點 → 弧從切點經拱頂掃到凹底＝外側短弧。
  // （手繪稿是 canvas y 朝下；搬到世界座標 y 朝上後，正確切點是 y 大者。）
  const tanUpper = (S: { x: number; y: number }, K: { x: number; y: number }) => {
    const t1 = tanFrom(S, K, +1);
    const t2 = tanFrom(S, K, -1);
    return t1.y >= t2.y ? t1 : t2;
  };
  const TcR = tanUpper(SR, KR);
  const TcL = tanUpper(SL, KL);
  // 凹底水平線段端點（兩拱在 x=±nHalf 的「上交點」）
  const Ny = cY + Math.sqrt(Math.max(0, cR * cR - (cSep - nHalf) * (cSep - nHalf)));
  const ER = { x: nHalf, y: Ny };
  const EL = { x: -nHalf, y: Ny };

  const raw: { x: number; y: number }[] = [];
  // 外圈大弧：從右接縫（角 π/2−seam）順時針（經底部）掃到左接縫（角 π/2+seam）
  const aSR = Math.PI / 2 - seam;
  const aSL = Math.PI / 2 + seam;
  const ringSpan = TAU - (aSL - aSR); // 大弧跨度（約 252°）
  const RING_N = 168;
  for (let i = 0; i <= RING_N; i++) {
    const a = aSR - (i / RING_N) * ringSpan;
    raw.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  }
  // 圓拱弧取樣（沿圓 K 從 A 到 B，直線插值圓心角；A、B 之間含拱頂 → 直接插值即經拱頂）
  const ARC_N = 40;
  const pushArc = (K: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }) => {
    const a0 = Math.atan2(A.y - K.y, A.x - K.x);
    const a1 = Math.atan2(B.y - K.y, B.x - K.x);
    for (let i = 1; i < ARC_N; i++) {
      const a = a0 + (i / ARC_N) * (a1 - a0);
      raw.push({ x: K.x + cR * Math.cos(a), y: K.y + cR * Math.sin(a) });
    }
  };
  raw.push(TcR); // 右腿端 = 右拱切點
  pushArc(KR, TcR, ER); // 右拱
  raw.push(ER, EL); // 水平凹底兩端
  pushArc(KL, EL, TcL); // 左拱
  raw.push(TcL); // 左腿端 = 左拱切點

  // 整體旋轉 rot、計算角度、依角度升冪排序（星形 → 排序後即界線環繞順序）
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const rotated = raw.map((p) => {
    const x = p.x * cr - p.y * sr;
    const y = p.x * sr + p.y * cr;
    return { x, y, ang: Math.atan2(y, x) };
  });
  rotated.sort((a, b) => a.ang - b.ang);

  const n = rotated.length;
  const ang = new Array<number>(n);
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  const nx = new Array<number>(n);
  const ny = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    ang[i] = rotated[i].ang;
    px[i] = rotated[i].x;
    py[i] = rotated[i].y;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = px[j] - px[i];
    let dy = py[j] - py[i];
    const len = Math.hypot(dx, dy) || 1e-6;
    dx /= len;
    dy /= len;
    let ox = dy; // 段法線候選
    let oy = -dx;
    const mx = (px[i] + px[j]) * 0.5;
    const my = (py[i] + py[j]) * 0.5;
    if (ox * mx + oy * my < 0) {
      ox = -ox;
      oy = -oy;
    } // 取朝外（與段中點位置同向；星形保證可分辨內外）
    nx[i] = ox;
    ny[i] = oy;
  }
  return { n, ang, px, py, nx, ny };
}

function getSwOutline(sw: SoftWall): SwOutline {
  let o = swOutlineCache.get(sw);
  if (!o) {
    o = buildSwOutline(sw);
    swOutlineCache.set(sw, o);
  }
  return o;
}

/** 找角度 θ 落在哪一段界線（回傳段索引 i：界線在點 i→i+1 之間）。 */
function swSegIndex(o: SwOutline, theta: number): number {
  const t = swWrap(theta);
  const { ang, n } = o;
  if (t < ang[0] || t >= ang[n - 1]) return n - 1; // 跨 ±π 的環繞段（點 n−1 → 點 0）
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ang[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 軟牆中心線半徑 r(θ)：從中心沿 θ 射線與所屬界線段的交點距離。引擎與 SVG 同源。 */
export function softWallRadiusAt(sw: SoftWall, theta: number): number {
  const o = getSwOutline(sw);
  const i = swSegIndex(o, theta);
  const j = (i + 1) % o.n;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const ax = o.px[i];
  const ay = o.py[i];
  const dx = o.px[j] - ax;
  const dy = o.py[j] - ay;
  const denom = ux * dy - uy * dx; // u × D
  if (Math.abs(denom) < 1e-9) return Math.hypot(ax, ay);
  const r = (ax * dy - ay * dx) / denom; // 射線參數 = (A × D)/(u × D)
  return r > 0 ? r : Math.hypot(ax, ay);
}

/** 軟牆在 θ 處的單位「外法線 + 切線」（所屬界線段的法線）。 */
export function softWallNormalAt(sw: SoftWall, theta: number): { nx: number; ny: number; tx: number; ty: number } {
  const o = getSwOutline(sw);
  const i = swSegIndex(o, theta);
  const nx = o.nx[i];
  const ny = o.ny[i];
  return { nx, ny, tx: -ny, ty: nx };
}

/** 頂部加速區查詢：是否在凹口弧段且貼近綠牆，連同外法線/切線。 */
export function softWallAccelAt(
  sw: SoftWall,
  px: number,
  py: number,
  bodyRadius: number,
): { onZone: boolean; nx: number; ny: number; tx: number; ty: number } {
  const theta = Math.atan2(py, px);
  const phi = swWrap(theta - (sw.topAngle ?? Math.PI / 2));
  const accelHalf = sw.accelHalf ?? sw.seamAngle ?? DEFAULT_MNOTCH.seamAngle;
  const r = Math.hypot(px, py) || 1e-6;
  const rw = softWallRadiusAt(sw, theta);
  const band = (sw.bandHalf ?? 16) + bodyRadius + 14;
  const onZone = (phi < 0 ? -phi : phi) <= accelHalf && (r - rw < 0 ? rw - r : r - rw) <= band;
  const nrm = softWallNormalAt(sw, theta);
  return { onZone, nx: nrm.nx, ny: nrm.ny, tx: nrm.tx, ty: nrm.ty };
}

/** 描繪來源：M 形界線取樣點（世界座標，依角度排序、閉合一圈）。ArenaSvg 描邊的唯一來源。 */
export function sampleSoftWall(sw: SoftWall): { x: number; y: number }[] {
  const o = getSwOutline(sw);
  const out = new Array<{ x: number; y: number }>(o.n);
  for (let i = 0; i < o.n; i++) out[i] = { x: o.px[i], y: o.py[i] };
  return out;
}
