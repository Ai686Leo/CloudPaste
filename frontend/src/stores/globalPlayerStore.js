/**
 * 全局音乐播放器状态管理 Store
 * 使用 Pinia 管理全局播放器状态，配合官方 APlayer 实例
 */

import { defineStore } from "pinia";
import { ref, computed, shallowRef } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("GlobalPlayerStore");

// localStorage 存储键
const STORAGE_KEY = "cloudpaste-global-player";

export const useGlobalPlayerStore = defineStore("globalPlayer", () => {
  // ===== 状态定义 =====

  // 播放器可见性
  const isVisible = ref(false);

  // 播放器模式：'mini' | 'expanded'
  const displayMode = ref("mini");

  // 播放状态
  const isPlaying = ref(false);


  // 播放列表
  const playlist = ref([]);

  // 当前播放索引
  const currentIndex = ref(0);

  // 播放进度（秒）
  const currentTime = ref(0);

  // 音频总时长（秒）
  const duration = ref(0);

  // 音量 (0-1)
  const volume = ref(0.7);

  // 循环模式：'all' | 'one' | 'none'
  const loopMode = ref("all");

  // 播放顺序：'list' | 'random'
  const orderMode = ref("list");

  // APlayer 实例引用（由 GlobalMusicPlayer 组件设置）
  const aplayerInstance = shallowRef(null);

  // 错误信息
  const error = ref(null);

  // ===== 计算属性 =====

  // 当前播放的音频
  const currentTrack = computed(() => {
    if (playlist.value.length === 0) return null;
    return playlist.value[currentIndex.value] || null;
  });

  // 是否有播放列表
  const hasPlaylist = computed(() => playlist.value.length > 0);

  // 是否为 mini 模式
  const isMiniMode = computed(() => displayMode.value === "mini");

  // 是否为展开模式
  const isExpandedMode = computed(() => displayMode.value === "expanded");

  // 播放进度百分比
  const progress = computed(() => {
    if (!duration.value) return 0;
    return (currentTime.value / duration.value) * 100;
  });

  // 格式化当前时间
  const formattedCurrentTime = computed(() => formatTime(currentTime.value));

  // 格式化总时长
  const formattedDuration = computed(() => formatTime(duration.value));

  // ===== 工具函数 =====

  /**
   * 格式化时间为 mm:ss
   */
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // ===== APlayer 实例管理 =====

  /**
   * 设置 APlayer 实例引用
   */
  const setAPlayerInstance = (instance) => {
    aplayerInstance.value = instance;
  };

  /**
   * 获取 APlayer 实例
   */
  const getAPlayerInstance = () => {
    return aplayerInstance.value;
  };

  // ===== 状态同步方法（由 GlobalMusicPlayer 调用） =====

  /**
   * 同步播放状态
   */
  const syncPlayState = (playing) => {
    isPlaying.value = playing;
  };

  /**
   * 同步播放进度
   */
  const syncProgress = (time, dur) => {
    currentTime.value = time || 0;
    duration.value = dur || 0;
  };

  /**
   * 同步当前索引
   */
  const syncCurrentIndex = (index) => {
    currentIndex.value = index;
  };

  // ===== 播放控制方法 =====

  /**
   * 播放
   */
  const play = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.play();
    }
  };

  /**
   * 暂停
   */
  const pause = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.pause();
    }
  };

  /**
   * 切换播放/暂停
   */
  const togglePlay = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.toggle();
    }
  };

  /**
   * 跳转到指定时间
   */
  const seekTo = (time) => {
    if (aplayerInstance.value) {
      aplayerInstance.value.seek(time);
    }
  };

  /**
   * 根据百分比跳转
   */
  const seekToPercent = (percent) => {
    if (duration.value && aplayerInstance.value) {
      aplayerInstance.value.seek((percent / 100) * duration.value);
    }
  };

  // ===== 显示控制 =====

  /**
   * 显示播放器
   */
  const showPlayer = () => {
    isVisible.value = true;
  };

  /**
   * 隐藏播放器
   */
  const hidePlayer = () => {
    isVisible.value = false;
  };

  /**
   * 切换播放器显示/隐藏
   */
  const toggleVisibility = () => {
    isVisible.value = !isVisible.value;
  };

  /**
   * 切换 mini/expanded 模式
   */
  const toggleDisplayMode = () => {
    displayMode.value = displayMode.value === "mini" ? "expanded" : "mini";
    saveToStorage();
  };

  /**
   * 设置显示模式
   */
  const setDisplayMode = (mode) => {
    if (mode === "mini" || mode === "expanded") {
      displayMode.value = mode;
      saveToStorage();
    }
  };

  // ===== 播放列表管理 =====

  /**
   * 设置播放列表并开始播放
   */
  const setPlaylist = (audioList, startIndex = 0) => {
    if (!audioList || audioList.length === 0) return;

    playlist.value = audioList.map((audio) => ({
      name: audio.name || audio.title || "未知音频",
      artist: audio.artist || "未知艺术家",
      url: audio.url,
      cover: audio.cover || audio.poster || null,
      originalFile: audio.originalFile || null,
    }));

    currentIndex.value = Math.min(startIndex, audioList.length - 1);
    isVisible.value = true;

    saveToStorage();
  };

  /**
   * 添加音频到播放列表
   */
  const addToPlaylist = (audio) => {
    if (!audio || !audio.url) return;

    const exists = playlist.value.some((item) => item.url === audio.url);
    if (exists) return;

    playlist.value.push({
      name: audio.name || audio.title || "未知音频",
      artist: audio.artist || "未知艺术家",
      url: audio.url,
      cover: audio.cover || audio.poster || null,
      originalFile: audio.originalFile || null,
    });

    // 如果 APlayer 实例存在，也添加到 APlayer
    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.add({
        name: audio.name || audio.title || "未知音频",
        artist: audio.artist || "未知艺术家",
        url: audio.url,
        cover: audio.cover || audio.poster || null,
      });
    }

    saveToStorage();
  };

  /**
   * 从播放列表移除音频
   */
  const removeFromPlaylist = (index) => {
    if (index < 0 || index >= playlist.value.length) return;

    playlist.value.splice(index, 1);

    // 如果 APlayer 实例存在，也从 APlayer 移除
    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.remove(index);
    }

    if (playlist.value.length === 0) {
      currentIndex.value = 0;
    } else if (index < currentIndex.value) {
      currentIndex.value--;
    } else if (index === currentIndex.value && currentIndex.value >= playlist.value.length) {
      currentIndex.value = playlist.value.length - 1;
    }

    saveToStorage();
  };

  /**
   * 清空播放列表
   */
  const clearPlaylist = () => {
    playlist.value = [];
    currentIndex.value = 0;
    currentTime.value = 0;
    duration.value = 0;

    if (aplayerInstance.value && aplayerInstance.value.list) {
      aplayerInstance.value.list.clear();
    }

    saveToStorage();
  };

  /**
   * 切换到指定曲目
   */
  const switchTrack = (index) => {
    if (index >= 0 && index < playlist.value.length) {
      currentIndex.value = index;
      if (aplayerInstance.value && aplayerInstance.value.list) {
        aplayerInstance.value.list.switch(index);
      }
      saveToStorage();
    }
  };

  /**
   * 播放下一首
   */
  const playNext = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.skipForward();
    }
  };

  /**
   * 播放上一首
   */
  const playPrev = () => {
    if (aplayerInstance.value) {
      aplayerInstance.value.skipBack();
    }
  };

  /**
   * 设置音量
   */
  const setVolume = (vol) => {
    volume.value = Math.max(0, Math.min(1, vol));
    if (aplayerInstance.value) {
      aplayerInstance.value.volume(volume.value, true);
    }
    saveToStorage();
  };

  /**
   * 切换循环模式
   */
  const toggleLoopMode = () => {
    const modes = ["all", "one", "none"];
    const currentModeIndex = modes.indexOf(loopMode.value);
    loopMode.value = modes[(currentModeIndex + 1) % modes.length];
    saveToStorage();
  };

  /**
   * 设置循环模式
   */
  const setLoopMode = (mode) => {
    if (["all", "one", "none"].includes(mode)) {
      loopMode.value = mode;
      saveToStorage();
    }
  };

  /**
   * 切换播放顺序
   */
  const toggleOrderMode = () => {
    orderMode.value = orderMode.value === "list" ? "random" : "list";
    saveToStorage();
  };

  /**
   * 设置播放顺序
   */
  const setOrderMode = (order) => {
    if (["list", "random"].includes(order)) {
      orderMode.value = order;
      saveToStorage();
    }
  };

  /**
   * 关闭播放器
   */
  const closePlayer = () => {
    isVisible.value = false;
    isPlaying.value = false;
    playlist.value = [];
    currentIndex.value = 0;
    currentTime.value = 0;
    duration.value = 0;
    displayMode.value = "mini";
    error.value = null;
    aplayerInstance.value = null;

    clearStorage();
  };

  // ===== 持久化方法 =====

  const storedState = useLocalStorage(STORAGE_KEY, null, { writeDefaults: false });

  const saveToStorage = () => {
    try {
      const state = {
        displayMode: displayMode.value,
        volume: volume.value,
        loopMode: loopMode.value,
        orderMode: orderMode.value,
      };
      storedState.value = state;
    } catch (e) {
      log.warn("保存播放器状态失败:", e);
    }
  };

  const loadFromStorage = () => {
    try {
      const state = storedState.value;
      if (!state || typeof state !== "object") return;
      if (state.displayMode) displayMode.value = state.displayMode;
      if (typeof state.volume === "number") volume.value = state.volume;
      if (state.loopMode) loopMode.value = state.loopMode;
      if (state.orderMode) orderMode.value = state.orderMode;
    } catch (e) {
      log.warn("加载播放器状态失败:", e);
    }
  };

  const clearStorage = () => {
    try {
      storedState.remove?.();
    } catch (e) {
      log.warn("清除播放器状态失败:", e);
    }
  };

  const initialize = () => {
    loadFromStorage();
  };

  initialize();

  return {
    // 状态
    isVisible,
    displayMode,
    isPlaying,
    playlist,
    currentIndex,
    currentTime,
    duration,
    volume,
    loopMode,
    orderMode,
    error,

    // 计算属性
    currentTrack,
    hasPlaylist,
    isMiniMode,
    isExpandedMode,
    progress,
    formattedCurrentTime,
    formattedDuration,

    // APlayer 实例管理
    setAPlayerInstance,
    getAPlayerInstance,

    // 状态同步
    syncPlayState,
    syncProgress,
    syncCurrentIndex,

    // 播放控制
    play,
    pause,
    togglePlay,
    seekTo,
    seekToPercent,

    // 显示控制
    showPlayer,
    hidePlayer,
    toggleVisibility,
    toggleDisplayMode,
    setDisplayMode,

    // 播放列表管理
    setPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    clearPlaylist,
    switchTrack,
    playNext,
    playPrev,
    setVolume,
    toggleLoopMode,
    setLoopMode,
    toggleOrderMode,
    setOrderMode,
    closePlayer,

    // 持久化
    saveToStorage,
    loadFromStorage,
    clearStorage,
    initialize,
  };
});
