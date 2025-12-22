<template>
  <Teleport to="body">
    <!-- 全局播放器容器 - 支持拖动 -->
    <div
      v-if="store.isVisible && store.hasPlaylist"
      ref="playerRef"
      class="global-player-wrapper"
      :class="{ 'is-mini': isMiniMode, 'dark-theme': isDarkMode }"
      :style="playerStyle"
      @mousedown="handleMouseDown"
      @click="handleClick"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <!-- APlayer 容器 -->
      <div ref="aplayerContainer" class="aplayer-global-container"></div>

      <!-- 自定义 Mini Switcher -->
      <div
        class="custom-mini-switcher"
        @click.stop="toggleMiniMode"
        :title="isMiniMode ? t('mount.audioPreview.expandPlayer') : t('mount.audioPreview.collapsePlayer')"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" :class="{ 'rotated': !isMiniMode }">
          <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
        </svg>
      </div>

      <!-- 关闭按钮 -->
      <div
        class="custom-close-btn"
        @click.stop="handleClose"
        :title="t('mount.audioPreview.closePlayer')"
      >
        <svg viewBox="0 0 24 24" width="10" height="10">
          <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </div>

      <!-- 键盘快捷键提示（hover 时显示） -->
      <div class="keyboard-hints" v-if="!isMiniMode">
        <span>空格: 播放/暂停</span>
        <span>↑↓: 音量</span>
        <span>←→: 快进/快退</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import APlayer from "aplayer";
import "aplayer/dist/APlayer.min.css";
import { useGlobalPlayerStore } from "@/stores/globalPlayerStore.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";

const { t } = useI18n();

// Store
const store = useGlobalPlayerStore();

// 主题
const { isDarkMode } = useThemeMode();

// 播放器引用
const playerRef = ref(null);
const aplayerContainer = ref(null);
const aplayerInstance = ref(null);

// 拖动相关状态
const position = ref({ x: 20, y: 20 });
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const positionStart = ref({ x: 0, y: 0 });

// Mini 模式状态（由 store 控制）
const isMiniMode = computed(() => store.displayMode === "mini");

// 计算播放器样式
const playerStyle = computed(() => ({
  position: 'fixed',
  left: `${position.value.x}px`,
  bottom: `${position.value.y}px`,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'stretch',
}));

// 计算主题色
const getThemeColor = () => {
  return isDarkMode.value ? "#60a5fa" : "#3b82f6";
};

// 生成默认封面
const generateDefaultCover = (name) => {
  const firstChar = (name || "M")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = getThemeColor();
  ctx.fillRect(0, 0, 100, 100);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 50, 50);

  return canvas.toDataURL();
};

// 格式化音频数据为 APlayer 格式
const formatAudioList = (playlist) => {
  return playlist.map((audio) => ({
    name: audio.name || audio.title || t('mount.audioPreview.unknownAudio'),
    artist: audio.artist || t('mount.audioPreview.unknownArtist'),
    url: audio.url,
    cover: audio.cover || audio.poster || generateDefaultCover(audio.name),
    lrc: audio.lrc || audio.lyrics,
    theme: getThemeColor(),
  }));
};

// 初始化 APlayer
const initAPlayer = () => {
  if (!aplayerContainer.value) return;

  // 销毁现有实例
  destroyAPlayer();

  // 检查是否有播放列表
  if (!store.playlist || store.playlist.length === 0) return;

  // 准备音频数据
  const audioData = formatAudioList(store.playlist);

  // APlayer 配置
  const options = {
    container: aplayerContainer.value,
    audio: audioData,
    autoplay: true,
    theme: getThemeColor(),
    loop: store.loopMode,
    order: store.orderMode,
    preload: "metadata",
    volume: store.volume,
    mutex: true,
    mini: isMiniMode.value,
    listFolded: true,
    listMaxHeight: "200px",
    storageName: "cloudpaste-aplayer",
  };

  try {
    aplayerInstance.value = new APlayer(options);

    // 如果有指定的起始索引，切换到该曲目
    if (store.currentIndex > 0 && store.currentIndex < audioData.length) {
      aplayerInstance.value.list.switch(store.currentIndex);
    }

    // 绑定事件
    bindAPlayerEvents();

    // 同步模式配置
    applyDisplayMode(store.displayMode);
    applyLoopMode(store.loopMode);
    applyOrderMode(store.orderMode);

    // 保存实例引用到 store
    store.setAPlayerInstance(aplayerInstance.value);

    // 聚焦播放器以支持键盘操作
    nextTick(() => {
      playerRef.value?.focus();
    });

    console.log("🎵 全局播放器 APlayer 初始化成功");
  } catch (error) {
    console.error("APlayer 初始化失败:", error);
  }
};

// 绑定 APlayer 事件
const bindAPlayerEvents = () => {
  if (!aplayerInstance.value) return;

  const ap = aplayerInstance.value;

  ap.on("play", () => {
    store.syncPlayState(true);
  });

  ap.on("pause", () => {
    store.syncPlayState(false);
  });

  ap.on("timeupdate", () => {
    store.syncProgress(ap.audio.currentTime, ap.audio.duration);
  });

  ap.on("listswitch", (index) => {
    store.syncCurrentIndex(index.index !== undefined ? index.index : index);
  });

  ap.on("error", (error) => {
    console.error("APlayer 播放错误:", error);
  });
};

