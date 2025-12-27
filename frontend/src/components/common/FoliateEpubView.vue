<template>
  <div
      ref="rootRef"
      class="foliate-epub-view w-full h-full relative flex flex-col"
      :class="[
      darkMode ? 'bg-gray-900' : 'bg-white'
    ]"
      @click="handleContainerClick"
      @mousemove="handleMouseMove"
  >
    <!-- 顶部工具栏：点击/悬停显示 -->
    <transition name="toolbar-fade">
      <div
          v-show="toolbarVisible || loading || error"
          class="toolbar-container absolute top-0 left-0 right-0 z-20"
      >
        <div
            class="flex items-center justify-between gap-2 px-3 py-2 backdrop-blur-sm"
            :class="darkMode ? 'bg-gray-800/90' : 'bg-white/90'"
        >
          <!-- 左侧：目录按钮 + 书籍信息 -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <button
                type="button"
                class="toolbar-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors"
                :class="[
                darkMode
                  ? 'hover:bg-gray-700 text-gray-300 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900',
                sidebarOpen ? (darkMode ? 'bg-gray-700' : 'bg-gray-100') : ''
              ]"
                @click.stop="sidebarOpen = !sidebarOpen"
                :disabled="loading || error || tocItems.length === 0"
                :title="sidebarOpen ? t('fileView.preview.epub.closeToc') : t('fileView.preview.epub.toc')"
            >
              <IconMenu size="sm" class="w-4 h-4" />
              <span class="text-sm hidden sm:inline">{{ t('fileView.preview.epub.toc') }}</span>
            </button>

            <!-- 书籍标题（仅在有空间时显示） -->
            <div v-if="bookTitle" class="hidden md:block min-w-0 flex-1">
              <div class="text-sm font-medium truncate" :class="darkMode ? 'text-gray-200' : 'text-gray-800'">
                {{ bookTitle }}
              </div>
            </div>
          </div>

          <!-- 右侧：历史导航 + 书签 + 阅读模式 + 翻页控制 -->
          <div class="flex items-center gap-2">
            <!-- 历史导航按钮组 -->
            <div class="flex items-center rounded-md overflow-hidden" :class="darkMode ? 'bg-gray-700' : 'bg-gray-100'">
              <button
                  type="button"
                  class="px-2 py-1.5 transition-colors"
                  :class="[
                  darkMode ? 'text-gray-300' : 'text-gray-600',
                  readingHistory.canGoBack.value ? (darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200') : 'opacity-40 cursor-not-allowed'
                ]"
                  @click.stop="historyBack"
                  :disabled="!readingHistory.canGoBack.value || loading || error"
                  :title="t('fileView.preview.epub.historyBack')"
              >
                <IconArrowLeft size="sm" class="w-4 h-4" />
              </button>
              <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>
              <button
                  type="button"
                  class="px-2 py-1.5 transition-colors"
                  :class="[
                  darkMode ? 'text-gray-300' : 'text-gray-600',
                  readingHistory.canGoForward.value ? (darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200') : 'opacity-40 cursor-not-allowed'
                ]"
                  @click.stop="historyForward"
                  :disabled="!readingHistory.canGoForward.value || loading || error"
                  :title="t('fileView.preview.epub.historyForward')"
              >
                <IconArrowRight size="sm" class="w-4 h-4" />
              </button>
            </div>

            <!-- 书签按钮 -->
            <button
                type="button"
                class="px-2.5 py-1.5 rounded-md transition-colors"
                :class="[
                darkMode
                  ? 'hover:bg-gray-700 text-gray-300 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900',
                isCurrentBookmarked ? (darkMode ? 'text-yellow-400' : 'text-yellow-500') : ''
              ]"
                @click.stop="toggleBookmark"
                :disabled="loading || error || !viewReady || !currentCfi"
                :title="isCurrentBookmarked ? t('fileView.preview.epub.removeBookmark') : t('fileView.preview.epub.addBookmark')"
            >
              <IconBookmarkSolid v-if="isCurrentBookmarked" size="sm" class="w-4 h-4" />
              <IconBookmark v-else size="sm" class="w-4 h-4" />
            </button>

            <!-- 阅读模式切换 -->
            <select
                v-model="flowMode"
                class="text-sm px-2 py-1.5 rounded-md border-0 cursor-pointer transition-colors"
                :class="darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'"
                :disabled="loading || error || !viewReady"
                :title="t('fileView.preview.epub.readingMode')"
            >
              <option value="paginated">{{ t('fileView.preview.epub.modePaginated') }}</option>
              <option value="scrolled">{{ t('fileView.preview.epub.modeScrolled') }}</option>
            </select>

            <!-- 翻页按钮组 -->
            <div class="flex items-center rounded-md overflow-hidden" :class="darkMode ? 'bg-gray-700' : 'bg-gray-100'">
              <button
                  type="button"
                  class="px-3 py-1.5 transition-colors"
                  :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
                  @click.stop="goLeft"
                  :disabled="loading || error || !viewReady"
                  :title="t('fileView.preview.epub.prevPage')"
              >
                <IconChevronLeft size="sm" class="w-4 h-4" />
              </button>
              <div class="w-px h-4" :class="darkMode ? 'bg-gray-600' : 'bg-gray-300'"></div>
              <button
                  type="button"
                  class="px-3 py-1.5 transition-colors"
                  :class="darkMode ? 'hover:bg-gray-600 text-gray-300' : 'hover:bg-gray-200 text-gray-600'"
                  @click.stop="goRight"
                  :disabled="loading || error || !viewReady"
                  :title="t('fileView.preview.epub.nextPage')"
              >
                <IconChevronRight size="sm" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 主内容区：目录侧边栏 + 阅读区域 -->
    <div class="flex-1 relative overflow-hidden">
      <!-- 目录侧边栏遮罩 -->
      <transition name="sidebar-fade">
        <div
            v-if="sidebarOpen"
            class="absolute inset-0 z-10 bg-black/30"
            @click="sidebarOpen = false"
        ></div>
      </transition>

      <!-- 目录侧边栏 -->
      <transition name="sidebar-slide">
        <div
            v-if="sidebarOpen"
            class="absolute left-0 top-0 bottom-0 z-20 w-72 max-w-[80%] flex flex-col shadow-xl"
            :class="darkMode ? 'bg-gray-800' : 'bg-white'"
            @click.stop
        >
          <!-- 侧边栏头部 -->
          <div class="flex items-center justify-between p-4 border-b" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
            <div class="min-w-0 flex-1">
              <div class="text-base font-semibold truncate" :class="darkMode ? 'text-gray-100' : 'text-gray-900'">
                {{ bookTitle || 'EPUB' }}
              </div>
              <div v-if="bookAuthor" class="text-sm truncate mt-0.5" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
                {{ bookAuthor }}
              </div>
            </div>
            <button
                type="button"
                class="ml-2 p-1.5 rounded-md transition-colors"
                :class="darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'"
                @click="sidebarOpen = false"
                :title="t('fileView.preview.epub.closeToc')"
            >
              <IconClose size="sm" class="w-5 h-5" />
            </button>
          </div>

          <!-- 目录列表 -->
          <div class="flex-1 overflow-auto p-2">
            <!-- 书签区域 -->
            <div v-if="bookmarksList.length > 0" class="mb-4">
              <div class="text-xs font-semibold uppercase tracking-wider px-2 py-1 mb-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
                {{ t('fileView.preview.epub.bookmarks') }}
              </div>
              <ul class="space-y-0.5">
                <li v-for="bookmark in bookmarksList" :key="bookmark.cfi" class="group">
                  <div
                      class="flex items-center gap-1 rounded-md transition-colors cursor-pointer"
                      :class="darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'"
                  >
                    <button
                        type="button"
                        class="flex-1 text-left text-sm py-2 px-2 rounded transition-colors truncate flex items-center gap-2"
                        :class="darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'"
                        @click="goToBookmark(bookmark)"
                        :title="bookmark.title"
                    >
                      <IconBookmarkSolid size="sm" class="w-3 h-3 flex-shrink-0" :class="darkMode ? 'text-yellow-400' : 'text-yellow-500'" />
                      <span class="truncate">{{ bookmark.title || t('fileView.preview.epub.untitledBookmark') }}</span>
                    </button>
                    <button
                        type="button"
                        class="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        :class="darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'"
                        @click.stop="epubProgress?.removeBookmark(bookmark.cfi)"
                        :title="t('fileView.preview.epub.removeBookmark')"
                    >
                      <IconClose size="sm" class="w-3 h-3" />
                    </button>
                  </div>
                </li>
              </ul>
              <div class="border-b my-2" :class="darkMode ? 'border-gray-700' : 'border-gray-200'"></div>
            </div>

            <!-- 目录区域 -->
            <div v-if="tocItems.length > 0" class="text-xs font-semibold uppercase tracking-wider px-2 py-1 mb-1" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t('fileView.preview.epub.toc') }}
            </div>
            <div v-if="!tocItems.length && !bookmarksList.length" class="text-sm p-3" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              {{ t('fileView.preview.epub.noToc') }}
            </div>
            <ul v-if="tocItems.length" class="space-y-0.5">
              <TocNode v-for="node in tocItems" :key="nodeKey(node)" :node="node" :dark-mode="darkMode" @go="goToToc" />
            </ul>
          </div>
        </div>
      </transition>

      <!-- 阅读器容器 -->
      <div ref="hostRef" class="w-full h-full"></div>

      <!-- 加载状态 -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center" :class="darkMode ? 'bg-gray-900' : 'bg-white'">
        <LoadingIndicator
            :text="loadingText"
            :dark-mode="darkMode"
            size="xl"
            icon-class="text-blue-500"
            :text-class="darkMode ? 'text-blue-400' : 'text-blue-600'"
        />
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center" :class="darkMode ? 'bg-gray-900' : 'bg-white'">
        <div class="text-center p-4">
          <IconExclamation class="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p class="text-base" :class="darkMode ? 'text-red-400' : 'text-red-600'">{{ errorText }}</p>
        </div>
      </div>
    </div>

    <!-- 底部进度条 -->
    <transition name="toolbar-fade">
      <div
          v-show="(toolbarVisible || loading || error) && viewReady"
          class="progress-container absolute bottom-0 left-0 right-0 z-20"
      >
        <div
            class="px-4 py-3 backdrop-blur-sm"
            :class="darkMode ? 'bg-gray-800/90' : 'bg-white/90'"
        >
          <!-- 进度条 -->
          <div class="relative h-1 rounded-full overflow-hidden mb-2" :class="darkMode ? 'bg-gray-700' : 'bg-gray-200'">
            <div
                class="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
                :class="darkMode ? 'bg-blue-500' : 'bg-blue-600'"
                :style="{ width: `${fraction * 100}%` }"
            ></div>
            <input
                type="range"
                min="0"
                max="1"
                step="0.0001"
                :dir="bookDir"
                v-model.number="fraction"
                @change="handleGoToFraction"
                :disabled="loading || error || !viewReady"
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                :title="progressTitle"
            />
          </div>

          <!-- 进度信息 -->
          <div class="flex items-center justify-between text-sm">
            <span :class="darkMode ? 'text-gray-400' : 'text-gray-500'">
              {{ progressTitle || percentText }}
            </span>
            <span class="font-medium" :class="darkMode ? 'text-gray-200' : 'text-gray-700'">
              {{ percentText }}
            </span>
          </div>
        </div>
      </div>
    </transition>

    <!-- 左右翻页热区（点击翻页） -->
    <div
        v-if="viewReady && !loading && !error && flowMode === 'paginated'"
        class="absolute inset-y-0 left-0 w-1/4 cursor-pointer z-10 opacity-0 hover:opacity-100 transition-opacity"
        @click.stop="goLeft"
    >
      <div class="absolute inset-y-0 left-0 w-full flex items-center justify-start pl-4">
        <div
            class="p-3 rounded-full transition-colors"
            :class="darkMode ? 'bg-gray-800/50 text-gray-300' : 'bg-white/50 text-gray-600'"
        >
          <IconChevronLeft size="lg" class="w-6 h-6" />
        </div>
      </div>
    </div>
    <div
        v-if="viewReady && !loading && !error && flowMode === 'paginated'"
        class="absolute inset-y-0 right-0 w-1/4 cursor-pointer z-10 opacity-0 hover:opacity-100 transition-opacity"
        @click.stop="goRight"
    >
      <div class="absolute inset-y-0 right-0 w-full flex items-center justify-end pr-4">
        <div
            class="p-3 rounded-full transition-colors"
            :class="darkMode ? 'bg-gray-800/50 text-gray-300' : 'bg-white/50 text-gray-600'"
        >
          <IconChevronRight size="lg" class="w-6 h-6" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed, defineComponent, h } from "vue";
