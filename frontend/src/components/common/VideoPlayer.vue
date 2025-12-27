<template>
  <div class="video-player-container" :class="{ 'dark-theme': darkMode, 'is-fullscreen': isFullscreen }">
    <div ref="artplayerContainer" class="artplayer-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import Artplayer from "artplayer";

const getExtLower = (name) => {
  const n = String(name || "");
  const idx = n.lastIndexOf(".");
  if (idx < 0) return "";
  return n.slice(idx + 1).toLowerCase();
};

// Props 定义
const props = defineProps({
  // 视频文件信息
  video: {
    type: Object,
    required: true,
  },
  // 是否为深色模式
  darkMode: {
    type: Boolean,
    default: false,
  },
  // 是否自动播放
  autoplay: {
    type: Boolean,
    default: false,
  },
  // 播放器主题色
  theme: {
    type: String,
    default: "#3b82f6",
  },
  // 播放器模式：'normal', 'mini', 'fullscreen'
  mode: {
    type: String,
    default: "normal",
  },
  // 是否循环播放
  loop: {
    type: Boolean,
    default: false,
  },
  // 音量
  volume: {
    type: Number,
    default: 0.7,
  },
  // 是否静音
  muted: {
    type: Boolean,
    default: false,
  },
  // 播放速度由 Artplayer 内置功能提供，无需额外配置
  // 是否显示字幕
  showSubtitle: {
    type: Boolean,
    default: false,
  },
  // 字幕文件URL
  subtitleUrl: {
    type: String,
    default: "",
  },
  // 是否显示全屏按钮
  showFullscreenControl: {
    type: Boolean,
    default: true,
  },
  // 外层容器是否处于全屏状态（用于样式控制）
  isFullscreen: {
    type: Boolean,
    default: false,
  },

  // 自定义控制器数组
  customControls: {
    type: Array,
    default: () => [],
  },
  // 预加载策略
  preload: {
    type: String,
    default: "metadata", // none, metadata, auto
  },
});

// Emits 定义
const emit = defineEmits([
  // 基础播放事件
  "play",
  "pause",
  "ended",
  "timeupdate",
  "loadstart",
  "canplay",
  "error",
  "ready",
  "loaded",

  // 全屏事件
  "fullscreen",
  "fullscreenExit",
  "fullscreenWeb",

  // 音频和进度事件
  "volumechange",
  "seeked",

  "flip", // 视频翻转事件
  "aspectRatio", // 长宽比变化事件
  "pip", // 画中画事件
  "lock", // 移动端锁定事件
  "screenshot", // 截图事件
  "gesture", // 移动端手势事件
]);

// 响应式数据
const artplayerContainer = ref(null);
const artplayerInstance = ref(null);

// 计算主题色
const getThemeColor = () => {
  if (props.darkMode) {
    return "#8b5cf6"; // 深色模式下使用紫色，与视频文件类型色彩一致
  }
  return props.theme;
};