// 销毁 APlayer
const destroyAPlayer = () => {
  if (aplayerInstance.value) {
    try {
      aplayerInstance.value.destroy();
    } catch (e) {
      console.warn("销毁 APlayer 时出错:", e);
    }
    aplayerInstance.value = null;
    store.setAPlayerInstance(null);
  }
};

// 同步显示模式
const applyDisplayMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.setMode(mode === "mini" ? "mini" : "normal");
};

// 同步循环模式
const applyLoopMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.options.loop = mode;
  aplayerInstance.value.audio.loop = mode === "one";
};

// 同步播放顺序
const applyOrderMode = (mode) => {
  if (!aplayerInstance.value) return;
  aplayerInstance.value.options.order = mode;
};

// 切换 Mini 模式
const toggleMiniMode = () => {
  const nextMode = isMiniMode.value ? "expanded" : "mini";
  store.setDisplayMode(nextMode);
};

// 关闭播放器
const handleClose = () => {
  destroyAPlayer();
  store.closePlayer();
};

// ===== 键盘快捷键 =====
const handleKeydown = (event) => {
  if (!aplayerInstance.value) return;

  const ap = aplayerInstance.value;

  switch (event.key) {
    case ' ':  // 空格 - 播放/暂停
      event.preventDefault();
      ap.toggle();
      break;
    case 'ArrowUp':  // 上箭头 - 增加音量
      event.preventDefault();
      {
        const newVol = Math.min(1, store.volume + 0.1);
        ap.volume(newVol, true);
        store.setVolume(newVol);
      }
      break;
    case 'ArrowDown':  // 下箭头 - 减少音量
      event.preventDefault();
      {
        const newVol = Math.max(0, store.volume - 0.1);
        ap.volume(newVol, true);
        store.setVolume(newVol);
      }
      break;
    case 'ArrowLeft':  // 左箭头 - 快退 5 秒
      event.preventDefault();
      ap.seek(Math.max(0, ap.audio.currentTime - 5));
      break;
    case 'ArrowRight':  // 右箭头 - 快进 5 秒
      event.preventDefault();
      ap.seek(Math.min(ap.audio.duration, ap.audio.currentTime + 5));
      break;
    case 'm':  // M 键 - 静音切换
    case 'M':
      event.preventDefault();
      if (store.volume > 0) {
        ap.volume(0, true);
        store.setVolume(0);
      } else {
        ap.volume(0.7, true);
        store.setVolume(0.7);
      }
      break;
    case 'n':  // N 键 - 下一首
    case 'N':
      event.preventDefault();
      ap.skipForward();
      break;
    case 'p':  // P 键 - 上一首
    case 'P':
      event.preventDefault();
      ap.skipBack();
      break;
    case 'Escape':  // ESC - 收起到 mini 模式
      event.preventDefault();
      if (!isMiniMode.value) {
        toggleMiniMode();
      }
      break;
  }
};

// ===== 拖动功能 =====

// 点击播放器时聚焦
const handleClick = () => {
  playerRef.value?.focus();
};

const handleMouseDown = (event) => {
  if (event.button !== 0) return;

  // 点击播放器时聚焦，以支持键盘操作
  playerRef.value?.focus();

  const target = event.target;
  const isControl = target.closest('.aplayer-icon') ||
                    target.closest('.aplayer-bar-wrap') ||
                    target.closest('.aplayer-list') ||
                    target.closest('.aplayer-volume-wrap') ||
                    target.closest('.custom-mini-switcher') ||
                    target.closest('.custom-close-btn');

  if (isControl) return;

  isDragging.value = true;
  dragStart.value = { x: event.clientX, y: event.clientY };
  positionStart.value = { ...position.value };

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);

  event.preventDefault();
};

const handleMouseMove = (event) => {
  if (!isDragging.value) return;

  const deltaX = event.clientX - dragStart.value.x;
  const deltaY = -(event.clientY - dragStart.value.y);

  const newX = positionStart.value.x + deltaX;
  const newY = positionStart.value.y + deltaY;

  const playerWidth = playerRef.value?.offsetWidth || 400;
  const playerHeight = playerRef.value?.offsetHeight || 66;

  const maxX = window.innerWidth - playerWidth;
  const maxY = window.innerHeight - playerHeight;

  position.value = {
    x: Math.max(0, Math.min(newX, maxX)),
    y: Math.max(0, Math.min(newY, maxY)),
  };
};

const handleMouseUp = () => {
  isDragging.value = false;
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
};

// ===== 监听器 =====

watch(
  () => store.playlist,
  (newPlaylist, oldPlaylist) => {
    if (!newPlaylist || newPlaylist.length === 0 || !store.isVisible) return;
    if (!aplayerInstance.value) {
      nextTick(() => {
        initAPlayer();
      });
      return;
    }
    if (newPlaylist === oldPlaylist) return;
    nextTick(() => {
      initAPlayer();
    });
  }
);

