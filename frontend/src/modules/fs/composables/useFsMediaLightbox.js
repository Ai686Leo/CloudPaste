import { computed, ref } from "vue";

/**
 * FS 媒体查看器（Lightbox）服务（模块内单例）
 *
 */

const isOpen = ref(false);
const sessionId = ref(0);

/** @type {import("vue").Ref<Array<any>>} */
const items = ref([]);
const index = ref(0);
const darkMode = ref(false);

/** @type {import("vue").Ref<Map<string, any> | null>} */
const imageStates = ref(null);
/** @type {import("vue").Ref<Function | null>} */
const loadImageUrl = ref(null);

/** @type {import("vue").Ref<Function | null>} */
const onDownload = ref(null);
/** @type {import("vue").Ref<Function | null>} */
const onGetLink = ref(null);

const sidebarOpen = ref(false);
const menuOpen = ref(false);
const slideshowActive = ref(false);

const currentItem = computed(() => {
  const list = Array.isArray(items.value) ? items.value : [];
  const i = Number.isFinite(index.value) ? index.value : 0;
  return list[i] || null;
});

export function useFsMediaLightbox() {
  const open = (options = {}) => {
    const list = Array.isArray(options.items) ? options.items : [];
    const startIndex = Number.isFinite(options.index) ? options.index : 0;

    items.value = list;
    index.value = Math.max(0, Math.min(startIndex, Math.max(list.length - 1, 0)));

    darkMode.value = !!options.darkMode;
    imageStates.value = options.imageStates || null;
    loadImageUrl.value = typeof options.loadImageUrl === "function" ? options.loadImageUrl : null;

    onDownload.value = typeof options.onDownload === "function" ? options.onDownload : null;
    onGetLink.value = typeof options.onGetLink === "function" ? options.onGetLink : null;

    sidebarOpen.value = false;
    menuOpen.value = false;
    slideshowActive.value = false;

    isOpen.value = true;
    sessionId.value += 1;
  };

  const close = () => {
    isOpen.value = false;
    menuOpen.value = false;
    sidebarOpen.value = false;
    slideshowActive.value = false;
    items.value = [];
    index.value = 0;
    imageStates.value = null;
    loadImageUrl.value = null;
    sessionId.value += 1;
  };

  const setIndex = (nextIndex) => {
    const list = Array.isArray(items.value) ? items.value : [];
    const i = Number.isFinite(nextIndex) ? nextIndex : 0;
    index.value = Math.max(0, Math.min(i, Math.max(list.length - 1, 0)));
  };

  const toggleSidebar = () => {
    sidebarOpen.value = !sidebarOpen.value;
  };

  const toggleMenu = () => {
    menuOpen.value = !menuOpen.value;
  };

  const setSlideshowActive = (active) => {
    slideshowActive.value = !!active;
  };

  const requestDownload = () => {
    const item = currentItem.value;
    if (!item) return;
    onDownload.value?.(item);
  };

  const requestGetLink = () => {
    const item = currentItem.value;
    if (!item) return;
    onGetLink.value?.(item);
  };

  return {
    // state
    isOpen,
    sessionId,
    items,
    index,
    currentItem,
    darkMode,
    imageStates,
    loadImageUrl,
    sidebarOpen,
    menuOpen,
    slideshowActive,

    // actions
    open,
    close,
    setIndex,
    toggleSidebar,
    toggleMenu,
    setSlideshowActive,
    requestDownload,
    requestGetLink,
  };
}
