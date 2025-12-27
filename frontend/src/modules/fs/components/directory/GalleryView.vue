<!--
  图廊视图组件
  专门用于展示图片文件的瀑布流布局
  基于@yeger/vue-masonry-wall实现专业的瀑布流效果
-->
<template>
  <div class="gallery-view">
    <!-- 现代化图廊工具栏 -->
    <div ref="toolbarRef" class="gallery-toolbar mb-4" :class="darkMode ? 'bg-gray-800/80' : 'bg-white/90'">
      <!-- 主工具栏 -->
      <div class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
        <div class="flex items-center justify-between">
          <!-- 左侧：统计信息 -->
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <!-- 图廊图标 -->
              <IconGallery :class="darkMode ? 'text-blue-400' : 'text-blue-600'" aria-hidden="true" />
              <span class="font-medium text-sm" :class="darkMode ? 'text-gray-200' : 'text-gray-900'">
                {{ t("gallery.viewModeName") }}
              </span>
            </div>

            <!-- 分隔符 -->
            <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>

            <!-- 统计信息 -->
            <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
              {{ getContentSummary() }}
            </span>
          </div>

          <!-- 右侧：快速操作 -->
          <div class="flex items-center gap-2">
            <!-- 排序按钮 -->
            <div class="relative">
              <button
                @click="toggleSortMenu"
                class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
              >
                <IconSortAscending size="sm" aria-hidden="true" />
                <span class="hidden sm:inline">{{ t("gallery.sort") }}</span>
                <IconChevronDown size="xs" aria-hidden="true" />
              </button>

              <!-- 排序菜单 -->
              <div
                v-if="showSortMenu"
                class="absolute right-0 top-full mt-1 w-48 rounded-md shadow-lg z-[9999]"
                :class="darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'"
              >
                <div class="py-1">
                  <button
                    v-for="option in sortOptions"
                    :key="option.value"
                    @click="handleSortChange(option.value)"
                    class="w-full text-left px-3 py-2 text-sm transition-colors"
                    :class="[
                      sortBy === option.value
                        ? darkMode
                          ? 'bg-gray-700 text-white'
                          : 'bg-gray-100 text-gray-900'
                        : darkMode
                        ? 'text-gray-300 hover:bg-gray-700'
                        : 'text-gray-700 hover:bg-gray-50',
                    ]"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 视图设置按钮 -->
            <button
              @click="toggleViewSettings"
              class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors"
              :class="darkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-700'"
            >
              <IconAdjustments size="sm" aria-hidden="true" />
              <span class="hidden sm:inline">{{ t("gallery.settings") }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 展开的视图设置面板 -->
      <div v-if="showViewSettings" class="px-3 py-2 border-b" :class="darkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- 列数控制 -->
          <div class="space-y-2">
            <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
              {{ t("gallery.columns") }}
            </label>
            <div class="flex items-center gap-2">
              <!-- 自动按钮 -->
              <button
                @click="columnCount = 'auto'"
                class="px-3 py-1.5 text-xs rounded-md transition-colors"
                :class="[
                  columnCount === 'auto'
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
                ]"
              >
                {{ t("gallery.auto") }}
              </button>

              <!-- 列数按钮组 -->
              <div class="flex rounded-md overflow-hidden border" :class="darkMode ? 'border-gray-600' : 'border-gray-300'">
                <button
                  v-for="cols in [2, 3, 4, 5, 6]"
                  :key="cols"
                  @click="columnCount = cols.toString()"
                  class="px-2 py-1.5 text-xs transition-colors"
                  :class="[
                    columnCount === cols.toString()
                      ? darkMode
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-200 text-gray-900'
                      : darkMode
                      ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      : 'bg-white text-gray-600 hover:bg-gray-50',
                  ]"
                >
                  {{ cols }}
                </button>
              </div>
            </div>
          </div>

          <!-- 间距控制 -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ t("gallery.spacing") }}
              </label>
              <button
                @click="resetGallerySettings"
                :disabled="isDefaultSettings"
                class="text-xs px-2 py-1 rounded transition-colors"
                :class="[
                  isDefaultSettings
                    ? darkMode
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-gray-400 cursor-not-allowed'
                    : darkMode
                    ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-700'
                    : 'text-gray-600 hover:text-gray-700 hover:bg-gray-100',
                ]"
                :title="isDefaultSettings ? t('gallery.alreadyDefault') : t('gallery.resetSettings')"
              >
                {{ t("gallery.reset") }}
              </button>
            </div>

            <!-- 水平排列的间距控制 -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <!-- 水平间距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                    {{ t("gallery.horizontalSpacing") }}
                  </label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ horizontalGap }}px </span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="horizontalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider horizontal-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>{{ t("gallery.tight") }}</span>
                    <span>{{ t("gallery.loose") }}</span>
                  </div>
                </div>
              </div>

              <!-- 垂直间距控制 -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium" :class="darkMode ? 'text-gray-400' : 'text-gray-600'">
                    {{ t("gallery.verticalSpacing") }}
                  </label>
                  <span class="text-xs" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ verticalGap }}px </span>
                </div>
                <div class="relative">
                  <input
                    v-model.number="verticalGap"
                    type="range"
                    min="0"
                    max="48"
                    step="2"
                    class="w-full h-2 rounded-lg appearance-none cursor-pointer spacing-slider vertical-slider"
                    :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'"
                  />
                  <div class="flex justify-between text-xs mt-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                    <span>{{ t("gallery.tight") }}</span>
                    <span>{{ t("gallery.loose") }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 瀑布流容器 + 渐进渲染哨兵 -->
    <template v-if="allImages.length > 0">
      <MasonryWall
        :items="masonryItems"
        :column-width="columnWidth"
        :gap="baseGap"
        :min-columns="minColumns"
        :max-columns="maxColumns"
        :ssr-columns="1"
        :key-mapper="(item, column, row, index) => item.id || index"
        class="masonry-wall-gallery"
      >
        <template #default="{ item }">
          <div
            class="masonry-item"
            @click="handleItemClick(item.image)"
            @contextmenu.prevent="(event) => handleContextMenu(event, item.image)"
          >
            <div class="masonry-image-container">
              <!-- 选择框 -->
              <div v-if="isCheckboxMode" class="absolute top-2 left-2 z-10" @click.stop="toggleItemSelect(item.image)">
                <input
                  type="checkbox"
                  :checked="isItemSelected(item.image)"
                  class="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  :class="darkMode ? 'bg-gray-700 border-gray-500' : ''"
                />
              </div>

              <!-- 图片容器：始终渲染，懒加载 -->
              <div class="masonry-image-wrapper">
                <!-- Live Photo 标志（仅展示，不触发播放；播放在灯箱/预览区处理）-->
                <div v-if="isLivePhotoInGallery(item.image)" class="pointer-events-none" :class="{ 'live-photo-viewer--dark': darkMode }">
                  <div class="live-photo-viewer__badge live-photo-viewer__badge--static" :title="t('livePhoto.badge')">
                    <span v-html="livePhotoBadgeIconSvg" />
                  </div>
                </div>

                <!-- 真实图片：只有URL时才显示 -->
                <img
                  v-if="getImageSrc(item.image)"
                  :src="getImageSrc(item.image)"
                  :alt="item.image.name"
                  class="masonry-image"
                  decoding="async"
                  @load="(event) => handleImageLoad(item.image, event)"
                  @error="handleImageError(item.image)"
                />

                <!-- 错误占位图：图片加载失败时显示 -->
                <div v-else-if="getImageState(item.image)?.status === 'error'" class="masonry-placeholder bg-red-100 dark:bg-red-900/20" :style="getPlaceholderStyle()">
                  <div class="placeholder-content">
                    <div class="w-8 h-8 mx-auto mb-2 opacity-50">
                      <IconExclamation class="w-full h-full text-red-500" aria-hidden="true" />
                    </div>
                    <span class="text-xs opacity-75 text-red-600 dark:text-red-400"> {{ t("gallery.loadError") }} </span>
                  </div>
                </div>

                <!-- 懒加载占位图：用于IntersectionObserver观察 -->
                <div v-else class="masonry-placeholder lazy-image bg-gray-200 dark:bg-gray-700 animate-pulse" :data-image-path="item.image.path" :style="getPlaceholderStyle()">
                  <div class="placeholder-content">
                    <div class="w-8 h-8 mx-auto mb-2 opacity-50">
                      <div v-html="getFileIcon(item.image, darkMode)" class="w-full h-full"></div>
                    </div>
                    <span class="text-xs opacity-75" :class="darkMode ? 'text-gray-400' : 'text-gray-600'"> {{ t("gallery.loading") }} </span>
                  </div>
                </div>
              </div>

              <!-- 悬浮操作层 - 现在使用上下文菜单 -->
              <div class="masonry-overlay">
                <!-- 图片信息（保留原有的悬浮信息） -->
                <div class="masonry-info">
                  <div class="text-sm font-medium truncate">{{ item.image.name }}</div>
                  <div class="text-xs opacity-75 mt-1">{{ formatFileSize(item.image.size) }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </MasonryWall>

      <!-- 渐进渲染哨兵：进入视口时扩展渲染窗口 -->
      <div v-if="hasMoreImages" ref="loadMoreSentinelRef" class="h-1"></div>
    </template>

    <!-- 空状态提示 -->
    <div v-else class="text-center py-16">
      <div class="max-w-md mx-auto">
        <!-- 图片图标 -->
        <div class="w-24 h-24 mx-auto mb-6 opacity-30">
          <IconGallery class="w-full h-full" :class="darkMode ? 'text-gray-500' : 'text-gray-400'" aria-hidden="true" />
        </div>

        <!-- 主要消息 -->
        <h3 class="text-lg font-medium mb-2" :class="darkMode ? 'text-gray-300' : 'text-gray-700'">
          {{ t("gallery.noImagesTitle") }}
        </h3>

        <!-- 详细说明 -->
        <p class="text-sm mb-4" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
          {{ t("gallery.noImagesDescription") }}
        </p>

        <!-- 统计信息 -->
        <div class="text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
          <span v-if="allFolders.length > 0">{{ allFolders.length }} {{ t("gallery.foldersCount") }}</span>
          <span v-if="allFolders.length > 0 && allOtherFiles.length > 0"> • </span>
          <span v-if="allOtherFiles.length > 0">{{ allOtherFiles.length }} {{ t("gallery.otherFilesCount") }}</span>
          <span v-if="allFolders.length === 0 && allOtherFiles.length === 0">{{ t("gallery.emptyFolder") }}</span>
        </div>
      </div>
    </div>

    <!-- 懒加载模式下不需要加载更多按钮 -->
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { onClickOutside, useIntersectionObserver } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useGalleryView } from "@/composables/ui-interaction/useGalleryView";
import { useContextMenu } from "@/composables/useContextMenu";
import { detectLivePhoto } from "@/utils/livePhotoUtils.js";
import { IconAdjustments, IconChevronDown, IconExclamation, IconGallery, IconSortAscending } from "@/components/icons";
import { getFileIcon } from "@/utils/fileTypeIcons";
import { formatFileSize } from "@/utils/fileUtils";
import MasonryWall from "@yeger/vue-masonry-wall";
import "@/components/common/LivePhoto/LivePhotoViewer.css";
import { LIVE_PHOTO_BADGE_ICON_SVG } from "@/components/common/LivePhoto/livePhotoBadgeIconSvg.js";
import { useFsMediaLightbox } from "@/modules/fs/composables/useFsMediaLightbox";

const { t } = useI18n();
const livePhotoBadgeIconSvg = LIVE_PHOTO_BADGE_ICON_SVG;

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  isCheckboxMode: {
    type: Boolean,
    default: false,
  },
  selectedItems: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["item-click", "item-select", "download", "getLink", "rename", "delete", "contextmenu", "show-message"]);

