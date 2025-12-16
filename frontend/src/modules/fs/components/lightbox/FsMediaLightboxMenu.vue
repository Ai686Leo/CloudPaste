<template>
  <div v-if="open" class="fs-media-lightbox-menu p-lightbox-menu" :class="darkMode ? 'is-dark' : 'is-light'" :style="menuStyle">
    <div class="action-menu action-menu--lightbox" role="menu" aria-label="更多操作">
      <button class="action-menu__item action-download" type="button" role="menuitem" @click="$emit('download')">
        <span class="action-menu__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 20h14v-2H5v2zm7-18l-5 5h3v6h4V7h3l-5-5z"></path>
          </svg>
        </span>
        <span class="action-menu__text">下载</span>
        <span class="action-menu__shortcut">Ctrl-D</span>
      </button>

      <button class="action-menu__item action-link" type="button" role="menuitem" @click="$emit('get-link')">
        <span class="action-menu__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4v-2H7c-2.83 0-5.1 2.27-5.1 5.1S4.17 17.1 7 17.1h4v-2H7c-1.71 0-3.1-1.39-3.1-3.1zm5.1 1h6v-2H9v2zm8-6.1h-4v2h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4v2h4c2.83 0 5.1-2.27 5.1-5.1s-2.27-5.1-5.1-5.1z"
            ></path>
          </svg>
        </span>
        <span class="action-menu__text">获取链接</span>
        <span class="action-menu__shortcut">Ctrl-L</span>
      </button>

      <div class="action-menu__divider" role="separator"></div>

      <button class="action-menu__item action-close" type="button" role="menuitem" @click="$emit('close')">
        <span class="action-menu__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
          </svg>
        </span>
        <span class="action-menu__text">关闭</span>
        <span class="action-menu__shortcut">Esc</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  darkMode: { type: Boolean, default: false },
  anchorEl: { type: Object, default: null }, // HTMLElement | null
});

defineEmits(["download", "get-link", "close"]);

const viewportTick = ref(0);

const clamp = (n, min, max) => {
  return Math.max(min, Math.min(max, n));
};

const menuStyle = computed(() => {
  // 触发响应式更新（resize/scroll）
  void viewportTick.value;

  // 默认位置（无锚点时保持旧行为）
  const fallback = { position: "fixed", top: "56px", right: "12px" };

  const el = props.anchorEl;
  if (!props.open || !el || typeof el.getBoundingClientRect !== "function") return fallback;

  const rect = el.getBoundingClientRect();
  const right = clamp(Math.round(window.innerWidth - rect.right - 6), 12, Math.max(12, window.innerWidth - 12));
  const top = clamp(Math.round(rect.bottom + 8), 12, Math.max(12, window.innerHeight - 12));

  return {
    position: "fixed",
    top: `${top}px`,
    right: `${right}px`,
  };
});

const bump = () => {
  viewportTick.value += 1;
};

watch(
  () => props.open,
  (v) => {
    if (v) bump();
  }
);

onMounted(() => {
  window.addEventListener("resize", bump, { passive: true });
  window.addEventListener("scroll", bump, { passive: true, capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", bump);
  window.removeEventListener("scroll", bump, true);
});
</script>
