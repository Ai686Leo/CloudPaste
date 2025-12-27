<template>
  <div class="external-player-dock w-full flex justify-center px-2 sm:px-4 pb-2 pt-1">
    <!-- Dock Container: 移动端横向滚动，桌面端 Dock 效果 -->
    <div
      class="dock-container flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-200/40 dark:bg-black/40 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-xl sm:rounded-2xl shadow-xl transition-all duration-300 overflow-x-auto sm:overflow-visible scrollbar-hide max-w-full"
    >
      <div
        v-for="(player, index) in platformPlayers"
        :key="player.name"
        @mouseenter="showTooltip(index, $event)"
        @mouseleave="hideTooltip"
        class="dock-item group relative flex flex-col items-center justify-end cursor-pointer transition-all duration-200 ease-out origin-bottom flex-shrink-0"
      >
        <!-- Icon Box -->
        <div
          class="dock-icon w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center bg-white/80 dark:bg-gray-800/80 border border-white/20 dark:border-gray-700 rounded-lg sm:rounded-xl shadow-md transition-all duration-200 overflow-hidden"
        >
          <a
            v-if="player.icon"
            :href="buildExternalPlayerUrl(player)"
            class="block w-full h-full"
            :title="player.name"
          >
            <img
              :src="`/images/${player.icon}.webp`"
              :alt="player.name"
              class="w-full h-full object-contain p-0.5 sm:p-1"
            />
          </a>
          <span v-else class="text-[10px] font-bold text-gray-500 dark:text-gray-300 uppercase">
            {{ player.name.substring(0, 2) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Tooltip 使用 Teleport 渲染到 body（移动端隐藏） -->
    <Teleport to="body">
      <Transition name="tooltip-fade">
        <div
          v-if="activeTooltip !== null"
          class="fixed px-2 py-1 bg-black/80 text-white text-[10px] rounded pointer-events-none whitespace-nowrap backdrop-blur-sm z-[9999] hidden sm:block"
          :style="tooltipStyle"
        >
          {{ platformPlayers[activeTooltip]?.name }}
          <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black/80"></div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* 隐藏滚动条但保留滚动功能 */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Mac Dock Effect - 仅在桌面端生效 */
@media (min-width: 640px) {
  .dock-item {
    transform: translateY(0) scale(1);
    will-change: transform, margin;
  }

  /* Hovered Item (Center) */
  .dock-container:hover .dock-item:hover {
    transform: translateY(-10px) scale(1.5);
    margin: 0 10px;
    z-index: 10;
  }

  /* Immediate Neighbors */
  .dock-container .dock-item:hover + .dock-item,
  .dock-container .dock-item:has(+ .dock-item:hover) {
    transform: translateY(-5px) scale(1.25);
    margin: 0 5px;
    z-index: 5;
  }

  /* Dimming non-hovered items */
  .dock-container:hover .dock-item:not(:hover):not(:has(+ .dock-item:hover)):not(.dock-item:hover + .dock-item) {
    opacity: 0.8;
    transform: scale(0.95);
  }
}

/* 移动端：禁用 Dock 放大效果，保持简洁 */
@media (max-width: 639px) {
  .dock-item {
    transform: none !important;
    margin: 0 !important;
  }

  .dock-item:active .dock-icon {
    transform: scale(0.9);
    opacity: 0.7;
  }
}

.dock-icon {
  backface-visibility: hidden;
}

/* Tooltip fade transition */
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}
</style>

<script setup>
import { ref, reactive, computed } from "vue";

const props = defineProps({
  videoUrl: {
    type: String,
    required: true,
  },
  fileName: {
    type: String,
    default: "video",
  },
});

// Tooltip state
const activeTooltip = ref(null);
const tooltipStyle = reactive({
  top: "0px",
  left: "0px",
});

const showTooltip = (index, event) => {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();

  // 计算 tooltip 位置：在图标上方居中
  tooltipStyle.top = `${rect.top - 32}px`;
  tooltipStyle.left = `${rect.left + rect.width / 2}px`;
  tooltipStyle.transform = "translateX(-50%)";

  activeTooltip.value = index;
};

const hideTooltip = () => {
  activeTooltip.value = null;
};

// External Players Configuration
const externalPlayersConfig = [
  { name: "IINA", icon: "iina", scheme: "iina://weblink?url=$edurl", platforms: ["MacOS"] },
  { name: "PotPlayer", icon: "potplayer", scheme: "potplayer:$durl", platforms: ["Windows"] },
  { name: "VLC", icon: "vlc", scheme: "vlc:$durl", platforms: ["Windows", "MacOS", "Linux", "Android", "iOS"] },
  { name: "nPlayer", icon: "nplayer", scheme: "nplayer-$durl", platforms: ["Android", "iOS"] },
  { name: "Infuse", icon: "infuse", scheme: "infuse://x-callback-url/play?url=$durl", platforms: ["MacOS", "iOS"] },
  { name: "Fig Player", icon: "figplayer", scheme: "figplayer://weblink?url=$durl", platforms: ["MacOS"] },
  { name: "MX Player", icon: "mxplayer", scheme: "intent:$durl#Intent;package=com.mxtech.videoplayer.ad;S.title=$name;end", platforms: ["Android"] },
  { name: "MX Player Pro", icon: "mxplayer-pro", scheme: "intent:$durl#Intent;package=com.mxtech.videoplayer.pro;S.title=$name;end", platforms: ["Android"] },
];

const platformPlayers = computed(() => {
  // 全部显示，不做平台限制
  return externalPlayersConfig;
});

const buildExternalPlayerUrl = (player) => {
  if (!props.videoUrl) return "#";
  const durl = encodeURI(props.videoUrl);
  const edurl = encodeURIComponent(props.videoUrl);
  const name = encodeURIComponent(props.fileName || "video");

  return String(player.scheme || "")
    .replace("$durl", durl)
    .replace("$edurl", edurl)
    .replace("$url", durl)
    .replace("$name", name);
};
</script>
