<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="lightbox.isOpen.value"
        ref="shellRef"
        class="p-dialog p-lightbox v-dialog--lightbox v-overlay--active is-ltr"
        :class="lightbox.darkMode.value ? 'is-dark' : 'is-light'"
        tabindex="-1"
        @pointerdown.capture="handleShellPointerDown"
        @wheel.capture.passive="handleShellWheel"
      >
        <!-- Underlay：承接“背景点击”语义 -->
        <div class="p-lightbox__underlay" />

        <div class="p-lightbox__container">
          <div
            class="p-lightbox__content"
            :class="{
              'sidebar-visible': lightbox.sidebarOpen.value,
              'slideshow-active': lightbox.slideshowActive.value,
              'is-zoomable': isZoomable,
            }"
          >
            <!-- PhotoSwipe 挂载点 -->
            <div ref="pswpHostRef" class="p-lightbox__pswp" />
          </div>

          <!-- 右侧信息栏 -->
          <FsMediaLightboxSidebar
            v-if="lightbox.sidebarOpen.value"
            :item="lightbox.currentItem.value"
            :image-states="lightbox.imageStates.value"
            :load-image-url="lightbox.loadImageUrl.value"
            @close="lightbox.toggleSidebar()"
          />
        </div>

        <!-- 菜单弹层 -->
        <FsMediaLightboxMenu
          :open="lightbox.menuOpen.value"
          :dark-mode="lightbox.darkMode.value"
          :anchor-el="menuButtonEl"
          @download="handleDownload"
          @get-link="handleGetLink"
          @close="handleClose"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, watch, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { usePhotoSwipe } from "@/composables/ui-interaction/usePhotoSwipe";
import { useFsService } from "@/modules/fs";
import { useFsMediaLightbox } from "../../composables/useFsMediaLightbox";
import FsMediaLightboxSidebar from "./FsMediaLightboxSidebar.vue";
import FsMediaLightboxMenu from "./FsMediaLightboxMenu.vue";

const fsService = useFsService();
const lightbox = useFsMediaLightbox();

const shellRef = ref(null);
const pswpHostRef = ref(null);
const menuButtonEl = ref(null);
const isZoomable = ref(true);

let unbindZoomableListeners = null;
let unbindPswpInteractionListeners = null;

const syncSlideshowButton = () => {
  const pswp = getPswp();
  const template = pswp?.template;
  if (!template) return;
  const btn = template.querySelector?.(".pswp__button--slideshow-toggle");
  if (!btn) return;
  btn.classList.toggle("is-active", !!lightbox.slideshowActive.value);
};

const {
  initPhotoSwipe,
  openPhotoSwipe,
  destroyPhotoSwipe,
  closePhotoSwipe,
  setExternalHandlers,
  setVideoResolver,
  setAppendToEl,
  getPswp,
} = usePhotoSwipe();

let slideshowTimer = null;
let slideshowToken = 0;

const lockBodyScroll = () => {
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
};

const unlockBodyScroll = () => {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
};

const handleClose = () => {
  lightbox.close();
};

const handleDownload = () => {
  lightbox.requestDownload();
  lightbox.menuOpen.value = false;
};

const handleGetLink = () => {
  lightbox.requestGetLink();
  lightbox.menuOpen.value = false;
};

const pauseSlideshow = () => {
  if (!lightbox.slideshowActive.value) return;
  stopSlideshow();
};

const toggleMenu = () => {
  // 打开菜单时暂停幻灯片（避免自动切图导致误操作）
  if (!lightbox.menuOpen.value) pauseSlideshow();
  lightbox.toggleMenu();
};

const toggleSidebar = () => {
  // 打开信息面板时暂停幻灯片
  if (!lightbox.sidebarOpen.value) pauseSlideshow();
  lightbox.toggleSidebar();
};

const handleShellPointerDown = (event) => {
  // 任何用户交互会中断幻灯片，但不干扰“点击幻灯片按钮本身”的 toggle 行为
  if (!event?.target?.closest?.(".pswp__button--slideshow-toggle")) {
    pauseSlideshow();
  }
  if (!lightbox.menuOpen.value) return;
  if (event?.target?.closest?.(".fs-media-lightbox-menu")) return;
  if (event?.target?.closest?.(".pswp__button--menu-button")) return;
  lightbox.menuOpen.value = false;
};

const handleShellWheel = () => {
  pauseSlideshow();
};

const requestFullscreen = async () => {
  const el = shellRef.value;
  if (!el) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await el.requestFullscreen();
  }
};

const stopSlideshow = () => {
  slideshowToken += 1;
  if (slideshowTimer) clearTimeout(slideshowTimer);
  slideshowTimer = null;
  lightbox.setSlideshowActive(false);
  syncSlideshowButton();
};

const startSlideshow = () => {
  stopSlideshow();
  lightbox.setSlideshowActive(true);
  syncSlideshowButton();
  const token = slideshowToken;
  const tick = () => {
    // 防止竞态：用户交互 stop 后仍然“再切一次”
    if (token !== slideshowToken) return;
    if (!lightbox.slideshowActive.value) return;
    getPswp()?.next?.();
    slideshowTimer = setTimeout(tick, 5000);
  };
  slideshowTimer = setTimeout(tick, 5000);
};

