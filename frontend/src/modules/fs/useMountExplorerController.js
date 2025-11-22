import { computed, watch, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/authStore.js";
import { useFileSystemStore } from "@/stores/fileSystemStore.js";
import { useFilePreview } from "@/composables";

/**
 * MountExplorer 视图控制器
 *
 * 职责：
 * - 封装路由 → 路径解析与 URL 同步
 * - 基于 authStore 的挂载访问权限与 basic_path 修正
 * - 协调 fileSystemStore 目录加载与 filePreview 初始预览
 *
 * 不负责：
 * - 具体文件操作（下载/删除/重命名等）
 * - UI 消息展示（toast）、模态框状态管理
 */
export function useMountExplorerController() {
  const router = useRouter();
  const route = useRoute();

  const authStore = useAuthStore();
  const fileSystemStore = useFileSystemStore();

  const {
    currentPath,
    loading,
    error,
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,
    directoryMeta,
  } = storeToRefs(fileSystemStore);

  const filePreview = useFilePreview();
  const {
    previewFile,
    previewInfo,
    isPreviewMode,
    isLoading: isPreviewLoading,
    error: previewError,
    updatePreviewUrl,
    stopPreview,
    initPreviewFromRoute,
  } = filePreview;

  // 基于当前路由判断是否存在预览意图
  const hasPreviewIntent = computed(() => !!route.query.preview);

  // 权限相关派生状态
  const isAdmin = computed(() => authStore.isAdmin);
  const hasApiKey = computed(() => authStore.isKeyUser && !!authStore.apiKey);
  // 这里的文件权限用于“从挂载页发起文件分享/上传”，对应 FILE_SHARE
  const hasFilePermission = computed(() => authStore.hasFileSharePermission);
  const hasMountPermission = computed(() => authStore.hasMountPermission);
  const hasPermission = computed(() => authStore.hasMountPermission);
  const apiKeyInfo = computed(() => authStore.apiKeyInfo);

  const currentMountId = computed(() => {
    const directoryData = fileSystemStore.directoryData;

    if (directoryData && directoryData.mount_id) {
      console.log("从directoryData获取挂载点ID:", directoryData.mount_id);
      return directoryData.mount_id;
    }

    if (directoryData && directoryData.items) {
      const mountItem = directoryData.items.find((item) => item.isMount && item.mount_id);
      if (mountItem) {
        console.log("从虚拟目录items获取挂载点ID:", mountItem.mount_id);
        return mountItem.mount_id;
      }
    }

    const pathSegments = currentPath.value.split("/").filter(Boolean);
    const extractedId = pathSegments.length > 0 ? pathSegments[0] : "";
    console.log("从路径提取挂载点ID:", extractedId);
    return extractedId;
  });

  // 路由 → 路径解析
  const getPathFromRoute = () => {
    const pathMatch = route.params.pathMatch;
    if (pathMatch) {
      const pathArray = Array.isArray(pathMatch) ? pathMatch : [pathMatch];
      const urlPath = "/" + pathArray.join("/");
      return urlPath.endsWith("/") ? urlPath : `${urlPath}/`;
    }
    return "/";
  };

  const getRouteIntent = () => {
    if (route.query.preview) {
      return {
        type: "file_preview",
        directoryPath: getPathFromRoute(),
        fileName: route.query.preview,
      };
    }

    return {
      type: "directory_browse",
      directoryPath: getPathFromRoute(),
    };
  };

  const updateUrl = (path, previewFileName = null) => {
    const normalizedPath = path || "/";
    const query = {};

    if (previewFileName) {
      query.preview = previewFileName;
    }

    let routePath = "/mount-explorer";
    if (normalizedPath !== "/") {
      const pathSegments = normalizedPath.split("/").filter(Boolean);
      if (pathSegments.length > 0) {
        routePath = `/mount-explorer/${pathSegments.join("/")}`;
      }
    }

    router.push({
      path: routePath,
      query,
    });
  };

  const navigateTo = async (path) => {
    const normalizedPath = path || "/";
    updateUrl(normalizedPath);
  };

  // ==== 防止竞态的异步处理器 ====
  const createAsyncProcessor = () => {
    let currentPromise = null;

    return async (asyncFn) => {
      if (currentPromise) {
        try {
          await currentPromise;
        } catch {
          // 忽略之前操作的错误
        }
      }

      currentPromise = asyncFn();

      try {
        await currentPromise;
      } finally {
        currentPromise = null;
      }
    };
  };

  // 精简版权限状态比较器，用于避免不必要的重复刷新
  const createAuthStateComparator = () => {
    let previousAuthState = null;

    return (currentAuth) => {
      const currentState = {
        isAdmin: currentAuth.isAdmin,
        apiKeyId: currentAuth.apiKeyInfo?.id || null,
        basicPath: currentAuth.apiKeyInfo?.basic_path || null,
        permissions: currentAuth.apiKeyInfo?.permissions
          ? {
              text: !!currentAuth.apiKeyInfo.permissions.text,
              file: !!currentAuth.apiKeyInfo.permissions.file,
              mount: !!currentAuth.apiKeyInfo.permissions.mount,
            }
          : null,
      };

      if (!previousAuthState) {
        previousAuthState = { ...currentState };
        return { changed: true, isFirstCall: true, changes: ["initial"] };
      }

      const changes = [];
      if (currentState.isAdmin !== previousAuthState.isAdmin) changes.push("isAdmin");
      if (currentState.apiKeyId !== previousAuthState.apiKeyId) changes.push("apiKeyId");
      if (currentState.basicPath !== previousAuthState.basicPath) changes.push("basicPath");

      const oldPerms = previousAuthState.permissions;
      const newPerms = currentState.permissions;
      if (JSON.stringify(oldPerms) !== JSON.stringify(newPerms)) {
        changes.push("permissions");
      }

      const hasChanges = changes.length > 0;
      if (hasChanges) {
        previousAuthState = { ...currentState };
      }

      return { changed: hasChanges, isFirstCall: false, changes };
    };
  };

  const asyncProcessor = createAsyncProcessor();
  const authComparator = createAuthStateComparator();

  // 根据路由与权限初始化目录
  const initializeFromRoute = async () => {
    if (!authStore.isAuthenticated) {
      console.log("等待认证状态就绪...");
      return;
    }

    const urlPath = getPathFromRoute();
    let finalPath = urlPath;

    if (!authStore.isAdmin && authStore.apiKeyInfo) {
      const basicPath = authStore.apiKeyInfo.basic_path || "/";
      const normalizedBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
      const normalizedUrlPath = urlPath.replace(/\/+$/, "") || "/";

      if (normalizedBasicPath !== "/" && normalizedUrlPath !== normalizedBasicPath && !normalizedUrlPath.startsWith(`${normalizedBasicPath}/`)) {
        console.log("URL路径超出权限范围，重定向到基本路径:", basicPath);
        finalPath = basicPath;
        currentPath.value = basicPath;
        updateUrl(basicPath);
      } else {
        currentPath.value = urlPath;
      }
    } else {
      currentPath.value = urlPath;
    }

    const intent = getRouteIntent();

    if (intent.type === "directory_browse") {
      await fileSystemStore.loadDirectory(finalPath);
    } else if (intent.type === "file_preview") {
      if (!fileSystemStore.directoryData || currentPath.value !== intent.directoryPath) {
        await fileSystemStore.loadDirectory(intent.directoryPath);
      }
    }
  };

  const handleDirectoryChange = async () => {
    try {
      await initializeFromRoute();
    } catch (e) {
      console.error("目录变化处理失败:", e);
    }
  };

  const handlePreviewChange = async () => {
    try {
      await initPreviewFromRoute(currentPath.value, directoryItems.value);
    } catch (e) {
      console.error("预览变化处理失败:", e);
    }
  };

  // 权限状态监听
  watch(
    () => ({ isAdmin: authStore.isAdmin, apiKeyInfo: authStore.apiKeyInfo }),
    (newAuth) => {
      const comparison = authComparator(newAuth);

      if (comparison.changed) {
        console.log("权限状态变化检测:", {
          isFirstCall: comparison.isFirstCall,
          changes: comparison.changes,
          newAuth: {
            isAdmin: newAuth.isAdmin,
            apiKeyId: newAuth.apiKeyInfo?.id,
            basicPath: newAuth.apiKeyInfo?.basic_path,
          },
        });

        if (typeof newAuth.isAdmin !== "boolean") {
          console.log("等待权限信息加载...");
          return;
        }

        asyncProcessor(async () => {
          await handleDirectoryChange();
        });
      }
    },
    { immediate: true }
  );

  // 路由路径变化监听
  watch(
    () => route.params.pathMatch,
    (newPath, oldPath) => {
      if (newPath !== oldPath) {
        asyncProcessor(async () => {
          await handleDirectoryChange();
        });
      }
    }
  );

  // 预览参数变化监听
  watch(
    () => route.query.preview,
    () => {
      asyncProcessor(async () => {
        await handlePreviewChange();
      });
    },
    { immediate: true }
  );

  onMounted(async () => {
    if (authStore.needsRevalidation) {
      console.log("MountExplorer: 需要重新验证认证状态");
      await authStore.validateAuth();
    }

    console.log("MountExplorer权限状态:", {
      isAdmin: isAdmin.value,
      hasApiKey: hasApiKey.value,
      hasFilePermission: hasFilePermission.value,
      hasMountPermission: hasMountPermission.value,
      hasPermission: hasPermission.value,
      apiKeyInfo: apiKeyInfo.value,
    });
  });

  return {
    // 目录与权限状态
    currentPath,
    loading,
    error,
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,
    directoryMeta,
    isAdmin,
    hasApiKey,
    hasFilePermission,
    hasMountPermission,
    hasPermission,
    apiKeyInfo,
    currentMountId,

    // 预览状态
    previewFile,
    previewInfo,
    isPreviewMode,
    isPreviewLoading,
    previewError,
    hasPreviewIntent,

    // 导航/预览操作
    updateUrl,
    navigateTo,
    updatePreviewUrl,
    stopPreview,

    // 便捷：目录刷新
    refreshDirectory: fileSystemStore.refreshDirectory,
  };
}
