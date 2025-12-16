/**
 * 图廊视图组合式函数
 * 提供图廊视图的完整功能逻辑，包括设置管理、数据处理、MasonryWall配置等
 */

import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useFsService } from "@/modules/fs";
import { decodeImagePreviewUrlToObjectUrl, revokeObjectUrl, shouldAttemptDecodeImagePreview } from "@/utils/imageDecode";

const INITIAL_RENDER_LIMIT = 120;
const RENDER_BATCH = 120;
const MAX_CONCURRENT_IMAGE_REQUESTS = 6;

/**
 * @typedef {{ status: "idle" | "loading" | "loaded" | "error", url: string | null, decoded?: boolean, decodeAttempted?: boolean, naturalWidth?: number, naturalHeight?: number, aspectRatio?: number }} GalleryImageState
 */

/**
 * 图廊逻辑入口
 * @param {{ items: import("vue").Ref<Array<any>> | import("vue").ComputedRef<Array<any>> }} input
 */
export function useGalleryView(input = {}) {
  const { t } = useI18n();
  const fsService = useFsService();
  const itemsRef = input.items;

  // ===== localStorage设置管理 =====

  // localStorage键名
  const STORAGE_KEYS = {
    COLUMN_COUNT: "gallery_column_count",
    HORIZONTAL_GAP: "gallery_horizontal_gap",
    VERTICAL_GAP: "gallery_vertical_gap",
    SORT_BY: "gallery_sort_by",
  };

  // 从localStorage恢复设置
  const getStoredValue = (key, defaultValue) => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch (error) {
      console.warn(`恢复图廊设置失败 (${key}):`, error);
      return defaultValue;
    }
  };

  // 保存设置到localStorage
  const saveToStorage = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`保存图廊设置失败 (${key}):`, error);
    }
  };

  // ===== 图廊设置状态 =====

  // 瀑布流布局控制 - 从localStorage恢复或使用默认值
  const columnCount = ref(getStoredValue(STORAGE_KEYS.COLUMN_COUNT, "auto"));

  // 分别控制水平和垂直间距 - 从localStorage恢复或使用默认值
  const horizontalGap = ref(getStoredValue(STORAGE_KEYS.HORIZONTAL_GAP, 16));
  const verticalGap = ref(getStoredValue(STORAGE_KEYS.VERTICAL_GAP, 20));

  // 排序方式 - 从localStorage恢复或使用默认值
  const sortBy = ref(getStoredValue(STORAGE_KEYS.SORT_BY, "name"));

  // 工具栏状态管理
  const showSortMenu = ref(false);
  const showViewSettings = ref(false);

  // ===== MasonryWall配置 =====

  // MasonryWall的gap直接使用水平间距（控制列间距）
  const baseGap = computed(() => horizontalGap.value);

  // MasonryWall配置
  const columnWidth = computed(() => {
    // 固定列宽，让MasonryWall根据min-columns和max-columns控制列数
    return 280; // 固定列宽280px
  });

  // 计算最小和最大列数
  const minColumns = computed(() => {
    if (columnCount.value === "auto") {
      return 1; // 自动模式：最少1列
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列数模式：最小列数等于设定值
  });

  const maxColumns = computed(() => {
    if (columnCount.value === "auto") {
      return undefined; // 自动模式：无最大列数限制
    }
    const cols = parseInt(columnCount.value);
    return cols; // 固定列数模式：最大列数等于设定值
  });

  // ===== 工具栏选项配置 =====

  const sortOptions = computed(() => [
    { value: "name", label: t("gallery.sortByName") },
    { value: "size", label: t("gallery.sortBySize") },
    { value: "date", label: t("gallery.sortByDate") },
    { value: "type", label: t("gallery.sortByType") },
  ]);

  // ===== 图片数据处理 =====

  // 状态驱动的图片管理
  /** @type {import("vue").Ref<Map<string, GalleryImageState>>} */
  const imageStates = ref(new Map()); // key: image.path
  const renderLimit = ref(INITIAL_RENDER_LIMIT);

  const resetRenderWindow = () => {
    renderLimit.value = INITIAL_RENDER_LIMIT;
  };

  const clearImageStates = () => {
    imageStates.value.forEach((state) => {
      revokeObjectUrl(state?.url);
    });
    imageStates.value.clear();
  };

  // 智能分组（依赖后端 type 字段：IMAGE=5、VIDEO=2）
  const groups = computed(() => {
    const items = Array.isArray(itemsRef?.value) ? itemsRef.value : [];
    const allFolders = items.filter((item) => item?.isDirectory);
    const allImages = items.filter((item) => !item?.isDirectory && item?.type === 5);
    const allOtherFiles = items.filter((item) => !item?.isDirectory && item?.type !== 5 && item?.type !== 2);
    return { allFolders, allImages, allOtherFiles };
  });

  // 排序函数
  const sortImages = (images) => {
    const sorted = [...images];

    switch (sortBy.value) {
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "size":
        return sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
      case "date":
        return sorted.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
      case "type":
        return sorted.sort((a, b) => {
          const extA = a.name.split(".").pop().toLowerCase();
          const extB = b.name.split(".").pop().toLowerCase();
          return extA.localeCompare(extB);
        });
      default:
        return sorted;
    }
  };

  const allImages = computed(() => sortImages(groups.value.allImages));
  const allFolders = computed(() => groups.value.allFolders);
  const allOtherFiles = computed(() => groups.value.allOtherFiles);

  // 渐进渲染窗口
  const visibleImages = computed(() => {
    return allImages.value.slice(0, renderLimit.value);
  });

  const hasMoreImages = computed(() => {
    return renderLimit.value < allImages.value.length;
  });

  const loadMoreImages = () => {
    if (!hasMoreImages.value) return;
    renderLimit.value = Math.min(renderLimit.value + RENDER_BATCH, allImages.value.length);
  };

  // 将图片数据转换为MasonryWall需要的格式
  const masonryItems = computed(() => {
    return visibleImages.value.map((image, index) => ({
      id: image.path,
      image,
      index,
    }));
  });

  // ===== 图片URL管理 =====

  const inFlight = new Map(); // key: image.path => Promise<void>
  /** @type {Array<{ image: any, signal?: AbortSignal, resolve: () => void, reject: (e: any) => void }>} */
  const queueHigh = [];
  /** @type {Array<{ image: any, signal?: AbortSignal, resolve: () => void, reject: (e: any) => void }>} */
  const queueNormal = [];
  let activeCount = 0;

  const ensureIdleState = (image) => {
    if (!image?.path) return;
    if (!imageStates.value.has(image.path)) {
      imageStates.value.set(image.path, { status: "idle", url: null });
    }
  };

  const dequeue = () => {
    if (queueHigh.length > 0) return queueHigh.shift();
    if (queueNormal.length > 0) return queueNormal.shift();
    return null;
  };

  const runQueue = () => {
    while (activeCount < MAX_CONCURRENT_IMAGE_REQUESTS) {
      const job = dequeue();
      if (!job) return;
      const { image, signal, resolve, reject } = job;
      const path = image?.path;
      if (!path) {
        resolve();
        continue;
      }
      if (signal?.aborted) {
        resolve();
        continue;
      }
      const state = imageStates.value.get(path);
      if (state?.status === "loaded" || state?.status === "loading") {
        resolve();
        continue;
      }

      activeCount += 1;
      void (async () => {
        try {
          await loadImageUrlInternal(image, { signal });
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          activeCount -= 1;
          runQueue();
        }
      })();
    }
  };

  const scheduleLoad = (image, { priority = "normal", signal } = {}) => {
    if (!image?.path) return Promise.resolve();
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job = { image, signal, resolve, reject };
      if (priority === "high") {
        queueHigh.push(job);
      } else {
        queueNormal.push(job);
      }
      runQueue();
    });
  };

  const loadImageUrlInternal = async (image, { signal } = {}) => {
    const imagePath = image?.path || "";
    if (!imagePath) return;
    if (signal?.aborted) return;

    const currentState = imageStates.value.get(imagePath);
    if (currentState?.status === "loading" || currentState?.status === "loaded") return;

    imageStates.value.set(imagePath, { ...(currentState || {}), status: "loading", url: null });

    try {
      // 图廊允许并发：cancelPrevious=false（避免互相 Abort）
      const fileInfo = await fsService.getFileInfo(imagePath, { cancelPrevious: false, signal });
      if (signal?.aborted) return;

      const previewUrl = fileInfo?.previewUrl || "";
      if (!previewUrl) {
        imageStates.value.set(imagePath, { status: "error", url: null });
        return;
      }

      // HEIC/HEIF：按扩展名/类型预判，直接走 wasm 解码，避免“先失败再解码”的二次开销
      if (shouldAttemptDecodeImagePreview({ filename: image?.name || "", mimetype: image?.mimetype || "" })) {
        const decoded = await decodeImagePreviewUrlToObjectUrl({
          url: previewUrl,
          filename: image?.name || "",
          mimetype: image?.mimetype || "",
          signal,
          outputType: "image/webp",
          quality: 0.9,
        });

        const prevUrl = currentState?.url || "";
        revokeObjectUrl(prevUrl);

        imageStates.value.set(imagePath, {
          status: "loaded",
          url: decoded.objectUrl,
          decoded: true,
          decodeAttempted: true,
          naturalWidth: decoded.width,
          naturalHeight: decoded.height,
          aspectRatio: decoded.width && decoded.height ? decoded.width / decoded.height : undefined,
        });
        return;
      }

        imageStates.value.set(imagePath, { status: "loaded", url: previewUrl });
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) return;
      imageStates.value.set(imagePath, { status: "error", url: null });
    }
  };

  /**
   * 外部调用：调度加载（带优先级/并发控制）
   * @param {any} image
   * @param {{ priority?: "high" | "normal"; signal?: AbortSignal }} [options]
   */
  const loadImageUrl = async (image, options = {}) => {
    const imagePath = image?.path || "";
    if (!imagePath) return;

    const currentState = imageStates.value.get(imagePath);
    if (currentState?.status === "loaded" || currentState?.status === "loading") return;

    if (inFlight.has(imagePath)) {
      return inFlight.get(imagePath);
    }

    const promise = scheduleLoad(image, options);

    inFlight.set(imagePath, promise);
    try {
      await promise;
    } finally {
      inFlight.delete(imagePath);
    }
  };

  // 随着可见窗口变化，确保新进入窗口的图片具备 idle state（供 Observer 判定）
  watch(
    visibleImages,
    (images) => {
      images.forEach((img) => ensureIdleState(img));
    },
    { immediate: true }
  );

  // items 切换（目录切换/刷新）：清空状态，重置渲染窗口
  watch(
    () => itemsRef?.value,
    () => {
      clearImageStates();
      resetRenderWindow();
    }
  );

  // ===== 懒加载管理 =====

  // ===== 设置管理方法 =====

  // 检查是否为默认设置
  const isDefaultSettings = computed(() => {
    return columnCount.value === "auto" && horizontalGap.value === 16 && verticalGap.value === 20 && sortBy.value === "name";
  });

  // 重置图廊设置到默认值
  const resetGallerySettings = () => {
    // 重置到默认值
    columnCount.value = "auto";
    horizontalGap.value = 16;
    verticalGap.value = 20;
    sortBy.value = "name";

    // 清除localStorage中的设置
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn(`清除图廊设置失败 (${key}):`, error);
      }
    });
  };

  // ===== 工具栏交互方法 =====

  const toggleSortMenu = () => {
    showSortMenu.value = !showSortMenu.value;
    if (showSortMenu.value) {
      showViewSettings.value = false;
    }
  };

  const toggleViewSettings = () => {
    showViewSettings.value = !showViewSettings.value;
    if (showViewSettings.value) {
      showSortMenu.value = false;
    }
  };

  const handleSortChange = (sortValue) => {
    sortBy.value = sortValue;
    showSortMenu.value = false;
  };

  // ===== 监听器设置 =====

  let watchersInitialized = false;

  // 监听设置变化并自动保存到localStorage
  const setupWatchers = () => {
    // 避免重复注册
    if (watchersInitialized) return;
    watchersInitialized = true;

    watch(columnCount, (newValue) => {
      saveToStorage(STORAGE_KEYS.COLUMN_COUNT, newValue);
    });

    watch(horizontalGap, (newValue) => {
      saveToStorage(STORAGE_KEYS.HORIZONTAL_GAP, newValue);
    });

    watch(verticalGap, (newValue) => {
      saveToStorage(STORAGE_KEYS.VERTICAL_GAP, newValue);
    });

    watch(sortBy, (newValue) => {
      saveToStorage(STORAGE_KEYS.SORT_BY, newValue);
    });
  };

  // 返回所有需要的状态和方法
  return {
    // 数据
    allFolders,
    allImages,
    allOtherFiles,
    visibleImages,
    masonryItems,
    hasMoreImages,
    loadMoreImages,

    // 状态
    columnCount,
    horizontalGap,
    verticalGap,
    sortBy,
    showSortMenu,
    showViewSettings,

    // MasonryWall配置
    baseGap,
    columnWidth,
    minColumns,
    maxColumns,

    // 工具栏配置
    sortOptions,

    // 图片状态
    imageStates,
    clearImageStates,
    resetRenderWindow,

    // 图片URL管理
    loadImageUrl,

    // 设置管理
    isDefaultSettings,
    resetGallerySettings,

    // 工具栏交互
    toggleSortMenu,
    toggleViewSettings,
    handleSortChange,

    // 初始化方法
    setupWatchers,
  };
}
