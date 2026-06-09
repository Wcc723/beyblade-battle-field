<script setup lang="ts">
/**
 * 場地向量圖層（SVG）。
 * 吃「引擎用的同一份場地幾何資料」(radius / rim / rail / box) 來畫，
 * 因此畫面與物理碰撞保證同源一致 —— 調物理數值，畫面自動跟著對。
 * 純展示、不吃指標事件（pointer-events:none），底下墊著、上層 canvas 畫會動的陀螺。
 */
import { computed } from "vue";
import type { ArenaConfig } from "../physics/types";
import { effectiveRim, rimAt, sampleSoftWall } from "../physics/arena";

const props = defineProps<{ arena: ArenaConfig }>();

const SIZE = 640;
const PAD = 28; // 與 BattleViz 的 toCanvas/scaleLen 一致
const C = SIZE / 2; // 320：場地中心

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
 * 綠色軟牆（M 形 Xtreme Line）描繪：吃「引擎用的同一份」softWall r(θ)（sampleSoftWall），
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

/* ---------- 圓形場幾何 ---------- */
const circG = computed(() => {
  if (props.arena.box) return null;
  const R = props.arena.radius * scale.value; // 碗外緣（固定 = 292）
  const exits = effectiveRim(props.arena).map((seg) => {
    const rp = rimAt(props.arena, seg.angle);
    const sa = -seg.angle; // 世界角 θ → SVG 角 -θ（y 軸翻轉）
    return { a0: sa - seg.half, a1: sa + seg.half, mid: sa, kind: rp.kind, score: rp.score };
  });
  // 綠軌：頂端留缺口，呼應實體場 M 形開口
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
      <radialGradient id="as-bowl" cx="50%" cy="45%" r="62%">
        <stop offset="0%" stop-color="#fbfdff" />
        <stop offset="55%" stop-color="#e7edf5" />
        <stop offset="85%" stop-color="#c3cedd" />
        <stop offset="100%" stop-color="#98a5ba" />
      </radialGradient>
      <radialGradient id="as-shade" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(0,0,0,0)" />
        <stop offset="74%" stop-color="rgba(0,0,0,0)" />
        <stop offset="100%" stop-color="rgba(18,28,44,0.4)" />
      </radialGradient>
      <linearGradient id="as-rail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#b6ff7a" />
        <stop offset="45%" stop-color="#46d65e" />
        <stop offset="100%" stop-color="#1d9a3a" />
      </linearGradient>
      <filter id="as-railglow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#46d65e" flood-opacity="0.55" />
      </filter>
      <filter id="as-bowlshadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="9" flood-color="#000" flood-opacity="0.45" />
      </filter>
    </defs>

    <!-- 外框：透明塑膠機殼 -->
    <rect x="6" y="6" :width="SIZE - 12" :height="SIZE - 12" rx="26" fill="#11151c" stroke="#2a3340" stroke-width="2" />
    <rect x="16" y="16" :width="SIZE - 32" :height="SIZE - 32" rx="20" fill="none" stroke="rgba(173,190,214,0.12)" stroke-width="10" />

    <!-- 方形場 -->
    <g v-if="boxG">
      <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" fill="url(#as-bowl)" filter="url(#as-bowlshadow)" />
      <rect :x="boxG.left" :y="boxG.top" :width="boxG.side" :height="boxG.side" :rx="boxG.rx" fill="url(#as-shade)" />

      <!-- 四個角：出界範圍（紅色填滿 + 虛線邊） -->
      <polygon v-for="(c, i) in boxG.corners" :key="'c' + i" :points="c" fill="rgba(255,107,107,0.18)" stroke="#ff6b6b" stroke-width="2.5" stroke-dasharray="7 6" stroke-linejoin="round" />

      <!-- 四邊：會反彈的牆 -->
      <line v-for="(e, i) in boxG.edges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" stroke="#9aa8c4" stroke-width="7" stroke-linecap="round" />

      <!-- 綠色加速軌道（Xtreme Line）：頂端 M 形凹口，把陀螺往中心擠 -->
      <path v-if="railShape" :d="railShape" fill="none" stroke="url(#as-rail)" :stroke-width="swBandPx" stroke-linejoin="round" stroke-linecap="round" filter="url(#as-railglow)" />

      <!-- 角落計分 -->
      <text
        v-for="(l, i) in boxG.labels"
        :key="'l' + i"
        :x="l.x"
        :y="l.y"
        text-anchor="middle"
        dominant-baseline="central"
        fill="#ff9b9b"
        font-size="17"
        font-weight="700"
        font-family="system-ui, sans-serif"
      >{{ l.score }}×</text>
    </g>

    <!-- 圓形場 -->
    <g v-else-if="circG">
      <circle :cx="C" :cy="C" :r="circG.R" fill="url(#as-bowl)" filter="url(#as-bowlshadow)" />
      <circle :cx="C" :cy="C" :r="circG.R" fill="url(#as-shade)" />
      <circle :cx="C" :cy="C" :r="circG.R * 0.72" fill="none" stroke="rgba(120,140,165,0.18)" stroke-width="1.5" />
      <circle :cx="C" :cy="C" :r="circG.R * 0.45" fill="none" stroke="rgba(120,140,165,0.14)" stroke-width="1.5" />
      <circle :cx="C" :cy="C" :r="circG.R" fill="none" stroke="#7d8aa8" stroke-width="3" />

      <!-- 綠色實體內牆（M 形 Xtreme Line）：圓形場也能套用（與 box 解耦），吃同一份 sampleSoftWall -->
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
          :stroke="e.kind === 'break' ? '#ff6b6b' : '#ffd166'"
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
          :fill="e.kind === 'break' ? '#ff8b8b' : '#ffd166'"
          font-size="17"
          font-weight="700"
          font-family="system-ui, sans-serif"
        >{{ e.score }}×</text>
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