// 是否应当为当前视频 URL 启用 CORS 模式
// - 同源资源：启用 CORS 模式可支持截图等高级能力
// - 代理链路（linkType=proxy）：预期返回 ACAO 头，启用更安全
// - 第三方直链（linkType=direct 且跨域）：禁用 CORS 模式，避免 PWA Service Worker 以 cors 请求导致播放失败（如 GitHub Releases 302 链）
const shouldEnableCorsMode = (rawUrl, linkType) => {
  if (!rawUrl) return false;
  try {
    const resolvedUrl = new URL(rawUrl, window.location.href);
    if (resolvedUrl.origin === window.location.origin) {
      return true;
    }
    if (linkType === "proxy") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// 初始化 Artplayer
const initArtplayer = async () => {
  if (!artplayerContainer.value || !props.video?.url) return;

  // 销毁现有实例
  if (artplayerInstance.value) {
    // 清理流媒体播放器实例
    if (artplayerInstance.value.streamPlayer) {
      try {
        if (artplayerInstance.value.streamPlayer.pause) {
          artplayerInstance.value.streamPlayer.pause();
        }
        if (artplayerInstance.value.streamPlayer.unload) {
          artplayerInstance.value.streamPlayer.unload();
        }
        if (artplayerInstance.value.streamPlayer.detachMediaElement) {
          artplayerInstance.value.streamPlayer.detachMediaElement();
        }
        if (artplayerInstance.value.streamPlayer.destroy) {
          artplayerInstance.value.streamPlayer.destroy();
        }
        console.log("🧹 流媒体播放器清理完成");
      } catch (error) {
        console.warn("清理流媒体播放器时出错:", error);
      }
    }

    artplayerInstance.value.destroy();
    artplayerInstance.value = null;
  }

  // Artplayer 配置 - 使用最简化配置确保兼容性
  const options = {
    container: artplayerContainer.value,
    url: props.video.url,
  };

  // 安全地添加可选配置
  if (props.video.name || props.video.title) {
    options.title = props.video.name || props.video.title || "视频播放";
  }

  if (props.video.poster || props.video.cover) {
    options.poster = props.video.poster || props.video.cover;
  }

  // 基础播放配置
  options.autoplay = props.autoplay;
  options.volume = props.volume;
  options.muted = props.muted;
  options.loop = props.loop;
  options.theme = getThemeColor();
  options.lang = "zh-cn";

  // 功能配置
  options.playbackRate = true;
  options.setting = true;
  options.settings = [];
  options.hotkey = true;
  options.pip = true;
  options.screenshot = true;
  options.miniProgressBar = true;
  options.fullscreen = props.showFullscreenControl;
  options.fullscreenWeb = props.showFullscreenControl;
  options.flip = true;
  options.aspectRatio = true;

  // 移动端优化
  options.autoOrientation = true; // 移动端自动旋转
  options.fastForward = true; // 长按快进功能
  options.lock = true; // 移动端锁定功能

  // 播放体验优化
  options.autoPlayback = true; // 自动记忆播放进度
  options.mutex = true; // 互斥播放（同时只能播放一个）
  options.subtitleOffset = true; // 字幕偏移功能

  // 控制器配置
  options.controls = props.customControls;

  // 只有在需要字幕时才添加 subtitle 选项
  if (props.showSubtitle && props.subtitleUrl) {
    options.subtitle = {
      url: props.subtitleUrl,
      type: "srt",
      encoding: "utf-8",
      escape: true,
    };
  }

  // 字幕列表
  const rawTracks = Array.isArray(props.video?.subtitleTracks) ? props.video.subtitleTracks : [];
  const effectiveTracks =
    rawTracks.length > 0
      ? rawTracks
      : props.showSubtitle && props.subtitleUrl
        ? [{ name: "字幕", url: props.subtitleUrl, type: "srt", default: true }]
        : [];

  if (effectiveTracks.length > 0) {
    const defaultTrack = effectiveTracks.find((t) => t && t.default && t.url) || effectiveTracks.find((t) => t && t.url) || null;

    // 如果外层没显式给 subtitleUrl，但我们有默认字幕，就自动带上
    if (!options.subtitle && defaultTrack?.url) {
      options.subtitle = {
        url: defaultTrack.url,
        type: String(defaultTrack.type || getExtLower(defaultTrack.name) || "srt"),
        encoding: "utf-8",
        escape: true,
      };
    }

    const selector = [
      { default: !defaultTrack, html: "关闭字幕", url: "" },
      ...effectiveTracks.map((t) => ({
        default: !!t.default,
        html: String(t.name || "字幕"),
        url: String(t.url || ""),
        type: String(t.type || getExtLower(t.name) || "srt"),
      })),
    ];

    options.settings.push({
      name: "subtitle",
      html: "字幕",
      width: 260,
      tooltip: defaultTrack?.name || "关闭字幕",
      selector,
      onSelect: function (item) {
        const art = artplayerInstance.value;
        if (!art) return item?.html;
        const nextUrl = String(item?.url || "");
        if (!nextUrl) {
          art.subtitle.show = false;
          return "关闭字幕";
        }
        art.subtitle.url = nextUrl;
        art.subtitle.show = true;
        return String(item?.html || "字幕");
      },
    });
  }

  // 添加跨域支持以启用截图功能
  const effectiveLinkType =
    props.video?.linkType || props.video?.originalFile?.linkType || null;
  const enableCorsMode = shouldEnableCorsMode(
    props.video.url,
    effectiveLinkType
  );
  options.moreVideoAttr = enableCorsMode
    ? { crossOrigin: "anonymous", preload: "metadata" }
    : { preload: "metadata" };

  // 根据模式调整配置
  if (props.mode === "mini") {
    options.autoSize = true;
    // mini 模式下隐藏控制栏，通过 CSS 控制
    options.controls = [];
  }

  // 检测并添加流媒体支持
  await addStreamingSupport(options);

  try {
    // 创建 Artplayer 实例
    artplayerInstance.value = new Artplayer(options);

    // 如果是流媒体播放器，将播放器实例从video元素转移到artplayerInstance
    if (artplayerInstance.value.video) {
      if (artplayerInstance.value.video.streamPlayer) {
        artplayerInstance.value.streamPlayer = artplayerInstance.value.video.streamPlayer;
        console.log("流媒体播放器实例已转移到Artplayer实例");
      }
    }

    // 绑定事件监听器
    bindEvents();

    // 应用主题样式
    applyThemeStyles();


    emit("ready", artplayerInstance.value);
  } catch (error) {
    console.error("Artplayer 初始化失败:", error);
    emit("error", error);
  }
};

// 检测流媒体格式
const detectStreamingFormat = (url, contentType, fileName) => {
  // HLS 检测
  if (
    url.toLowerCase().includes(".m3u8") ||
    fileName.toLowerCase().endsWith(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("application/vnd.apple.mpegurl")
  ) {
    return "m3u8";
  }
  // MPEG-TS 检测
  if (
    url.toLowerCase().includes(".ts") ||
    url.toLowerCase().includes(".m2ts") ||
    contentType.includes("mp2t") ||
    fileName.toLowerCase().endsWith(".ts") ||
    fileName.toLowerCase().endsWith(".m2ts")
  ) {
    return "mpegts";
  }
  // FLV 检测
  if (url.toLowerCase().includes(".flv") || contentType.includes("flv") || contentType === "video/x-flv" || fileName.toLowerCase().endsWith(".flv")) {
    return "flv";
  }
  return null;
};

// 添加流媒体支持函数
const addStreamingSupport = async (options) => {
  const videoUrl = props.video?.url || "";
  const contentType = props.video?.contentType || props.video?.mimetype || "";
  const fileName = props.video?.name || "";

  // 检测流媒体格式
  const streamingFormat = detectStreamingFormat(videoUrl, contentType, fileName);

  if (!streamingFormat) {
    console.log("非流媒体格式，使用默认播放器");
    return;
  }

  console.log(`检测到${streamingFormat.toUpperCase()}格式，正在加载相应播放器...`);

  try {
    // 初始化customType对象
    options.customType = options.customType || {};

    if (streamingFormat === "m3u8") {
      await setupHLSPlayer(options, videoUrl);
    } else if (streamingFormat === "flv" || streamingFormat === "mpegts") {
      await setupMpegTSPlayer(options, videoUrl, streamingFormat);
    }
  } catch (error) {
    console.error(`加载${streamingFormat}播放器失败:`, error);
    emit("error", {
      type: `${streamingFormat}_load_error`,
      message: `加载${streamingFormat.toUpperCase()}播放器失败: ${error.message}`,
      originalError: error,
    });
  }
};

// 设置 HLS 播放器
const setupHLSPlayer = async (options, videoUrl) => {
  // 动态导入 hls.js
  const Hls = await import("hls.js");

  // 检查浏览器支持
  if (!Hls.default.isSupported()) {
    console.warn(" 当前浏览器不支持HLS播放");
    emit("error", {
      type: "hls_not_supported",
      message: "当前浏览器不支持HLS播放，请使用Chrome、Firefox或Edge浏览器",
    });
    return;
  }

  // 配置HLS自定义类型
  options.customType.m3u8 = function (video, url, art) {
    const urlTransform = typeof props.video?.hlsUrlTransform === "function" ? props.video.hlsUrlTransform : null;

    const installHlsMenus = (targetArt, hlsInstance) => {
      // 只在 setting 打开时才加菜单
      if (!targetArt?.setting || typeof targetArt.setting.add !== "function") return;

      // 1) 清晰度（levels）
      const updateQuality = () => {
        const levels = Array.isArray(hlsInstance.levels) ? hlsInstance.levels : [];
        if (!levels.length) return;

        const auto = hlsInstance.currentLevel === -1 || hlsInstance.autoLevelEnabled === true;
        const selector = [
          { default: auto, html: "自动", level: -1 },
          ...levels.map((lvl, idx) => {
            const label = lvl?.height ? `${lvl.height}P` : lvl?.bitrate ? `${Math.round(lvl.bitrate / 1000)}kbps` : `L${idx}`;
            return { default: !auto && hlsInstance.currentLevel === idx, html: label, level: idx };
          }),
        ];

        const currentLabel = auto
          ? "自动"
          : selector.find((x) => x.default)?.html || "自动";

        const payload = {
          name: "hls-quality",
          html: "清晰度",
          width: 180,
          tooltip: currentLabel,
          selector,
          onSelect: function (item) {
            const level = Number(item?.level);
            if (!Number.isFinite(level)) return String(item?.html || "自动");
            if (level < 0) {
              hlsInstance.currentLevel = -1;
              return "自动";
            }
            hlsInstance.currentLevel = level;
            return String(item?.html || "清晰度");
          },
        };

        if (!targetArt.__cpHlsQualityInstalled) {
          targetArt.setting.add(payload);
          targetArt.__cpHlsQualityInstalled = true;
        } else if (typeof targetArt.setting.update === "function") {
          targetArt.setting.update(payload);
        }
      };

      // 2) 音轨（audioTracks）
      const updateAudio = () => {
        const tracks = Array.isArray(hlsInstance.audioTracks) ? hlsInstance.audioTracks : [];
        if (tracks.length <= 1) return;
        const selector = tracks.map((tr, idx) => ({
          default: hlsInstance.audioTrack === idx,
          html: String(tr?.name || tr?.lang || `音轨 ${idx + 1}`),
          track: idx,
        }));
        const currentLabel = selector.find((x) => x.default)?.html || "音轨";
        const payload = {
          name: "hls-audio",
          html: "音轨",
          width: 220,
          tooltip: currentLabel,
          selector,
          onSelect: function (item) {
            const track = Number(item?.track);
            if (!Number.isFinite(track) || track < 0) return String(item?.html || "音轨");
            hlsInstance.audioTrack = track;
            return String(item?.html || "音轨");
          },
        };
        if (!targetArt.__cpHlsAudioInstalled) {
          targetArt.setting.add(payload);
          targetArt.__cpHlsAudioInstalled = true;
        } else if (typeof targetArt.setting.update === "function") {
          targetArt.setting.update(payload);
        }
      };

      // 触发一次 + 后续在事件里更新
      updateQuality();
      updateAudio();

      try {
        hlsInstance.on(Hls.default.Events.MANIFEST_PARSED, () => updateQuality());
        hlsInstance.on(Hls.default.Events.LEVEL_SWITCHED, () => updateQuality());
        hlsInstance.on(Hls.default.Events.AUDIO_TRACKS_UPDATED, () => updateAudio());
        hlsInstance.on(Hls.default.Events.AUDIO_TRACK_SWITCHED, () => updateAudio());
      } catch {
        // ignore
      }
    };

    const hlsPlayer = new Hls.default({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 120,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.25,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      abrBandWidthFactor: 0.8,
      //重试配置
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 10000,
          maxLoadTimeMs: 120000,
          timeoutRetry: {
            maxNumRetry: 2, // 最多重试2次
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
          errorRetry: {
            maxNumRetry: 1, // 错误重试最多1次
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
        },
      },
      playlistLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 10000,
          maxLoadTimeMs: 120000,
          timeoutRetry: {
            maxNumRetry: 2,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
          errorRetry: {
            maxNumRetry: 1,
            retryDelayMs: 1000,
            maxRetryDelayMs: 8000,
          },
        },
      },
      // 用自定义 loader 在加载前“改 URL”
      ...(urlTransform
        ? {
            pLoader: class extends Hls.default.DefaultConfig.loader {
              constructor(config) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = function (context, config, callbacks) {
                  urlTransform(context.url, true)
                    .then((nextUrl) => {
                      const finalUrl = nextUrl || context.url;
                      const complete = callbacks.onSuccess;
                      callbacks.onSuccess = (loaderResponse, stats, successContext, networkDetails) => {
                        loaderResponse.url = finalUrl;
                        complete(loaderResponse, stats, successContext, networkDetails);
                      };
                      originalLoad({ ...context, url: finalUrl }, config, callbacks);
                    })
                    .catch(() => originalLoad(context, config, callbacks));
                };
              }
            },
            fLoader: class extends Hls.default.DefaultConfig.loader {
              constructor(config) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = function (context, config, callbacks) {
                  urlTransform(context.url, false)
                    .then((nextUrl) => {
                      const finalUrl = nextUrl || context.url;
                      const complete = callbacks.onSuccess;
                      callbacks.onSuccess = (loaderResponse, stats, successContext, networkDetails) => {
                        loaderResponse.url = finalUrl;
                        complete(loaderResponse, stats, successContext, networkDetails);
                      };
                      // fragment 需要同时改 frag 的 url 字段
                      originalLoad(
                        { ...context, frag: { ...(context.frag || {}), relurl: finalUrl, _url: finalUrl }, url: finalUrl },
                        config,
                        callbacks,
                      );
                    })
                    .catch(() => originalLoad(context, config, callbacks));
                };
              }
            },
          }
        : {}),
      // 兜底：禁用凭据传递
      xhrSetup: function (xhr) {
        xhr.withCredentials = false;
      },
    });

    // HLS播放器事件处理
    hlsPlayer.on(Hls.default.Events.ERROR, (event, data) => {
      let errorMessage = "HLS播放出现错误";
      if (data.fatal) {
        switch (data.type) {
          case Hls.default.ErrorTypes.NETWORK_ERROR:
            errorMessage = "网络错误，HLS.js将自动重试";
            break;
          case Hls.default.ErrorTypes.MEDIA_ERROR:
            errorMessage = "媒体解码错误，HLS.js将自动恢复";
            break;
          default:
            errorMessage = `HLS播放错误: ${data.details || "未知错误"}`;
            console.error("HLS致命错误，销毁播放器:", data.details);
            hlsPlayer.destroy();
            break;
        }

        emit("error", {
          type: "hls_error",
          errorType: data.type,
          errorDetail: data,
          message: errorMessage,
        });
      }
    });

    // 加载HLS源
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    // 兜底：让 video 元素也拿到 src
    if (!video.src) {
      try {
        video.src = url;
      } catch {
        // ignore
      }
    }

    // 存储hlsPlayer实例以便后续清理
    video.streamPlayer = hlsPlayer;
    if (art) {
      art.hls = hlsPlayer;
      try {
        art.on("destroy", () => hlsPlayer.destroy());
      } catch {
        // ignore
      }
      // 菜单：只在 HLS 时出现
      installHlsMenus(art, hlsPlayer);
    }
    console.log("HLS播放器初始化完成");
  };

  // 设置URL类型为 m3u8
  options.type = "m3u8";
};