// 使用图廊视图组合式函数
const {
  // 数据
  allFolders,
  allImages,
  allOtherFiles,
  masonryItems,
  hasMoreImages,
  loadMoreImages,

  // 设置状态
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

  // 图片状态/加载
  imageStates,
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
  clearImageStates,
  resetRenderWindow,
} = useGalleryView({ items: computed(() => props.items) });

const fsLightbox = useFsMediaLightbox();
const toolbarRef = ref(null);

// 点击外部关闭菜单（VueUse 自动管理监听器与清理）
onClickOutside(toolbarRef, () => {
  if (!showSortMenu.value && !showViewSettings.value) return;
  showSortMenu.value = false;
  showViewSettings.value = false;
});

// ===== 操作菜单相关方法 =====

// 处理下载操作
const handleDownload = (item) => {
  emit("download", item);
};

// 处理获取链接操作
const handleGetLink = (item) => {
  emit("getLink", item);
};

// 处理重命名操作
const handleRename = (item) => {
  emit("rename", item);
};

// 处理删除操作
const handleDelete = (items) => {
  emit("delete", items);
};

// 处理复制操作 - 通过 contextmenu 事件传递
const handleCopy = (items) => {
  // 传递给父组件处理
  emit("contextmenu", { 
    event: null, 
    item: Array.isArray(items) ? items[0] : items,
    items: Array.isArray(items) ? items : [items],
    action: 'copy'
  });
};

