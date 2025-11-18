/**
 * 统一认证状态管理Store
 * 使用Pinia管理所有认证相关状态，实现主动权限验证
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "@/api";
import { Permission, PermissionChecker } from "@/constants/permissions.js";
import { registerAuthBridge } from "./authBridge.js";

// 配置常量
const REVALIDATION_INTERVAL = 5 * 60 * 1000; // 5分钟
const STORAGE_KEYS = {
  ADMIN_TOKEN: "admin_token",
  API_KEY: "api_key",
  API_KEY_PERMISSIONS: "api_key_permissions",
  API_KEY_INFO: "api_key_info",
};

export const useAuthStore = defineStore("auth", () => {
  // ===== 状态定义 =====

  // 认证状态
  const isAuthenticated = ref(false);
  const authType = ref("none"); // 'none' | 'admin' | 'apikey'
  const isLoading = ref(false);
  const guestAutoTried = ref(false);
  const lastValidated = ref(null);
  const initialized = ref(false);

  // 管理员相关状态
  const adminToken = ref(null);

  // API密钥相关状态
  const apiKey = ref(null);
  const apiKeyInfo = ref(null);
  // 使用位标志权限系统
  const apiKeyPermissions = ref(0); // 位标志权限值
  const apiKeyPermissionDetails = ref({
    text_share: false,
    text_manage: false,
    file_share: false,
    file_manage: false,
    mount_view: false,
    mount_upload: false,
    mount_copy: false,
    mount_rename: false,
    mount_delete: false,
    webdav_read: false,
    webdav_manage: false,
  });

  // 用户信息
  const userInfo = ref({
    id: null,
    name: null,
    basicPath: "/",
  });

  // ===== 计算属性 =====

  // 是否为管理员 / Key 用户（从 authType 推导，消除冗余状态）
  const isAdmin = computed(() => authType.value === "admin");
  const isKeyUser = computed(() => authType.value === "apikey");
  const isGuest = computed(() => {
    if (!isKeyUser.value) return false;
    const role = apiKeyInfo.value?.role || apiKeyInfo.value?.Role;
    return role === "GUEST";
  });

  // 文本/文件分享权限（创建 vs 管理）
  const hasTextSharePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.TEXT_SHARE);
  });

  const hasTextManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.TEXT_MANAGE);
  });

  const hasFileSharePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.FILE_SHARE);
  });

  const hasFileManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.FILE_MANAGE);
  });

  // 兼容旧命名：hasTextPermission / hasFilePermission 代表“具备对应分享能力（通常用于创建）”
  const hasTextPermission = hasTextSharePermission;
  const hasFilePermission = hasFileSharePermission;

  // 是否有挂载权限（任一挂载权限）
  const hasMountPermission = computed(() => {
    return (
      isAdmin.value ||
      PermissionChecker.hasAnyPermission(apiKeyPermissions.value, [
        Permission.MOUNT_VIEW,
        Permission.MOUNT_UPLOAD,
        Permission.MOUNT_COPY,
        Permission.MOUNT_RENAME,
        Permission.MOUNT_DELETE,
      ])
    );
  });

  // 详细的挂载权限检查
  const hasMountViewPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_VIEW);
  });

  const hasMountUploadPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_UPLOAD);
  });

  const hasMountCopyPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_COPY);
  });

  const hasMountRenamePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_RENAME);
  });

  const hasMountDeletePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.MOUNT_DELETE);
  });

  // WebDAV权限检查
  const hasWebDAVReadPermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.WEBDAV_READ);
  });

  const hasWebDAVManagePermission = computed(() => {
    return isAdmin.value || PermissionChecker.hasPermission(apiKeyPermissions.value, Permission.WEBDAV_MANAGE);
  });

  // 是否需要重新验证（使用配置常量）
  const needsRevalidation = computed(() => {
    if (!lastValidated.value) return true;
    return Date.now() - lastValidated.value > REVALIDATION_INTERVAL;
  });

  const convertPermissionsToBitFlag = (permissions) => {
    if (typeof permissions === "number") {
      return permissions;
    }

    if (permissions && typeof permissions === "object") {
      let bitFlag = 0;
      // 兼容新旧字段命名（text/text_share, file/file_share 等）
      const textShare = permissions.text_share ?? permissions.text ?? false;
      const textManage = permissions.text_manage ?? false;
      const fileShare = permissions.file_share ?? permissions.file ?? false;
      const fileManage = permissions.file_manage ?? false;

      if (textShare) bitFlag |= Permission.TEXT_SHARE;
      if (textManage) bitFlag |= Permission.TEXT_MANAGE;
      if (fileShare) bitFlag |= Permission.FILE_SHARE;
      if (fileManage) bitFlag |= Permission.FILE_MANAGE;
      if (permissions.mount_view) bitFlag |= Permission.MOUNT_VIEW;
      if (permissions.mount_upload) bitFlag |= Permission.MOUNT_UPLOAD;
      if (permissions.mount_copy) bitFlag |= Permission.MOUNT_COPY;
      if (permissions.mount_rename) bitFlag |= Permission.MOUNT_RENAME;
      if (permissions.mount_delete) bitFlag |= Permission.MOUNT_DELETE;
      if (permissions.webdav_read) bitFlag |= Permission.WEBDAV_READ;
      if (permissions.webdav_manage) bitFlag |= Permission.WEBDAV_MANAGE;
      return bitFlag;
    }

    return 0;
  };

  // ===== 私有方法 =====

  /**
   * 从localStorage加载认证状态
   */
  const loadFromStorage = () => {
    // 分别处理每个存储项，避免一个失败影响全部

    // 尝试加载管理员token
    try {
      const storedAdminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN);
      if (storedAdminToken) {
        adminToken.value = storedAdminToken;
        authType.value = "admin";
        isAuthenticated.value = true;
        userInfo.value = {
          id: "admin",
          name: "Administrator",
          basicPath: "/",
        };
        return; // 管理员认证成功，直接返回
      }
    } catch (error) {
      console.warn("加载管理员token失败:", error);
      localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN);
    }

    // 尝试加载API密钥
    try {
      const storedApiKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
      if (storedApiKey) {
        apiKey.value = storedApiKey;
        authType.value = "apikey";
        isAuthenticated.value = true;

        // 尝试加载API密钥权限
        try {
          const storedPermissions = localStorage.getItem(STORAGE_KEYS.API_KEY_PERMISSIONS);
          if (storedPermissions) {
            apiKeyPermissions.value = convertPermissionsToBitFlag(JSON.parse(storedPermissions));
          }
        } catch (permError) {
          console.warn("加载API密钥权限失败:", permError);
          localStorage.removeItem(STORAGE_KEYS.API_KEY_PERMISSIONS);
        }

        // 尝试加载API密钥信息
        try {
          const storedKeyInfo = localStorage.getItem(STORAGE_KEYS.API_KEY_INFO);
          if (storedKeyInfo) {
            const keyInfo = JSON.parse(storedKeyInfo);
            apiKeyInfo.value = keyInfo;
            userInfo.value = {
              id: keyInfo.id,
              name: keyInfo.name,
              basicPath: keyInfo.basic_path || "/",
            };
          }
        } catch (infoError) {
          console.warn("加载API密钥信息失败:", infoError);
          localStorage.removeItem(STORAGE_KEYS.API_KEY_INFO);
        }
      }
    } catch (error) {
      console.warn("加载API密钥失败:", error);
      localStorage.removeItem(STORAGE_KEYS.API_KEY);
    }
  };

  /**
   * 清除所有认证状态
   */
  const clearAuthState = () => {
    isAuthenticated.value = false;
    authType.value = "none";
    adminToken.value = null;
    apiKey.value = null;
    apiKeyInfo.value = null;
    apiKeyPermissions.value = 0; // 重置为无权限
    userInfo.value = {
      id: null,
      name: null,
      basicPath: "/",
    };
    lastValidated.value = null;
  };

  /**
   * 保存认证状态到localStorage
   */
  const saveToStorage = () => {
    try {
      if (authType.value === "admin" && adminToken.value) {
        localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, adminToken.value);
      } else if (authType.value === "apikey" && apiKey.value) {
        localStorage.setItem(STORAGE_KEYS.API_KEY, apiKey.value);
        if (apiKeyPermissions.value) {
          localStorage.setItem(STORAGE_KEYS.API_KEY_PERMISSIONS, JSON.stringify(apiKeyPermissions.value));
        }
        if (apiKeyInfo.value) {
          localStorage.setItem(STORAGE_KEYS.API_KEY_INFO, JSON.stringify(apiKeyInfo.value));
        }
      }
    } catch (error) {
      console.error("保存认证状态到localStorage失败:", error);
    }
  };

  /**
   * 清除localStorage中的认证数据
   */
  const clearStorage = () => {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
  };

  // ===== 公共方法 =====

  /**
   * 初始化认证状态
   */
  const initialize = async () => {
    if (initialized.value) {
      return;
    }

    console.log("初始化认证状态...");
    loadFromStorage();

    if (isAuthenticated.value) {
      await validateAuth();
    }

    initialized.value = true;
  };

  /**
   * 验证当前认证状态
   */
  const validateAuth = async () => {
    if (!isAuthenticated.value) return false;

    isLoading.value = true;

    try {
      if (authType.value === "admin" && adminToken.value) {
        // 验证管理员token
        const adminResult = await api.admin.checkLogin();
        if (adminResult) {
          lastValidated.value = Date.now();
          return true;
        } else {
          throw new Error("管理员token验证失败");
        }
      } else if (authType.value === "apikey" && apiKey.value) {
        // 验证API密钥
        const response = await api.test.verifyApiKey();
        if (response.success && response.data) {
          // 更新权限信息
        if (response.data.permissions) {
          apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
        }

          // 更新API密钥信息（包括基础路径）
          if (response.data.key_info) {
            apiKeyInfo.value = response.data.key_info;
            userInfo.value = {
              id: response.data.key_info.id,
              name: response.data.key_info.name,
              basicPath: response.data.key_info.basic_path || "/",
            };
          }

          saveToStorage();
          lastValidated.value = Date.now();
          return true;
        } else {
          throw new Error("API密钥验证失败");
        }
      }

      // 验证失败，清除状态
      await logout();
      return false;
    } catch (error) {
      console.error("认证验证失败:", error);
      await logout();
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 管理员登录
   */
  const adminLogin = async (username, password) => {
    isLoading.value = true;

    try {
      const result = await api.admin.login(username, password);
      const token = result.data?.token;

      if (!token) {
        throw new Error("登录响应中缺少token");
      }

      // 设置认证状态
      adminToken.value = token;
      authType.value = "admin";
      isAuthenticated.value = true;
      userInfo.value = {
        id: "admin",
        name: "Administrator",
        basicPath: "/",
      };
      lastValidated.value = Date.now();

      // 保存到localStorage
      saveToStorage();

      // 简化事件触发：只触发必要的认证状态变化事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "admin-login", isAuthenticated: true },
          })
        );
      } catch (eventError) {
        console.warn("触发认证状态变化事件失败:", eventError);
      }

      return { success: true, data: { token } };
    } catch (error) {
      console.error("管理员登录失败:", error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * API密钥登录
   */
  const apiKeyLogin = async (key) => {
    isLoading.value = true;

    try {
      // 临时设置API密钥和认证类型进行验证
      const originalApiKey = apiKey.value;
      const originalAuthType = authType.value;

      apiKey.value = key;
      authType.value = "apikey";

      const response = await api.test.verifyApiKey();

      if (!response.success || !response.data) {
        apiKey.value = originalApiKey;
        authType.value = originalAuthType;
        throw new Error("API密钥验证失败");
      }

      // 设置认证状态
      authType.value = "apikey";
      isAuthenticated.value = true;

      // 设置权限
      if (response.data.permissions) {
        apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
      }

      // 设置密钥信息
      if (response.data.key_info) {
        apiKeyInfo.value = response.data.key_info;
        userInfo.value = {
          id: response.data.key_info.id,
          name: response.data.key_info.name,
          basicPath: response.data.key_info.basic_path || "/",
        };
      }

      lastValidated.value = Date.now();

      // 保存到localStorage
      saveToStorage();

      // 简化事件触发：只触发必要的认证状态变化事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "apikey-login", isAuthenticated: true },
          })
        );
      } catch (eventError) {
        console.warn("触发认证状态变化事件失败:", eventError);
      }

      return { success: true, data: response.data };
    } catch (error) {
      console.error("API密钥登录失败:", error);
      // 恢复原始状态
      await logout();
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 游客登录（基于 Guest API Key）
   */
  const guestLogin = async () => {
    isLoading.value = true;

    try {
      const guestConfigResp = await api.system.getGuestConfig?.();
      const guestData = guestConfigResp?.data ?? guestConfigResp;

      if (!guestData || !guestData.enabled || !guestData.key) {
        throw new Error("游客模式未启用或未正确配置");
      }

      apiKey.value = guestData.key;
      authType.value = "apikey";

      const response = await api.test.verifyApiKey();
      if (!response.success || !response.data) {
        apiKey.value = originalApiKey;
        authType.value = originalAuthType;
        throw new Error("游客 API 密钥验证失败");
      }

      isAuthenticated.value = true;

      if (response.data.permissions) {
        apiKeyPermissions.value = convertPermissionsToBitFlag(response.data.permissions);
      }

      if (response.data.key_info) {
        apiKeyInfo.value = response.data.key_info;
        userInfo.value = {
          id: response.data.key_info.id,
          name: response.data.key_info.name,
          basicPath: response.data.key_info.basic_path || "/",
        };
      }

      lastValidated.value = Date.now();

      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "guest-login", isAuthenticated: true },
          })
        );
      } catch {
        // 忽略事件触发异常
      }

      return { success: true, data: response.data };
    } catch (error) {
      console.error("游客登录失败:", error);
      await logout();
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 自动尝试游客登录（仅在匿名且未尝试过时调用）
   */
  const maybeAutoGuestLogin = async () => {
    if (guestAutoTried.value) return;
    if (isAuthenticated.value || authType.value !== "none") {
      guestAutoTried.value = true;
      return;
    }

    guestAutoTried.value = true;

    try {
      await guestLogin();
    } catch (error) {
      console.warn("自动游客登录失败，将保持匿名状态:", error);
    }
  };

  /**
   * 登出
   */
  const logout = async () => {
    try {
      // 如果是管理员，调用登出API
      if (authType.value === "admin") {
        try {
          await api.admin.logout();
        } catch (error) {
          console.warn("管理员登出API调用失败:", error);
        }
      }

      // 保存当前认证类型用于事件触发
      const currentAuthType = authType.value;

      // 清除状态和存储
      clearAuthState();
      clearStorage();

      // 简化事件触发：只触发必要的事件
      try {
        window.dispatchEvent(
          new CustomEvent("auth-state-changed", {
            detail: { type: "logout", isAuthenticated: false },
          })
        );

        // 触发特定的登出事件
        const wasGuest = currentAuthType === "apikey" && isGuest.value;
        if (currentAuthType === "admin") {
          window.dispatchEvent(new CustomEvent("admin-token-expired"));
        } else if (currentAuthType === "apikey") {
          window.dispatchEvent(new CustomEvent("api-key-invalid"));
          if (wasGuest) {
            window.dispatchEvent(new CustomEvent("guest-session-ended"));
          }
        }
      } catch (eventError) {
        console.warn("触发登出事件失败:", eventError);
      }
    } catch (error) {
      console.error("登出过程中出错:", error);
    }
  };

  /**
   * 检查特定权限
   */
  const hasPermission = (permissionType) => {
    if (!isAuthenticated.value) return false;

    switch (permissionType) {
      case "text":
        return hasTextPermission.value;
      case "file":
        return hasFilePermission.value;
      case "mount":
        return hasMountPermission.value;
      case "admin":
        return isAdmin.value;
      default:
        return false;
    }
  };

  /**
   * 检查路径权限（针对API密钥用户）
   */
  const hasPathPermission = (path) => {
    if (isAdmin.value) return true;
    if (!isAuthenticated.value || authType.value !== "apikey") return false;

    const basicPath = userInfo.value.basicPath || "/";
    const normalizedBasicPath = basicPath === "/" ? "/" : basicPath.replace(/\/+$/, "");
    const normalizedPath = path.replace(/\/+$/, "") || "/";

    // 如果基本路径是根路径，允许访问所有路径
    if (normalizedBasicPath === "/") return true;

    // 检查路径是否在基本路径范围内
    return normalizedPath === normalizedBasicPath || normalizedPath.startsWith(normalizedBasicPath + "/");
  };

  /**
   * 检查当前用户是否是指定文件的创建者
   * @param {Object} fileInfo - 文件信息对象
   * @returns {boolean} 是否为创建者
   */
  const isFileCreator = (fileInfo) => {
    // 如果没有文件或创建者信息，无法判断
    if (!fileInfo || !fileInfo.created_by) {
      return false;
    }

    // 如果是管理员，总是返回true
    if (isAdmin.value) {
      return true;
    }

    // 如果不是API密钥用户（包括游客API Key），返回false
    if (!isKeyUser.value || !apiKeyInfo.value || !apiKeyInfo.value.id) {
      return false;
    }

    // 处理created_by字段，后端返回的格式是"apikey:密钥ID"
    const createdBy = fileInfo.created_by;

    // 如果created_by以"apikey:"开头，提取实际的ID部分
    if (typeof createdBy === "string" && createdBy.startsWith("apikey:")) {
      const actualKeyId = createdBy.substring(7); // 移除"apikey:"前缀
      return apiKeyInfo.value.id === actualKeyId;
    }

    // 否则直接比较完整的ID
    return apiKeyInfo.value.id === createdBy;
  };

  registerAuthBridge({
    getSnapshot: () => ({
      authType: authType.value,
      adminToken: adminToken.value,
      apiKey: apiKey.value,
      isAuthenticated: isAuthenticated.value,
    }),
    logout,
  });

  // 返回store的状态和方法
  return {
    // 状态
    isAuthenticated,
    authType,
    isLoading,
    isAdmin,
    isGuest,
    isKeyUser,
    adminToken,
    apiKey,
    apiKeyInfo,
    apiKeyPermissions,
    userInfo,
    lastValidated,
    initialized,

    // 计算属性
    hasTextPermission,
    hasTextSharePermission,
    hasTextManagePermission,
    hasFilePermission,
    hasFileSharePermission,
    hasFileManagePermission,
    hasMountPermission,
    hasMountViewPermission,
    hasMountUploadPermission,
    hasMountCopyPermission,
    hasMountRenamePermission,
    hasMountDeletePermission,
    hasWebDAVReadPermission,
    hasWebDAVManagePermission,
    needsRevalidation,

    // 方法
    initialize,
    validateAuth,
    adminLogin,
    apiKeyLogin,
    guestLogin,
    maybeAutoGuestLogin,
    logout,
    hasPermission,
    hasPathPermission,
    isFileCreator,
  };
});
