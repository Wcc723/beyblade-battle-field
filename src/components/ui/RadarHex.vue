<script setup lang="ts">
// 六維六邊形雷達圖（純 SVG、BURST FORGE 金屬風）。
// 用法：<RadarHex :values="[0.8, 0.4, ...]" :labels="['攻擊', ...]" color="#e8442e" />
// values 為 0~1 六值，第 0 軸在正上方、順時針排列；color 預設琥珀。
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 六維數值（0~1，超界自動夾制） */
    values: number[];
    /** 六個頂點標籤（缺省不畫字） */
    labels?: string[];
    /** 數值多邊形顏色（隊色/琥珀） */
    color?: string;
    /** 渲染寬度 px（高度依 viewBox 比例換算；CSS 可再覆寫） */
    size?: number;
  }>(),
  { labels: () => [], color: "#ffb31f", size: 132 },
);

const CX = 120;
const CY = 106;
const R = 70; // 數值滿格半徑
const LABEL_R = 86; // 頂點標籤半徑

/** 第 i 軸（0=正上方、順時針）半徑 r 的座標 */
function pt(i: number, r: number): { x: number; y: number } {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}
function hexPoints(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const p = pt(i, r);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
}

// 背景網格固定不變（同心 25/50/75/100% 環 + 軸輻線），建構時算一次即可
const rings = [0.25, 0.5, 0.75, 1].map((f) => hexPoints(f * R));
const spokes = Array.from({ length: 6 }, (_, i) => pt(i, R));

// 數值多邊形
const poly = computed(() =>
  Array.from({ length: 6 }, (_, i) => {
    const v = Math.min(1, Math.max(0, props.values[i] ?? 0));
    const p = pt(i, v * R);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" "),
);

// 頂點標籤：上下置中、左右側外推錨點，避免文字壓到圖
const ANCHORS = ["middle", "start", "start", "middle", "end", "end"] as const;
const labelPts = computed(() =>
  Array.from({ length: 6 }, (_, i) => {
    const p = pt(i, LABEL_R);
    const anchor = ANCHORS[i];
    const dx = anchor === "start" ? 2 : anchor === "end" ? -2 : 0;
    return { x: p.x + dx, y: p.y, anchor, text: props.labels[i] ?? "" };
  }),
);
</script>

<template>
  <svg
    class="radar"
    :width="size"
    :height="Math.round((size * 208) / 240)"
    viewBox="0 0 240 208"
    aria-hidden="true"
  >
    <!-- 背景：同心六邊形網格（鋼灰細線）+ 軸輻線 -->
    <polygon
      v-for="(r, i) in rings"
      :key="'r' + i"
      :points="r"
      class="ring"
      :class="{ outer: i === rings.length - 1 }"
    />
    <line v-for="(p, i) in spokes" :key="'s' + i" :x1="CX" :y1="CY" :x2="p.x" :y2="p.y" class="spoke" />
    <!-- 數值多邊形（半透明填充 + 描邊） -->
    <polygon
      :points="poly"
      :fill="color"
      fill-opacity="0.24"
      :stroke="color"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
    <!-- 頂點標籤 -->
    <text v-for="(l, i) in labelPts" :key="'t' + i" :x="l.x" :y="l.y" :text-anchor="l.anchor" class="lbl">
      {{ l.text }}
    </text>
  </svg>
</template>

<style scoped>
.radar {
  display: block;
}
.ring {
  fill: none;
  stroke: #313845;
  stroke-width: 1;
}
.ring.outer {
  stroke: #444c5b;
  stroke-width: 1.2;
}
.spoke {
  stroke: #2a303b;
  stroke-width: 1;
}
.lbl {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  fill: var(--muted, #8c96a8);
  dominant-baseline: middle;
}
</style>