// 处理添加到文件篮操作 - 通过 contextmenu 事件传递
const handleAddToBasket = (items) => {
  // 传递给父组件处理
  emit("contextmenu", { 
    event: null, 
    item: Array.isArray(items) ? items[0] : items,
    items: Array.isArray(items) ? items : [items],
    action: 'add-to-basket'
  });
};

// 处理切换勾选框显示 - 通过 contextmenu 事件传递
const handleToggleCheckboxes = () => {
  emit("contextmenu", { 
    event: null, 
    item: null,
    items: [],
    action: 'toggle-checkboxes'
  });
};

// 初始化右键菜单（必须在操作函数定义之后）
const contextMenu = useContextMenu({
  onDownload: handleDownload,
  onGetLink: handleGetLink,
  onRename: handleRename,
  onDelete: handleDelete,
  onCopy: handleCopy,
  onAddToBasket: handleAddToBasket,
  onToggleCheckboxes: handleToggleCheckboxes,
  t,
});

// 内容摘要 - 只显示图片统计
const getContentSummary = () => {
  const imageCount = allImages.value.length;

  if (imageCount === 0) {
    return t("gallery.noImages");
  }

  return `${imageCount} ${t("gallery.imagesCount")}`;
};

// 懒加载：只返回状态，不触发加载
const getImageSrc = (image) => {
  const imageState = imageStates.value.get(image.path);

  // 如果状态为loaded，返回URL
  if (imageState?.status === "loaded" && imageState.url) {
    return imageState.url;
  }

  // 不在这里触发加载，由IntersectionObserver负责
  return "";
};