// 设置 mpegts.js 播放器 (支持 FLV 和 MPEG-TS)
const setupMpegTSPlayer = async (options, videoUrl, format) => {
  console.log(`正在加载 mpegts.js 用于 ${format.toUpperCase()} 播放...`);

  // 动态导入 mpegts.js
  const mpegts = await import("mpegts.js");

  // 检查浏览器支持
  if (!mpegts.isSupported?.()) {
    console.warn("当前浏览器不支持MPEG-TS/FLV播放");
    emit("error", {
      type: `${format}_not_supported`,
      message: `当前浏览器不支持${format.toUpperCase()}播放，请使用Chrome、Firefox或Edge浏览器`,
    });
    return;
  }

  console.log(`mpegts.js加载成功，配置${format.toUpperCase()}播放器...`);

  // 配置自定义类型
  options.customType[format] = function (video, url) {
    console.log(`初始化${format.toUpperCase()}播放器，URL:`, url);

    const inferredTsType =
      format === "flv"
        ? "flv"
        : url.toLowerCase().includes(".m2ts") || (props.video?.name || "").toLowerCase().endsWith(".m2ts")
          ? "m2ts"
          : "mpegts";

    const playerConfig = {
      type: inferredTsType,
      isLive: false,
      cors: true,
      withCredentials: false,
      url: url,
    };

    const mediaConfig = {
      accurateSeek: true,
      seekType: "range",
      lazyLoadMaxDuration: 5 * 60,
      reuseRedirectedURL: true,
    };

    const streamPlayer = mpegts.createPlayer(playerConfig, mediaConfig);

    // 播放器事件处理
    streamPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
      console.error(`${format.toUpperCase()}播放错误:`, errorType, errorDetail);

      let errorMessage = `${format.toUpperCase()}播放出现错误`;
      switch (errorType) {
        case mpegts.ErrorTypes.NETWORK_ERROR:
          errorMessage = `网络错误，无法加载${format.toUpperCase()}视频`;
          break;
        case mpegts.ErrorTypes.MEDIA_ERROR:
          errorMessage = `媒体解码错误，${format.toUpperCase()}格式可能不兼容`;
          break;
        case mpegts.ErrorTypes.OTHER_ERROR:
          errorMessage = `加载错误，无法获取${format.toUpperCase()}视频数据`;
          break;
        default:
          errorMessage = `${format.toUpperCase()}播放错误: ${errorDetail?.info || "未知错误"}`;
      }

      emit("error", {
        type: `${format}_error`,
        errorType,
        errorDetail,
        message: errorMessage,
      });
    });

    streamPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log(`${format.toUpperCase()}加载完成`);
    });

    streamPlayer.on(mpegts.Events.RECOVERED_EARLY_EOF, () => {
      console.log(`${format.toUpperCase()}早期EOF恢复`);
    });

    streamPlayer.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
      console.log(`${format.toUpperCase()}媒体信息:`, mediaInfo);
    });

    // 绑定到video元素并加载
    streamPlayer.attachMediaElement(video);
    streamPlayer.load();

    // 存储streamPlayer实例以便后续清理
    video.streamPlayer = streamPlayer;

    console.log(`${format.toUpperCase()}播放器初始化完成`);
  };

  // 设置URL类型
  options.type = format;

  console.log(` ${format.toUpperCase()}支持配置完成`);
};