import { useI18n } from "vue-i18n";
import { useEventListener } from "@vueuse/core";
import { IconChevronLeft, IconChevronRight, IconMenu, IconClose, IconExclamation, IconBookmark, IconBookmarkSolid, IconArrowLeft, IconArrowRight } from "@/components/icons";
import LoadingIndicator from "@/components/common/LoadingIndicator.vue";
import { useEpubProgress, useReadingHistory, generateBookId } from "@/composables/useEpubProgress.js";

// 注册 <foliate-view> 自定义元素
import "foliate-js/view.js";

const { t } = useI18n();

const props = defineProps({
  srcUrl: {
    type: String,
    default: "",
  },
  darkMode: {
    type: Boolean,
    default: false,
  },
  isFullscreen: {
    type: Boolean,
    default: false,
  },
  loadingText: {
    type: String,
    default: "Loading...",
  },
  errorText: {
    type: String,
    default: "Failed to load.",
  },
  // 书籍唯一标识，用于保存阅读进度
  bookId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["load", "error"]);

const hostRef = ref(null);
const rootRef = ref(null);
const loading = ref(true);
const error = ref(false);
const currentViewEl = ref(null);
const currentContentDocRef = ref(null);
let loadSeq = 0;
let stopViewRelocateListener = null;
let stopViewLoadListener = null;

const viewReady = computed(() => Boolean(currentViewEl.value));

// 工具栏显示控制
const toolbarVisible = ref(true);
let toolbarTimer = null;

const showToolbar = () => {
  toolbarVisible.value = true;
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(() => {
    if (!sidebarOpen.value) {
      toolbarVisible.value = false;
    }
  }, 3000);
};

const handleContainerClick = (e) => {
  // 点击中央区域切换工具栏
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) return;

  const x = e.clientX - rect.left;
  const centerStart = rect.width * 0.25;
  const centerEnd = rect.width * 0.75;

  if (x > centerStart && x < centerEnd) {
    toolbarVisible.value = !toolbarVisible.value;
    if (toolbarVisible.value) {
      showToolbar();
    }
  }
};

