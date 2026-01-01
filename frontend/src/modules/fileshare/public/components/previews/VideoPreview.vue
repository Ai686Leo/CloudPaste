<template>
  <div
    ref="previewContainerRef"
    class="video-preview rounded-lg overflow-hidden mb-2 w-full relative border border-gray-200 dark:border-gray-700 flex flex-col"
    :class="isFullscreen ? 'h-screen' : ''"
  >
    <PreviewProviderHeader
      :title="filename || t('fileView.preview.video.title')"
      :options="providerOptions"
      :show-select="providerOptions.length > 1"
      :show-fullscreen="true"
      :fullscreen-target="previewContainerRef"
      v-model="selectedProviderKey"
      @fullscreen-change="handleFullscreenChange"
    />

    <!-- 视频预览内容 -->
    <div
      class="relative bg-gray-900"
      :class="isFullscreen ? 'flex-1 min-h-0' : 'h-[calc(100vh-350px)] min-h-[300px]'"
    >
      <VideoPlayer
        ref="videoPlayerRef"
        v-if="currentPreviewUrl && videoData && !shareHlsBlocked"
        :video="videoData"
        :dark-mode="darkMode"
        :autoplay="false"
        :volume="0.7"
        :muted="false"
        :loop="false"
        :custom-controls="[]"
        class="w-full h-full"
        @play="handlePlay"
        @pause="handlePause"
        @error="handleError"
        @canplay="handleCanPlay"
        @ended="handleVideoEnded"
        @timeupdate="handleTimeUpdate"
        @fullscreen="handlePlayerFullscreen"
        @fullscreenExit="handleFullscreenExit"
        @ready="handlePlayerReady"
      />

      <!-- 分享页：m3u8 如果引用了相对分片（ts/m4s/key），单文件分享会 404，直接提示即可 -->
      <div
        v-if="shareHlsBlocked"
        class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 p-6"
      >
        <div class="max-w-xl w-full rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-4">
          <div class="text-base font-semibold text-gray-900 dark:text-white mb-2">
            {{ t("fileView.preview.video.hlsShareNotSupportedTitle") }}
          </div>
          <div class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
            {{ t("fileView.preview.video.hlsShareNotSupportedTip") }}
          </div>
        </div>
      </div>

      <!-- 加载状态 -->
      <div
        v-if="!videoData && !shareHlsBlocked"
        class="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700"
      >
        <LoadingIndicator
          :text="t('fileView.preview.video.loading')"
          :dark-mode="darkMode"
          size="2xl"
          :icon-class="darkMode ? 'text-primary-500' : 'text-primary-600'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener } from "@vueuse/core";
import VideoPlayer from "@/components/common/VideoPlayer.vue";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useProviderSelector } from "@/composables/file-preview/useProviderSelector.js";
import PreviewProviderHeader from "@/components/common/preview/PreviewProviderHeader.vue";
import { createLogger } from "@/utils/logger.js";

const { t } = useI18n();
const log = createLogger("VideoPreview");

// Props 定义
const props = defineProps({
  // 多源预览架构
  providers: {
    type: Object,
    default: () => ({}),
  },
  nativeUrl: {
    type: String,
    default: "",
  },
  // 兼容旧调用
  previewUrl: {
    type: String,
    default: "",
  },
  linkType: {
    type: String,
    default: null,
  },
  mimetype: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// Emits 定义
const emit = defineEmits(["load", "error", "play", "pause", "fullscreen", "fullscreenExit"]);

// 容器 ref 和全屏状态
const previewContainerRef = ref(null);
const isFullscreen = ref(false);

const handleFullscreenChange = (val) => {
  isFullscreen.value = val;
};

// 解析 nativeUrl
const resolvedNativeUrl = computed(() => props.nativeUrl || props.previewUrl || "");

// 使用统一的 provider 选择器
const {
  providerOptions,
  selectedKey: selectedProviderKey,
  currentUrl: currentPreviewUrl,
} = useProviderSelector({
  providers: computed(() => props.providers || {}),
  nativeUrl: resolvedNativeUrl,
  nativeLabel: computed(() => t("fileView.preview.video.browserNative")),
});

// 响应式数据
const videoPlayerRef = ref(null);
const isPlaying = ref(false);
const originalTitle = ref("");
const currentTime = ref(0);
const duration = ref(0);

// 当前视频数据（响应式）
const currentVideoData = ref(null);

// 为了兼容性，保留 videoData 计算属性
const videoData = computed(() => currentVideoData.value);

const shareHlsBlocked = ref(false);

// 分享页的 m3u8 识别（只靠文件名/MIME，不依赖 URL 后缀）
const isHlsByMeta = computed(() => {
  const name = String(props.filename || "").toLowerCase();
  const mt = String(props.mimetype || "").toLowerCase();
  return name.endsWith(".m3u8") || mt.includes("mpegurl") || mt.includes("application/vnd.apple.mpegurl");
});

// 分享页 HLS：只做最轻量的“相对路径 -> 绝对 URL”纠正
const createShareHlsUrlTransform = () => {
  return async (requestUrl) => {
    const raw = String(requestUrl || "").trim();
    if (!raw) return requestUrl;
    // 已经是绝对地址/根路径/数据URL，直接放行
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith("//") || raw.startsWith("/") || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return requestUrl;
    }
    // 禁止跳目录
    if (raw.split("/").includes("..")) return requestUrl;
    try {
      const base = new URL(currentPreviewUrl.value, window.location.href);
      return new URL(raw, base).toString();
    } catch {
      return requestUrl;
    }
  };
};

const shareHlsUrlTransform = computed(() => (isHlsByMeta.value ? createShareHlsUrlTransform() : null));

const detectRelativeRefsInM3u8 = async (playlistUrl) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
  try {
    const res = await fetch(playlistUrl, {
      method: "GET",
      headers: { accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*" },
      signal: controller?.signal,
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text) return false;

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("#EXT-X-KEY")) {
        const m = /URI="([^"]+)"/i.exec(line);
        const uri = m?.[1] ? String(m[1]).trim() : "";
        if (uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !uri.startsWith("/") && !uri.startsWith("//")) return true;
        continue;
      }
      if (line.startsWith("#")) continue;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !line.startsWith("/") && !line.startsWith("//")) return true;
    }
    return false;
  } catch {
    // 拉不到 playlist（CORS/网络）就不拦截，避免误伤“本来能播”的情况
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// 更新页面标题
const updatePageTitle = (playing = false, fileName = null) => {
  const title = fileName || "视频预览";
  document.title = playing ? `${title}` : `${title}`;
};

// 恢复原始页面标题
const restoreOriginalTitle = () => {
  if (originalTitle.value) {
    document.title = originalTitle.value;
  }
};

// 生成默认海报
const generateDefaultPoster = (fileName) => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Arial";
  ctx.textAlign = "center";
  ctx.fillText("🎬", canvas.width / 2, canvas.height / 2 - 10);
  ctx.font = "12px Arial";
  ctx.fillText(fileName || "视频文件", canvas.width / 2, canvas.height / 2 + 15);

  return canvas.toDataURL();
};