// 绑定事件监听器
const bindEvents = () => {
  if (!artplayerInstance.value) return;

  const art = artplayerInstance.value;

  art.on("play", () => {
    emit("play", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("pause", () => {
    emit("pause", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("ended", () => {
    emit("ended", {
      video: props.video,
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  art.on("timeupdate", () => {
    emit("timeupdate", {
      currentTime: art.currentTime,
      duration: art.duration,
      percentage: art.duration > 0 ? (art.currentTime / art.duration) * 100 : 0,
    });
  });

  art.on("loadstart", () => {
    emit("loadstart");
  });

  art.on("canplay", () => {
    emit("canplay");
  });

  art.on("error", (error) => {
    console.error("Artplayer 播放错误:", error);
    emit("error", error);
  });

  art.on("fullscreen", (state) => {
    if (state) {
      emit("fullscreen");
    } else {
      emit("fullscreenExit");
    }
  });

  art.on("volumechange", () => {
    emit("volumechange", {
      volume: art.volume,
      muted: art.muted,
    });
  });

  art.on("seeked", () => {
    emit("seeked", {
      currentTime: art.currentTime,
      duration: art.duration,
    });
  });

  // 新增的高级功能事件
  art.on("flip", (flip) => {
    emit("flip", flip);
  });

  art.on("aspectRatio", (ratio) => {
    emit("aspectRatio", ratio);
  });

  art.on("pip", (state) => {
    emit("pip", state);
  });

  art.on("lock", (state) => {
    emit("lock", state);
  });

  art.on("screenshot", (dataUri) => {
    emit("screenshot", dataUri);
  });

  // 移动端手势事件
  art.on("gesture", (event) => {
    emit("gesture", event);
  });

  // 网页全屏事件
  art.on("fullscreenWeb", (state) => {
    emit("fullscreenWeb", state);
  });
};

// 应用主题样式
const applyThemeStyles = () => {
  if (!artplayerContainer.value) return;

  nextTick(() => {
    const artplayerElement = artplayerContainer.value.querySelector(".art-video-player");
    if (!artplayerElement) return;

    // 更新主题色
    const themeColor = getThemeColor();
    artplayerElement.style.setProperty("--art-theme", themeColor);

    // 应用暗色主题类
    if (props.darkMode) {
      artplayerContainer.value.classList.add("dark-theme");
    } else {
      artplayerContainer.value.classList.remove("dark-theme");
    }
  });
};

// 公开的方法
const play = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.play();
  }
};

const pause = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pause();
  }
};

const toggle = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.toggle();
  }
};

const seek = (time) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.seek = time;
  }
};

const setVolume = (volume) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.volume = volume;
  }
};