const handleMouseMove = () => {
  showToolbar();
};

// 目录/书籍信息
const sidebarOpen = ref(false);
const tocItems = ref([]);
const bookTitle = ref("");
const bookAuthor = ref("");
const bookDir = ref("ltr");

// 进度
const fraction = ref(0);
const percentText = computed(() => {
  const v = Number(fraction.value || 0);
  if (!Number.isFinite(v)) return "0%";
  return `${Math.round(v * 100)}%`;
});
const progressTitle = ref("");

// 阅读模式
const flowMode = ref("paginated");

// 当前 CFI 位置（用于书签判断）
const currentCfi = ref("");

// 计算书籍唯一标识
const computedBookId = computed(() => {
  if (props.bookId) return props.bookId;
  return generateBookId(props.srcUrl, bookTitle.value, bookAuthor.value);
});

// 阅读进度管理
const epubProgress = ref(null);
const readingHistory = useReadingHistory(50);

// 书签列表
const bookmarksList = ref([]);

// 初始化进度管理（在书籍加载后调用）
const initProgressManager = () => {
  const id = computedBookId.value;
  if (!id) return;

  // 创建新的进度管理实例
  const {
    currentCfi: savedCfi,
    currentFraction: savedFraction,
    bookmarks,
    isLoaded,
    loadProgress,
    saveProgress,
    saveProgressImmediate,
    addBookmark: addBookmarkFn,
    removeBookmark: removeBookmarkFn,
    hasBookmark: hasBookmarkFn
  } = useEpubProgress(id);

  epubProgress.value = {
    savedCfi,
    savedFraction,
    bookmarks,
    isLoaded,
    loadProgress: () => {
      const result = loadProgress();
      // loadProgress 后同步书签列表
      bookmarksList.value = [...bookmarks.value];
      return result;
    },
    saveProgress,
    saveProgressImmediate,
    addBookmark: (cfi, title, excerpt) => {
      const result = addBookmarkFn(cfi, title, excerpt);
      // 同步更新本地书签列表
      bookmarksList.value = [...bookmarks.value];
      return result;
    },
    removeBookmark: (cfi) => {
      const result = removeBookmarkFn(cfi);
      // 同步更新本地书签列表
      bookmarksList.value = [...bookmarks.value];
      return result;
    },
    hasBookmark: hasBookmarkFn,
  };
};

