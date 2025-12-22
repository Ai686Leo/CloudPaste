/**
 * PhotoSwipe图片预览组合式函数
 * 基于PhotoSwipe v5
 */

import { ref, nextTick } from "vue";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import "@/styles/photoswipe-custom.css";
import "@/components/common/LivePhoto/LivePhotoViewer.css";
import { LIVE_PHOTO_BADGE_ICON_SVG } from "@/components/common/LivePhoto/livePhotoBadgeIconSvg.js";

export function usePhotoSwipe() {
  const lightbox = ref(null);
  const isInitialized = ref(false);

  const session = {
    items: /** @type {Array<any>} */ ([]),
    imageStates: /** @type {Map<string, any> | null} */ (null),
    loadImageUrl: /** @type {Function | null} */ (null),
    abortController: /** @type {AbortController | null} */ (null),
    appendToEl: /** @type {HTMLElement | null} */ (null),
    resolveVideoSrc: /** @type {((path: string) => Promise<string>) | null} */ (null),
    handlers: /** @type {any} */ ({
      onRequestClose: null,
      onToggleSidebar: null,
      onToggleMenu: null,
      onToggleFullscreen: null,
      onToggleSlideshow: null,
      onIndexChange: null,
      onClosed: null,
      getSlideshowActive: null,
      onMenuButtonInit: null,
    }),
    darkMode: false,
    muted: true,
    transforms: /** @type {Map<string, { rotate: number; flipY: boolean }>} */ (new Map()),
  };

  const mobileBreakpoint = 1024;

  const setAppendToEl = (el) => {
    session.appendToEl = el || null;
  };

  const setExternalHandlers = (handlers = {}) => {
    session.handlers = { ...(session.handlers || {}), ...(handlers || {}) };
  };

  const setVideoResolver = (resolver) => {
    session.resolveVideoSrc = typeof resolver === "function" ? resolver : null;
  };

  const getPswp = () => {
    return lightbox.value?.pswp || null;
  };

  const getViewportSize = () => {
    const el = session.appendToEl;
    if (el && typeof el.clientWidth === "number" && typeof el.clientHeight === "number") {
      return { x: el.clientWidth, y: el.clientHeight };
    }
    return { x: document.documentElement.clientWidth, y: window.innerHeight };
  };

  const getPadding = (viewport, data) => {
    let top = 0;
    let bottom = 0;
    let left = 0;
    let right = 0;

    if (!viewport || !data?.width || !data?.height) return { top, bottom, left, right };

    // 小屏不加 padding
    if (viewport.x <= mobileBreakpoint) return { top, bottom, left, right };

    // 仅对图片内容加 padding（HTML slide 不处理）
    if (!data?.src) return { top, bottom, left, right };

    if (data.width % viewport.x !== 0 && viewport.x > viewport.y) {
      left = 48;
      right = 48;
    }

    if (data.height % viewport.y === 0) {
      top = 48;
      bottom = 48;
      left = 48;
      right = 48;
    } else if (data.height > data.width) {
      top = 48;
      bottom = 48;
    } else {
      top = 72;
      bottom = 64;
    }

    return { top, bottom, left, right };
  };

  const initPhotoSwipe = () => {
    if (isInitialized.value) return;
    if (!session.appendToEl) return;

    try {
      lightbox.value = new PhotoSwipeLightbox({
        // 将 PhotoSwipe 渲染限制在外部壳组件的容器内（用于 sidebar/menu 等外围 UI）
        appendToEl: session.appendToEl,
        pswpModule: () => import("photoswipe"),

        // 缩放与平移交互
        zoom: true,
        mouseMovePan: true,
        allowPanToNext: false,
        pinchToClose: false,

        // 关闭动画，外部壳负责遮罩与过渡
        showHideAnimationType: "none",
        showAnimationDuration: 0,
        hideAnimationDuration: 0,

        // 交互：键盘/关闭行为交给外部壳统一处理
        arrowKeys: false,
        escKey: false,
        close: false,
        counter: false,
        closeOnVerticalDrag: false,
        closeOnScroll: false,

        // 缩放
        wheelToZoom: true,
        initialZoomLevel: "fit",
        // 并限制在 maxZoomLevel（当前为 8）以内。
        secondaryZoomLevel: (zoomLevels) => {
          const pan = zoomLevels?.panAreaSize;
          const el = zoomLevels?.elementSize;
          if (!pan || !el || !el.x || !el.y) return zoomLevels?.fill || 1;

          // 计算“填充视口”的倍率（不再 clamp 到 1）
          const fillScale = Math.max(pan.x / el.x, pan.y / el.y);

          // 保持至少为 fit，且避免 NaN/Infinity
          const next = Number.isFinite(fillScale) ? Math.max(zoomLevels.fit || 1, fillScale) : (zoomLevels?.fill || 1);

          return Math.min(8, next);
        },
        maxZoomLevel: 8,

        // 视口与留白计算（影响“看起来是否居中/是否过大”）
        getViewportSizeFn: () => getViewportSize(),
        paddingFn: (viewportSize, itemData) => getPadding(viewportSize, itemData),

        // 背景：由外部壳提供（避免双层黑底）
        bgOpacity: 1,

        // 为 pswp 根节点添加主类名，便于统一样式覆盖
        mainClass: "p-lightbox__pswp",

        // 背景点击由外部壳统一关闭
        bgClickAction: () => session.handlers?.onRequestClose?.(),

        // 预加载：只加载相邻 slide
        preload: [1, 1],
      });

      setupPhotoSwipeFilters();
      setupPhotoSwipeEvents();
      lightbox.value.init();
      isInitialized.value = true;
    } catch (error) {
      console.error("[PhotoSwipe] 初始化失败:", error);
    }
  };

  const setupPhotoSwipeFilters = () => {
    if (!lightbox.value) return;

    lightbox.value.addFilter("numItems", () => {
      return Array.isArray(session.items) ? session.items.length : 0;
    });

    lightbox.value.addFilter("itemData", (itemData, i) => {
      const item = session.items[i] || itemData;
      const state = session.imageStates ? session.imageStates.get(item?.path) : null;

      const width = state?.naturalWidth || 1200;
      const height = state?.naturalHeight || 800;
      const src = state?.status === "loaded" ? state?.url || "" : "";

      return {
        src,
        width,
        height,
        alt: item?.name || "",
        title: item?.name || "",
        __cloudpasteItem: item,
      };
    });
  };

  const setupPhotoSwipeEvents = () => {
    if (!lightbox.value) return;

    lightbox.value.on("close", () => {
      session.abortController?.abort();
      session.abortController = null;
      session.items = [];
      session.imageStates = null;
      session.loadImageUrl = null;
      session.darkMode = false;
      session.transforms.clear();
      session.handlers?.onClosed?.();
    });

    // slide 销毁时清理自定义资源（视频事件/定时器等）
    lightbox.value.on("contentDestroy", (e) => {
      const content = e?.content;
      const cleanup = content?.data?.__cloudpasteCleanup;
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {
          // 忽略
        }
      }
    });

    lightbox.value.on("change", () => {
      const pswp = lightbox.value?.pswp;
      if (!pswp) return;
      session.handlers?.onIndexChange?.(pswp.currIndex);
      void prefetchAround(pswp.currIndex);
      applyTransformToSlide(pswp.currSlide);
    });

    lightbox.value.on("uiRegister", () => {
      registerCoreUI();
      registerCaptionUI();
    });

    lightbox.value.on("contentLoad", (e) => {
      const content = e?.content;
      const item = content?.data?.__cloudpasteItem;
      if (!content || !item) return;

      if (item?.__cloudpasteLivePhotoVideoPath) {
        void renderLivePhotoContent(e, item);
        return;
      }
    });

    // 图片仍使用 PhotoSwipe 原生 image content（保证 fit/居中/缩放逻辑一致），
    // 仅在这里异步注入 src（按需加载 + Abort）。
    lightbox.value.on("contentLoadImage", (e) => {
      const content = e?.content;
      const item = content?.data?.__cloudpasteItem;
      if (!content || !item) return;
      if (item?.__cloudpasteLivePhotoVideoPath) return;

      // 使用原生 Content，但自行控制 src 加载与 onLoaded/onError
      e.preventDefault();

      const img = /** @type {HTMLImageElement | undefined} */ (content.element);
      if (!img) return;

      const signal = session.abortController?.signal;

      void (async () => {
        try {
          const src = await ensureImageSrc(item, { signal });
          if (signal?.aborted) return;

          img.decoding = "async";
          img.alt = item?.name || "";

          img.onload = () => {
            try {
              const w = img.naturalWidth || 0;
              const h = img.naturalHeight || 0;
              if (w && h) {
                content.data.width = w;
                content.data.height = h;
                content.width = w;
                content.height = h;
              }

              if (session.imageStates && item?.path) {
                const prev = session.imageStates.get(item.path) || null;
                session.imageStates.set(item.path, {
                  ...(prev || { status: "loaded", url: src }),
                  status: "loaded",
                  url: src,
                  naturalWidth: w || (prev?.naturalWidth || 0),
                  naturalHeight: h || (prev?.naturalHeight || 0),
                  aspectRatio: w && h ? w / h : prev?.aspectRatio,
                });
              }

              // PhotoSwipe 的缩放/zoomLevels 计算依赖 slide.width/height。
              const slide = content.slide;
              if (slide && w && h) {
                slide.width = w;
                slide.height = h;
                if (slide.data) {
                  slide.data.width = w;
                  slide.data.height = h;
                  slide.data.src = src;
                }
                content.data.src = src;
                slide.resize?.();
              } else {
                // 保底：只更新 displayed size（不重置 zoom），避免在极端情况下卡死
                content.slide?.updateContentSize?.(true);
              }
            } catch {
              // ignore
            }

            content.onLoaded();
          };

          img.onerror = () => content.onError();
          img.src = src;
        } catch {
          content.onError();
        }
      })();
    });
  };

  const getTransformKey = (slide) => {
    const item = slide?.data?.__cloudpasteItem;
    return item?.path || slide?.data?.src || String(slide?.index ?? "");
  };

  const getTransformState = (key) => {
    return session.transforms.get(key) || { rotate: 0, flipY: false };
  };

  const setTransformState = (key, next) => {
    session.transforms.set(key, next);
  };

  const applyTransformToSlide = (slide) => {
    if (!slide) return;
    const item = slide?.data?.__cloudpasteItem;

    const key = getTransformKey(slide);
    const state = getTransformState(key);

    const rotate = ((state.rotate % 360) + 360) % 360;
    const flip = !!state.flipY;
    const extraTransform = `${flip ? "scaleY(-1) " : ""}rotate(${rotate}deg)`.trim() || "none";

    const el = slide?.content?.element;

    if (item?.__cloudpasteLivePhotoVideoPath) {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty("--cloudpaste-media-transform", extraTransform);
      return;
    }

    // 普通图片：直接对 pswp__img 设置 transform，不影响 zoom-wrap 的缩放/平移
    if (!(el instanceof HTMLImageElement)) return;
    el.style.transformOrigin = "center center";
    el.style.transform = extraTransform === "none" ? "" : extraTransform;
    el.style.transition = "transform 120ms ease-out";
  };

  const rotateCurrent = () => {
    const pswp = getPswp();
    const slide = pswp?.currSlide;
    if (!slide) return;
    const key = getTransformKey(slide);
    const prev = getTransformState(key);
    setTransformState(key, { ...prev, rotate: (prev.rotate + 90) % 360 });
    applyTransformToSlide(slide);
  };

  const toggleFlipVerticalCurrent = () => {
    const pswp = getPswp();
    const slide = pswp?.currSlide;
    if (!slide) return;
    const key = getTransformKey(slide);
    const prev = getTransformState(key);
    setTransformState(key, { ...prev, flipY: !prev.flipY });
    applyTransformToSlide(slide);
  };

  const registerCoreUI = () => {
    const pswp = lightbox.value?.pswp;
    if (!pswp) return;

    // 关闭
    pswp.ui.registerElement({
      name: "close-button",
      className: "pswp__button pswp__button--close-button",
      title: "关闭",
      ariaLabel: "关闭",
      order: 1,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" id="pswp__icn-close-button"/>',
        outlineID: "pswp__icn-close-button",
        size: 24,
      },
      onClick: () => session.handlers?.onRequestClose?.(),
    });

    // 信息侧栏
    if (window.innerWidth > mobileBreakpoint) {
      pswp.ui.registerElement({
        name: "sidebar-button",
        className: "pswp__button pswp__button--info-button pswp__button--mdi",
        title: "信息",
        ariaLabel: "信息",
        order: 9,
        isButton: true,
        html: {
          isCustomSVG: true,
          inner:
            '<path d="M11 7V9H13V7H11M14 17V15H13V11H10V13H11V15H10V17H14M22 12C22 17.5 17.5 22 12 22C6.5 22 2 17.5 2 12C2 6.5 6.5 2 12 2C17.5 2 22 6.5 22 12M20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12Z" id="pswp__icn-info"/>',
          outlineID: "pswp__icn-info",
          size: 24,
        },
        onClick: () => session.handlers?.onToggleSidebar?.(),
      });
    }

    // 实况/视频声音
    let soundButtonEl = null;
    const updateSoundButton = () => {
      const item = pswp?.currSlide?.data?.__cloudpasteItem;
      const isLive = !!item?.__cloudpasteLivePhotoVideoPath;
      if (soundButtonEl) {
        soundButtonEl.style.display = isLive ? "" : "none";
        soundButtonEl.classList.toggle("is-muted", !!session.muted);
        soundButtonEl.setAttribute("aria-label", session.muted ? "取消静音" : "静音");
        soundButtonEl.setAttribute("title", session.muted ? "取消静音" : "静音");
      }
    };

    const applyMutedToCurrentVideo = () => {
      const el = pswp?.currSlide?.content?.element;
      const video = el?.querySelector?.(".pswp__video");
      if (!(video instanceof HTMLVideoElement)) return;
      video.muted = !!session.muted;
      if (session.muted) {
        video.setAttribute("muted", "");
      } else {
        video.removeAttribute("muted");
      }
    };

    pswp.ui.registerElement({
      name: "sound-toggle",
      className: "pswp__button pswp__button--sound-toggle pswp__button--mdi",
      title: "静音",
      ariaLabel: "静音",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner:
          '<path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" class="pswp__icn-sound-on" id="pswp__icn-sound-on"/><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" class="pswp__icn-sound-off" id="pswp__icn-sound-off"/>',
        size: 24,
      },
      onInit: (el) => {
        soundButtonEl = el;
        try {
          const saved = window.sessionStorage.getItem("cloudpaste.lightbox.muted");
          if (saved === "true" || saved === "false") {
            session.muted = saved === "true";
          }
        } catch {
          // ignore
        }
        pswp.on("change", () => {
          updateSoundButton();
          applyMutedToCurrentVideo();
        });
        updateSoundButton();
        applyTransformToSlide(pswp.currSlide);
      },
      onClick: () => {
        session.muted = !session.muted;
        try {
          window.sessionStorage.setItem("cloudpaste.lightbox.muted", String(session.muted));
        } catch {
          // ignore
        }
        updateSoundButton();
        applyMutedToCurrentVideo();
      },
    });

    // 旋转 / 上下翻转
    pswp.ui.registerElement({
      name: "rotate-button",
      className: "pswp__button pswp__button--rotate pswp__button--mdi",
      title: "旋转",
      ariaLabel: "旋转",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner:
          '<path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z" id="pswp__icn-rotate"/>',
        outlineID: "pswp__icn-rotate",
        size: 24,
      },
      onClick: () => rotateCurrent(),
    });

    let flipButtonEl = null;
    const updateFlipButton = () => {
      if (!flipButtonEl) return;
      const slide = pswp?.currSlide;
      const key = getTransformKey(slide);
      const state = getTransformState(key);
      flipButtonEl.classList.toggle("is-active", !!state.flipY);
    };

    pswp.ui.registerElement({
      name: "flip-vertical-button",
      className: "pswp__button pswp__button--flip-vertical pswp__button--mdi",
      title: "上下翻转",
      ariaLabel: "上下翻转",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner: '<path d="M12 3l4 4h-3v10h-2V7H8l4-4zm0 18l-4-4h3V7h2v10h3l-4 4z" id="pswp__icn-flip-vertical"/>',
        outlineID: "pswp__icn-flip-vertical",
        size: 24,
      },
      onInit: (el) => {
        flipButtonEl = el;
        pswp.on("change", updateFlipButton);
        updateFlipButton();
      },
      onClick: () => {
        toggleFlipVerticalCurrent();
        updateFlipButton();
      },
    });

    // 菜单
    pswp.ui.registerElement({
      name: "menu-button",
      className: "pswp__button pswp__button--menu-button pswp__button--mdi",
      title: "更多",
      ariaLabel: "更多",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner: '<path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" id="pswp__icn-menu-button" />',
        outlineID: "pswp__icn-menu-button",
        size: 16,
      },
      onInit: (el) => session.handlers?.onMenuButtonInit?.(el),
      onClick: () => session.handlers?.onToggleMenu?.(),
    });

    // 全屏
    pswp.ui.registerElement({
      name: "fullscreen-toggle",
      className: "pswp__button pswp__button--fullscreen-toggle pswp__button--mdi",
      title: "全屏",
      ariaLabel: "全屏",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner:
          '<path d="M7 14H5v5h5v-2H7v-3zm0-4h2V7h3V5H5v5zm10 7h-3v2h5v-5h-2v3zm0-12V7h-3v2h5V5h-2z" id="pswp__icn-fullscreen"/>',
        outlineID: "pswp__icn-fullscreen",
        size: 24,
      },
      onClick: () => session.handlers?.onToggleFullscreen?.(),
    });

    // 幻灯片
    let slideshowButtonEl = null;
    pswp.ui.registerElement({
      name: "slideshow-toggle",
      className: "pswp__button pswp__button--slideshow-toggle pswp__button--mdi",
      title: "幻灯片",
      ariaLabel: "幻灯片",
      order: 10,
      isButton: true,
      html: {
        isCustomSVG: true,
        inner:
          '<path d="M14 19h4V5h-4v14zM6 19h4V5H6v14z" id="pswp__icn-slideshow-on" class="pswp__icn-slideshow-on" /><path d="M8 5.14v14l11-7-11-7z" id="pswp__icn-slideshow-off" class="pswp__icn-slideshow-off" />',
        size: 24,
      },
      onInit: (el) => {
        slideshowButtonEl = el;
        const update = () => {
          const active = session.handlers?.getSlideshowActive?.();
          el.classList.toggle("is-active", !!active);
        };
        pswp.on("change", update);
        update();
      },
      onClick: () => {
        session.handlers?.onToggleSlideshow?.();
        // 不等待外部状态回流，直接基于 getter 重新计算
        queueMicrotask(() => {
          const active = session.handlers?.getSlideshowActive?.();
          slideshowButtonEl?.classList.toggle("is-active", !!active);
        });
      },
    });
  };

  const registerCaptionUI = () => {
    const pswp = lightbox.value?.pswp;
    if (!pswp) return;

    pswp.ui.registerElement({
      name: "cloudpaste-caption",
      className: "pswp__cloudpaste-caption",
      appendTo: "root",
      order: 9,
      isButton: false,
      html: "",
      onInit: (el, pswp) => {
        let isPointerDown = false;
        let revealTimer = null;

        const clearRevealTimer = () => {
          if (!revealTimer) return;
          clearTimeout(revealTimer);
          revealTimer = null;
        };

        const isZoomedIn = () => {
          const slide = pswp?.currSlide;
          const fit = slide?.zoomLevels?.fit;
          const current = slide?.currZoomLevel;
          if (!fit || !current) return false;
          return current > fit + 0.01;
        };

        const setFaded = (faded) => {
          el.classList.toggle("is-faded", !!faded);
        };

        const update = () => {
          const item = pswp?.currSlide?.data?.__cloudpasteItem;
          const name = item?.name || "";
          el.textContent = name;
          if (name) el.setAttribute("title", name);
        };

        const updateVisibility = () => {
          setFaded(isPointerDown || isZoomedIn());
        };

        const scheduleReveal = () => {
          clearRevealTimer();
          revealTimer = setTimeout(() => {
            if (!isPointerDown && !isZoomedIn()) setFaded(false);
          }, 120);
        };

        pswp.on("change", () => {
          update();
          updateVisibility();
        });

        pswp.on("zoomPanUpdate", () => {
          if (isZoomedIn()) {
            clearRevealTimer();
            setFaded(true);
          } else if (!isPointerDown) {
            scheduleReveal();
          }
        });

        pswp.on("pointerDown", () => {
          isPointerDown = true;
          clearRevealTimer();
          setFaded(true);
        });

        pswp.on("pointerUp", () => {
          isPointerDown = false;
          if (!isZoomedIn()) scheduleReveal();
        });

        pswp.on("destroy", () => {
          clearRevealTimer();
        });

        update();
        updateVisibility();
      },
    });
  };

  const renderLivePhotoContent = async (e, item) => {
    const content = e?.content;
    if (!content || !item) return;

    e.preventDefault();

    const videoPath = item.__cloudpasteLivePhotoVideoPath;
    const ctrl = new AbortController();

    const root = document.createElement("div");
    // 统一 Live Photo 样式：复用 LivePhotoViewer.css 的 badge 视觉与暗色主题变量
    root.className = "pswp__media pswp__media--live live-photo-viewer--dark";

    const img = document.createElement("img");
    img.className = "pswp__image";
    img.decoding = "async";
    img.alt = item?.name || "";

    const video = document.createElement("video");
    video.className = "pswp__video";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.muted = !!session.muted;
    if (session.muted) {
      video.setAttribute("muted", "");
    }
    video.preload = "metadata";

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "live-photo-viewer__badge";
    badge.setAttribute("aria-label", "播放实况（按住播放 / 点击切换）");
    badge.setAttribute("title", "播放实况（按住播放 / 点击切换）");
    badge.innerHTML = `
      ${LIVE_PHOTO_BADGE_ICON_SVG}
      <span class="live-photo-viewer__badge-text">LIVE</span>
    `;

    const control = document.createElement("button");
    control.type = "button";
    control.className = "pswp__live-toggle";
    control.setAttribute("aria-label", "播放实况");
    control.setAttribute("title", "播放 / 暂停");
    control.innerHTML = `
      <span class="pswp__live-toggle-icon pswp__live-toggle-icon--play" aria-hidden="true">▶</span>
      <span class="pswp__live-toggle-icon pswp__live-toggle-icon--pause" aria-hidden="true">❚❚</span>
    `;

    root.appendChild(img);
    root.appendChild(video);
    root.appendChild(badge);
    root.appendChild(control);

    content.element = root;

    const signal = session.abortController?.signal;
    const state = {
      playing: false,
      loading: false,
      holdActive: false,
      holdTimer: /** @type {ReturnType<typeof setTimeout> | null} */ (null),
      videoUrl: "",
    };

    const cleanup = () => {
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
      try {
        video.pause();
      } catch {
        // ignore
      }
      try {
        video.removeAttribute("src");
        video.load?.();
      } catch {
        // ignore
      }
    };

    content.data.__cloudpasteCleanup = cleanup;

    // 先加载图片封面
    try {
      const src = await ensureImageSrc(item, { signal });
      if (signal?.aborted) return;
      img.src = src;
    } catch {
      // 允许继续，让 PhotoSwipe 走 error UI
    }

    const clearHoldTimer = () => {
      if (!state.holdTimer) return;
      clearTimeout(state.holdTimer);
      state.holdTimer = null;
    };

    const setPlaying = (v) => {
      state.playing = !!v;
      root.classList.toggle("live-photo-viewer--playing", state.playing);
      badge.setAttribute("aria-label", state.playing ? "暂停实况" : "播放实况（按住播放 / 点击切换）");
      control.classList.toggle("is-playing", state.playing);
      control.setAttribute("aria-label", state.playing ? "暂停实况" : "播放实况");
    };

    const setLoading = (v) => {
      state.loading = !!v;
      root.classList.toggle("live-photo-viewer--loading", state.loading);
      badge.disabled = state.loading;
      control.disabled = state.loading;
    };

    const ensureVideoUrl = async () => {
      if (state.videoUrl) return state.videoUrl;
      if (!videoPath || !session.resolveVideoSrc) return "";
      const url = await session.resolveVideoSrc(videoPath);
      state.videoUrl = url || "";
      return state.videoUrl;
    };

    const play = async () => {
      if (signal?.aborted) return;
      if (state.playing) return;
      try {
        setLoading(true);
        const url = await ensureVideoUrl();
        if (!url) return;
        if (!video.src) {
          video.src = url;
        }
        await video.play();
        setPlaying(true);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    const pause = () => {
      clearHoldTimer();
      state.holdActive = false;
      try {
        video.pause();
      } catch {
        // ignore
      }
      setPlaying(false);
    };

    const toggle = () => {
      if (state.playing) {
        pause();
      } else {
        void play();
      }
    };

    // B：按住播放（主），点击切换（辅）
    root.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev?.target?.closest?.(".live-photo-viewer__badge, .pswp__live-toggle")) return;
        if (state.playing) return;
        if (ev.pointerType === "mouse" && ev.button !== 0) return;

        try {
          root.setPointerCapture?.(ev.pointerId);
        } catch {
          // ignore
        }

        // 说明：未静音时，浏览器通常要求“同步用户手势”才能带声音播放。
        if (!session.muted) {
          state.holdActive = true;
          void play();
          return;
        }

        clearHoldTimer();
        state.holdTimer = setTimeout(() => {
          state.holdActive = true;
          void play();
        }, 160);
      },
      { signal: ctrl.signal }
    );

    root.addEventListener(
      "pointerup",
      (ev) => {
        clearHoldTimer();
        if (state.holdActive) {
          pause();
        }
        try {
          root.releasePointerCapture?.(ev.pointerId);
        } catch {
          // ignore
        }
      },
      { signal: ctrl.signal }
    );

    root.addEventListener(
      "pointercancel",
      () => {
        clearHoldTimer();
        if (state.holdActive) pause();
      },
      { signal: ctrl.signal }
    );

    badge.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggle();
      },
      { signal: ctrl.signal }
    );

    control.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggle();
      },
      { signal: ctrl.signal }
    );

    video.addEventListener(
      "ended",
      () => {
        setPlaying(false);
      },
      { signal: ctrl.signal }
    );

    content.onLoaded();
  };

  const ensureImageSrc = async (item, options = {}) => {
    const signal = options.signal;
    if (signal?.aborted) throw new Error("aborted");

    const state = session.imageStates ? session.imageStates.get(item?.path) : null;
    if (state?.status === "loaded" && state?.url) return state.url;

    if (typeof session.loadImageUrl === "function") {
      await session.loadImageUrl(item, { priority: options.priority || "high", signal });
    }

    const nextState = session.imageStates ? session.imageStates.get(item?.path) : null;
    if (nextState?.status === "loaded" && nextState?.url) return nextState.url;
    throw new Error("image src unavailable");
  };

  const prefetchAround = async (idx) => {
    const signal = session.abortController?.signal;
    if (!Array.isArray(session.items) || session.items.length === 0) return;
    if (signal?.aborted) return;

    const candidates = [idx - 2, idx - 1, idx + 1, idx + 2];
    for (const i of candidates) {
      if (i < 0 || i >= session.items.length) continue;
      const item = session.items[i];
      if (!item) continue;
      // 未就绪/被取消都不应在控制台产生未处理的 Promise rejection
      void ensureImageSrc(item, { signal, priority: "normal" }).catch(() => {});
    }
  };

  const openPhotoSwipe = async (items, startIndex = 0, imageStatesArg = null, loadImageUrlArg = null, options = {}) => {
    if (!Array.isArray(items) || items.length === 0) return;

    if (!isInitialized.value) {
      initPhotoSwipe();
      await nextTick();
    }
    if (!lightbox.value) return;

    session.items = items;
    session.imageStates = imageStatesArg;
    session.loadImageUrl = typeof loadImageUrlArg === "function" ? loadImageUrlArg : null;
    session.darkMode = !!options.darkMode;

    session.abortController?.abort();
    session.abortController = new AbortController();

    const validStartIndex = Math.max(0, Math.min(startIndex, items.length - 1));

    // 打开前先确保首张图片具备 src，避免长时间空白
    const first = items[validStartIndex];
    if (first) {
      try {
        await ensureImageSrc(first, { signal: session.abortController.signal, priority: "high" });
      } catch {
        // ignore
      }
    }

    lightbox.value.loadAndOpen(validStartIndex, items);
    void prefetchAround(validStartIndex);
  };

  const closePhotoSwipe = () => {
    try {
      lightbox.value?.pswp?.close?.();
    } catch {
      // ignore
    }
  };

  const destroyPhotoSwipe = () => {
    try {
      lightbox.value?.destroy?.();
    } catch {
      // ignore
    }
    lightbox.value = null;
    isInitialized.value = false;
  };

  return {
    isInitialized,
    initPhotoSwipe,
    openPhotoSwipe,
    closePhotoSwipe,
    destroyPhotoSwipe,
    setAppendToEl,
    setExternalHandlers,
    setVideoResolver,
    getPswp,
    rotateCurrent,
    toggleFlipVerticalCurrent,
  };
}
