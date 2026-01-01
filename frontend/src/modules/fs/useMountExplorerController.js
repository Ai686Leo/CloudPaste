import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useEventListener } from "@vueuse/core";
import { useAuthStore } from "@/stores/authStore.js";
import { useFsService } from "@/modules/fs";
import { useViewStateMachine } from "./composables/useViewStateMachine";
import { ViewState } from "./constants/ViewState";
import { normalizeFsPath, toDirApiPath } from "@/utils/fsPathUtils.js";
import { createLogger } from "@/utils/logger.js";

const HISTORY_LIMIT = 20;
/** @type {Map<string, any>} */
const historyMap = new Map();
const PREFETCH_LIMIT = 20;
/** @type {Map<string, any>} */
const prefetchMap = new Map();
/** @type {Map<string, boolean>} */
const isDirRecord = new Map();
let cacheEpoch = 0;

const invalidateCachesAfterMutation = () => {
  cacheEpoch += 1;
  historyMap.clear();
  prefetchMap.clear();
  isDirRecord.clear();
};

// 存储配置发生变更（例如 GitHub ref 切换）时：历史/prefetch 需要失效，
// 否则可能出现“旧目录快照短暂回显 → 后台刷新后消失”的闪现现象。
let storageConfigChangeListenerBound = false;
const bindStorageConfigChangeListener = () => {
  if (storageConfigChangeListenerBound) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  storageConfigChangeListenerBound = true;
  useEventListener(window, "cloudpaste:storage-config-changed", () => {
    invalidateCachesAfterMutation();
  });
};
bindStorageConfigChangeListener();