// 当前位置是否有书签
const isCurrentBookmarked = computed(() => {
  if (!currentCfi.value || !epubProgress.value) return false;
  return epubProgress.value.hasBookmark(currentCfi.value);
});

// 切换书签
const toggleBookmark = () => {
  if (!currentCfi.value || !epubProgress.value) return;

  if (isCurrentBookmarked.value) {
    epubProgress.value.removeBookmark(currentCfi.value);
  } else {
    // 获取当前章节标题
    const tocItem = currentViewEl.value?.getTOCItemOf?.(currentCfi.value);
    const title = tocItem?.label || progressTitle.value || "";
    epubProgress.value.addBookmark(currentCfi.value, title);
  }
};

// 跳转到书签
const goToBookmark = async (bookmark) => {
  if (!bookmark?.cfi || !currentViewEl.value) return;
  try {
    await currentViewEl.value.goTo(bookmark.cfi);
    sidebarOpen.value = false;
  } catch {
    // 静默处理
  }
};

// 历史导航
const historyBack = async () => {
  const target = readingHistory.goBack();
  if (target?.cfi && currentViewEl.value) {
    try {
      await currentViewEl.value.goTo(target.cfi);
    } catch {
      // 静默处理
    }
  }
};

const historyForward = async () => {
  const target = readingHistory.goForward();
  if (target?.cfi && currentViewEl.value) {
    try {
      await currentViewEl.value.goTo(target.cfi);
    } catch {
      // 静默处理
    }
  }
};