// 获取图片状态
const getImageState = (image) => {
  return imageStates.value.get(image.path);
};

// ===== Live Photo（图廊仅标识，不播放）=====

const livePhotoInfoByPath = computed(() => {
  const map = new Map();
  for (const img of allImages.value) {
    if (!img?.path) continue;
    const result = detectLivePhoto(img, props.items);
    map.set(img.path, {
      isLive: !!result?.isLivePhoto,
      videoPath: result?.videoFile?.path || "",
    });
  }
  return map;
});

const isLivePhotoInGallery = (image) => {
  if (!image?.path) return false;
  return !!livePhotoInfoByPath.value.get(image.path)?.isLive;
};

const handleImageLoad = (image, event) => {
  const img = event.target;
  const aspectRatio = img.naturalWidth / img.naturalHeight;

  // 更新图片状态，添加尺寸信息
  const currentState = imageStates.value.get(image.path);
  if (currentState) {
    imageStates.value.set(image.path, {
      ...currentState,
      aspectRatio,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }
};

// 图片加载失败：优先做一次“重新拉取 URL”（常见于预签名 URL 过期）
const errorRetries = new Map(); // key: image.path => number
let galleryAbortController = null;

const handleImageError = (image) => {
  const current = errorRetries.get(image.path) || 0;
  if (current < 1) {
    errorRetries.set(image.path, current + 1);
    imageStates.value.set(image.path, { status: "idle", url: null });
    void loadImageUrl(image, { priority: "high", signal: galleryAbortController?.signal });
    return;
  }
  imageStates.value.set(image.path, { status: "error", url: null });
};

const getPlaceholderStyle = () => {
  // 瀑布流占位符样式
  return {
    width: "100%",
    height: "200px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
};

// 当前目录的图片索引
const imagesByPath = computed(() => {
  return new Map(allImages.value.map((img) => [img.path, img]));
});

// 灯箱数据源
const lightboxItems = computed(() => {
  const infoMap = livePhotoInfoByPath.value;
  return allImages.value.map((img) => {
    const info = infoMap.get(img.path);
    if (info?.isLive && info.videoPath) {
      return {
        ...img,
        __cloudpasteLivePhotoVideoPath: info.videoPath,
      };
    }
    return img;
  });
});

// 上下文菜单处理 - 使用统一的 useContextMenu
const handleContextMenu = (event, image) => {
  // 获取当前已选中的项目
  const selectedFiles = props.selectedItems || [];
  const isImageSelected = selectedFiles.some((i) => i.path === image.path);

  let itemsForMenu;

  if (selectedFiles.length > 0) {
    // 有选中项时：
    // - 如果右键的项目已在选中列表中，操作所有选中项目
    // - 如果右键的项目不在选中列表中，只操作当前项目
    if (isImageSelected) {
      itemsForMenu = selectedFiles;
    } else {
      itemsForMenu = [image];
    }
  } else {
    // 无选中项：只操作当前右键的项目
    itemsForMenu = [image];
  }

  // 显示右键菜单（传递当前勾选框显示状态）
  contextMenu.showContextMenu(event, image, itemsForMenu, props.darkMode, props.isCheckboxMode);
};

// 懒加载：IntersectionObserver（VueUse）
const lazyImageTargets = ref([]);
const { stop: stopLazyImageObserver } = useIntersectionObserver(
  lazyImageTargets,
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const placeholder = /** @type {HTMLElement} */ (entry.target);
      const imagePath = placeholder?.dataset?.imagePath;
      if (!imagePath) return;

      // 查找对应的图片对象
      const image = imagesByPath.value.get(imagePath);
      if (!image) return;

      // 根据可见比例确定优先级
      const priority = entry.intersectionRatio > 0.5 ? "high" : "normal";
      void loadImageUrl(image, { priority, signal: galleryAbortController?.signal });

      // 停止观察这个占位符，避免重复触发
      try {
        observer?.unobserve?.(placeholder);
      } catch {
        // ignore
      }
    });
  },
  {
    rootMargin: "200px",
    threshold: [0.1, 0.5],
  }
);