const setMuted = (muted) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.muted = muted;
  }
};

const setPlaybackRate = (rate) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.playbackRate = rate;
  }
};

const enterFullscreen = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.fullscreen = true;
  }
};

const exitFullscreen = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.fullscreen = false;
  }
};

const screenshot = async (filename) => {
  if (artplayerInstance.value) {
    try {
      // 使用 Artplayer 的内置截图功能，会自动下载
      artplayerInstance.value.screenshot(filename || `video-screenshot-${Date.now()}`);
      return true;
    } catch (error) {
      console.error("截图失败:", error);
      return false;
    }
  }
  return false;
};

const getScreenshotDataURL = async () => {
  if (artplayerInstance.value) {
    try {
      return await artplayerInstance.value.getDataURL();
    } catch (error) {
      console.error("获取截图 DataURL 失败:", error);
      return null;
    }
  }
  return null;
};

const getScreenshotBlobUrl = async () => {
  if (artplayerInstance.value) {
    try {
      return await artplayerInstance.value.getBlobUrl();
    } catch (error) {
      console.error("获取截图 BlobUrl 失败:", error);
      return null;
    }
  }
  return null;
};

// 视频翻转控制
const setFlip = (flipType) => {
  if (artplayerInstance.value) {
    // flipType: 'normal', 'horizontal', 'vertical'
    artplayerInstance.value.flip = flipType;
  }
};