const formatLanguageMap = (x) => {
  if (!x) return "";
  if (typeof x === "string") return x;
  const keys = Object.keys(x);
  return x[keys[0]] || "";
};

const formatContributor = (contributor) => {
  if (!contributor) return "";
  if (typeof contributor === "string") return contributor;
  if (Array.isArray(contributor)) {
    const names = contributor.map((c) => (typeof c === "string" ? c : formatLanguageMap(c?.name))).filter(Boolean);
    return names.join(", ");
  }
  return formatLanguageMap(contributor?.name);
};

const nodeKey = (node) => {
  return `${String(node?.href || "")}::${String(node?.label || "")}`;
};

const goToToc = async (href) => {
  if (!href || !currentViewEl.value) return;
  try {
    await currentViewEl.value.goTo(href);
    sidebarOpen.value = false;
  } catch {
    // 静默处理
  }
};

const handleKeydown = (event) => {
  if (!currentViewEl.value) return;
  const k = event.key;
  if (k === "ArrowLeft" || k === "h") {
    event.preventDefault();
    currentViewEl.value.goLeft?.();
  } else if (k === "ArrowRight" || k === "l") {
    event.preventDefault();
    currentViewEl.value.goRight?.();
  } else if (k === "Escape") {
    sidebarOpen.value = false;
  }
};

