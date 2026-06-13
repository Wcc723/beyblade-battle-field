<script setup lang="ts">
// 共用圖示元件（BURST FORGE 設計系統）
// 用法：<BbIcon name="lightning" :size="16" />，currentColor 上色。
// 名單（見 ICONS）；自繪簡潔幾何，viewBox 0 0 16 16。
import { computed } from "vue";

const props = withDefaults(defineProps<{ name: string; size?: number }>(), {
  size: 16,
});

// 線稿共用屬性（描邊 1.5、圓端點）；實心圖示直接吃 svg 根的 fill="currentColor"
const S =
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const ICONS: Record<string, string> = {
  person: `<g ${S}><circle cx="8" cy="5.2" r="2.7"/><path d="M2.9 13.4c.5-2.9 2.6-4.4 5.1-4.4s4.6 1.5 5.1 4.4"/></g>`,
  "person-circle": `<g ${S}><circle cx="8" cy="8" r="6.4"/><circle cx="8" cy="6.4" r="2.1"/><path d="M4.3 12.8c.6-2.1 2-3.2 3.7-3.2s3.1 1.1 3.7 3.2"/></g>`,
  people: `<g ${S}><circle cx="5.9" cy="5.6" r="2.3"/><path d="M1.7 13.1c.4-2.5 2-3.8 4.2-3.8s3.8 1.3 4.2 3.8"/><circle cx="11.7" cy="6.1" r="1.8"/><path d="M11.9 9.9c1.6.4 2.5 1.5 2.7 3.2"/></g>`,
  lightning: `<path d="M8.9 1.3 3.7 8.9h3.5L6.1 14.7l5.6-7.6H8.1l.8-5.8z"/>`,
  trophy: `<g ${S}><path d="M5.2 2h5.6v3.8a2.8 2.8 0 0 1-5.6 0V2z"/><path d="M5.2 2.8h-2v.9c0 1.3.8 2.1 1.9 2.3M10.8 2.8h2v.9c0 1.3-.8 2.1-1.9 2.3"/><path d="M8 8.6v2.2M5.9 11h4.2M4.9 13.4h6.2"/></g>`,
  gear: `<g ${S}><circle cx="8" cy="8" r="2.2"/><path d="M8 2.4v1.7M8 11.9v1.7M2.4 8h1.7M11.9 8h1.7M4 4l1.2 1.2M10.8 10.8 12 12M12 4l-1.2 1.2M5.2 10.8 4 12"/></g>`,
  controller: `<g ${S}><path d="M5.1 4.9h5.8c1.9 0 3.2 1.5 3.2 3.4 0 1.5-1 2.7-2.3 2.7-.8 0-1.5-.4-1.9-1.1l-.5-.8H6.6l-.5.8c-.4.7-1.1 1.1-1.9 1.1-1.3 0-2.3-1.2-2.3-2.7 0-1.9 1.3-3.4 3.2-3.4z"/><path d="M5.5 6.8v2M4.5 7.8h2"/><circle cx="10.4" cy="8.6" r=".7" fill="currentColor" stroke="none"/><circle cx="11.7" cy="6.9" r=".7" fill="currentColor" stroke="none"/></g>`,
  "door-open": `<g ${S}><path d="M10.2 1.8 5.6 2.9v10.2l4.6 1.1V1.8z"/><path d="M10.2 3.2h2.4v9.6h-2.4"/><path d="M3 13.9h2.6"/><circle cx="8.7" cy="8" r=".7" fill="currentColor" stroke="none"/></g>`,
  copy: `<g ${S}><rect x="5.6" y="5.6" width="7.6" height="7.6" rx="1.1"/><path d="M3.9 10.4h-.7c-.7 0-1.2-.5-1.2-1.2V4c0-.7.5-1.2 1.2-1.2h5.2c.7 0 1.2.5 1.2 1.2v.7"/></g>`,
  "volume-up": `<g ${S}><path d="M2.2 6.2v3.6h2.2l3.1 2.5V3.7L4.4 6.2H2.2z"/><path d="M9.8 6.1a2.9 2.9 0 0 1 0 3.8M11.7 4.4a5.4 5.4 0 0 1 0 7.2"/></g>`,
  "volume-mute": `<g ${S}><path d="M2.2 6.2v3.6h2.2l3.1 2.5V3.7L4.4 6.2H2.2z"/><path d="M10.2 6.3l3.4 3.4M13.6 6.3l-3.4 3.4"/></g>`,
  music: `<g ${S}><circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="10" r="2"/><path d="M6.5 11.5V4l7-1.5V10"/></g>`,
  "music-mute": `<g ${S}><circle cx="4.5" cy="11.5" r="2"/><path d="M6.5 11.5V4l7-1.5V6"/><path d="M10.8 12.2l4-4"/></g>`,
  play: `<path d="M4.8 2.9v10.2c0 .5.5.8.9.5l8-5.1c.4-.3.4-.8 0-1l-8-5.1c-.4-.3-.9 0-.9.5z"/>`,
  pause: `<rect x="4.2" y="3" width="2.6" height="10" rx=".8"/><rect x="9.2" y="3" width="2.6" height="10" rx=".8"/>`,
  "arrow-repeat": `<g ${S}><path d="M2.8 6.5a5.4 5.4 0 0 1 10.2-1.1"/><path d="M13.4 2.5l-.3 3.1-3.1-.3"/><path d="M13.2 9.5A5.4 5.4 0 0 1 3 10.6"/><path d="M2.6 13.5l.3-3.1 3.1.3"/></g>`,
  "arrow-right": `<g ${S}><path d="M2.5 8h10.6"/><path d="M9.6 4.5 13.1 8l-3.5 3.5"/></g>`,
  "arrow-clockwise": `<g ${S}><path d="M12.7 5.8A5.2 5.2 0 1 0 13.2 8.7"/><path d="M12.9 2.8v3.1H9.8"/></g>`,
  "arrow-counterclockwise": `<g ${S}><path d="M3.3 5.8A5.2 5.2 0 1 1 2.8 8.7"/><path d="M3.1 2.8v3.1h3.1"/></g>`,
  "box-arrow-right": `<g ${S}><path d="M10.4 5.3V3.6c0-.7-.5-1.2-1.2-1.2H3.9c-.7 0-1.2.5-1.2 1.2v8.8c0 .7.5 1.2 1.2 1.2h5.3c.7 0 1.2-.5 1.2-1.2v-1.7"/><path d="M6.4 8h7.2M11.2 5.6 13.6 8l-2.4 2.4"/></g>`,
  wifi: `<g ${S}><path d="M1.7 6.7a9.4 9.4 0 0 1 12.6 0"/><path d="M3.8 9a6.3 6.3 0 0 1 8.4 0"/><path d="M5.9 11.2a3.2 3.2 0 0 1 4.2 0"/><circle cx="8" cy="13.2" r="1" fill="currentColor" stroke="none"/></g>`,
  plus: `<g ${S}><path d="M8 3.2v9.6M3.2 8h9.6"/></g>`,
  check: `<g ${S}><path d="M2.8 8.6l3.3 3.3 7.1-7.6"/></g>`,
  x: `<g ${S}><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></g>`,
  crosshair: `<g ${S}><circle cx="8" cy="8" r="4.4"/><path d="M8 1.4v2.4M8 12.2v2.4M1.4 8h2.4M12.2 8h2.4"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/></g>`,
  hourglass: `<g ${S}><path d="M4.2 2.2h7.6M4.2 13.8h7.6"/><path d="M5.2 2.2v2c0 1.9 2.8 2.5 2.8 3.8 0 1.3-2.8 1.9-2.8 3.8v2M10.8 2.2v2c0 1.9-2.8 2.5-2.8 3.8 0 1.3 2.8 1.9 2.8 3.8v2"/></g>`,
  house: `<g ${S}><path d="M2.6 7.6 8 2.8l5.4 4.8v5.6c0 .5-.4.9-.9.9H3.5c-.5 0-.9-.4-.9-.9V7.6z"/><path d="M6.4 14v-3.6h3.2V14"/></g>`,
  shield: `<g ${S}><path d="M8 1.7 13 3.3v4.2c0 3.3-2.1 5.4-5 6.7-2.9-1.3-5-3.4-5-6.7V3.3L8 1.7z"/></g>`,
  floppy: `<g ${S}><path d="M2.5 3.8c0-.7.6-1.3 1.3-1.3h7.3l2.4 2.4v7.3c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3V3.8z"/><path d="M5 2.6v3h5.4v-3"/><path d="M4.8 13.4V9h6.4v4.4"/></g>`,
  trash: `<g ${S}><path d="M2.6 4.3h10.8"/><path d="M5.4 4.2V3.1c0-.5.4-.9.9-.9h3.4c.5 0 .9.4.9.9v1.1"/><path d="M4.1 4.5l.7 8.3c0 .5.5 1 1 1h4.4c.5 0 1-.5 1-1l.7-8.3"/><path d="M6.5 6.9v4.2M9.5 6.9v4.2"/></g>`,
  eye: `<g ${S}><path d="M1.7 8S4.1 3.8 8 3.8 14.3 8 14.3 8 11.9 12.2 8 12.2 1.7 8 1.7 8z"/><circle cx="8" cy="8" r="1.9"/></g>`,
  google: `<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M13.4 8A5.4 5.4 0 1 1 11.9 4.1"/><path d="M13.4 8H8.3"/></g>`,
};

const body = computed(() => ICONS[props.name] ?? "");
</script>

<template>
  <svg
    class="bb-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    v-html="body"
  />
</template>

<style scoped>
.bb-icon {
  display: inline-block;
  vertical-align: -0.125em;
  flex: none;
}
</style>