const getFlip = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.flip;
  }
  return "normal";
};

// 视频长宽比控制
const setAspectRatio = (ratio) => {
  if (artplayerInstance.value) {
    // ratio: '16:9', '4:3', '1:1', 'default' 等
    artplayerInstance.value.aspectRatio = ratio;
  }
};

const getAspectRatio = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.aspectRatio;
  }
  return "default";
};

// 移动端锁定控制
const setLock = (locked) => {
  if (artplayerInstance.value) {
    artplayerInstance.value.lock = locked;
  }
};

const getLock = () => {
  if (artplayerInstance.value) {
    return artplayerInstance.value.lock;
  }
  return false;
};

// 画中画控制
const enterPip = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pip = true;
  }
};

const exitPip = () => {
  if (artplayerInstance.value) {
    artplayerInstance.value.pip = false;
  }
};

// 暴露方法给父组件
defineExpose({
  play,
  pause,
  toggle,
  seek,
  setVolume,
  setMuted,
  setPlaybackRate,
  enterFullscreen,
  exitFullscreen,
  screenshot,
  getScreenshotDataURL,
  getScreenshotBlobUrl,
  setFlip,
  getFlip,
  setAspectRatio,
  getAspectRatio,
  setLock,
  getLock,
  enterPip,
  exitPip,
  getInstance: () => artplayerInstance.value,
});