// 注册键盘事件（自动清理）
useEventListener(document, "keydown", handleKeydown);
useEventListener(currentContentDocRef, "keydown", handleKeydown);

const handleRelocate = (event) => {
  const detail = event?.detail || {};
  if (typeof detail.fraction === "number" && Number.isFinite(detail.fraction)) {
    fraction.value = detail.fraction;
  }

  const percent = percentText.value;
  const pageItem = detail.pageItem;
  const location = detail.location;
  const locText = pageItem?.label ? `${t('fileView.preview.epub.page')} ${pageItem.label}` : location?.current ? `Loc ${location.current}` : "";
  progressTitle.value = locText ? `${locText}` : "";

  // 获取当前 CFI 并保存进度
  const cfi = detail.cfi || detail.location?.start?.cfi || "";
  if (cfi) {
    currentCfi.value = cfi;

    // 保存阅读进度
    if (epubProgress.value) {
      epubProgress.value.saveProgress(cfi, fraction.value);
    }

    // 记录历史（用于前进/后退导航）
    const tocItem = detail.tocItem;
    readingHistory.push(cfi, tocItem?.label || "");
  }
};

const handleLoadContentDoc = (event) => {
  const doc = event?.detail?.doc;
  if (doc && typeof doc.addEventListener === "function") {
    currentContentDocRef.value = doc;
  }
};

const applyFlowMode = () => {
  if (!currentViewEl.value?.renderer) return;
  currentViewEl.value.renderer.setAttribute?.("flow", flowMode.value);
};

// 应用暗色模式 - foliate-js 使用 CSS filter 实现暗色模式
const applyDarkMode = () => {
  if (!currentViewEl.value) return;
  // foliate-js 通过 CSS ::part(filter) 控制暗色模式
  // 我们通过添加/移除 data-dark 属性来控制
  if (props.darkMode) {
    currentViewEl.value.setAttribute("data-dark", "");
  } else {
    currentViewEl.value.removeAttribute("data-dark");
  }
};

const goLeft = () => {
  if (!currentViewEl.value) return;
  currentViewEl.value.goLeft?.();
};

const goRight = () => {
  if (!currentViewEl.value) return;
  currentViewEl.value.goRight?.();
};

const handleGoToFraction = async () => {
  if (!currentViewEl.value) return;
  const v = Number(fraction.value);
  if (!Number.isFinite(v)) return;
  try {
    await currentViewEl.value.goToFraction?.(v);
  } catch {
    // 静默处理
  }
};

const cleanup = () => {
  currentContentDocRef.value = null;
  if (typeof stopViewRelocateListener === "function") {
    stopViewRelocateListener();
    stopViewRelocateListener = null;
  }
  if (typeof stopViewLoadListener === "function") {
    stopViewLoadListener();
    stopViewLoadListener = null;
  }

  if (currentViewEl.value) {
    try {
      currentViewEl.value.close?.();
      currentViewEl.value.remove?.();
    } catch {
      // ignore
    }
  }
  currentViewEl.value = null;

  if (hostRef.value) {
    hostRef.value.innerHTML = "";
  }
};

