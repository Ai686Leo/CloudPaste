<template>
  <div ref="previewContainerRef" class="video-preview-wrapper relative flex flex-col w-full h-full group">
    <!-- 主播放区域容器 (Video Box) -->
    <div class="video-box relative flex-1 min-h-0 w-full bg-gray-50 dark:bg-gray-900 rounded-xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-800">
      <div class="relative w-full h-full bg-black">
      <VideoPlayer
        ref="videoPlayerRef"
        v-if="videoUrl && videoData"
        :video="videoData"
        :dark-mode="darkMode"
        :is-fullscreen="isFullscreen"
        :autoplay="false"
        :volume="0.7"
        :muted="false"
        :loop="false"
        :show-fullscreen-control="false"
        :custom-controls="playerControls"
        class="w-full h-full"
        @play="handlePlay"
        @pause="handlePause"
        @error="handleError"
        @canplay="handleCanPlay"
        @ended="handleVideoEnded"
        @timeupdate="handleTimeUpdate"
        @fullscreen="handleFullscreen"
        @fullscreenExit="handleFullscreenExit"
        @ready="handlePlayerReady"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <LoadingIndicator
          :text="$t('mount.videoPreview.loadingVideo')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>

      <!-- 右侧玻璃拟态播放列表抽屉 -->
      <transition name="slide-fade">
        <div
          v-show="isPlaylistOpen"
          class="absolute right-0 top-0 bottom-0 w-full sm:w-80 max-w-[85vw] z-20 flex flex-col bg-gray-100/80 dark:bg-gray-900/80 backdrop-blur-xl border-l border-gray-200/50 dark:border-gray-700/50 shadow-2xl"
        >
          <!-- 列表头部 -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50">
            <h3 class="text-gray-800 dark:text-white font-medium text-sm tracking-wide">
              {{ $t('mount.videoPreview.playlist') }} ({{ videoItemsInOrder.length }})
            </h3>
            <button
              @click="isPlaylistOpen = false"
              class="p-1.5 rounded-full hover:bg-gray-200/50 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>

          <!-- 列表内容 -->
          <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            <div
              v-for="item in videoItemsInOrder"
              :key="item.path"
              @click="goToVideoItem(item)"
              class="group/item flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 border border-transparent"
              :class="[
                isCurrentVideo(item)
                  ? 'bg-primary-500/20 border-primary-500/30 text-primary-600 dark:text-primary-400'
                  : 'hover:bg-gray-200/50 dark:hover:bg-white/5 hover:border-gray-300/50 dark:hover:border-white/10 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              ]"
            >
              <!-- 播放状态/序号 -->
              <div class="flex-shrink-0 w-6 flex justify-center">
                <div v-if="isCurrentVideo(item) && isPlaying" class="playing-equalizer">
                  <span class="bar"></span><span class="bar"></span><span class="bar"></span>
                </div>
                <svg v-else-if="isCurrentVideo(item)" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                <span v-else class="text-xs font-mono opacity-50">{{ getVideoIndex(item) + 1 }}</span>
              </div>
              
              <!-- 文件名 -->
              <span class="text-xs font-medium truncate flex-1 leading-relaxed">
                {{ item.name }}
              </span>
            </div>
          </div>
        </div>
      </transition>

      <!-- 播放列表开关按钮 (当列表关闭时显示) -->
      <button
        v-show="!isPlaylistOpen && videoItemsInOrder.length > 1"
        @click="isPlaylistOpen = true"
        class="absolute right-3 top-3 flex items-center gap-1.5 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white px-2.5 py-1.5 rounded-lg transition-all duration-200 z-10 border border-white/10 hover:border-white/20 shadow-lg opacity-70 hover:opacity-100"
        :title="$t('mount.videoPreview.showPlaylist')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        <span class="text-xs font-medium">{{ videoItemsInOrder.length }}</span>
      </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch, inject } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener, useWindowScroll } from "@vueuse/core";
