<template>
  <Teleport to="body">
    <!-- 全局播放器容器 - 支持拖动 -->
    <div
      v-if="store.isVisible && store.hasPlaylist"
      ref="playerRef"
      class="global-player-wrapper"
      :class="{ 'is-mini': isMiniMode, 'dark-theme': isDarkMode }"
      :style="playerStyle"
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
import { useDraggable, useWindowSize } from "@vueuse/core";
import { useGlobalPlayerStore } from "@/stores/globalPlayerStore.js";
import { useThemeMode } from "@/composables/core/useThemeMode.js";
import { useFsService } from "@/modules/fs";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();

// Store
const store = useGlobalPlayerStore();
const log = createLogger("GlobalMusicPlayer");
const fsService = useFsService();

// 主题
const { isDarkMode } = useThemeMode();

// 播放器引用
const playerRef = ref(null);
const aplayerContainer = ref(null);
const aplayerInstance = ref(null);

// 默认不需要在首屏就加载。
let APlayerConstructor = null;
let aplayerCssLoaded = false;
let initTaskId = 0;
let suppressNextListSwitch = false;

const ensureAPlayerLoaded = async () => {
  if (APlayerConstructor) return APlayerConstructor;
  const mod = await import("aplayer");
  APlayerConstructor = mod?.default || mod;
  if (!aplayerCssLoaded) {
    await import("aplayer/dist/APlayer.min.css");
    aplayerCssLoaded = true;
  }
  return APlayerConstructor;
};

// 拖动相关状态（VueUse useDraggable）
const initializedDragPosition = ref(false);
const { width: windowWidth, height: windowHeight } = useWindowSize();
const { x, y, style: draggableStyle } = useDraggable(playerRef, {
  initialValue: { x: 20, y: 20 },
  preventDefault: true,
  onStart: (_pos, event) => {
    // 点击播放器时聚焦，以支持键盘操作
    playerRef.value?.focus();

    const target = event?.target;
    const isControl =
      target?.closest?.(".aplayer-icon") ||
      target?.closest?.(".aplayer-bar-wrap") ||
      target?.closest?.(".aplayer-list") ||
      target?.closest?.(".aplayer-volume-wrap") ||
      target?.closest?.(".custom-mini-switcher") ||
      target?.closest?.(".custom-close-btn");

    // 点到控制区不允许拖动（避免误触）
    if (isControl) return false;
  },
});

// Mini 模式状态（由 store 控制）
const isMiniMode = computed(() => store.displayMode === "mini");

// 计算播放器样式
const playerStyle = computed(() => ([
  {
    position: "fixed",
    zIndex: 9999,
    display: "flex",
    alignItems: "stretch",
  },
  draggableStyle.value,
]));

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
    url: audio.url || PLACEHOLDER_AUDIO_URL,
    cover: audio.cover || audio.poster || generateDefaultCover(audio.name),
    lrc: audio.lrc || audio.lyrics,
    theme: getThemeColor(),
    // 透传原始文件信息：用于“切歌时按需获取直链”
    originalFile: audio.originalFile || null,
  }));
};

// ===== “按需获取直链”缓存 =====
const audioUrlCache = new Map();
const audioUrlPending = new Map();

// 用一个“很短的静音 wav”当占位 url：避免 APlayer 遇到空 url 就直接报错/自动跳歌
const PLACEHOLDER_AUDIO_URL =
  "data:audio/wav;base64,UklGRuwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YcgAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

const safePlayAudioEl = (audioEl) => {
  if (!audioEl?.play) return;
  try {
    const p = audioEl.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
      });
    }
  } catch {
    // 忽略同步异常
  }
};

const waitForAPlayerListDomReady = async (ap, { minItems = 1, timeoutMs = 1500 } = {}) => {
  const start = performance.now?.() ?? Date.now();
  // “轮询 + 短等待”是为了等 APlayer 把列表 DOM 插入
  while (true) {
    const now = performance.now?.() ?? Date.now();
    if (now - start > timeoutMs) return false;

    try {
      const items = ap?.container?.querySelectorAll?.(".aplayer-list ol li");
      if (items && items.length >= minItems) return true;
    } catch {
      // 忽略 DOM 探测异常
    }

    // 让出一帧，给 APlayer 自己渲染 DOM
    await new Promise((r) => setTimeout(r, 50));
  }
};