const openBook = async () => {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = false;

  cleanup();

  const url = String(props.srcUrl || "").trim();
  if (!url) {
    loading.value = false;
    error.value = true;
    emit("error");
    return;
  }

  try {
    const viewEl = document.createElement("foliate-view");
    viewEl.className = "w-full h-full";
    viewEl.style.colorScheme = "light dark";

    hostRef.value?.appendChild(viewEl);
    currentViewEl.value = viewEl;

    stopViewRelocateListener = useEventListener(viewEl, "relocate", handleRelocate);
    stopViewLoadListener = useEventListener(viewEl, "load", handleLoadContentDoc);

    await viewEl.open(url);
    if (seq !== loadSeq) return;

    // 读取书信息/目录
    const book = viewEl.book;
    const title = formatLanguageMap(book?.metadata?.title) || "";
    const author = formatContributor(book?.metadata?.author) || "";
    bookTitle.value = title;
    bookAuthor.value = author;
    bookDir.value = book?.dir || "ltr";
    tocItems.value = Array.isArray(book?.toc) ? book.toc : [];

    // 应用阅读模式
    applyFlowMode();

    // 应用暗色模式
    applyDarkMode();

    // 初始化进度管理并恢复阅读位置
    initProgressManager();
    if (epubProgress.value) {
      const savedData = epubProgress.value.loadProgress();
      // 同步书签列表（loadProgress 会更新内部 bookmarks ref）
      if (epubProgress.value.bookmarks?.value) {
        bookmarksList.value = [...epubProgress.value.bookmarks.value];
      }
      if (savedData?.cfi) {
        // 恢复到上次阅读位置
        try {
          await viewEl.goTo(savedData.cfi);
        } catch {
          // 如果恢复失败，触发首屏渲染
          viewEl.renderer?.next?.();
        }
      } else {
        // 没有保存的进度，触发首屏渲染
        viewEl.renderer?.next?.();
      }
    } else {
      // 触发首屏渲染
      viewEl.renderer?.next?.();
    }

    loading.value = false;
    error.value = false;
    emit("load");

    // 初始显示工具栏
    showToolbar();
  } catch (e) {
    if (seq !== loadSeq) return;
    loading.value = false;
    error.value = true;
    emit("error", e);
  }
};

onMounted(() => {
  openBook();
});

watch(
    flowMode,
    () => {
      applyFlowMode();
    },
    { immediate: true },
);

watch(
    () => props.srcUrl,
    () => {
      openBook();
    },
);

// 监听暗色模式变化
watch(
    () => props.darkMode,
    () => {
      applyDarkMode();
    },
);

// 监听侧边栏状态，打开时保持工具栏显示
watch(sidebarOpen, (open) => {
  if (open) {
    toolbarVisible.value = true;
    clearTimeout(toolbarTimer);
  } else {
    showToolbar();
  }
});

onBeforeUnmount(() => {
  loadSeq++;
  clearTimeout(toolbarTimer);

  // 立即保存阅读进度
  if (epubProgress.value) {
    epubProgress.value.saveProgressImmediate();
  }

  cleanup();
});