const toggleSlideshow = () => {
  if (lightbox.slideshowActive.value) {
    stopSlideshow();
  } else {
    startSlideshow();
  }
};

const onKeyDown = (e) => {
  if (!lightbox.isOpen.value) return;

  // 输入框内不处理快捷键
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    /** @type {any} */ (active)?.isContentEditable
  ) {
    return;
  }

  const key = String(e.key || "");
  const lower = key.toLowerCase();
  const hasCtrlLike = !!(e.ctrlKey || e.metaKey);

  if (e.key === "Escape") {
    e.preventDefault();
    pauseSlideshow();
    handleClose();
    return;
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    pauseSlideshow();
    getPswp()?.prev?.();
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    pauseSlideshow();
    getPswp()?.next?.();
    return;
  }

  if (lower === "i") {
    e.preventDefault();
    pauseSlideshow();
    toggleSidebar();
    return;
  }

  if (lower === "m") {
    e.preventDefault();
    pauseSlideshow();
    toggleMenu();
    return;
  }

  if (lower === "f") {
    e.preventDefault();
    pauseSlideshow();
    void requestFullscreen();
    return;
  }

  // D/L 常用快捷键（菜单里展示的是 Ctrl-*，但实际按键不强制 Ctrl；两种都支持）
  if (lower === "d" && (hasCtrlLike || (!e.ctrlKey && !e.metaKey && !e.altKey))) {
    e.preventDefault();
    pauseSlideshow();
    handleDownload();
    return;
  }

  if (lower === "l" && (hasCtrlLike || (!e.ctrlKey && !e.metaKey && !e.altKey))) {
    e.preventDefault();
    pauseSlideshow();
    handleGetLink();
    return;
  }

  if (e.key === " ") {
    e.preventDefault();
    toggleSlideshow();
    return;
  }
};

// 注册键盘事件（自动清理；内部会根据 isOpen 判断是否处理）
useEventListener(window, "keydown", onKeyDown, { passive: false });

const cleanup = () => {
  stopSlideshow();
  unlockBodyScroll();
  closePhotoSwipe();
  destroyPhotoSwipe();
  if (typeof unbindZoomableListeners === "function") {
    unbindZoomableListeners();
    unbindZoomableListeners = null;
  }
  if (typeof unbindPswpInteractionListeners === "function") {
    unbindPswpInteractionListeners();
    unbindPswpInteractionListeners = null;
  }
  isZoomable.value = true;
};

watch(
  () => lightbox.isOpen.value,
  async (open) => {
    if (!open) {
      cleanup();
      return;
    }

    await nextTick();

    lockBodyScroll();

    // PhotoSwipe 容器与外部控制回调
    setAppendToEl(pswpHostRef.value);
    setExternalHandlers({
      onRequestClose: handleClose,
      onToggleSidebar: () => toggleSidebar(),
      onToggleMenu: () => toggleMenu(),
      onToggleFullscreen: () => requestFullscreen(),
      onToggleSlideshow: () => toggleSlideshow(),
      getSlideshowActive: () => lightbox.slideshowActive.value,
      onMenuButtonInit: (el) => {
        menuButtonEl.value = el || null;
      },
      onIndexChange: (i) => {
        lightbox.setIndex(i);
        lightbox.menuOpen.value = false;
      },
      onClosed: () => lightbox.close(),
    });

    // Live Photo / 视频：由 FS Service 提供预签名解析（forceDownload=false）
    setVideoResolver(async (path) => {
      if (!path) return "";
      try {
        const url = await fsService.getFileLink(path, null, false);
        return url || "";
      } catch {
        return "";
      }
    });

    initPhotoSwipe();

    // 仅当会话具备数据源时才打开
    const items = Array.isArray(lightbox.items.value) ? lightbox.items.value : [];
    if (items.length === 0) return;

    await openPhotoSwipe(items, lightbox.index.value, lightbox.imageStates.value, lightbox.loadImageUrl.value, {
      darkMode: lightbox.darkMode.value,
    });

    // 仅在“可缩放”时展示 zoom toggle
    const pswp = getPswp();
    if (pswp) {
      const updateZoomable = () => {
        const template = pswp.template;
        isZoomable.value = !!template?.classList?.contains?.("pswp--zoom-allowed");
      };

      pswp.on("change", updateZoomable);
      pswp.on("zoomPanUpdate", updateZoomable);
      pswp.on("zoomLevelsUpdate", updateZoomable);
      updateZoomable();

      unbindZoomableListeners = () => {
        try {
          pswp.off("change", updateZoomable);
          pswp.off("zoomPanUpdate", updateZoomable);
          pswp.off("zoomLevelsUpdate", updateZoomable);
        } catch {
          // ignore
        }
      };
    }

    // 用户交互中断幻灯片
    if (pswp) {
      pswp.on("change", syncSlideshowButton);
      unbindPswpInteractionListeners = () => {
        try {
          pswp.off("change", syncSlideshowButton);
        } catch {
          // ignore
        }
      };
    }

    // 确保按钮状态与当前 slideshowActive 同步（键盘/外部触发时不会漏掉）
    syncSlideshowButton();

    // 让 shell 获取焦点，便于键盘操作
    shellRef.value?.focus?.();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  cleanup();
});
</script>
