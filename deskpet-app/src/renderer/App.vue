<script setup lang="ts">
import DeskpetStage from './components/DeskpetStage.vue'
</script>

<template>
  <DeskpetStage />
</template>

<style>
:root,
:root[data-theme='light'] {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-expo: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.76, 0, 0.24, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --spring-snappy: linear(0, 0.45 8%, 0.91 19%, 1.06 30%, 1.02 44%, 0.995 62%, 1);
  --spring-bouncy: linear(0, 0.39 7%, 0.89 17%, 1.13 27%, 1.05 38%, 0.97 52%, 1.01 68%, 1);
  --spring-gentle: linear(0, 0.34 8%, 0.82 20%, 1.04 33%, 1.01 50%, 1);

  --dp-accent: #c87137;
  --dp-accent-rgb: 200, 113, 55;
  --dp-accent-soft: rgba(var(--dp-accent-rgb), 0.13);
  --dp-accent-fill: rgba(var(--dp-accent-rgb), 0.22);
  --dp-accent-border: rgba(var(--dp-accent-rgb), 0.35);
  --dp-accent-glow: rgba(var(--dp-accent-rgb), 0.28);
  --dp-orb-grad: linear-gradient(135deg, var(--dp-accent) 0%, rgba(var(--dp-accent-rgb), 0.55) 100%);
  --dp-clay: #d8b898;

  /* Porcelain & Oat (Day Mode) */
  --dp-panel-bg: #ffffff;
  --dp-bg: #ffffff;
  --dp-bg-elevated: #f3efea;
  --dp-card-bg: #f3efea;
  --dp-surface: #f3efea;
  --dp-card-hover: #eae4dc;
  --dp-surface-hover: #eae4dc;
  --dp-pill-inner: rgba(255, 255, 255, 0.8);
  --dp-input-bg: rgba(255, 255, 255, 0.82);
  --dp-border: rgba(23, 43, 26, 0.06);
  --dp-border-subtle: rgba(23, 43, 26, 0.04);
  --dp-border-strong: rgba(23, 43, 26, 0.14);
  --dp-text-main: #172b1a;
  --dp-text-primary: #172b1a;
  --dp-text-sub: #5a6b5c;
  --dp-text-secondary: #5a6b5c;
  --dp-text-dim: #7e8c7f;
  --dp-text-muted: #7e8c7f;
  --dp-accent-vivid: var(--dp-accent);
  --dp-accent-text: #ffffff;
  --dp-icon: #263d29;
  --dp-icon-muted: #5a6b5c;
  --dp-bubble-bg: rgba(255, 255, 255, 0.96);
  --dp-bubble-text: #172b1a;
  --dp-shadow:
    0 26px 60px -12px rgba(24, 48, 28, 0.16),
    0 6px 20px -4px rgba(24, 48, 28, 0.08),
    0 0 0 1px rgba(23, 43, 26, 0.06);
  --dp-dock-bg: rgba(255, 255, 255, 0.92);
  --dp-scrollbar: rgba(23, 43, 26, 0.16);
}

:root[data-theme='dark'] {
  /* Clean Deep Matte Dark Mode (no muddy sRGB green mixing) */
  --dp-accent-soft: rgba(var(--dp-accent-rgb), 0.22);
  --dp-accent-fill: rgba(var(--dp-accent-rgb), 0.32);
  --dp-accent-border: rgba(var(--dp-accent-rgb), 0.48);
  --dp-accent-glow: rgba(var(--dp-accent-rgb), 0.34);

  --dp-panel-bg: #161819;
  --dp-bg: #161819;
  --dp-bg-elevated: #202325;
  --dp-card-bg: #202325;
  --dp-surface: #202325;
  --dp-card-hover: #2a2e31;
  --dp-surface-hover: #2a2e31;
  --dp-pill-inner: #2b2f33;
  --dp-input-bg: #121415;
  --dp-border: rgba(255, 255, 255, 0.07);
  --dp-border-subtle: rgba(255, 255, 255, 0.05);
  --dp-border-strong: rgba(255, 255, 255, 0.12);
  --dp-text-main: #f1f5f3;
  --dp-text-primary: #f1f5f3;
  --dp-text-sub: #9ca8a2;
  --dp-text-secondary: #9ca8a2;
  --dp-text-dim: #6f7c76;
  --dp-text-muted: #6f7c76;
  --dp-accent-vivid: #7cd474;
  --dp-accent-text: #ffffff;
  --dp-icon: #e2ebe6;
  --dp-icon-muted: #9ca8a2;
  --dp-bubble-bg: rgba(22, 24, 25, 0.96);
  --dp-bubble-text: #f1f5f3;
  --dp-shadow:
    0 28px 64px -12px rgba(0, 0, 0, 0.62),
    0 0 0 1px rgba(255, 255, 255, 0.07) inset;
  --dp-dock-bg: rgba(22, 24, 25, 0.92);
  --dp-scrollbar: rgba(255, 255, 255, 0.18);
}

html, body {
  background: transparent !important;
  margin: 0;
  padding: 0;
  font-family: "Inter", "Plus Jakarta Sans", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
</style>