// 目录树组件
const TocNode = defineComponent({
  name: "TocNode",
  props: {
    node: { type: Object, required: true },
    darkMode: { type: Boolean, default: false },
    depth: { type: Number, default: 0 },
  },
  emits: ["go"],
  setup(props, { emit }) {
    const children = computed(() => (Array.isArray(props.node?.subitems) ? props.node.subitems : []));
    const label = computed(() => String(props.node?.label || "").trim() || "Untitled");
    const href = computed(() => props.node?.href ?? "");
    const expanded = ref(false);

    const toggle = () => {
      if (!children.value.length) return;
      expanded.value = !expanded.value;
    };

    const go = () => {
      // 兜底 TOC 用章节 index
      if (href.value === null || href.value === undefined) return;
      if (typeof href.value === "string" && !href.value.trim()) return;
      emit("go", href.value);
    };

    return () => {
      const hasChildren = children.value.length > 0;
      const rowClass = `flex items-center gap-1 rounded-md transition-colors ${
          props.darkMode ? "hover:bg-gray-700" : "hover:bg-gray-100"
      }`;

      const toggleBtn = hasChildren
          ? h(
              "button",
              {
                type: "button",
                class: `w-7 h-7 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                    props.darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
                }`,
                onClick: toggle,
                title: expanded.value ? "收起" : "展开",
              },
              [h("span", { class: "text-xs" }, expanded.value ? "▾" : "▸")],
          )
          : h("span", { class: "w-7 h-7 flex-shrink-0" });

      const labelBtn = h(
          "button",
          {
            type: "button",
            class: `flex-1 text-left text-sm py-2 pr-2 rounded transition-colors truncate ${
                props.darkMode ? "text-gray-300 hover:text-white" : "text-gray-700 hover:text-gray-900"
            }`,
            onClick: go,
            title: label.value,
          },
          label.value,
      );

      const childList =
          expanded.value && hasChildren
              ? h(
                  "ul",
                  { class: "pl-4 mt-0.5 space-y-0.5" },
                  children.value.map((child) =>
                      h(TocNode, {
                        key: nodeKey(child),
                        node: child,
                        darkMode: props.darkMode,
                        depth: props.depth + 1,
                        onGo: (payload) => emit("go", payload),
                      }),
                  ),
              )
              : null;

      return h("li", null, [h("div", { class: rowClass }, [toggleBtn, labelBtn]), childList]);
    };
  },
});
</script>

<style scoped>
.foliate-epub-view :deep(foliate-view) {
  display: block;
}

.foliate-epub-view :deep(foliate-view[data-dark])::part(filter) {
  filter: invert(1) hue-rotate(180deg);
}

/* 全屏模式样式 - 确保内容填满整个屏幕 */
.foliate-epub-view:fullscreen,
.foliate-epub-view:-webkit-full-screen,
.foliate-epub-view:-moz-full-screen,
.foliate-epub-view:-ms-fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
}

/* 全屏时 foliate-view 填满容器 */
.foliate-epub-view:fullscreen :deep(foliate-view),
.foliate-epub-view:-webkit-full-screen :deep(foliate-view),
.foliate-epub-view:-moz-full-screen :deep(foliate-view),
.foliate-epub-view:-ms-fullscreen :deep(foliate-view) {
  width: 100% !important;
  height: 100% !important;
}

/* 父容器全屏时的样式 */
:fullscreen .foliate-epub-view,
:-webkit-full-screen .foliate-epub-view,
:-moz-full-screen .foliate-epub-view,
:-ms-fullscreen .foliate-epub-view {
  width: 100% !important;
  height: 100% !important;
}

:fullscreen .foliate-epub-view :deep(foliate-view),
:-webkit-full-screen .foliate-epub-view :deep(foliate-view),
:-moz-full-screen .foliate-epub-view :deep(foliate-view),
:-ms-fullscreen .foliate-epub-view :deep(foliate-view) {
  width: 100% !important;
  height: 100% !important;
}

/* 工具栏淡入淡出动画 */
.toolbar-fade-enter-active,
.toolbar-fade-leave-active {
  transition: opacity 0.2s ease;
}

.toolbar-fade-enter-from,
.toolbar-fade-leave-to {
  opacity: 0;
}

/* 侧边栏滑入滑出动画 */
.sidebar-slide-enter-active,
.sidebar-slide-leave-active {
  transition: transform 0.25s ease;
}

.sidebar-slide-enter-from,
.sidebar-slide-leave-to {
  transform: translateX(-100%);
}

/* 侧边栏遮罩淡入淡出 */
.sidebar-fade-enter-active,
.sidebar-fade-leave-active {
  transition: opacity 0.25s ease;
}

.sidebar-fade-enter-from,
.sidebar-fade-leave-to {
  opacity: 0;
}

/* 进度条滑块隐藏默认样式 */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: currentColor;
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: currentColor;
  cursor: pointer;
  border: none;
}
</style>
