<script setup lang="ts">
/**
 * 場地向量圖層（SVG）。
 * 吃「引擎用的同一份場地幾何資料」(radius / rim / rail / box) 來畫，
 * 因此畫面與物理碰撞保證同源一致 —— 調物理數值，畫面自動跟著對。
 * 純展示、不吃指標事件（pointer-events:none），底下墊著、上層 canvas 畫會動的陀螺。
 */
import { computed } from "vue";
import type { ArenaConfig } from "../physics/types";
import { effectiveRim, rimAt, sampleSoftWall, sampleBoundary, boundaryRadiusAt } from "../physics/arena";

const props = defineProps<{ arena: ArenaConfig }>();

const SIZE = 640;
const PAD = 28; // 與 BattleViz 的 toCanvas/scaleLen 一致
const C = SIZE / 2; // 320：場地中心

// 機殼四角鉚釘座標（純裝飾，與物理幾何無關）
const RIVETS: ReadonlyArray<readonly [number, number]> = [
  [22, 22],
  [SIZE - 22, 22],
  [22, SIZE - 22],
  [SIZE - 22, SIZE - 22],
];

// 縮放基準：方形場用半邊長、圓形場用半徑（場地剛好填滿畫布）
const scaleRef = computed(() => (props.arena.box ? props.arena.box.half : props.arena.radius));
const scale = computed(() => (SIZE / 2 - PAD) / scaleRef.value);

const railG = computed(() =>
  props.arena.rail
    ? { r: props.arena.rail.radius * scale.value, w: Math.max(7, props.arena.rail.band * scale.value * 0.7) }
    : null,
);

function pt(r: number, a: number): [number, number] {
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/**
 * 熔岩軟牆（M 形內牆）描繪：吃「引擎用的同一份」softWall r(θ)（sampleSoftWall），
 * 等角取樣世界座標 → 畫布（含 y 翻轉，與 BattleViz.toCanvas 一致）→ 折線。畫面與物理同源。
 */
function toSvgWorld(wx: number, wy: number): string {
  return `${(C + wx * scale.value).toFixed(1)} ${(C - wy * scale.value).toFixed(1)}`;
}
const railShape = computed(() => {
  const sw = props.arena.softWall;
  if (!sw) return "";
  const pts = sampleSoftWall(sw);
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toSvgWorld(p.x, p.y)}`).join(" ") + " Z";
});
const swBandPx = computed(() => {
  const sw = props.arena.softWall;
  return sw ? Math.max(7, (sw.bandHalf ?? 16) * 2 * scale.value) : 7;
});
function arcPath(r: number, a0: number, a1: number, large = 0, sweep = 1): string {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* ---------- 超橢圓場（弧壁）幾何 ---------- */
function svgPt(wx: number, wy: number): string {
  return `${(C + wx * scale.value).toFixed(1)},${(C - wy * scale.value).toFixed(1)}`;
}
/** 以畫布中心為原點的等比縮放 transform（內圈拉絲紋用） */
function ringTf(k: number): string {
  const t = C * (1 - k);
  return `translate(${t.toFixed(1)} ${t.toFixed(1)}) scale(${k})`;
}
const superG = computed(() => {
  if (props.arena.box || !props.arena.superellipse) return null;
  // 邊界路徑：吃「引擎用的同一份」r(θ)（sampleBoundary）→ 畫面與物理同源
  const pts = sampleBoundary(props.arena, 288);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${toSvgWorld(p.x, p.y)}`).join(" ") + " Z";
  // 出界扇區（rim，弧壁場為四個對角 pocket）：沿邊界取樣的帶狀 hazard 區 + 計分標籤
  const bandW = 30; // hazard 帶寬（world 單位）
  const exits = effectiveRim(props.arena)
    .map((seg) => {
      const rp = rimAt(props.arena, seg.angle);
      const N = 14;
      const outer: string[] = [];
      const inner: string[] = [];
      for (let i = 0; i <= N; i++) {
        const a = seg.angle - seg.half + (i / N) * seg.half * 2;
        const r = boundaryRadiusAt(props.arena, a);
        outer.push(svgPt(r * Math.cos(a), r * Math.sin(a)));
        inner.unshift(svgPt((r - bandW) * Math.cos(a), (r - bandW) * Math.sin(a)));
      }
      const rl = boundaryRadiusAt(props.arena, seg.angle) - bandW - 20;
      return {
        pts: [...outer, ...inner].join(" "),
        lx: C + rl * Math.cos(seg.angle) * scale.value,
        ly: C - rl * Math.sin(seg.angle) * scale.value,
        kind: rp.kind,
        score: rp.score,
      };
    })
    .filter((e) => e.kind !== "wall" || e.score > 1);
  return { path, exits };
});