const syncAPlayerAudioUrl = (index, url) => {
  const ap = aplayerInstance.value;
  if (!ap?.list?.audios || typeof index !== "number") return;

  const audio = ap.list.audios[index];
  if (audio) {
    audio.url = url;
  }

  if (ap.list.index === index && ap.audio) {
    try {
      ap.audio.src = url;
      // 恢复 loop 语义：占位时强制 loop=true；真实音频则按 APlayer 配置（loop==='one'）决定
      ap.audio.loop = url === PLACEHOLDER_AUDIO_URL ? true : ap.options?.loop === "one";
      ap.audio.load?.();
    } catch (e) {
      log.warn("同步 audio.src 失败:", e);
    }
  }
};

const ensureTrackUrlReady = async (index, { playAfter = false } = {}) => {
  const track = store.playlist?.[index];
  if (!track) return null;

  const syncUrlAndMaybeResume = (url) => {
    const ap = aplayerInstance.value;
    const wasPlayingBeforeSwap = !!ap?.audio && !ap.audio.paused;

    track.url = url;
    syncAPlayerAudioUrl(index, url);

    const shouldResume = playAfter || wasPlayingBeforeSwap;
    if (!shouldResume) return;
    safePlayAudioEl(ap?.audio);
  };

  // 已有真实 url：直接返回
  if (track.url && track.url !== PLACEHOLDER_AUDIO_URL) {
    if (playAfter) {
      safePlayAudioEl(aplayerInstance.value?.audio);
    }
    return track.url;
  }

  const filePath = track.originalFile?.path;
  if (!filePath) return null;

  if (audioUrlCache.has(filePath)) {
    const cachedUrl = audioUrlCache.get(filePath);
    syncUrlAndMaybeResume(cachedUrl);
    return cachedUrl;
  }

  if (audioUrlPending.has(filePath)) {
    const pending = audioUrlPending.get(filePath);
    const url = await pending;
    if (url) {
      syncUrlAndMaybeResume(url);
    }
    return url;
  }

  const task = (async () => {
    try {
      const url = await fsService.getFileLink(filePath, null, false);
      if (url) audioUrlCache.set(filePath, url);
      return url;
    } catch (error) {
      log.error(`获取音频直链失败: ${filePath}`, error);
      return null;
    }
  })();

  audioUrlPending.set(filePath, task);
  try {
    const url = await task;
    if (url) {
      syncUrlAndMaybeResume(url);
    }
    return url;
  } finally {
    audioUrlPending.delete(filePath);
  }
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
    autoplay: false,
    theme: getThemeColor(),
    loop: store.loopMode,
    order: store.orderMode,
    preload: "metadata",
    volume: store.volume,
    mutex: true,
    mini: isMiniMode.value,
    listFolded: true,
    listMaxHeight: "200px",
    storageName: "cloudpaste-aplayer-global",
  };

  // 动态加载 APlayer
  const taskId = ++initTaskId;
  Promise.resolve()
    .then(async () => {
      const APlayer = await ensureAPlayerLoaded();
      return new APlayer(options);
    })
    .then((ap) => {
      const shouldAbort =
        taskId !== initTaskId || !store.isVisible || !store.hasPlaylist || !aplayerContainer.value || !playerRef.value;
      if (shouldAbort) {
        try {
          ap?.destroy?.();
        } catch {
          // 忽略销毁异常
        }
        return;
      }

      aplayerInstance.value = ap;

      // 绑定事件
      bindAPlayerEvents();

      // 保存实例引用到 store
      store.setAPlayerInstance(aplayerInstance.value);

      // 聚焦播放器以支持键盘操作
      nextTick(() => {
        playerRef.value?.focus();
      });

      log.debug("全局播放器 APlayer 初始化成功");

      // 等 APlayer 列表 DOM 真正就绪后再 switch
      void (async () => {
        await nextTick();
        if (taskId !== initTaskId) return;

        const maxIndex = Math.max(0, (ap?.list?.audios?.length || 1) - 1);
        const idx = Math.min(Math.max(store.currentIndex || 0, 0), maxIndex);

        // 等列表 DOM（至少要有 idx+1 个 li）
        const ok = await waitForAPlayerListDomReady(ap, { minItems: idx + 1, timeoutMs: 2000 });
        if (taskId !== initTaskId) return;

        if (ok && idx > 0) {
          suppressNextListSwitch = true;
          try {
            ap.list.switch(idx);
          } catch {
            // 忽略同步异常（真正的崩溃通常是 APlayer 内部异步触发，这里已经通过 wait 尽量避免）
          }
        }

        // 切到目标曲目后，再按需补齐直链并播放
        void ensureTrackUrlReady(idx, { playAfter: true });
      })();
    })
    .catch((error) => {
      log.error("APlayer 初始化失败:", error);
    });
};