import VideoPlayer from "@/components/common/VideoPlayer.vue";
import { useFsService } from "@/modules/fs";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("FsVideoPreview");
const fsService = useFsService();
const navigateToFile = inject("navigateToFile", null);
const previewContainerRef = ref(null);
const { y: windowScrollY } = useWindowScroll();

// Props 定义
const props = defineProps({
  file: { type: Object, required: true },
  videoUrl: { type: String, default: null },
  darkMode: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  // 全屏状态由父容器统一管理（挂载浏览页的工具栏全屏/播放器按钮共用同一个开关）
  isFullscreen: { type: Boolean, default: false },
  currentPath: { type: String, default: "" },
  directoryItems: { type: Array, default: () => [] },
});

// Emits 定义
const emit = defineEmits(["play", "pause", "error", "canplay", "loaded", "fullscreen", "fullscreenExit", "toggle-fullscreen"]);

// 响应式数据
const videoPlayerRef = ref(null);
const isPlaying = ref(false);
const originalTitle = ref("");
const currentTime = ref(0);
const duration = ref(0);
const isPlaylistOpen = ref(false);

// 当前视频数据
const currentVideoData = ref(null);
const isHLSVideo = ref(false);
const isPreparingHls = ref(false);
const videoData = computed(() => currentVideoData.value);

// ===== 目录列表兜底=====
const resolvedDirectoryItems = ref([]);
const isResolvingDirectory = ref(false);
let resolveDirectorySeq = 0;
const lastResolvedDirPath = ref("");
let resolvingDirectoryPromise = null;

const getParentDirFromFilePath = (p) => {
  const raw = String(p || "").trim();
  if (!raw) return "/";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
};

const getEffectiveDirPath = () => {
  // 1) 优先用父组件传的 currentPath
  const fromProp = normalizeDirPath(props.currentPath || "");
  if (fromProp && fromProp !== "/") return fromProp;
  // 2) 兜底：从 file.path 推父目录
  const fromFile = getParentDirFromFilePath(props.file?.path);
  return normalizeDirPath(fromFile || "/");
};

const getEffectiveDirectoryItems = () => {
  const passed = Array.isArray(props.directoryItems) ? props.directoryItems : [];
  if (passed.length) return passed;
  const cached = Array.isArray(resolvedDirectoryItems.value) ? resolvedDirectoryItems.value : [];
  return cached;
};

const ensureDirectoryItemsLoaded = async ({ refresh = false } = {}) => {
  const passed = Array.isArray(props.directoryItems) ? props.directoryItems : [];
  if (passed.length) return;

  const dirPath = getEffectiveDirPath();
  if (!dirPath) return;
  // 目录变了：清空旧缓存，避免短暂展示“上一层目录的播放列表”
  if (lastResolvedDirPath.value !== dirPath) {
    lastResolvedDirPath.value = dirPath;
    resolvedDirectoryItems.value = [];
  }

  if (resolvingDirectoryPromise) {
    await resolvingDirectoryPromise;
    return;
  }

  const seq = ++resolveDirectorySeq;
  isResolvingDirectory.value = true;
  resolvingDirectoryPromise = (async () => {
    try {
      const data = await fsService.getDirectoryList(dirPath, { refresh });
      if (seq !== resolveDirectorySeq) return;
      resolvedDirectoryItems.value = Array.isArray(data?.items) ? data.items : [];
    } catch {
      if (seq !== resolveDirectorySeq) return;
      resolvedDirectoryItems.value = [];
    } finally {
      // 只有“当前这次”才负责把状态收尾
      if (seq === resolveDirectorySeq) {
        isResolvingDirectory.value = false;
      }
      if (resolvingDirectoryPromise) {
        resolvingDirectoryPromise = null;
      }
    }
  })();

  await resolvingDirectoryPromise;
};