/* ---------- 圓形場幾何 ---------- */
const circG = computed(() => {
  if (props.arena.box || props.arena.superellipse) return null;
  const R = props.arena.radius * scale.value; // 碗外緣（固定 = 292）
  const exits = effectiveRim(props.arena).map((seg) => {
    const rp = rimAt(props.arena, seg.angle);
    const sa = -seg.angle; // 世界角 θ → SVG 角 -θ（y 軸翻轉）
    return { a0: sa - seg.half, a1: sa + seg.half, mid: sa, kind: rp.kind, score: rp.score };
  });
  // 熔岩軌：頂端留缺口，呼應實體場 M 形開口
  const gap = 0.5;
  const railPath = railG.value ? arcPath(railG.value.r, -Math.PI / 2 + gap, -Math.PI / 2 - gap, 1, 1) : "";
  return { R, exits, railPath };
});

/* ---------- 方形場幾何 ---------- */
const boxG = computed(() => {
  const b = props.arena.box;
  if (!b) return null;
  const bp = b.half * scale.value; // 半邊長（px）≈ 292
  const gp = b.cornerGap * scale.value; // 角落開口（px）
  const left = C - bp, right = C + bp, top = C - bp, bottom = C + bp;
  // 四條邊（會反彈的牆）：直線中段，兩端各留 gp 給角落開口
  const edges = [
    { x1: left + gp, y1: top, x2: right - gp, y2: top }, // 上
    { x1: left + gp, y1: bottom, x2: right - gp, y2: bottom }, // 下
    { x1: left, y1: top + gp, x2: left, y2: bottom - gp }, // 左
    { x1: right, y1: top + gp, x2: right, y2: bottom - gp }, // 右
  ];
  // 四個角（出界範圍）：以直角三角形填滿角落（綠圈往外即此範圍）
  const corners = [
    `${left + gp},${top} ${left},${top} ${left},${top + gp}`, // 左上
    `${right - gp},${top} ${right},${top} ${right},${top + gp}`, // 右上
    `${left},${bottom - gp} ${left},${bottom} ${left + gp},${bottom}`, // 左下
    `${right},${bottom - gp} ${right},${bottom} ${right - gp},${bottom}`, // 右下
  ];
  const score = b.cornerScore ?? 2;
  const labels = [
    { x: left + gp * 0.42, y: top + gp * 0.42, score },
    { x: right - gp * 0.42, y: top + gp * 0.42, score },
    { x: left + gp * 0.42, y: bottom - gp * 0.42, score },
    { x: right - gp * 0.42, y: bottom - gp * 0.42, score },
  ];
  return { left, top, side: 2 * bp, rx: Math.min(gp, bp * 0.5), corners, edges, labels };
});
</script>

