/**
 * 全局音乐播放器 Composable
 * 提供简化的播放器控制 API，配合官方 APlayer 实例
 */

import { useGlobalPlayerStore } from "@/stores/globalPlayerStore.js";
import { storeToRefs } from "pinia";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("GlobalPlayer");

export function useGlobalPlayer() {
  const store = useGlobalPlayerStore();

  // 解构响应式状态
  const {
    isVisible,
    isPlaying,
    isMiniMode,
    isExpandedMode,
    currentTrack,
    hasPlaylist,
    playlist,
    currentIndex,
    progress,
    volume,
    loopMode,
    orderMode,
    formattedCurrentTime,
    formattedDuration,
    error,
  } = storeToRefs(store);

  /**
   * 播放音频列表
   * @param {Array} audioList - 音频列表
   * @param {number} startIndex - 开始播放的索引
   */
  const playAudio = (audioList, startIndex = 0) => {
    if (!audioList || audioList.length === 0) {
      log.warn("playAudio: 音频列表为空");
      return;
    }
    store.setPlaylist(audioList, startIndex);
    store.setDisplayMode("expanded");
  };

  /**
   * 播放单个音频
   * @param {Object} audio - 音频对象
   */
  const playSingleAudio = (audio) => {
    if (!audio || !audio.url) {
      log.warn("playSingleAudio: 音频对象无效");
      return;
    }
    playAudio([audio], 0);
  };

  /**
   * 添加音频到播放列表
   * @param {Object} audio - 音频对象
   * @param {boolean} playNow - 是否立即播放
   */
  const addToPlaylist = (audio, playNow = false) => {
    store.addToPlaylist(audio);
    if (playNow) {
      const index = store.playlist.length - 1;
      store.switchTrack(index);
    }
    store.showPlayer();
  };

  /**
   * 切换播放/暂停
   */
  const togglePlay = () => {
    store.togglePlay();
  };

  /**
   * 播放
   */
  const play = () => {
    store.play();
  };

  /**
   * 暂停
   */
  const pause = () => {
    store.pause();
  };

  /**
   * 播放下一首
   */
  const playNext = () => {
    store.playNext();
  };

  /**
   * 播放上一首
   */
  const playPrev = () => {
    store.playPrev();
  };

  /**
   * 切换到指定索引的音频
   * @param {number} index - 索引
   */
  const switchTo = (index) => {
    store.switchTrack(index);
  };

  /**
   * 设置音量
   * @param {number} vol - 音量 (0-1)
   */
  const setVolume = (vol) => {
    store.setVolume(vol);
  };

  /**
   * 跳转到指定时间
   * @param {number} time - 时间（秒）
   */
  const seekTo = (time) => {
    store.seekTo(time);
  };

  /**
   * 显示播放器
   */
  const showPlayer = () => {
    store.showPlayer();
  };

  /**
   * 隐藏播放器
   */
  const hidePlayer = () => {
    store.hidePlayer();
  };

  /**
   * 切换播放器显示/隐藏
   */
  const togglePlayer = () => {
    store.toggleVisibility();
  };

  /**
   * 切换 mini/expanded 模式
   */
  const toggleDisplayMode = () => {
    store.toggleDisplayMode();
  };

  /**
   * 设置为 mini 模式
   */
  const setMiniMode = () => {
    store.setDisplayMode("mini");
  };

  /**
   * 设置为展开模式
   */
  const setExpandedMode = () => {
    store.setDisplayMode("expanded");
  };

  /**
   * 关闭播放器
   */
  const closePlayer = () => {
    store.closePlayer();
  };

  /**
   * 清空播放列表
   */
  const clearPlaylist = () => {
    store.clearPlaylist();
  };

  /**
   * 切换循环模式
   */
  const toggleLoopMode = () => {
    store.toggleLoopMode();
  };

  /**
   * 切换播放顺序
   */
  const toggleOrderMode = () => {
    store.toggleOrderMode();
  };

  /**
   * 获取 APlayer 实例（高级用法）
   */
  const getAPlayerInstance = () => {
    return store.getAPlayerInstance();
  };

  return {
    // 状态（只读）
    isVisible,
    isPlaying,
    isMiniMode,
    isExpandedMode,
    currentTrack,
    hasPlaylist,
    playlist,
    currentIndex,
    progress,
    volume,
    loopMode,
    orderMode,
    formattedCurrentTime,
    formattedDuration,
    error,

    // 播放控制
    playAudio,
    playSingleAudio,
    addToPlaylist,
    togglePlay,
    play,
    pause,
    playNext,
    playPrev,
    switchTo,
    setVolume,
    seekTo,

    // 显示控制
    showPlayer,
    hidePlayer,
    togglePlayer,
    toggleDisplayMode,
    setMiniMode,
    setExpandedMode,
    closePlayer,
    clearPlaylist,

    // 模式控制
    toggleLoopMode,
    toggleOrderMode,

    // APlayer 实例（高级用法）
    getAPlayerInstance,

    // Store 引用（高级用法）
    store,
  };
}