// 事件处理函数
const handlePlay = (data) => {
  isPlaying.value = true;
  const videoName = data?.video?.name || props.filename;
  updatePageTitle(true, videoName);
  emit("play", data);
};

const handlePause = (data) => {
  isPlaying.value = false;
  const videoName = data?.video?.name || props.filename;
  updatePageTitle(false, videoName);
  emit("pause", data);
};

const handleError = (error) => {
  // 忽略Service Worker相关的误报错误
  if (error?.target?.src?.includes(window.location.origin) && currentVideoData.value?.url) {
    return;
  }

  isPlaying.value = false;
  log.error("视频播放错误:", error);
  emit("error", error);
};

const handleCanPlay = () => {
  emit("load");
};

const handleTimeUpdate = (data) => {
  currentTime.value = data.currentTime;
  duration.value = data.duration;
};

// 处理视频播放结束
const handleVideoEnded = () => {
  isPlaying.value = false;
  updatePageTitle(false, props.filename);
};

// 处理全屏事件（来自播放器内部）
const handlePlayerFullscreen = () => {
  emit("fullscreen");
};

const handleFullscreenExit = () => {
  emit("fullscreenExit");
};

// 处理播放器准备就绪
const handlePlayerReady = () => {
  // 播放器准备就绪
};

// 初始化当前视频数据
const initializeCurrentVideo = async () => {
  const url = currentPreviewUrl.value;
  if (!url) {
    return;
  }

  shareHlsBlocked.value = false;
  if (isHlsByMeta.value) {
    const hasRelative = await detectRelativeRefsInM3u8(url);
    if (hasRelative) {
      // 单文件分享 + 相对分片：浏览器一定会去请求 /proxy/share/<ts>，导致 404
      shareHlsBlocked.value = true;
      currentVideoData.value = null;
      return;
    }
  }

  // 构建视频数据对象
  currentVideoData.value = {
    name: props.filename || "视频文件",
    title: props.filename || "视频预览",
    url: url,
    linkType: props.linkType || null,
    poster: generateDefaultPoster(props.filename),
    contentType: props.mimetype,
    mimetype: props.mimetype,
    isHLS: isHlsByMeta.value,
    hlsUrlTransform: isHlsByMeta.value ? shareHlsUrlTransform.value : null,
  };
};

// 监听 currentPreviewUrl 变化
watch(
  currentPreviewUrl,
  async (newUrl) => {
    if (newUrl) {
      await initializeCurrentVideo();
    }
  },
  { immediate: true }
);

// 快捷键处理
const handleKeydown = (event) => {
  // 如果用户正在输入框中输入，不处理快捷键
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") {
    return;
  }

  const player = videoPlayerRef.value?.getInstance();
  if (!player) return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      player.toggle();
      break;
    case "ArrowLeft":
      event.preventDefault();
      player.seek = Math.max(0, player.currentTime - 10);
      break;
    case "ArrowRight":
      event.preventDefault();
      player.seek = Math.min(player.duration, player.currentTime + 10);
      break;
    case "ArrowUp":
      event.preventDefault();
      player.volume = Math.min(1, player.volume + 0.1);
      break;
    case "ArrowDown":
      event.preventDefault();
      player.volume = Math.max(0, player.volume - 0.1);
      break;
    case "KeyF":
      event.preventDefault();
      player.fullscreen = !player.fullscreen;
      break;
  }
};

// 注册键盘事件（自动清理）
useEventListener(document, "keydown", handleKeydown);

// 生命周期钩子
onMounted(() => {
  originalTitle.value = document.title;
});

onBeforeUnmount(() => {
  restoreOriginalTitle();
});
</script>

<style scoped>
/* 全屏时预览容器填满屏幕 */
.video-preview :deep(:fullscreen),
.video-preview :deep(:-webkit-full-screen),
.video-preview :deep(:-moz-full-screen) {
  width: 100vw !important;
  height: 100vh !important;
  background: #000;
}

/* 确保 VideoPlayer 和 Artplayer 填满容器 */
.video-preview :deep(.video-player-container),
.video-preview :deep(.artplayer-container),
.video-preview :deep(.art-video-player) {
  width: 100% !important;
  height: 100% !important;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .video-preview {
    min-height: 200px;
  }
}
</style>
