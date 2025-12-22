import { ref, onMounted, onBeforeUnmount, unref } from "vue";

/**
 * 通用“元素全屏”工具（Fullscreen API）
 *
 */
export function useElementFullscreen(targetRef) {
  const isFullscreen = ref(false);

  const getTargetEl = () => unref(targetRef) || null;

  const syncState = () => {
    const el = getTargetEl();
    isFullscreen.value = Boolean(el && document.fullscreenElement === el);
  };

  const requestFullscreen = async () => {
    const el = getTargetEl();
    if (!el) return;
    try {
      await el.requestFullscreen();
    } catch {
      // 静默：有些浏览器/环境会拒绝
    } finally {
      syncState();
    }
  };

  const exitFullscreen = async () => {
    const el = getTargetEl();
    if (!el || document.fullscreenElement !== el) return;
    try {
      await document.exitFullscreen();
    } catch {
      // 静默
    } finally {
      syncState();
    }
  };

  const toggleFullscreen = async () => {
    if (isFullscreen.value) {
      await exitFullscreen();
      return;
    }
    await requestFullscreen();
  };

  const handleFullscreenChange = () => {
    syncState();
  };

  onMounted(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    syncState();
  });

  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  });

  return {
    isFullscreen,
    requestFullscreen,
    exitFullscreen,
    toggleFullscreen,
    syncState,
  };
}