// ===== 播放列表与导航逻辑 =====
const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "flv", "ts", "m2ts", "m3u8"]);
const isVideoItem = (it) => {
  if (!it || it.isDirectory) return false;
  const ext = getExtLower(it.name);
  if (VIDEO_EXTS.has(ext)) return true;
  const mt = String(it.mimetype || it.mimeType || "").toLowerCase();
  return mt.startsWith("video/") || mt.includes("mpegurl");
};

const videoItemsInOrder = computed(() => {
  const items = getEffectiveDirectoryItems();
  // 统一做“自然排序”，避免后端返回顺序不稳定导致“上集/下集”乱跳
  return items
    .filter(isVideoItem)
    .slice()
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" }));
});

const isCurrentVideo = (item) => {
  return (props.file?.path && item.path === props.file.path) || 
         (props.file?.name && item.name === props.file.name);
};

const getVideoIndex = (item) => {
  return videoItemsInOrder.value.indexOf(item);
};

const prevVideoItem = computed(() => {
  const all = videoItemsInOrder.value;
  const idx = all.findIndex(isCurrentVideo);
  if (idx <= 0) return null;
  return all[idx - 1];
});

const nextVideoItem = computed(() => {
  const all = videoItemsInOrder.value;
  const idx = all.findIndex(isCurrentVideo);
  if (idx < 0 || idx >= all.length - 1) return null;
  return all[idx + 1];
});

const goToVideoItem = (it) => {
  if (!it) return;
  const path = String(it.path || "");
  if (!path) return;
  if (typeof navigateToFile === "function") {
    try {
      void navigateToFile(path);
      windowScrollY.value = 0;
    } catch (e) { log.error(e); }
  }
};

// Controls
const controlSvgPrev = '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M20 5v14l-8 -7z" stroke-width="0" fill="currentColor"></path><path d="M11 5v14l-8 -7z" stroke-width="0" fill="currentColor"></path></svg>';
const controlSvgNext = '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M4 5v14l8 -7z" stroke-width="0" fill="currentColor"></path><path d="M13 5v14l8 -7z" stroke-width="0" fill="currentColor"></path></svg>';
const controlSvgFullscreen = '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
const controlSvgFullscreenExit = '<svg xmlns="http://www.w3.org/2000/svg" height="22" width="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5z"/></svg>';

const playerControls = computed(() => {
  const controls = [];
  // 仅在列表关闭时或全屏时显示底部栏控制
  if (prevVideoItem.value) {
    controls.push({
      name: "prev-video",
      index: 10,
      position: "left",
      html: controlSvgPrev,
      tooltip: t("mount.videoPreview.prevVideo"),
      click: () => goToVideoItem(prevVideoItem.value),
    });
  }
  if (nextVideoItem.value) {
    controls.push({
      name: "next-video",
      index: 11,
      position: "left",
      html: controlSvgNext,
      tooltip: t("mount.videoPreview.nextVideo"),
      click: () => goToVideoItem(nextVideoItem.value),
    });
  }

  // 自定义全屏按钮
  controls.push({
    name: "fullscreen-custom",
    index: 100, // 放在最右侧
    position: "right",
    html: props.isFullscreen ? controlSvgFullscreenExit : controlSvgFullscreen,
    tooltip: props.isFullscreen ? "Exit Fullscreen" : "Fullscreen",
    click: () => emit("toggle-fullscreen"),
  });
  
  return controls;
});

// ===== 外部播放器逻辑 (Arouse) =====



// ===== 基础工具函数 =====
const getExtLower = (name) => {
  const n = String(name || "");
  const idx = n.lastIndexOf(".");
  return idx < 0 ? "" : n.slice(idx + 1).toLowerCase();
};
const stripExt = (name) => {
  const n = String(name || "");
  const idx = n.lastIndexOf(".");
  return idx < 0 ? n : n.slice(0, idx);
};
const normalizeDirPath = (p) => {
  const raw = String(p || "").trim();
  if (!raw) return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
};
const resolveItemPath = (item, dirPath) => {
  if (item && item.path) return String(item.path);
  const name = String(item?.name || "");
  if (!name) return "";
  return `${dirPath}/${name}`.replace(/\/{2,}/g, "/");
};

