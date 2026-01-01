/**
 * Live Photo 核心逻辑 Composable
 *
 *
 * @module useLivePhoto
 */

import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, unref } from "vue";
import { useEventListener, useIntersectionObserver } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

/**
 * 错误类型定义
 */
export const LivePhotoErrorType = {
  VIDEO_LOAD_ERROR: "VIDEO_LOAD_ERROR",
  PHOTO_LOAD_ERROR: "PHOTO_LOAD_ERROR",
  PLAYBACK_ERROR: "PLAYBACK_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  FORMAT_NOT_SUPPORTED: "FORMAT_NOT_SUPPORTED",
};

/**
 * 播放模式
 */
export const PlaybackStyle = {
  HINT: "hint", // 短预览（约1秒）
  FULL: "full", // 完整播放
};

/**
 * 创建 Live Photo 错误对象
 */
const createLivePhotoError = (type, message, originalError = null) => ({
  type,
  message,
  originalError,
  timestamp: Date.now(),
});

/**
 * 检测是否为移动设备
 */
const isMobile = () => {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
};

/**
 * Live Photo Composable
 *
 * @param {Object} options - 配置选项
 * @param {string | import("vue").Ref<string>} options.photoSrc - 图片 URL（支持 Ref）
 * @param {string | import("vue").Ref<string>} options.videoSrc - 视频 URL（支持 Ref）
 * @param {boolean} [options.autoplay=false] - 是否自动播放
 * @param {boolean} [options.lazyLoad=true] - 是否懒加载视频
 * @param {number} [options.longPressDelay=300] - 长按触发延迟（毫秒）
 * @param {boolean} [options.enableVibration=true] - 是否启用触觉反馈
 * @param {number} [options.stillImageTime=null] - 关键帧时间点（秒）
 * @param {string} [options.playbackStyle='full'] - 播放模式
 * @param {Function} [options.onPlay] - 播放开始回调
 * @param {Function} [options.onPause] - 暂停回调
 * @param {Function} [options.onEnded] - 播放结束回调
 * @param {Function} [options.onError] - 错误回调
 * @param {Function} [options.onProgress] - 加载进度回调
 * @param {Function} [options.onCanPlay] - 可播放回调
 */