// 定时器管理
const timers = new Set();

// 安全的定时器函数
const safeSetTimeout = (callback, delay) => {
  const id = setTimeout(() => {
    timers.delete(id);
    callback();
  }, delay);
  timers.add(id);
  return id;
};

// 初始化/重置懒加载观察目标（Observer 实例由 VueUse 管理）
const initImageLazyLoading = () => {
  lazyImageTargets.value = [];
};

// 观察所有懒加载占位符（带重试机制）
const observeLazyImages = (retryCount = 0) => {
  // 查找所有懒加载占位符
  const lazyPlaceholders = document.querySelectorAll(".lazy-image");

  if (lazyPlaceholders.length === 0 && retryCount < 2) {
    safeSetTimeout(() => {
      observeLazyImages(retryCount + 1);
    }, 200 * (retryCount + 1));
    return;
  }

  if (lazyPlaceholders.length === 0) {
    return;
  }

  /** @type {HTMLElement[]} */
  const targets = [];
  lazyPlaceholders.forEach((placeholder) => {
    // 只观察还没有URL的图片
    const imagePath = placeholder.dataset.imagePath;
    const imageState = imageStates.value.get(imagePath);
    if (imageState?.status === "idle") {
      targets.push(/** @type {HTMLElement} */ (placeholder));
    }
  });

  lazyImageTargets.value = targets;
};