// 避免同一时刻被多处 watch/onMounted 重复触发 init
let initScheduled = false;
const scheduleInitAPlayer = () => {
  if (initScheduled) return;
  initScheduled = true;
  nextTick(() => {
    initScheduled = false;
    initAPlayer();
  });
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
    const resolvedIndex = index && typeof index === "object" && "index" in index ? index.index : index;
    store.syncCurrentIndex(resolvedIndex);

    // 初始化阶段我们会主动 switch 到目标曲目，这一次不需要再触发“按需取直链”
    if (suppressNextListSwitch) {
      suppressNextListSwitch = false;
      return;
    }

    // 切到某一首时再取直链
    const wasPlaying = !!ap?.audio && !ap.audio.paused;

    // 如果切到的是“占位静音”，先强制 loop，避免它瞬间结束→APlayer 自动跳走
    try {
      const currentUrl = ap?.list?.audios?.[resolvedIndex]?.url;
      if (ap?.audio && currentUrl === PLACEHOLDER_AUDIO_URL) {
        ap.audio.loop = true;
      }
    } catch {
      // 忽略
    }

    void ensureTrackUrlReady(resolvedIndex, { playAfter: wasPlaying });
  });

  ap.on("error", (error) => {
    // “按需获取直链”场景：如果当前这首还没拿到 url，APlayer 可能会先抛一次错误，先忽略即可
    try {
      const idx = ap?.list?.index;
      const current = typeof idx === "number" ? ap?.list?.audios?.[idx] : null;
      if (current && (!current.url || current.url === "" || current.url === PLACEHOLDER_AUDIO_URL)) {
        log.debug("正在按需获取音频直链，先忽略一次播放错误");
        return;
      }
    } catch {
      // 忽略探测异常
    }
    log.error("APlayer 播放错误:", error);
  });
};

// 销毁 APlayer
const destroyAPlayer = () => {
  // 任何销毁都视为“取消当前 init 任务”，防止异步 init 回来后又把实例塞回去
  initTaskId++;
  if (aplayerInstance.value) {
    try {
      aplayerInstance.value.destroy();
    } catch (e) {
      log.warn("销毁 APlayer 时出错:", e);
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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const clampInViewport = () => {
  const el = playerRef.value;
  if (!el) return;

  const maxX = Math.max(0, windowWidth.value - (el.offsetWidth || 0));
  const maxY = Math.max(0, windowHeight.value - (el.offsetHeight || 0));

  x.value = clamp(x.value, 0, maxX);
  y.value = clamp(y.value, 0, maxY);
};

const dockToBottomLeftIfNeeded = async () => {
  if (initializedDragPosition.value) return;
  await nextTick();
  const el = playerRef.value;
  if (!el) return;

  x.value = 20;
  y.value = clamp(windowHeight.value - (el.offsetHeight || 0) - 20, 0, windowHeight.value);
  clampInViewport();
  initializedDragPosition.value = true;
};

// ===== 监听器 =====

watch(
  () => store.playlist,
  (newPlaylist, oldPlaylist) => {
    if (!newPlaylist || newPlaylist.length === 0 || !store.isVisible) return;
    if (newPlaylist === oldPlaylist) return;
    scheduleInitAPlayer();
  }
);

watch(
  () => store.isVisible,
  (visible) => {
    if (visible && store.hasPlaylist) {
      scheduleInitAPlayer();
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
    scheduleInitAPlayer();
  }
  void dockToBottomLeftIfNeeded();
});

onBeforeUnmount(() => {
  initTaskId++;
  destroyAPlayer();
});

watch(
  () => store.isVisible,
  async (visible) => {
    if (!visible) return;
    await dockToBottomLeftIfNeeded();
    await nextTick();
    clampInViewport();
  }
);

watch([windowWidth, windowHeight], async () => {
  await nextTick();
  clampInViewport();
});

watch(
  () => store.displayMode,
  async () => {
    await nextTick();
    clampInViewport();
  }
);
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