// ===== 字幕 & HLS 逻辑 (保持原有核心功能) =====
const SUPPORTED_SUBTITLE_EXTS = new Set(["srt", "vtt", "ass"]);

const loadSubtitleTracksForCurrentVideo = async () => {
  const file = props.file;
  if (!file?.name) return [];
  const dirPath = getEffectiveDirPath();

  // 先尽量复用父组件传入的目录列表；刷新后为空则触发一次兜底 list
  let items = getEffectiveDirectoryItems();
  if (!items.length) {
    await ensureDirectoryItemsLoaded({ refresh: false });
    items = getEffectiveDirectoryItems();
  }

  const videoBase = stripExt(file.name).toLowerCase();
  const subtitleItems = items.filter((it) => {
    if (!it || it.isDirectory) return false;
    return SUPPORTED_SUBTITLE_EXTS.has(getExtLower(it.name));
  });

  if (!subtitleItems.length) return [];
  subtitleItems.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));

  const tracks = [];
  for (const it of subtitleItems) {
    const path = resolveItemPath(it, dirPath);
    if (!path) continue;
    try {
      const url = await fsService.getFileLink(path, null, false);
      const ext = getExtLower(it.name);
      tracks.push({
        name: it.name,
        path,
        url,
        type: ext || "srt",
        default: stripExt(it.name).toLowerCase() === videoBase,
      });
    } catch {}
  }
  return tracks;
};

const checkIfHLSVideo = (file) => file?.name?.toLowerCase().endsWith(".m3u8");

// HLS URL 转换
const createHlsUrlTransform = () => {
  const dirPrefix = `${getEffectiveDirPath()}/`.replace(/\/{2,}/g, "/");
  const cache = new Map();
  const CACHE_TTL = 120000; 
  
  return async (reqUrl) => {
    // 简单版：如果是 path，则拼接 dirPrefix
    if (/^https?:\/\//i.test(reqUrl) || reqUrl.startsWith("data:")) return reqUrl;
    // 去掉 query hash
    const k = reqUrl.split("?")[0].split("#")[0].trim();
    if (!k || k.split("/").includes("..")) return reqUrl;
    
    // 构造存储路径
    let storagePath = k.startsWith("/") ? k : `${dirPrefix}${k}`;
    storagePath = storagePath.replace(/\/{2,}/g, "/");

    // 缓存检查
    const now = Date.now();
    const cached = cache.get(storagePath);
    if (cached && (now - cached.at < CACHE_TTL)) return cached.url;

    try {
      const url = await fsService.getFileLink(storagePath, null, false);
      if (url) {
        cache.set(storagePath, { url, at: now });
        // 限制缓存大小
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return url;
      }
    } catch {}
    return reqUrl;
  };
};

const generateDefaultPoster = (name) => {
  const firstChar = (name || "V")[0].toUpperCase();
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = props.darkMode ? "#111827" : "#e5e7eb";
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = props.darkMode ? "#3b82f6" : "#60a5fa";
  ctx.beginPath(); ctx.arc(160, 90, 30, 0, 2*Math.PI); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(150, 75); ctx.lineTo(150, 105); ctx.lineTo(175, 90); ctx.closePath(); ctx.fill();
  ctx.font = "bold 16px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(firstChar, 160, 140);
  return canvas.toDataURL();
};

const initializeCurrentVideo = async () => {
  if (!props.file) return;
  isHLSVideo.value = checkIfHLSVideo(props.file);
  if (isHLSVideo.value) isPreparingHls.value = true;

  const baseData = {
    name: props.file.name || "unknown",
    title: props.file.name || "unknown",
    poster: generateDefaultPoster(props.file.name),
    contentType: props.file.contentType,
    originalFile: props.file,
    isHLS: isHLSVideo.value,
    hlsUrlTransform: isHLSVideo.value ? createHlsUrlTransform() : null,
    subtitleTracks: [],
  };

  if (props.videoUrl) {
    currentVideoData.value = { ...baseData, url: props.videoUrl };
    isPreparingHls.value = false;
    
    // 加载字幕
    const currentName = props.file.name;
    loadSubtitleTracksForCurrentVideo().then(tracks => {
      if (!tracks?.length || currentVideoData.value?.name !== currentName) return;
      currentVideoData.value.subtitleTracks = tracks;
    });
  } else {
    currentVideoData.value = { ...baseData, url: null };
    isPreparingHls.value = false;
  }
};

// Lifecycle
watch(
  () => [props.currentPath, props.file?.path, Array.isArray(props.directoryItems) ? props.directoryItems.length : 0],
  async () => {
    // 刷新/直达文件页：父组件可能还没把目录 items 传下来，这里主动 list 一次兜底
    await ensureDirectoryItemsLoaded({ refresh: false });
  },
  { immediate: true },
);

watch(
  () => props.videoUrl,
  async (val) => {
    if (!val || !props.file) return;
    // 刷新时：目录列表通常是“后到”的。先确保目录 items 就绪，再初始化播放器控制（上集/下集/列表）才不会丢。
    await ensureDirectoryItemsLoaded({ refresh: false });
    await initializeCurrentVideo();
  },
  { immediate: true },
);

onMounted(() => {
  originalTitle.value = document.title;
});
onBeforeUnmount(() => {
  if (originalTitle.value) document.title = originalTitle.value;
});

const handleKeydown = (e) => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  const player = videoPlayerRef.value?.getInstance();
  if (!player) return;
  
  switch(e.code) {
    case "Space": e.preventDefault(); player.toggle(); break;
    case "ArrowLeft": e.preventDefault(); player.seek = Math.max(0, player.currentTime - 10); break;
    case "ArrowRight": e.preventDefault(); player.seek = Math.min(player.duration, player.currentTime + 10); break;
    case "ArrowUp": e.preventDefault(); player.volume = Math.min(1, player.volume + 0.1); break;
    case "ArrowDown": e.preventDefault(); player.volume = Math.max(0, player.volume - 0.1); break;
    case "KeyF": e.preventDefault(); player.fullscreen = !player.fullscreen; break;
  }
};