// 事件处理 - 集成 PhotoSwipe 预览
const handleItemClick = async (item) => {
  // 勾选模式：不触发预览
  if (props.isCheckboxMode) {
    toggleItemSelect(item);
    return;
  }

  const currentIndex = lightboxItems.value.findIndex((img) => img.path === item.path);
  if (currentIndex === -1) {
    emit("item-click", item);
    return;
  }

  fsLightbox.open({
    items: lightboxItems.value,
    index: currentIndex,
    darkMode: props.darkMode,
    imageStates: imageStates.value,
    loadImageUrl,
    onDownload: (current) => emit("download", current),
    onGetLink: (current) => emit("getLink", current),
  });
};

const toggleItemSelect = (item) => {
  emit("item-select", item, !isItemSelected(item));
};

const isItemSelected = (item) => {
  return props.selectedItems.some((selected) => selected.path === item.path);
};

// 更新CSS变量以控制垂直间距（水平间距由MasonryWall的gap属性控制）
const updateSpacingCSSVariables = () => {
  const galleryElement = document.querySelector(".masonry-wall-gallery");
  if (galleryElement) {
    galleryElement.style.setProperty("--vertical-gap", `${verticalGap.value}px`);
  }
};

// 监听垂直间距变化
watch(
  verticalGap,
  () => {
    updateSpacingCSSVariables();
  },
  { immediate: true }
);

// 监听masonryItems变化，重新观察新的懒加载图片
watch(
  masonryItems,
  () => {
    // 延迟观察，等待MasonryWall重新渲染完成
    safeSetTimeout(() => {
      observeLazyImages();
    }, 100);
  },
  { flush: "post" }
);

// 渐进渲染：观察底部哨兵，按需扩展渲染窗口
const loadMoreSentinelRef = ref(null);
const { stop: stopLoadMoreObserver } = useIntersectionObserver(
  loadMoreSentinelRef,
  (entries) => {
    const entry = entries?.[0];
    if (!entry?.isIntersecting) return;
    if (!hasMoreImages.value) return;
    loadMoreImages();
    nextTick(() => observeLazyImages());
  },
  { rootMargin: "800px" }
);

// 生命周期
onMounted(() => {
  setupWatchers();
  galleryAbortController = new AbortController();

  nextTick(() => {
    updateSpacingCSSVariables();
    initImageLazyLoading();
  });

  safeSetTimeout(() => observeLazyImages(), 100);
});

// 目录切换/刷新：取消在途加载，避免旧目录请求回写到新目录的状态
watch(
  () => props.items,
  () => {
    errorRetries.clear();
    galleryAbortController?.abort();
    galleryAbortController = new AbortController();
    initImageLazyLoading();
    nextTick(() => {
      observeLazyImages();
    });
  }
);

onBeforeUnmount(() => {
  timers.forEach((id) => clearTimeout(id));
  timers.clear();

  stopLazyImageObserver?.();
  stopLoadMoreObserver?.();

  galleryAbortController?.abort();
  galleryAbortController = null;

  clearImageStates();
  resetRenderWindow();
});
</script>

<style scoped>
@import "@/styles/pages/mount-explorer/gallery.css";
</style>