export function useLivePhoto(options = {}) {
  const log = createLogger("LivePhoto");
  const readSources = () => ({
    photoSrc: unref(options.photoSrc) || "",
    videoSrc: unref(options.videoSrc) || "",
  });

  // 默认配置
  const initialSources = readSources();
  const config = reactive({
    photoSrc: initialSources.photoSrc,
    videoSrc: initialSources.videoSrc,
    autoplay: options.autoplay ?? false,
    lazyLoad: options.lazyLoad ?? true,
    longPressDelay: options.longPressDelay ?? 300,
    enableVibration: options.enableVibration ?? true,
    stillImageTime: options.stillImageTime ?? null,
    playbackStyle: options.playbackStyle ?? PlaybackStyle.FULL,
  });

  // 状态管理
  const state = reactive({
    isPlaying: false,
    isLoading: false,
    isLoaded: false,
    hasError: false,
    errorMessage: "",
    progress: 0,
    duration: 0,
    currentTime: 0,
    isWarmed: false, // 视频是否已预热
    isVisible: false, // 是否在视口内
  });

  // DOM 引用
  const containerRef = ref(null);
  const videoRef = ref(null);
  const imageRef = ref(null);

  // 内部状态
  let touchStartTime = 0;
  let isWithin = false; // 用于处理触摸中断
  let stopIntersectionObserver = null;
  let previewTimeoutId = null;
  let isLazyLoadSetup = false;

  // 计算属性
  const canPlay = computed(() => state.isLoaded && !state.hasError);
  const isMobileDevice = computed(() => isMobile());

  /**
   * 视频预热 - 解决移动端自动播放限制
   */
  const warmVideo = async () => {
    const video = videoRef.value;
    if (!video || state.isWarmed || !video.src) return;

    try {
      const wasMuted = video.muted;
      video.muted = true;

      await video.play();
      video.pause();

      video.muted = wasMuted;
      video.currentTime = 0;
      state.isWarmed = true;
    } catch (e) {
      // 预热失败不影响后续操作
      log.warn("[LivePhoto] Video warm-up failed:", e.message);
    }
  };

  /**
   * 设置懒加载
   */
  const setupLazyLoad = () => {
    if (!config.lazyLoad || !containerRef.value || isLazyLoadSetup) return;

    const { stop } = useIntersectionObserver(
      containerRef,
      (entries) => {
        entries.forEach((entry) => {
          state.isVisible = entry.isIntersecting;

          if (entry.isIntersecting && videoRef.value && !videoRef.value.src && config.videoSrc) {
            videoRef.value.src = config.videoSrc;
            state.isLoading = true;
          }
        });
      },
      { rootMargin: "100px" }
    );
    stopIntersectionObserver = stop;
    isLazyLoadSetup = true;
  };

  /**
   * 更新加载进度
   */
  const updateProgress = () => {
    const video = videoRef.value;
    if (!video || !video.buffered.length) return;

    const lastRangeIndex = Math.max(0, video.buffered.length - 1);
    const buffered = video.buffered.end(lastRangeIndex);
    const duration = video.duration || 1;
    state.progress = Math.floor((buffered / duration) * 100);
    state.duration = duration;

    options.onProgress?.(state.progress);

    if (state.progress >= 100) {
      state.isLoading = false;
    }
  };

  /**
   * 播放视频
   */
  const play = async () => {
    const video = videoRef.value;
    if (!video || state.isPlaying || state.hasError) return;

    try {
      // 如果视频未加载，先加载
      if (!video.src && config.videoSrc) {
        video.src = config.videoSrc;
        state.isLoading = true;
      }

      // 根据播放模式设置起始时间
      if (config.playbackStyle === PlaybackStyle.HINT && config.stillImageTime) {
        // HINT 模式：从关键帧前约1秒开始播放
        const previewStart = Math.max(0, config.stillImageTime - 1);
        video.currentTime = previewStart;
      } else {
        video.currentTime = 0;
      }

      await video.play();

      state.isPlaying = true;

      // 触觉反馈
      if (config.enableVibration && navigator.vibrate) {
        navigator.vibrate(50);
      }

      options.onPlay?.();

      // HINT 模式下设置自动停止
      if (config.playbackStyle === PlaybackStyle.HINT && config.stillImageTime) {
        const duration = config.stillImageTime - video.currentTime;
        previewTimeoutId = setTimeout(() => {
          stop();
        }, duration * 1000);
      }
    } catch (error) {
      handleError(error);
    }
  };

  /**
   * 暂停视频
   */
  const pause = () => {
    const video = videoRef.value;
    if (!video || !state.isPlaying) return;

    video.pause();
    state.isPlaying = false;
    clearTimeout(previewTimeoutId);

    options.onPause?.();
  };

  /**
   * 停止视频并重置
   */
  const stop = () => {
    const video = videoRef.value;
    if (!video) return;

    video.pause();
    state.isPlaying = false;
    clearTimeout(previewTimeoutId);

    options.onPause?.();
  };

  /**
   * 切换播放状态
   */
  const toggle = () => {
    state.isPlaying ? pause() : play();
  };

  /**
   * 错误处理
   */
  const handleError = (error) => {
    // 忽略用户离开导致的中断
    if (!isWithin && error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    state.hasError = true;
    state.isPlaying = false;
    state.isLoading = false;
    state.isLoaded = false;

    let errorType = LivePhotoErrorType.PLAYBACK_ERROR;
    let messageKey = "livePhoto.errors.playbackFailed";

    if (error instanceof DOMException) {
      const nameToKey = {
        NotAllowedError: "livePhoto.errors.notAllowed",
        AbortError: "livePhoto.errors.aborted",
        NotSupportedError: "livePhoto.errors.notSupported",
        NetworkError: "livePhoto.errors.networkError",
      };
      messageKey = nameToKey[error.name] || "livePhoto.errors.playbackFailed";
      if (error.name === "NotSupportedError") {
        errorType = LivePhotoErrorType.FORMAT_NOT_SUPPORTED;
      }
    } else if (error.target?.error) {
      const mediaError = error.target.error;
      const codeToKey = {
        1: "livePhoto.errors.aborted",
        2: "livePhoto.errors.networkError",
        3: "livePhoto.errors.decodeFailed",
        4: "livePhoto.errors.notSupported",
      };
      messageKey = codeToKey[mediaError.code] || "livePhoto.errors.videoLoadFailed";
      errorType = mediaError.code === 2 ? LivePhotoErrorType.NETWORK_ERROR : LivePhotoErrorType.VIDEO_LOAD_ERROR;
    }

    state.errorMessage = messageKey;

    const livePhotoError = createLivePhotoError(errorType, messageKey, error);
    options.onError?.(livePhotoError);
  };

  /**
   * 处理触摸开始
   */
  const handleTouchStart = (e) => {
    e.preventDefault();
    touchStartTime = Date.now();
    isWithin = true;
    play();
  };

  /**
   * 处理触摸结束
   */
  const handleTouchEnd = (e) => {
    const touchDuration = Date.now() - touchStartTime;
    isWithin = false;

    // 短按视为点击
    if (touchDuration < config.longPressDelay) {
      options.onClick?.(e);
    }

    stop();
  };

  /**
   * 处理鼠标进入（桌面端）
   */
  const handleMouseEnter = () => {
    if (!state.hasError) {
      play();
    }
  };

  /**
   * 处理鼠标离开（桌面端）
   */
  const handleMouseLeave = () => {
    if (!state.hasError) {
      stop();
    }
  };

  /**
   * 视频事件处理
   */
  const handleLoadedMetadata = () => {
    const video = videoRef.value;
    if (!video) return;
    state.duration = video.duration;
    if (config.stillImageTime === null) {
      // 如果没有指定关键帧时间，默认使用视频中点
      config.stillImageTime = video.duration / 2;
    }
  };

  const handleCanPlayThrough = () => {
    state.isLoaded = true;
    state.isLoading = false;
    options.onCanPlay?.();
  };

  const handleEnded = () => {
    state.isPlaying = false;
    options.onEnded?.();
  };

  const handleTimeUpdate = () => {
    const video = videoRef.value;
    if (!video) return;
    state.currentTime = video.currentTime;
  };

  const handleProgressEvent = () => updateProgress();

  /** @type {Array<Function>} */
  let stopVideoEventListeners = [];

  const setupVideoEvents = () => {
    const video = videoRef.value;
    if (!video) return;

    cleanupVideoEvents();

    stopVideoEventListeners = [
      useEventListener(video, "progress", handleProgressEvent),
      useEventListener(video, "loadedmetadata", handleLoadedMetadata),
      useEventListener(video, "canplaythrough", handleCanPlayThrough),
      useEventListener(video, "ended", handleEnded),
      useEventListener(video, "error", handleError),
      useEventListener(video, "timeupdate", handleTimeUpdate),
    ];
  };

  /**
   * 清理视频事件
   */
  const cleanupVideoEvents = () => {
    if (Array.isArray(stopVideoEventListeners) && stopVideoEventListeners.length > 0) {
      stopVideoEventListeners.forEach((stop) => {
        try {
          stop?.();
        } catch {
          // ignore
        }
      });
    }
    stopVideoEventListeners = [];
  };

  /**
   * 销毁实例
   */
  const destroy = () => {
    // 清理观察器
    stopIntersectionObserver?.();
    stopIntersectionObserver = null;

    // 清理定时器
    clearTimeout(previewTimeoutId);

    // 清理事件
    cleanupVideoEvents();

    // 释放媒体资源
    const video = videoRef.value;
    if (video) {
      video.pause();
      // 避免设置 video.src="" 导致浏览器将当前页面 URL 解析为媒体地址
      video.removeAttribute("src");
      video.load();
    }

    const image = imageRef.value;
    if (image) {
      image.removeAttribute("src");
    }
  };

  /**
   * 更新配置
   */
  const updateConfig = (newOptions) => {
    Object.assign(config, newOptions);
  };

  /**
   * 重置状态
   */
  const reset = () => {
    state.isPlaying = false;
    state.isLoading = false;
    state.hasError = false;
    state.errorMessage = "";
    state.progress = 0;
    state.currentTime = 0;

    const video = videoRef.value;
    if (video) {
      video.currentTime = 0;
    }
  };

  // 监听配置变化
  watch(
    () => [unref(options.photoSrc), unref(options.videoSrc)],
    ([newPhotoSrc, newVideoSrc]) => {
      const nextPhotoSrc = newPhotoSrc || "";
      const nextVideoSrc = newVideoSrc || "";
      if (nextPhotoSrc === config.photoSrc && nextVideoSrc === config.videoSrc) return;

      reset();
      config.photoSrc = nextPhotoSrc;
      config.videoSrc = nextVideoSrc;
      state.isLoaded = false;
      state.isWarmed = false;

      // 懒加载场景下，视频 URL 变更时必须清理旧的 src；并在可见时立即触发加载
      const video = videoRef.value;
      if (video && config.lazyLoad) {
        video.pause();
        video.removeAttribute("src");
        video.load();

        if (state.isVisible && config.videoSrc) {
          video.src = config.videoSrc;
          state.isLoading = true;
        }
      }
    }
  );

  // 生命周期
  onMounted(() => {
    setupVideoEvents();
    setupLazyLoad();

    // 首次用户交互时预热视频
    const warmOnInteraction = () => {
      warmVideo();
      stopWarmTouch?.();
      stopWarmMouse?.();
      stopWarmTouch = null;
      stopWarmMouse = null;
    };

    let stopWarmTouch = useEventListener(containerRef, "touchstart", warmOnInteraction, { once: true, passive: true });
    let stopWarmMouse = useEventListener(containerRef, "mouseenter", warmOnInteraction, { once: true });
  });

  onBeforeUnmount(() => {
    destroy();
  });

  return {
    // 状态
    state,
    config,

    // DOM 引用
    containerRef,
    videoRef,
    imageRef,

    // 计算属性
    canPlay,
    isMobileDevice,

    // 方法
    play,
    pause,
    stop,
    toggle,
    warmVideo,
    destroy,
    reset,
    updateConfig,

    // 事件处理器
    handleTouchStart,
    handleTouchEnd,
    handleMouseEnter,
    handleMouseLeave,
  };
}

export default useLivePhoto;
