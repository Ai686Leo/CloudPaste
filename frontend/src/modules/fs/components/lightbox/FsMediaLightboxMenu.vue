<template>
  <div v-if="open" class="fs-media-lightbox-menu p-lightbox-menu" :class="darkMode ? 'is-dark' : 'is-light'" :style="menuStyle">
    <div class="action-menu action-menu--lightbox" role="menu" aria-label="更多操作">
      <button class="action-menu__item action-download" type="button" role="menuitem" @click="$emit('download')">
        <span class="action-menu__icon" aria-hidden="true">
          <IconDownload size="md" />
        </span>
        <span class="action-menu__text">下载</span>
        <span class="action-menu__shortcut">Ctrl-D</span>
      </button>

      <button class="action-menu__item action-link" type="button" role="menuitem" @click="$emit('get-link')">
        <span class="action-menu__icon" aria-hidden="true">
          <IconLink size="md" />
        </span>
        <span class="action-menu__text">获取链接</span>
        <span class="action-menu__shortcut">Ctrl-L</span>
      </button>

      <div class="action-menu__divider" role="separator"></div>

      <button class="action-menu__item action-close" type="button" role="menuitem" @click="$emit('close')">
        <span class="action-menu__icon" aria-hidden="true">
          <IconClose size="md" />
        </span>
        <span class="action-menu__text">关闭</span>
        <span class="action-menu__shortcut">Esc</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { IconClose, IconDownload, IconLink } from "@/components/icons";

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