// 监听属性变化
watch(
  () => props.darkMode,
  () => {
    applyThemeStyles();
  },
  { immediate: false }
);

watch(
  () => props.theme,
  () => {
    if (artplayerInstance.value) {
      artplayerInstance.value.theme = getThemeColor();
    }
    applyThemeStyles();
  }
);

watch(
  () => [props.video, props.loop, props.volume, props.muted],
  () => {
    initArtplayer();
  },
  { deep: true }
);

watch(
  () => props.volume,
  (newVolume) => {
    setVolume(newVolume);
  }
);

watch(
  () => props.muted,
  (newMuted) => {
    setMuted(newMuted);
  }
);

// 生命周期
onMounted(() => {
  nextTick(() => {
    initArtplayer();
  });
});

onBeforeUnmount(() => {
  if (artplayerInstance.value) {
    // 清理流媒体播放器实例
    if (artplayerInstance.value.streamPlayer) {
      try {
        console.log("🧹 清理流媒体播放器实例...");
        if (artplayerInstance.value.streamPlayer.pause) {
          artplayerInstance.value.streamPlayer.pause();
        }
        if (artplayerInstance.value.streamPlayer.unload) {
          artplayerInstance.value.streamPlayer.unload();
        }
        if (artplayerInstance.value.streamPlayer.detachMediaElement) {
          artplayerInstance.value.streamPlayer.detachMediaElement();
        }
        if (artplayerInstance.value.streamPlayer.destroy) {
          artplayerInstance.value.streamPlayer.destroy();
        }
        console.log("🧹 流媒体播放器清理完成");
      } catch (error) {
        console.warn("清理流媒体播放器时出错:", error);
      }
    }

    // 清理Artplayer实例
    artplayerInstance.value.destroy();
    artplayerInstance.value = null;
  }
});
</script>

<style scoped>
.video-player-container {
  width: 100%;
  position: relative;
}

.artplayer-container {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 80vh;
  min-height: 200px;
}

/* 全屏模式：通过 prop 控制，移除宽高比和最大高度限制 */
.is-fullscreen .artplayer-container {
  aspect-ratio: unset;
  max-height: none;
  height: 100%;
}
</style>

<style>
/* 播放器自身全屏时的样式 */
.artplayer-container:fullscreen,
.art-video-player:fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  border-radius: 0 !important;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .artplayer-container {
    min-height: 180px;
  }
}

/* 确保播放器在容器中正确显示 */
.artplayer-container .art-video-player {
  border-radius: 8px;
  overflow: hidden;
}
</style>