// 注册键盘事件（自动清理）
useEventListener(document, "keydown", handleKeydown);

// Events Proxy
const handlePlay = (d) => { isPlaying.value = true; document.title = `${d?.video?.name || props.file?.name}`; emit("play", d); };
const handlePause = (d) => { isPlaying.value = false; document.title = props.file?.name || originalTitle.value; emit("pause", d); };
const handleVideoEnded = () => { isPlaying.value = false; document.title = props.file?.name || originalTitle.value; };
const handleError = (e) => emit("error", e);
const handleCanPlay = () => { emit("canplay"); emit("loaded"); };
const handleTimeUpdate = (d) => { currentTime.value = d.currentTime; duration.value = d.duration; };
const handleFullscreen = () => emit("fullscreen");
const handleFullscreenExit = () => emit("fullscreenExit");
const handlePlayerReady = () => {};

</script>

<style scoped>
@import "@/styles/pages/mount-explorer/video-preview.css";

/* 播放列表动画 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* 播放中跳动音柱动画 */
.playing-equalizer {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
  padding-bottom: 2px;
}
.playing-equalizer .bar {
  width: 2px;
  background-color: currentColor;
  animation: equalize 0.8s infinite ease-in-out;
}
.playing-equalizer .bar:nth-child(1) { animation-delay: 0.1s; height: 40%; }
.playing-equalizer .bar:nth-child(2) { animation-delay: 0.3s; height: 80%; }
.playing-equalizer .bar:nth-child(3) { animation-delay: 0.5s; height: 50%; }

@keyframes equalize {
  0% { height: 30%; }
  50% { height: 100%; }
  100% { height: 30%; }
}

/* 玻璃拟态滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}
</style>
