/**
 * EPUB 阅读进度管理 Composable
 *
 * - 阅读进度自动保存/恢复
 * - 书签管理（添加、删除、跳转）
 * - 阅读历史导航（前进、后退）
 *
 * 存储结构：
 * {
 *   [bookId]: {
 *     cfi: "epubcfi(...)",           // 当前位置 CFI
 *     fraction: 0.25,                // 阅读进度百分比
 *     lastReadTime: timestamp,       // 最后阅读时间
 *     bookmarks: [{ cfi, title, createdAt }], // 书签列表
 *   }
 * }
 */

import { ref, computed, watch, onBeforeUnmount } from "vue";

const STORAGE_KEY = "cloudpaste-epub-progress";
const MAX_BOOKS = 30; // 最多保存 30 本书的进度
const SAVE_DEBOUNCE_MS = 1000; // 保存防抖时间

/**
 * 从 localStorage 加载所有进度数据
 */
function loadAllProgress() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.warn("[EpubProgress] 加载进度数据失败:", e);
    return {};
  }
}

/**
 * 保存所有进度数据到 localStorage
 */
function saveAllProgress(data) {
  try {
    // 清理过期数据：只保留最近的 MAX_BOOKS 本书
    const entries = Object.entries(data);
    if (entries.length > MAX_BOOKS) {
      // 按最后阅读时间排序，保留最新的
      entries.sort((a, b) => (b[1].lastReadTime || 0) - (a[1].lastReadTime || 0));
      data = Object.fromEntries(entries.slice(0, MAX_BOOKS));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn("[EpubProgress] 保存进度数据失败:", e);
    return false;
  }
}

/**
 * 生成书籍唯一标识
 * @param {string} url - 书籍 URL
 * @param {string} title - 书籍标题
 * @param {string} author - 书籍作者
 */
export function generateBookId(url, title = "", author = "") {
  // 优先使用 URL 的 hash，因为同一本书的 URL 通常是唯一的
  if (url) {
    // 提取 URL 中的文件名部分作为标识
    try {
      const urlObj = new URL(url, window.location.origin);
      const pathname = urlObj.pathname;
      // 移除查询参数和 hash，只保留路径
      const filename = pathname.split("/").pop() || pathname;
      if (filename) {
        return `url:${filename}`;
      }
    } catch {
      // URL 解析失败，使用整个 URL
      return `url:${btoa(url).slice(0, 32)}`;
    }
  }

  // 如果没有 URL，使用标题和作者
  if (title) {
    const id = `${title}-${author}`.replace(/\s+/g, "-").toLowerCase();
    return `meta:${id}`;
  }

  // 最后的 fallback
  return `unknown:${Date.now()}`;
}

/**
 * EPUB 阅读进度管理 Hook
 * @param {string} bookId - 书籍唯一标识
 */
export function useEpubProgress(bookId) {
  // 响应式状态
  const currentCfi = ref("");
  const currentFraction = ref(0);
  const bookmarks = ref([]);
  const isLoaded = ref(false);

  // 防抖保存定时器
  let saveTimer = null;

  /**
   * 加载书籍进度
   */
  function loadProgress() {
    if (!bookId) return null;

    const allData = loadAllProgress();
    const bookData = allData[bookId];

    if (bookData) {
      currentCfi.value = bookData.cfi || "";
      currentFraction.value = bookData.fraction || 0;
      bookmarks.value = Array.isArray(bookData.bookmarks) ? bookData.bookmarks : [];
      isLoaded.value = true;
      return bookData;
    }

    isLoaded.value = true;
    return null;
  }

  /**
   * 保存当前进度（防抖）
   */
  function saveProgress(cfi, fraction) {
    if (!bookId) return;

    currentCfi.value = cfi || currentCfi.value;
    currentFraction.value = fraction ?? currentFraction.value;

    // 防抖保存
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      const allData = loadAllProgress();
      allData[bookId] = {
        cfi: currentCfi.value,
        fraction: currentFraction.value,
        lastReadTime: Date.now(),
        bookmarks: bookmarks.value,
      };
      saveAllProgress(allData);
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 立即保存进度（不防抖）
   */
  function saveProgressImmediate() {
    if (!bookId) return;

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    const allData = loadAllProgress();
    allData[bookId] = {
      cfi: currentCfi.value,
      fraction: currentFraction.value,
      lastReadTime: Date.now(),
      bookmarks: bookmarks.value,
    };
    saveAllProgress(allData);
  }

  /**
   * 添加书签
   * @param {string} cfi - 书签位置 CFI
   * @param {string} title - 书签标题（章节名或自定义）
   * @param {string} excerpt - 书签摘要文本
   */
  function addBookmark(cfi, title = "", excerpt = "") {
    if (!cfi) return false;

    // 检查是否已存在
    const exists = bookmarks.value.some((b) => b.cfi === cfi);
    if (exists) return false;

    bookmarks.value.push({
      cfi,
      title: title || `书签 ${bookmarks.value.length + 1}`,
      excerpt: excerpt || "",
      createdAt: Date.now(),
    });

    saveProgressImmediate();
    return true;
  }

  /**
   * 删除书签
   * @param {string} cfi - 书签位置 CFI
   */
  function removeBookmark(cfi) {
    const index = bookmarks.value.findIndex((b) => b.cfi === cfi);
    if (index === -1) return false;

    bookmarks.value.splice(index, 1);
    saveProgressImmediate();
    return true;
  }

  /**
   * 检查当前位置是否有书签
   * @param {string} cfi - 位置 CFI
   */
  function hasBookmark(cfi) {
    if (!cfi) return false;
    return bookmarks.value.some((b) => b.cfi === cfi);
  }

  /**
   * 清除书籍所有数据
   */
  function clearProgress() {
    if (!bookId) return;

    currentCfi.value = "";
    currentFraction.value = 0;
    bookmarks.value = [];

    const allData = loadAllProgress();
    delete allData[bookId];
    saveAllProgress(allData);
  }

  // 组件卸载时立即保存
  onBeforeUnmount(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveProgressImmediate();
  });

  return {
    // 状态
    currentCfi,
    currentFraction,
    bookmarks,
    isLoaded,

    // 方法
    loadProgress,
    saveProgress,
    saveProgressImmediate,
    addBookmark,
    removeBookmark,
    hasBookmark,
    clearProgress,
  };
}

/**
 * 阅读历史导航 Hook
 * 管理阅读器内的前进/后退导航
 */
export function useReadingHistory(maxSize = 50) {
  const history = ref([]); // 历史记录栈
  const currentIndex = ref(-1); // 当前位置索引

  /**
   * 添加历史记录
   * @param {string} cfi - 位置 CFI
   * @param {string} title - 章节标题
   */
  function push(cfi, title = "") {
    if (!cfi) return;

    // 如果当前不在历史末尾，删除后面的记录
    if (currentIndex.value < history.value.length - 1) {
      history.value = history.value.slice(0, currentIndex.value + 1);
    }

    // 避免重复添加相同位置
    const last = history.value[history.value.length - 1];
    if (last?.cfi === cfi) return;

    // 添加新记录
    history.value.push({ cfi, title, timestamp: Date.now() });

    // 限制历史记录大小
    if (history.value.length > maxSize) {
      history.value.shift();
    } else {
      currentIndex.value = history.value.length - 1;
    }
  }

  /**
   * 是否可以后退
   */
  const canGoBack = computed(() => currentIndex.value > 0);

  /**
   * 是否可以前进
   */
  const canGoForward = computed(() => currentIndex.value < history.value.length - 1);

  /**
   * 后退
   * @returns {object|null} 后退到的位置
   */
  function goBack() {
    if (!canGoBack.value) return null;
    currentIndex.value--;
    return history.value[currentIndex.value];
  }

  /**
   * 前进
   * @returns {object|null} 前进到的位置
   */
  function goForward() {
    if (!canGoForward.value) return null;
    currentIndex.value++;
    return history.value[currentIndex.value];
  }

  /**
   * 清空历史
   */
  function clear() {
    history.value = [];
    currentIndex.value = -1;
  }

  return {
    history,
    currentIndex,
    canGoBack,
    canGoForward,
    push,
    goBack,
    goForward,
    clear,
  };
}

export default {
  useEpubProgress,
  useReadingHistory,
  generateBookId,
};