watch(
  () => store.isVisible,
  (visible) => {
    if (visible && store.hasPlaylist) {
      nextTick(() => {
        initAPlayer();
      });
    } else if (!visible) {
      destroyAPlayer();
    }
  }
);

watch(
  () => store.loopMode,
  (newLoop) => {
    applyLoopMode(newLoop);
  }
);

watch(
  () => store.orderMode,
  (newOrder) => {
    applyOrderMode(newOrder);
  }
);

watch(
  () => store.displayMode,
  (mode) => {
    applyDisplayMode(mode);
  }
);

// ===== 生命周期 =====

onMounted(() => {
  if (store.isVisible && store.hasPlaylist) {
    nextTick(() => {
      initAPlayer();
    });
  }
});

onBeforeUnmount(() => {
  destroyAPlayer();
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
});
</script>

<style>
/* ===== 全局播放器容器 ===== */
.global-player-wrapper {
  position: fixed !important;
  user-select: none;
  outline: none !important;
}

/* 播放器阴影和圆角 */
.global-player-wrapper .aplayer {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 2px 0 0 2px;
  margin: 0 !important;
}

/* 展开模式下加宽播放器 */
.global-player-wrapper .aplayer:not(.aplayer-narrow) {
  min-width: 280px;
}

/* Mini 模式下恢复原生宽度 */
.global-player-wrapper .aplayer.aplayer-narrow {
  width: 66px !important;
  min-width: 66px !important;
}

/* ===== 自定义 Mini Switcher ===== */
.custom-mini-switcher {
  width: 18px;
  background: #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  color: #666;
  flex-shrink: 0;
}

.custom-mini-switcher:hover {
  background: #d0d0d0;
}

.custom-mini-switcher svg {
  transition: transform 0.3s;
}

.custom-mini-switcher svg.rotated {
  transform: rotate(180deg);
}

/* ===== 自定义关闭按钮 ===== */
.custom-close-btn {
  width: 18px;
  background: #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  color: #666;
  border-radius: 0 2px 2px 0;
  flex-shrink: 0;
}

.custom-close-btn:hover {
  background: #ff6b6b;
  color: white;
}

/* ===== 键盘快捷键提示 ===== */
.keyboard-hints {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  font-size: 10px;
  padding: 4px 8px;
  display: none;
  gap: 8px;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
}

.global-player-wrapper:focus .keyboard-hints,
.global-player-wrapper:hover .keyboard-hints {
  display: flex;
}

/* ===== 深色模式 ===== */
.global-player-wrapper.dark-theme .aplayer {
  background: #1f2937 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info {
  background: #1f2937 !important;
  border-bottom-color: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-title {
  color: #f9fafb !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-info .aplayer-music .aplayer-author {
  color: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller {
  background: #1f2937 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-time {
  color: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-icon {
  fill: #9ca3af !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-controller .aplayer-icon:hover {
  fill: #f9fafb !important;
}

.global-player-wrapper.dark-theme .custom-mini-switcher {
  background: #374151;
  color: #9ca3af;
}

.global-player-wrapper.dark-theme .custom-mini-switcher:hover {
  background: #4b5563;
  color: #f9fafb;
}

.global-player-wrapper.dark-theme .custom-close-btn {
  background: #374151;
  color: #9ca3af;
}

.global-player-wrapper.dark-theme .custom-close-btn:hover {
  background: #ef4444;
  color: white;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list {
  background: #1f2937 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li {
  color: #d1d5db !important;
  border-bottom-color: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li:hover {
  background: #374151 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light {
  background: #3b82f6 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light .aplayer-list-title,
.global-player-wrapper.dark-theme .aplayer .aplayer-list ol li.aplayer-list-light .aplayer-list-author {
  color: #ffffff !important;
}

.global-player-wrapper.dark-theme .keyboard-hints {
  background: rgba(31, 41, 55, 0.9);
}

/* ===== 主题色 ===== */
.global-player-wrapper .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played {
  background: #3b82f6 !important;
}

.global-player-wrapper .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played .aplayer-thumb {
  background: #3b82f6 !important;
}

.global-player-wrapper .aplayer .aplayer-volume-wrap .aplayer-volume-bar .aplayer-volume {
  background: #3b82f6 !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played {
  background: #60a5fa !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-bar-wrap .aplayer-bar .aplayer-played .aplayer-thumb {
  background: #60a5fa !important;
}

.global-player-wrapper.dark-theme .aplayer .aplayer-volume-wrap .aplayer-volume-bar .aplayer-volume {
  background: #60a5fa !important;
}

/* ===== 拖动时的光标 ===== */
.global-player-wrapper .aplayer .aplayer-pic {
  cursor: move;
}

/* 控制元素保持默认光标 */
.global-player-wrapper .aplayer .aplayer-icon,
.global-player-wrapper .aplayer .aplayer-bar-wrap,
.global-player-wrapper .aplayer .aplayer-volume-wrap,
.global-player-wrapper .aplayer .aplayer-list {
  cursor: pointer;
}
</style>