<template>
  <svg class="arena-svg" :viewBox="`0 0 ${SIZE} ${SIZE}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <!-- 黑鋼碗面：中心微亮 → 邊緣沉黑的放射漸層 -->
      <radialGradient id="as-bowl" cx="50%" cy="45%" r="62%">
        <stop offset="0%" stop-color="#353b46" />
        <stop offset="55%" stop-color="#272c35" />
        <stop offset="85%" stop-color="#1f232b" />
        <stop offset="100%" stop-color="#1a1d24" />
      </radialGradient>
      <radialGradient id="as-shade" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(0,0,0,0)" />
        <stop offset="74%" stop-color="rgba(0,0,0,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.5)" />
      </radialGradient>
      <!-- 加速軌道：熔岩橘能量（白熱 → 琥珀 → 熔岩） -->
      <linearGradient id="as-rail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fff3d6" />
        <stop offset="45%" stop-color="#ffb31f" />
        <stop offset="100%" stop-color="#ff7a18" />
      </linearGradient>
      <filter id="as-railglow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ff7a18" flood-opacity="0.6" />
      </filter>
      <filter id="as-bowlshadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="9" flood-color="#000" flood-opacity="0.45" />
      </filter>
      <!-- 金屬機殼：殼面漸層 + bevel 雙描邊（上亮下暗）+ 鉚釘 -->
      <linearGradient id="as-shell" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#262b34" />
        <stop offset="55%" stop-color="#171a20" />
        <stop offset="100%" stop-color="#0d0f13" />
      </linearGradient>
      <linearGradient id="as-bevel-hi" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4a5260" />
        <stop offset="100%" stop-color="#14161b" />
      </linearGradient>
      <linearGradient id="as-bevel-lo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0a0c10" />
        <stop offset="100%" stop-color="#3a414e" />
      </linearGradient>
      <radialGradient id="as-rivet" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#cfd6e2" />
        <stop offset="45%" stop-color="#8f99a8" />
        <stop offset="100%" stop-color="#3a414e" />
      </radialGradient>
      <!-- 出界口：黃黑警示斜紋 -->
      <pattern id="as-hazard" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="18" height="18" fill="#15171c" />
        <rect width="9" height="18" fill="#ffb31f" />
      </pattern>
    </defs>

    <!-- 外框：金屬機殼（bevel 上亮下暗 + 內框厚邊 + 四角鉚釘） -->
    <rect x="6" y="6" :width="SIZE - 12" :height="SIZE - 12" rx="26" fill="url(#as-shell)" stroke="url(#as-bevel-hi)" stroke-width="2.5" />
    <rect x="11" y="11" :width="SIZE - 22" :height="SIZE - 22" rx="22" fill="none" stroke="url(#as-bevel-lo)" stroke-width="1.5" />
    <rect x="16" y="16" :width="SIZE - 32" :height="SIZE - 32" rx="20" fill="none" stroke="rgba(170,180,196,0.1)" stroke-width="10" />
    <g v-for="(rv, i) in RIVETS" :key="'rv' + i">
      <circle :cx="rv[0]" :cy="rv[1]" r="5" fill="url(#as-rivet)" stroke="rgba(0,0,0,0.55)" stroke-width="1" />
      <circle :cx="rv[0] - 1.6" :cy="rv[1] - 1.6" r="1.4" fill="rgba(255,255,255,0.65)" />
    </g>

    <!-- 方形場 -->
    <g v-if="boxG">
      <clipPath id="as-boxclip">
        <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" />
      </clipPath>
      <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" fill="url(#as-bowl)" filter="url(#as-bowlshadow)" />
      <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" fill="url(#as-shade)" />
      <!-- 拉絲紋：低透明同心細圈（純裝飾） -->
      <g clip-path="url(#as-boxclip)">
        <circle :cx="C" :cy="C" :r="boxG.side * 0.46" fill="none" stroke="rgba(170,180,196,0.1)" stroke-width="1.5" />
        <circle :cx="C" :cy="C" :r="boxG.side * 0.32" fill="none" stroke="rgba(170,180,196,0.08)" stroke-width="1.5" />
        <circle :cx="C" :cy="C" :r="boxG.side * 0.18" fill="none" stroke="rgba(170,180,196,0.07)" stroke-width="1.5" />
      </g>
      <!-- 碗外緣：鋼色描邊 -->
      <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" fill="none" stroke="#7e8a9c" stroke-width="2.5" />

      <!-- 四個角：出界範圍（黃黑警示斜紋 + 細紅描邊保留危險語意） -->
      <polygon v-for="(c, i) in boxG.corners" :key="'c' + i" :points="c" fill="url(#as-hazard)" fill-opacity="0.85" stroke="#e8442e" stroke-width="2" stroke-linejoin="round" />

      <!-- 四邊：會反彈的牆 -->
      <line v-for="(e, i) in boxG.edges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" stroke="#aab4c4" stroke-width="7" stroke-linecap="round" />

      <!-- 熔岩加速軌道（M 形內牆）：頂端凹口，把陀螺往中心擠 -->
      <path v-if="railShape" :d="railShape" fill="none" stroke="url(#as-rail)" :stroke-width="swBandPx" stroke-linejoin="round" stroke-linecap="round" filter="url(#as-railglow)" />

      <!-- 角落計分 -->
      <text
        v-for="(l, i) in boxG.labels"
        :key="'l' + i"
        :x="l.x"
        :y="l.y"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#ffb31f"
        font-size="18"
        font-weight="700"
        font-family="'Big Shoulders Display', 'Noto Sans TC', sans-serif"
      >2×</text><!-- 計分新制：出界一律 2 分（cornerScore 不再參與計分） -->
    </g>

    <!-- 超橢圓場（弧壁）：四邊外凸弧形牆 + 對角出界扇區 -->
    <g v-else-if="superG">
      <path :d="superG.path" fill="url(#as-bowl)" filter="url(#as-bowlshadow)" />
      <path :d="superG.path" fill="url(#as-shade)" />
      <!-- 拉絲紋：低透明同形內圈（純裝飾，邊界路徑等比內縮） -->
      <path :d="superG.path" fill="none" :transform="ringTf(0.82)" stroke="rgba(170,180,196,0.1)" stroke-width="1.5" />
      <path :d="superG.path" fill="none" :transform="ringTf(0.6)" stroke="rgba(170,180,196,0.08)" stroke-width="1.5" />
      <path :d="superG.path" fill="none" :transform="ringTf(0.36)" stroke="rgba(170,180,196,0.07)" stroke-width="1.5" />
      <!-- 碗外緣：鋼色描邊 -->
      <path :d="superG.path" fill="none" stroke="#7e8a9c" stroke-width="3" />

      <!-- 對角出界扇區：黃黑警示斜紋帶 + 細紅描邊 + 計分標籤 -->
      <g v-for="(e, i) in superG.exits" :key="'se' + i">
        <polygon :points="e.pts" fill="url(#as-hazard)" fill-opacity="0.85" stroke="#e8442e" stroke-width="2" stroke-linejoin="round" />
        <text
          v-if="e.score > 1"
          :x="e.lx"
          :y="e.ly"
          text-anchor="middle"
          dominant-baseline="central"
          fill="#ffb31f"
          font-size="18"
          font-weight="700"
          font-family="'Big Shoulders Display', 'Noto Sans TC', sans-serif"
        >2×</text>
      </g>
    </g>

    <!-- 圓形場 -->
    <g v-else-if="circG">
      <circle :cx="C" :cy="C" :r="circG.R" fill="url(#as-bowl)" filter="url(#as-bowlshadow)" />
      <circle :cx="C" :cy="C" :r="circG.R" fill="url(#as-shade)" />
      <!-- 拉絲紋：steel 低透明同心細圈 -->
      <circle :cx="C" :cy="C" :r="circG.R * 0.88" fill="none" stroke="rgba(170,180,196,0.1)" stroke-width="1.5" />
      <circle :cx="C" :cy="C" :r="circG.R * 0.72" fill="none" stroke="rgba(170,180,196,0.09)" stroke-width="1.5" />
      <circle :cx="C" :cy="C" :r="circG.R * 0.45" fill="none" stroke="rgba(170,180,196,0.07)" stroke-width="1.5" />
      <!-- 碗外緣：鋼色描邊 -->
      <circle :cx="C" :cy="C" :r="circG.R" fill="none" stroke="#7e8a9c" stroke-width="3" />

      <!-- 熔岩實體內牆（M 形）：圓形場也能套用（與 box 解耦），吃同一份 sampleSoftWall -->
      <path
        v-if="railShape"
        :d="railShape"
        fill="none"
        stroke="url(#as-rail)"
        :stroke-width="swBandPx"
        stroke-linejoin="round"
        stroke-linecap="round"
        filter="url(#as-railglow)"
      />

      <path
        v-if="circG.railPath"
        :d="circG.railPath"
        fill="none"
        stroke="url(#as-rail)"
        :stroke-width="railG?.w ?? 9"
        stroke-linecap="round"
        filter="url(#as-railglow)"
      />

      <g v-for="(e, i) in circG.exits" :key="i">
        <path
          v-if="e.kind !== 'wall' || e.score > 1"
          :d="arcPath(circG.R, e.a0, e.a1, 0, 1)"
          fill="none"
          :stroke="e.kind === 'break' ? '#e8442e' : '#ffb31f'"
          :stroke-width="e.kind === 'break' ? 12 : 9"
          :stroke-dasharray="e.kind === 'break' ? '7 6' : 'none'"
          stroke-linecap="round"
        />
        <text
          v-if="e.score > 1"
          :x="pt(circG.R - 24, e.mid)[0]"
          :y="pt(circG.R - 24, e.mid)[1]"
          text-anchor="middle"
          dominant-baseline="central"
          :fill="e.kind === 'break' ? '#ff9d8c' : '#ffb31f'"
          font-size="18"
          font-weight="700"
          font-family="'Big Shoulders Display', 'Noto Sans TC', sans-serif"
        >2×</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.arena-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: auto;
  display: block;
  border-radius: 16px;
  pointer-events: none;
  z-index: 0;
}
</style>