const safeClone = (value) => {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const encodeFsSegment = (segment) => encodeURIComponent(segment);

const decodeFsSegment = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const encodeFsPathForRoute = (fsPath) => {
  const normalized = normalizeFsPath(fsPath);
  if (normalized === "/") return "";
  const segments = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
  return `/${segments.map(encodeFsSegment).join("/")}`;
};

const decodeFsPathFromRouteRest = (rest) => {
  const raw = typeof rest === "string" ? rest : "";
  const withoutLeading = raw.replace(/^\/+/, "");
  if (!withoutLeading) return "/";
  const segments = withoutLeading.split("/").filter((seg) => seg.length > 0);
  return `/${segments.map(decodeFsSegment).join("/")}`;
};

const setPathAs = (path, dir = true) => {
  const normalized = normalizeFsPath(path);
  if (dir) {
    isDirRecord.set(normalized, true);
  } else {
    isDirRecord.delete(normalized);
  }
};

const getParentDirPath = (filePath) => {
  const normalizedFile = normalizeFsPath(filePath);
  if (normalizedFile === "/") return "/";
  const lastSlash = normalizedFile.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalizedFile.slice(0, lastSlash) || "/";
};

const buildMountExplorerRoutePath = (fsPath) => {
  const normalized = normalizeFsPath(fsPath);
  if (normalized === "/") return "/mount-explorer";
  return `/mount-explorer${encodeFsPathForRoute(normalized)}`;
};

const parseFsPathFromRoute = (routePath) => {
  if (routePath === "/mount-explorer") return "/";
  if (!routePath.startsWith("/mount-explorer/")) return "/";
  const rest = routePath.slice("/mount-explorer".length);
  return normalizeFsPath(decodeFsPathFromRouteRest(rest));
};

const normalizeRouteKey = (routePath) => {
  if (!routePath) return null;
  return buildMountExplorerRoutePath(normalizeFsPath(parseFsPathFromRoute(routePath)));
};

const shouldRecordHistory = (state) =>
  state !== ViewState.PASSWORD_REQUIRED && state !== ViewState.ERROR;

const setHistory = (key, snapshot) => {
  if (!key) return;
  historyMap.set(key, snapshot);
  if (historyMap.size <= HISTORY_LIMIT) return;
  const firstKey = historyMap.keys().next().value;
  if (firstKey) {
    historyMap.delete(firstKey);
  }
};

const setPrefetch = (key, snapshot) => {
  if (!key) return;
  prefetchMap.set(key, snapshot);
  if (prefetchMap.size <= PREFETCH_LIMIT) return;
  const firstKey = prefetchMap.keys().next().value;
  if (firstKey) {
    prefetchMap.delete(firstKey);
  }
};

const clearHistoryForRoutePath = (routePath) => {
  const key = normalizeRouteKey(routePath) || routePath;
  if (!key) return;
  historyMap.delete(key);
};

/**
 * MountExplorer 视图控制器
 *
 * - URL 仅表达“对象路径”（pathname），不再用“尾部 /”区分目录/文件
 * - 目录判定：优先使用本地 isDirRecord（来自 UI 导航/hover 预判），否则通过 /fs/get 判定
 * - 虚拟目录：当 /fs/get 无法解析挂载点时，回退到 /fs/list（后端会输出虚拟目录结构）
 */
export function useMountExplorerController() {
  const router = useRouter();
  const route = useRoute();

  const authStore = useAuthStore();
  const fsService = useFsService();
  const log = createLogger("MountExplorerController");

  const stateMachine = useViewStateMachine();

  const currentViewPath = ref("/");
  const currentPath = ref("/");

  const directoryData = stateMachine.directoryData;
  const fileData = stateMachine.fileData;

  const error = ref(null);
  const previewError = ref(null);

  const loading = computed(() => stateMachine.viewState.value === ViewState.LOADING_DIRECTORY);
  const isPreviewLoading = computed(() => stateMachine.viewState.value === ViewState.LOADING_FILE);

  const directoryItems = computed(() => directoryData.value?.items || []);
  const isVirtualDirectory = computed(() => !!directoryData.value?.isVirtual);
  const directoryMeta = computed(() => directoryData.value?.meta || null);
  const directoryNextCursor = computed(() => (directoryData.value && typeof directoryData.value.nextCursor === "string" ? directoryData.value.nextCursor : null));
  const directoryHasMore = computed(() => !!directoryNextCursor.value);
  const directoryLoadingMore = ref(false);

  // “待恢复滚动值”：只在“预览 → 列表”这类场景使用
  const pendingScrollRestore = ref(null);

  // 权限相关派生状态
  const isAdmin = computed(() => authStore.isAdmin);
  const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
  const hasFilePermission = computed(() => authStore.hasFileSharePermission);
  const hasMountPermission = computed(() => authStore.hasMountPermission);
  const hasPermission = computed(() => authStore.hasMountPermission);
  const apiKeyInfo = computed(() => authStore.apiKeyInfo);

  const hasPermissionForCurrentPath = computed(() => authStore.hasPathPermission(currentPath.value));

  const currentMountId = computed(() => {
    const data = directoryData.value;

    if (data && data.mount_id) {
      return data.mount_id;
    }

    if (data && Array.isArray(data.items)) {
      const mountItem = data.items.find((item) => item.isMount && item.mount_id);
      if (mountItem) {
        return mountItem.mount_id;
      }
    }

    const pathSegments = currentPath.value.split("/").filter(Boolean);
    return pathSegments.length > 0 ? pathSegments[0] : "";
  });

  let skipNextHistoryRecordKey = null;

  const shouldSkipHistoryRecordOnce = (routePath) => {
    const key = normalizeRouteKey(routePath) || routePath;
    if (!key) return false;
    if (!skipNextHistoryRecordKey) return false;
    if (skipNextHistoryRecordKey !== key) return false;
    skipNextHistoryRecordKey = null;
    return true;
  };

  const updateUrl = (fsPath, { replace = false, clearTargetHistory = true } = {}) => {
    const routePath = buildMountExplorerRoutePath(fsPath);
    // 避免恢复到过期目录内容；浏览器后退/前进不走这里，因此仍可恢复滚动位置。
    if (clearTargetHistory) {
      clearHistoryForRoutePath(routePath);
    }
    if (replace) {
      return router.replace({ path: routePath });
    }
    return router.push({ path: routePath });
  };

  const recordHistoryIfNeeded = (routePath) => {
    const key = normalizeRouteKey(routePath);
    if (!key) return false;
    const viewState = stateMachine.viewState.value;
    if (!shouldRecordHistory(viewState)) return false;
    if (directoryData.value == null && fileData.value == null) return false;

    // 记录时尽量落在稳定态：否则恢复后可能一直处于 loading 态，影响恢复体验
    const stableViewState =
      viewState === ViewState.LOADING_DIRECTORY && directoryData.value != null
        ? ViewState.DIRECTORY_LOADED
        : viewState === ViewState.LOADING_FILE && fileData.value != null
          ? ViewState.FILE_LOADED
          : viewState;

    // 用 window.scrollY 读取“实时值”，确保预览返回能回到准确位置。
    const scrollNow = typeof window !== "undefined" ? window.scrollY : 0;

    setHistory(key, {
      kind: "history",
      ts: Date.now(),
      epoch: cacheEpoch,
      viewState: stableViewState,
      currentViewPath: currentViewPath.value,
      currentPath: currentPath.value,
      // 目录数据通常体积较大：在 FILE_LOADED 状态下，直接复用当前对象引用即可，
      // 避免频繁 deep clone 造成 UI 卡顿（例如预览返回列表/前进后退时）。
      directoryData: viewState === ViewState.FILE_LOADED ? directoryData.value : safeClone(directoryData.value),
      fileData: safeClone(fileData.value),
      error: error.value,
      previewError: previewError.value,
      scroll: scrollNow || 0,
    });

    return true;
  };

  // UI 主动导航时：在触发路由变化前先记录当前页 scroll，避免在导航后 scrollTo(0) 抹掉旧位置
  const recordCurrentRouteHistoryBeforeNavigation = () => {
    const fromPath = route.path;
    const recorded = recordHistoryIfNeeded(fromPath);
    if (recorded) {
      skipNextHistoryRecordKey = normalizeRouteKey(fromPath) || fromPath;
    }
  };

  const navigateTo = async (path) => {
    recordCurrentRouteHistoryBeforeNavigation();
    const normalized = normalizeFsPath(path);
    setPathAs(normalized, true);
    // 进入新目录：默认回到顶部
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
    await updateUrl(normalized);
  };

  // 从“预览关闭”等场景回到目录：保留 history（用于恢复滚动位置与秒开体验）
  const navigateToPreserveHistory = async (path, { replace = false } = {}) => {
    recordCurrentRouteHistoryBeforeNavigation();
    const normalized = normalizeFsPath(path);
    setPathAs(normalized, true);
    await updateUrl(normalized, { replace, clearTargetHistory: false });
  };

  const navigateToFile = async (path) => {
    recordCurrentRouteHistoryBeforeNavigation();
    const normalized = normalizeFsPath(path);
    setPathAs(normalized, false);
    await updateUrl(normalized);
  };

  const stopPreview = () => {
    previewError.value = null;
    stateMachine.closeFilePreview();
    fsService.cancelFileInfoRequest();
  };

  const invalidateCaches = () => {
    invalidateCachesAfterMutation();
    // 强一致性：后端目录列表通过 ETag 条件请求缓存；写操作后清空本地可验证缓存，避免任何复活窗口
    if (typeof fsService.clearDirectoryListCache === "function") {
      fsService.clearDirectoryListCache();
    }
  };

  const removeItemsFromCurrentDirectory = (paths) => {
    if (!paths || !Array.isArray(paths) || paths.length === 0) return;
    const data = directoryData.value;
    if (!data || !Array.isArray(data.items)) return;
    const toRemove = new Set(paths.filter(Boolean));
    if (toRemove.size === 0) return;
    const nextItems = data.items.filter((item) => !toRemove.has(item?.path));
    if (nextItems.length === data.items.length) return;
    directoryData.value = {
      ...data,
      items: nextItems,
    };
  };

  const refreshDirectory = async () => {
    await loadDirectory(currentPath.value, { refresh: true });
  };

  const refreshCurrentRoute = async () => {
    await handleRouteChange(route.path);
  };

  const tryRecoverHistory = async (routePath) => {
    const key = normalizeRouteKey(routePath) || routePath;
    if (!key || !historyMap.has(key)) return false;
    const snapshot = historyMap.get(key);
    if (!snapshot) return false;
    if (snapshot.epoch !== cacheEpoch) return false;

    // 先准备“待恢复滚动值”
    const restoredViewState = snapshot.viewState || ViewState.INITIAL;
    const isPreviewState = restoredViewState === ViewState.FILE_LOADED || restoredViewState === ViewState.LOADING_FILE;
    pendingScrollRestore.value = isPreviewState ? null : (snapshot.scroll || 0);

    currentViewPath.value = snapshot.currentViewPath || "/";
    currentPath.value = snapshot.currentPath || "/";

    directoryData.value = snapshot.directoryData || null;
    fileData.value = snapshot.fileData || null;

    error.value = snapshot.error || null;
    previewError.value = snapshot.previewError || null;

    stateMachine.viewState.value = restoredViewState;
    stateMachine.errorInfo.value = null;

    await nextTick();

    return true;
  };

  const tryRecoverPrefetch = async (routePath) => {
    const key = normalizeRouteKey(routePath) || routePath;
    if (!key || !prefetchMap.has(key)) return false;
    const snapshot = prefetchMap.get(key);
    if (!snapshot) return false;
    if (snapshot.epoch !== cacheEpoch) return false;

    const dirPath = normalizeFsPath(snapshot.dirPath || parseFsPathFromRoute(routePath));
    const dirApiPath = toDirApiPath(dirPath);

    setPathAs(dirPath, true);
    currentViewPath.value = dirPath;
    currentPath.value = dirApiPath;

    directoryData.value = snapshot.directoryData || null;
    fileData.value = null;

    error.value = null;
    previewError.value = null;
    stopPreview();

    stateMachine.viewState.value = ViewState.DIRECTORY_LOADED;
    stateMachine.errorInfo.value = null;

    await nextTick();
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }

    return true;
  };

  const ensureWithinBasicPath = async (fsPath) => {
    const normalized = normalizeFsPath(fsPath);
    if (authStore.isAdmin) return normalized;
    if (!authStore.apiKeyInfo) return normalized;

    const basicPathRaw = authStore.apiKeyInfo.basic_path || "/";
    const basicPath = normalizeFsPath(basicPathRaw);

    if (basicPath === "/") return normalized;

    if (normalized === basicPath || normalized.startsWith(`${basicPath}/`)) {
      return normalized;
    }

    await updateUrl(basicPath, { replace: true });
    return null;
  };

  let activeRouteTask = 0;

  const loadDirectory = async (dirPath, { refresh = false, taskId } = {}) => {
    const targetViewPath = normalizeFsPath(dirPath);
    const targetDirApi = toDirApiPath(targetViewPath);
    const prevDirApi = currentPath.value;
    setPathAs(targetViewPath, true);

    currentViewPath.value = targetViewPath;
    currentPath.value = targetDirApi;

    error.value = null;
    previewError.value = null;
    stopPreview();

    // 导航到“不同目录”时，避免沿用旧目录数据导致 UI 展示与路径不一致。
    // 刷新同一路径时保留旧数据，让 DirectoryList 可以继续展示并配合 loading skeleton。
    if (!refresh && prevDirApi !== targetDirApi) {
      directoryData.value = null;
    }

    stateMachine.startLoadingDirectory(targetDirApi);

    try {
      const data = await fsService.getDirectoryList(targetDirApi, { refresh });
      if (taskId != null && taskId !== activeRouteTask) return;
      if (data === null) return;
      stateMachine.onDirectoryLoaded(data);
    } catch (e) {
      if (taskId != null && taskId !== activeRouteTask) return;
      if (e?.code === "FS_PATH_PASSWORD_REQUIRED") {
        stateMachine.requirePassword();
        return;
      }
      error.value = e?.message || "加载目录失败";
      stateMachine.setError(e);
    }
  };

  const loadFile = async (filePath, { taskId } = {}) => {
    const targetPath = normalizeFsPath(filePath);
    const parentViewPath = getParentDirPath(targetPath);
    const parentDirApi = toDirApiPath(parentViewPath);

    currentViewPath.value = targetPath;
    currentPath.value = parentDirApi;

    error.value = null;
    previewError.value = null;

    stateMachine.startLoadingFile(targetPath, parentDirApi);

    try {
      const info = await fsService.getFileInfo(targetPath);
      if (taskId != null && taskId !== activeRouteTask) return;
      if (info === null) return;

      const isDirectoryInfo = !!info.isDirectory || info.type === "directory" || info.is_dir === true;
      if (isDirectoryInfo) {
        setPathAs(targetPath, true);
        await loadDirectory(targetPath, { taskId });
        return;
      }

      fileData.value = info;
      setPathAs(targetPath, false);
      stateMachine.onFileLoaded(info);
    } catch (e) {
      if (taskId != null && taskId !== activeRouteTask) return;
      if (e?.code === "FS_PATH_PASSWORD_REQUIRED") {
        stateMachine.requirePassword();
        return;
      }
      // /fs/get 无法解析挂载点或对象：回退到 /fs/list（后端会输出虚拟目录结构）
      await loadDirectory(targetPath, { taskId });
      if (taskId != null && taskId !== activeRouteTask) return;
      if (stateMachine.viewState.value === ViewState.DIRECTORY_LOADED || stateMachine.viewState.value === ViewState.PASSWORD_REQUIRED) {
        return;
      }

      previewError.value = e?.message || "预览失败";
      stateMachine.setError(e);
    }
  };

  const handleRouteChange = async (routePath) => {
    if (!authStore.isAuthenticated) return;
    const taskId = ++activeRouteTask;
    fsService.cancelAllRequests();
    pendingScrollRestore.value = null;

    const fsPath = normalizeFsPath(parseFsPathFromRoute(routePath));
    const allowedPath = await ensureWithinBasicPath(fsPath);
    if (taskId !== activeRouteTask) return;
    if (!allowedPath) return;

    const silentRevalidateDirectory = async () => {
      const expectedTask = taskId;
      const expectedKey = normalizeRouteKey(routePath) || routePath;
      const dirApiPath = currentPath.value;
      const expectedEpoch = cacheEpoch;

      if (stateMachine.viewState.value !== ViewState.DIRECTORY_LOADED) return;
      if (!dirApiPath) return;

      // 后台 revalidate：优先走 If-None-Match/304
      // 写操作后会 clearDirectoryListCache，因此仍会强制拉取最新数据。
      const data = await fsService.prefetchDirectoryList(dirApiPath, { refresh: false, returnNullOnNotModified: true });
      if (expectedTask !== activeRouteTask) return;
      if ((normalizeRouteKey(route.path) || route.path) !== expectedKey) return;
      if (cacheEpoch !== expectedEpoch) return;
      if (!data) return;
      if (stateMachine.viewState.value !== ViewState.DIRECTORY_LOADED) return;
      // 一致性优先：严格替换，保证删除/改名不会再次“复活”
      directoryData.value = data;
    };

    // 优先使用 history 恢复（避免重复请求 + 恢复滚动位置）
    const recovered = await tryRecoverHistory(routePath);
    if (taskId !== activeRouteTask) return;
    if (recovered) {
      // stale-while-revalidate：先秒开恢复，再后台拉取最新目录数据无感更新
      void silentRevalidateDirectory();
      return;
    }

    // hover 预热恢复（用于 UI 主动导航的瞬时加载优化）
    const recoveredPrefetch = await tryRecoverPrefetch(routePath);
    if (taskId !== activeRouteTask) return;
    if (recoveredPrefetch) {
      void silentRevalidateDirectory();
      return;
    }

    if (allowedPath === "/" || isDirRecord.get(allowedPath)) {
      await loadDirectory(allowedPath, { taskId });
      return;
    }

    // 文件/未知：先 /fs/get 判定；当 /fs/get 无法解析挂载点时，会回退到 /fs/list 虚拟目录
    await loadFile(allowedPath, { taskId });
  };

  const consumePendingScrollRestore = () => {
    const value = pendingScrollRestore.value;
    if (value == null) return null;
    pendingScrollRestore.value = null;
    return value;
  };

  // 路由变化监听：记录旧页面 history，再处理新页面
  watch(
    () => route.path,
    (newPath, oldPath) => {
      if (!shouldSkipHistoryRecordOnce(oldPath)) {
        recordHistoryIfNeeded(oldPath);
      }
      handleRouteChange(newPath);
    },
    { immediate: true }
  );

  onMounted(async () => {
    if (authStore.needsRevalidation) {
      await authStore.validateAuth();
    }
  });

  const resetCaches = () => {
    historyMap.clear();
    prefetchMap.clear();
    isDirRecord.clear();
  };

  const loadMoreCurrentDirectory = async () => {
    const data = directoryData.value;
    if (!data || !Array.isArray(data.items)) return false;
    const cursor = directoryNextCursor.value;
    if (!cursor) return false;
    if (directoryLoadingMore.value) return false;
    if (loading.value) return false;

    directoryLoadingMore.value = true;
    try {
      const more = await fsService.getDirectoryList(currentPath.value, { cursor });
      if (!more || !Array.isArray(more.items)) {
        return false;
      }

      // 防御：只允许 append 同一路径的分页结果
      if (String(more.path || "") !== String(data.path || "")) {
        log.warn("分页目录结果路径不一致，已跳过 append:", { current: data.path, next: more.path });
        return false;
      }

      const existed = new Set(data.items.map((it) => it?.path).filter(Boolean));
      const appended = more.items.filter((it) => it && it.path && !existed.has(it.path));

      directoryData.value = {
        ...data,
        items: [...data.items, ...appended],
        // 后端会对 HF 分页返回 nextCursor
        nextCursor: typeof more.nextCursor === "string" && more.nextCursor ? more.nextCursor : null,
        hasMore: !!more.nextCursor,
      };

      return true;
    } catch (e) {
      const msg = e?.message || "加载更多失败";
      log.warn("loadMoreCurrentDirectory failed:", e);
      error.value = msg;
      return false;
    } finally {
      directoryLoadingMore.value = false;
    }
  };

  // 认证域变更时清理缓存：避免跨账号/跨 basicPath 的“幽灵恢复”
  watch(
    () =>
      `${authStore.authType}|${authStore.isAuthenticated ? "1" : "0"}|${authStore.isAdmin ? "1" : "0"}|${normalizeFsPath(authStore.apiKeyInfo?.basic_path || "/")}`,
    (nextKey, prevKey) => {
      if (prevKey == null) return;
      if (nextKey !== prevKey) {
        resetCaches();
      }
    }
  );

  const prefetchDirectory = async (path) => {
    if (!path) return;
    const dirPath = normalizeFsPath(path);
    setPathAs(dirPath, true);
    const key = buildMountExplorerRoutePath(dirPath);

    if (prefetchMap.has(key)) return;

    try {
      const data = await fsService.prefetchDirectoryList(toDirApiPath(dirPath));
      if (!data) return;

      setPrefetch(key, {
        kind: "prefetch",
        ts: Date.now(),
        epoch: cacheEpoch,
        dirPath,
        directoryData: safeClone(data),
      });
    } catch {
      // 预热失败不影响主流程
    }
  };

  return {
    // 当前路径（目录上下文）与当前视图路径（可为文件）
    currentPath,
    currentViewPath,

    // 目录与权限状态
    loading,
    error,
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,
    directoryMeta,
    directoryHasMore,
    directoryLoadingMore,
    isAdmin,
    hasApiKey,
    hasFilePermission,
    hasMountPermission,
    hasPermission,
    apiKeyInfo,
    currentMountId,

    // 预览状态
    previewFile: fileData,
    previewInfo: fileData,
    isPreviewLoading,
    previewError,

    // 状态机状态
    viewState: stateMachine.viewState,
    showDirectory: stateMachine.showDirectory,
    showFilePreview: stateMachine.showFilePreview,
    isLoading: stateMachine.isLoading,
    hasError: stateMachine.hasError,
    needsPassword: stateMachine.needsPassword,
    previewFileName: stateMachine.previewFileName,

    // 导航/预览操作
    updateUrl,
    navigateTo,
    navigateToPreserveHistory,
    navigateToFile,
    stopPreview,
    invalidateCaches,
    removeItemsFromCurrentDirectory,
    refreshDirectory,
    refreshCurrentRoute,
    prefetchDirectory,
    consumePendingScrollRestore,
    loadMoreCurrentDirectory,
  };
}
