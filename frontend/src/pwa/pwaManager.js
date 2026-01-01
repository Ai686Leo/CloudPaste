/**
 * CloudPaste PWA 管理器
 * 基于 vite-plugin-pwa 官方标准实现
 * 完整的PWA功能：安装、更新、离线存储、状态管理
 */

import { reactive, watch } from "vue";
import { useEventListener, useMediaQuery, useOnline } from "@vueuse/core";
import { showOfflineToast, hideOfflineToast } from "./offlineToast.js";
import { createLogger } from "@/utils/logger.js";

const OFFLINE_DB_VERSION = 6;
const log = createLogger("PWA");

// 获取应用版本号
const getAppVersion = () => {
  return __APP_VERSION__ || "0.6.8";
};

// PWA 状态管理 - 完整的状态定义
export const pwaState = reactive({
  // 安装相关
  isInstallable: false,
  isInstalled: false,
  deferredPrompt: null,

  // 更新相关
  isUpdateAvailable: false,
  isUpdating: false,
  needRefresh: false,
  updateError: null,

  // Service Worker 相关
  registration: null,
  swState: "unknown", // 'installing', 'waiting', 'active', 'redundant'

  // 网络状态
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,

  // 版本信息
  version: getAppVersion(),
  swVersion: null,

  // 缓存状态
  cacheStatus: "unknown", // 'caching', 'cached', 'error'

  // 推送通知状态
  notificationPermission: "default", // 'default', 'granted', 'denied'
  pushSubscription: null,

  // 后台同步状态
  backgroundSyncSupported: false,
  syncInProgress: false,
  ready: false,
});

// 离线存储管理
class OfflineStorage {
  constructor() {
    this.dbName = "CloudPasteOfflineDB";
    this.version = OFFLINE_DB_VERSION;
    this.db = null;
  }

  // 执行数据库迁移策略
  performDatabaseMigration(db, oldVersion, newVersion) {
    log.debug(`执行数据库迁移: ${oldVersion} -> ${newVersion}`);

    // 版本兼容性检查
    if (oldVersion > newVersion) {
      log.warn(`[PWA] 数据库版本回退: ${oldVersion} -> ${newVersion}，可能存在兼容性问题`);
    }

    // 创建基础数据结构（适用于新安装）
    this.createBaseObjectStores(db);

    //执行版本特定的迁移
    this.executeVersionSpecificMigrations(db, oldVersion, newVersion);
  }

  // 🎯 创建基础数据结构
  createBaseObjectStores(db) {
    // 创建文本分享存储
    if (!db.objectStoreNames.contains("pastes")) {
      log.debug("创建 pastes ObjectStore");
      const pasteStore = db.createObjectStore("pastes", { keyPath: "slug" });
      pasteStore.createIndex("created_at", "created_at", { unique: false });
      pasteStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 创建文件信息存储
    if (!db.objectStoreNames.contains("files")) {
      log.debug("创建 files ObjectStore");
      const fileStore = db.createObjectStore("files", { keyPath: "slug" });
      fileStore.createIndex("created_at", "created_at", { unique: false });
      fileStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 创建目录结构存储
    if (!db.objectStoreNames.contains("directories")) {
      log.debug("创建 directories ObjectStore");
      const dirStore = db.createObjectStore("directories", { keyPath: "path" });
      dirStore.createIndex("lastModified", "lastModified", { unique: false });
      dirStore.createIndex("cachedAt", "cachedAt", { unique: false });
    }

    // 创建用户设置存储
    if (!db.objectStoreNames.contains("settings")) {
      log.debug("创建 settings ObjectStore");
      db.createObjectStore("settings", { keyPath: "key" });
    }

    // 创建离线操作队列存储
    if (!db.objectStoreNames.contains("offlineQueue")) {
      log.debug("创建 offlineQueue ObjectStore");
      const queueStore = db.createObjectStore("offlineQueue", { keyPath: "id", autoIncrement: true });
      queueStore.createIndex("timestamp", "timestamp", { unique: false });
      queueStore.createIndex("type", "type", { unique: false });
    }

    // 创建搜索历史存储
    if (!db.objectStoreNames.contains("searchHistory")) {
      log.debug("创建 searchHistory ObjectStore");
      const searchStore = db.createObjectStore("searchHistory", { keyPath: "id", autoIncrement: true });
      searchStore.createIndex("query", "query", { unique: false });
      searchStore.createIndex("timestamp", "timestamp", { unique: false });
    }
  }

  // 🎯 执行版本特定的迁移
  executeVersionSpecificMigrations(db, oldVersion, newVersion) {
    // 基础版本5以下的迁移
    if (oldVersion < 5) {
      log.debug("执行基础版本迁移");
      // 这里可以添加数据迁移逻辑
    }

    // 版本685以上的新功能迁移（对应0.6.8版本）
    if (oldVersion < 685 && newVersion >= 685) {
      log.debug("执行0.6.8版本迁移");
      // 可以添加新功能的数据结构变更
    }

    // 未来版本的迁移可以在这里添加
    // if (oldVersion < 700 && newVersion >= 700) { ... }
  }

  async init() {
    // 请求持久化存储权限
    if ("storage" in navigator && "persist" in navigator.storage) {
      try {
        const persistent = await navigator.storage.persist();
        log.debug(`持久化存储: ${persistent ? "已启用" : "未启用"}`);
      } catch (error) {
        log.warn("[PWA] 无法请求持久化存储:", error);
      }
    }

    return new Promise((resolve, reject) => {
      const openDatabase = (useExplicitVersion) => {
        let request;

        try {
          request = useExplicitVersion ? indexedDB.open(this.dbName, this.version) : indexedDB.open(this.dbName);
        } catch (error) {
          // 当请求的版本号小于已存在版本时，IndexedDB 可能会同步抛出 VersionError
          if (useExplicitVersion && error && error.name === "VersionError") {
            log.warn(
              "[PWA] 本地离线数据库版本高于当前代码要求，将跳过降级并使用现有版本继续工作"
            );
            return openDatabase(false);
          }

          reject(error);
          return;
        }

        request.onerror = () => {
          const err = request.error;
          if (useExplicitVersion && err && err.name === "VersionError") {
            log.warn(
              "[PWA] 本地离线数据库版本高于当前代码要求，将跳过降级并使用现有版本继续工作"
            );
            return openDatabase(false);
          }

          reject(err);
        };

        request.onsuccess = () => {
          this.db = request.result;

          // 如果是使用现有版本打开，可以同步当前实际版本号，方便日志和后续检查
          try {
            if (!useExplicitVersion && typeof this.db.version === "number") {
              this.version = this.db.version;
              log.debug(`使用现有离线数据库版本: ${this.version}`);
            }
          } catch {
            // 仅用于调试，不影响功能
          }

          resolve(this.db);
        };

        if (useExplicitVersion) {
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;
            const newVersion = event.newVersion;

            log.debug(`数据库升级: ${oldVersion} -> ${newVersion}`);

            // 🎯 执行数据库迁移策略
            this.performDatabaseMigration(db, oldVersion, newVersion);

            log.debug("数据库升级完成");
          };
        }
      };

      // 首先尝试使用当前代码声明的版本号打开数据库；
      // 如果遇到 VersionError，则回退为“使用现有版本”打开，避免降级错误。
      openDatabase(true);
    });
  }

  async savePaste(paste) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["pastes"], "readwrite");
    const store = transaction.objectStore("pastes");

    const pasteData = {
      ...paste,
      cachedAt: new Date().toISOString(),
      isOfflineCache: true,
    };

    return store.put(pasteData);
  }

  async getPaste(slug) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["pastes"], "readonly");
    const store = transaction.objectStore("pastes");

    return new Promise((resolve, reject) => {
      const request = store.get(slug);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveFile(file) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["files"], "readwrite");
    const store = transaction.objectStore("files");

    const fileData = {
      ...file,
      cachedAt: new Date().toISOString(),
      isOfflineCache: true,
    };

    return store.put(fileData);
  }

  async getFile(slug) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["files"], "readonly");
    const store = transaction.objectStore("files");

    return new Promise((resolve, reject) => {
      const request = store.get(slug);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveDirectory(path, data) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["directories"], "readwrite");
    const store = transaction.objectStore("directories");

    const dirData = {
      path,
      data,
      cachedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    return store.put(dirData);
  }

  async getDirectory(path) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["directories"], "readonly");
    const store = transaction.objectStore("directories");

    return new Promise((resolve, reject) => {
      const request = store.get(path);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveSetting(key, value) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["settings"], "readwrite");
    const store = transaction.objectStore("settings");

    return store.put({ key, value, updatedAt: new Date().toISOString() });
  }

  async getSetting(key) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["settings"], "readonly");
    const store = transaction.objectStore("settings");

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async clearExpiredCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    // 7天
    if (!this.db) await this.init();

    const cutoffTime = new Date(Date.now() - maxAge).toISOString();
    const stores = ["pastes", "files", "directories"];

    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const index = store.index("cachedAt");

      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }

    // 清理过期的设置缓存
    await this.clearExpiredSettings(maxAge);
  }

  async clearExpiredSettings(maxAge = 7 * 24 * 60 * 60 * 1000) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(["settings"], "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.getAll();

      request.onsuccess = () => {
        const settings = request.result;
        const cutoffTime = Date.now() - maxAge;

        settings.forEach((setting) => {
          if (setting.updatedAt) {
            const settingTime = new Date(setting.updatedAt).getTime();
            if (settingTime < cutoffTime && setting.key.startsWith("api_cache_")) {
              store.delete(setting.key);
            }
          }
        });
      };
    } catch (error) {
      log.warn("清理过期设置缓存失败:", error);
    }
  }

  async clearAllApiCache() {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(["settings"], "readwrite");
      const store = transaction.objectStore("settings");
      const request = store.getAll();

      request.onsuccess = () => {
        const settings = request.result;

        settings.forEach((setting) => {
          if (
            setting.key.startsWith("api_cache_") ||
            setting.key.startsWith("admin_") ||
            setting.key.startsWith("user_") ||
            setting.key.startsWith("system_") ||
            setting.key.startsWith("test_") ||
            setting.key.startsWith("storage_config_") ||
            setting.key.startsWith("url_") ||
            setting.key.startsWith("public_file_") ||
            setting.key.startsWith("raw_paste_") ||
            setting.key === "storage_configs_list" ||
            setting.key === "url_info_cache"
          ) {
            store.delete(setting.key);
          }
        });
      };

      log.debug("所有API缓存已清理");
    } catch (error) {
      log.warn("清理API缓存失败:", error);
    }
  }

  // 离线操作队列方法
  async addToOfflineQueue(operation) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readwrite");
    const store = transaction.objectStore("offlineQueue");

    const queueItem = {
      ...operation,
      timestamp: new Date().toISOString(),
      status: "pending",
    };

    return store.add(queueItem);
  }

  async getOfflineQueue() {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readonly");
    const store = transaction.objectStore("offlineQueue");

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromOfflineQueue(id) {
    if (!this.db) await this.init();

    const transaction = this.db.transaction(["offlineQueue"], "readwrite");
    const store = transaction.objectStore("offlineQueue");

    return store.delete(id);
  }

  // 数据库状态检查工具（调试用）
  async checkDatabaseStatus() {
    if (!this.db) await this.init();

    const objectStores = Array.from(this.db.objectStoreNames);
    log.debug("数据库状态检查:", {
      name: this.db.name,
      version: this.db.version,
      objectStores: objectStores,
    });

    return {
      name: this.db.name,
      version: this.db.version,
      objectStores: objectStores,
    };
  }
}

// 创建离线存储实例
export const offlineStorage = new OfflineStorage();

// PWA 管理器类
class PWAManager {
  constructor() {
    this._networkListenersBound = false;
    this._installPromptListenersBound = false;
    this._vitePwaEventListenersBound = false;
    this._supplementaryListenersBound = false;
    this.readyPromise = this.init();
  }

  async init() {
    log.debug("初始化 PWA 管理器");

    // 1. 初始化离线存储
    try {
      await offlineStorage.init();
      log.debug("离线存储初始化成功");
    } catch (error) {
      log.error("[PWA] 离线存储初始化失败:", error);
    }

    // 2. 监听网络状态
    this.setupNetworkListeners();

    // 3. 监听安装提示
    this.setupInstallPrompt();

    // 4. 检查是否已安装
    this.checkInstallStatus();

    // 5. 设置 Service Worker 更新监听
    this.setupServiceWorkerListeners();

    // 6. 初始化推送通知
    this.initPushNotifications();

    // 7. 检查后台同步支持
    this.checkBackgroundSyncSupport();

    log.debug("PWA 管理器初始化完成");
    pwaState.ready = true;
  }

  // 网络状态监听 - 集成offlineToast
  setupNetworkListeners() {
    if (this._networkListenersBound) return;
    this._networkListenersBound = true;

    const online = useOnline();

    const updateOnlineStatus = (isOnlineNow) => {
      const wasOffline = pwaState.isOffline;
      pwaState.isOffline = !isOnlineNow;

      log.debug(`网络状态: ${isOnlineNow ? "在线" : "离线"}`);

      // 集成offlineToast显示用户友好的提示
      if (!isOnlineNow && !wasOffline) {
        // 刚刚离线 - 使用国际化文本
        showOfflineToast("您已离线，部分功能可能受限");
      } else if (isOnlineNow && wasOffline) {
        // 刚刚恢复在线
        hideOfflineToast();
        showOfflineToast("网络已恢复，正在同步数据...");

        // 3秒后隐藏恢复提示
        setTimeout(() => {
          hideOfflineToast();
        }, 3000);

        // 触发数据同步
        this.syncOfflineData();
      }
    };

    watch(
      online,
      (isOnlineNow) => {
        updateOnlineStatus(isOnlineNow);
      },
      { immediate: true }
    );
  }

  // 同步离线数据 - 集成Background Sync API
  async syncOfflineData() {
    try {
      log.debug("开始同步离线数据");
      pwaState.syncInProgress = true;

      // 🎯 优先使用Background Sync API进行可靠同步
      if (pwaState.backgroundSyncSupported && pwaState.registration) {
        log.debug("使用Background Sync API进行同步");
        await this.triggerBackgroundSync();
      } else {
        log.debug("使用传统同步方式");
        await this.fallbackSync();
      }

      pwaState.syncInProgress = false;
      log.debug("离线数据同步完成");
    } catch (error) {
      pwaState.syncInProgress = false;
      log.error("[PWA] 离线数据同步失败:", error);
      showOfflineToast("数据同步失败，请稍后重试");
    }
  }

  // 🎯 触发Background Sync API同步
  async triggerBackgroundSync() {
    try {
      // 注册后台同步事件
      await pwaState.registration.sync.register("sync-offline-queue");
      log.debug("Background Sync 已注册，等待浏览器调度");

      // 获取同步状态
      const syncStatus = await this.getBackgroundSyncStatus();
      log.debug("当前同步状态:", syncStatus);
    } catch (error) {
      log.error("[PWA] Background Sync 注册失败，回退到传统同步:", error);
      await this.fallbackSync();
    }
  }

  // 🎯 传统同步方式（兼容性回退）
  async fallbackSync() {
    // 处理离线操作队列
    const offlineQueue = await offlineStorage.getOfflineQueue();

    if (offlineQueue && offlineQueue.length > 0) {
      log.debug(`发现 ${offlineQueue.length} 个离线操作待同步`);

      let successCount = 0;
      let failureCount = 0;
      const syncedOperations = [];

      for (const operation of offlineQueue) {
        try {
          await this.processOfflineOperation(operation);
          await offlineStorage.removeFromOfflineQueue(operation.id);
          successCount++;
          syncedOperations.push({
            type: operation.type,
            id: operation.id,
            timestamp: operation.timestamp,
          });
          log.debug(`离线操作同步成功: ${operation.type}`);
        } catch (error) {
          failureCount++;
          log.error(`[PWA] 离线操作同步失败: ${operation.type}`, error);
        }
      }

      // 🎯 传统同步完成后也发送通知 - 确保UI更新
      if (successCount > 0 || failureCount > 0) {
        this.handleSyncCompletedMessage({
          syncType: "offline-queue",
          successCount,
          failureCount,
          totalProcessed: offlineQueue.length,
          syncedOperations,
          timestamp: new Date().toISOString(),
          source: "fallback-sync",
        });
      }
    }
  }

  // 处理单个离线操作 - 基于实际API接口
  async processOfflineOperation(operation) {
    const { type, data, endpoint, method } = operation;
    const { post, put, del } = await import("../api/client.js");

    switch (type) {
      // 📝 文本分享操作
      case "createPaste":
        return await post("/api/paste", data);

      // 📝 统一文本分享操作
      case "updatePaste":
        return await put(endpoint, data); // /api/pastes/:slug
      case "batchDeletePastes":
        return await del("/api/pastes/batch-delete", data);
      case "clearExpiredPastes":
        return await post("/api/pastes/clear-expired", data);

      // ⚙️ 系统管理操作
      case "updateGroupSettings":
        // endpoint 应该是 /api/admin/settings/group/:groupId
        return await put(endpoint, data);
      case "clearCache":
        return await post("/api/admin/cache/clear", data);

      // 🔐 文件密码验证
      case "verifyFilePassword":
        return await post(endpoint, data);

      default:
        log.warn(`[PWA] 未知的离线操作类型: ${type}`);
        return null;
    }
  }

  setupInstallPrompt() {
    if (this._installPromptListenersBound) return;
    this._installPromptListenersBound = true;

    useEventListener(window, "beforeinstallprompt", (e) => {
      e.preventDefault();
      pwaState.deferredPrompt = e;
      pwaState.isInstallable = true;
      log.debug("应用可安装");
    });

    useEventListener(window, "appinstalled", () => {
      pwaState.isInstalled = true;
      pwaState.isInstallable = false;
      pwaState.deferredPrompt = null;
      log.debug("应用已安装");
    });
  }

  checkInstallStatus() {
    // 检查是否在独立模式下运行（已安装）
    if (this._standaloneQueryBound) return;
    this._standaloneQueryBound = true;

    const isStandalone = useMediaQuery("(display-mode: standalone)");
    watch(
      isStandalone,
      (val) => {
        pwaState.isInstalled = Boolean(val);
      },
      { immediate: true }
    );
  }

  // Service Worker 监听 - 统一使用vite-plugin-pwa标准事件
  setupServiceWorkerListeners() {
    if (!("serviceWorker" in navigator)) {
      log.warn("[PWA] Service Worker 不受支持");
      return;
    }

    // 优先使用vite-plugin-pwa标准事件，避免重复监听
    this.setupVitePWAEventListeners();

    // 仅在必要时添加补充监听，避免与vite-plugin-pwa冲突
    this.setupSupplementaryListeners();
  }

  // 设置vite-plugin-pwa标准事件监听
  setupVitePWAEventListeners() {
    if (this._vitePwaEventListenersBound) return;
    this._vitePwaEventListenersBound = true;

    // 监听vite-plugin-pwa的标准更新事件
    useEventListener(window, "vite:pwa-update-available", () => {
      pwaState.isUpdateAvailable = true;
      log.debug("检测到应用更新（vite-plugin-pwa标准事件）");
      this.notifyUpdate();
    });

    // 监听vite-plugin-pwa的其他标准事件
    useEventListener(window, "vite:pwa-updated", () => {
      pwaState.needRefresh = true;
      log.debug("应用已更新，需要刷新");
    });

    useEventListener(window, "vite:pwa-offline-ready", () => {
      log.debug("应用已准备好离线使用");
      pwaState.cacheStatus = "cached";
    });

    // 监听vite-plugin-pwa的错误事件
    useEventListener(window, "vite:pwa-error", (event) => {
      log.error("[PWA] vite-plugin-pwa错误:", event.detail);
      pwaState.updateError = event.detail?.message || "PWA更新错误";
    });
  }

  // 设置补充监听器（仅在vite-plugin-pwa未覆盖的场景）
  setupSupplementaryListeners() {
    if (this._supplementaryListenersBound) return;
    this._supplementaryListenersBound = true;

    // 监听Service Worker消息，包括同步完成通知
    useEventListener(navigator.serviceWorker, "message", (event) => {
      if (event.data && event.data.type === "SW_UPDATED") {
        // 这是来自自定义Service Worker的消息，vite-plugin-pwa可能未处理
        pwaState.isUpdateAvailable = true;
        log.debug("检测到应用更新（Service Worker消息）");
        this.notifyUpdate();
      } else if (event.data && event.data.type === "PWA_SYNC_COMPLETED") {
        // 第2层：PWA Manager → 全局事件系统
        // 接收Service Worker的同步完成通知并转发为标准事件
        this.handleSyncCompletedMessage(event.data.payload);
      }
    });

    // 等待Service Worker注册完成，获取registration对象
    navigator.serviceWorker.ready
      .then((registration) => {
        pwaState.registration = registration;
        log.debug("Service Worker 已注册");

        // 更新Service Worker状态
        if (registration.active) {
          pwaState.swState = "active";
        }
      })
      .catch((error) => {
        log.error("[PWA] Service Worker 注册失败:", error);
        pwaState.updateError = error.message;
      });
  }

  // 通知更新可用
  notifyUpdate() {
    // 发送自定义事件
    window.dispatchEvent(
      new CustomEvent("pwa-update-available", {
        detail: {
          version: pwaState.version,
          swVersion: pwaState.swVersion,
        },
      })
    );
  }

  // 处理同步完成消息 - 分层事件通信架构的第2层
  handleSyncCompletedMessage(payload) {
    try {
      log.debug("收到Service Worker同步完成通知", payload);

      // 更新PWA状态
      pwaState.syncInProgress = false;

      // 发送标准化的全局事件 - 第2层：PWA Manager → 全局事件系统
      const eventDetail = {
        syncType: payload.syncType,
        successCount: payload.successCount,
        failureCount: payload.failureCount,
        totalProcessed: payload.totalProcessed,
        syncedOperations: payload.syncedOperations || [],
        timestamp: payload.timestamp,
        source: payload.source,
      };

      // 发送通用的同步完成事件
      window.dispatchEvent(
        new CustomEvent("pwa:sync-completed", {
          detail: eventDetail,
        })
      );

      // 根据同步类型发送特定事件
      if (payload.syncType === "offline-queue") {
        window.dispatchEvent(
          new CustomEvent("pwa:offline-queue-synced", {
            detail: eventDetail,
          })
        );
      }

      log.debug("已发送全局同步完成事件", eventDetail);

      // 显示用户友好的提示
      if (payload.successCount > 0) {
        showOfflineToast(`成功同步 ${payload.successCount} 个离线操作`);
        setTimeout(() => {
          hideOfflineToast();
        }, 3000);

        // 全局页面刷新机制
        // 检查当前页面是否需要刷新数据
        this.refreshCurrentPageIfNeeded(payload.syncedOperations);
      }
    } catch (error) {
      log.error("[PWA] 处理同步完成消息失败:", error);
    }
  }

  // 智能页面刷新机制 - 根据同步的操作类型刷新相关页面
  refreshCurrentPageIfNeeded(syncedOperations) {
    try {
      if (!syncedOperations || syncedOperations.length === 0) {
        return;
      }

      // 获取当前页面路径
      const currentPath = window.location.pathname;
      log.debug("检查页面刷新需求", { currentPath, syncedOperations });

      // 检查是否有文本分享相关的同步操作
      const hasTextOperations = syncedOperations.some(
        (op) => op.type === "createPaste" || op.type === "updatePaste" || op.type === "batchDeletePastes" || op.type === "clearExpiredPastes"
      );

      // 如果当前在文本管理页面且有文本相关操作，则刷新页面
      if (hasTextOperations && (currentPath.includes("/admin") || currentPath.includes("/management"))) {
        log.debug("检测到文本管理页面需要刷新数据");

        // 使用温和的页面刷新方式
        setTimeout(() => {
          window.location.reload();
        }, 1000); // 延迟1秒
      }

      // 可以根据需要添加其他页面的刷新逻辑
      // 例如：文件管理页面、系统设置页面等
    } catch (error) {
      log.error("[PWA] 页面刷新检查失败:", error);
    }
  }

  // 清理应用缓存
  clearApplicationCache() {
    try {
      // 清理 localStorage 中的临时数据
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes("cache_") || key.includes("temp_"))) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
      log.debug(`已清理 ${keysToRemove.length} 个临时存储项`);
    } catch (error) {
      log.warn("[PWA] 清理应用缓存失败:", error);
    }
  }

  async installApp() {
    if (!pwaState.deferredPrompt) {
      log.warn("[PWA] 无法安装应用：没有安装提示");
      return false;
    }

    try {
      pwaState.deferredPrompt.prompt();
      const { outcome } = await pwaState.deferredPrompt.userChoice;

      if (outcome === "accepted") {
        log.debug("用户接受安装");
        pwaState.isInstallable = false;
        return true;
      } else {
        log.debug("用户拒绝安装");
        return false;
      }
    } catch (error) {
      log.error("[PWA] 安装失败:", error);
      return false;
    } finally {
      pwaState.deferredPrompt = null;
    }
  }

  // 按照官方标准实现应用更新
  async updateApp() {
    try {
      pwaState.isUpdating = true;
      pwaState.updateError = null;
      log.debug("开始应用更新...");

      // autoUpdate模式：直接刷新页面应用更新
      if (pwaState.needRefresh) {
        log.debug("autoUpdate模式：刷新页面应用更新");
        this.reloadApp();
        return true;
      }

      // 如果有等待中的Service Worker，发送skipWaiting消息
      if (pwaState.registration && pwaState.registration.waiting) {
        log.debug("发送skipWaiting消息");
        pwaState.registration.waiting.postMessage({ type: "SKIP_WAITING" });
        return true;
      }

      log.warn("[PWA] 没有可用的更新");
      return false;
    } catch (error) {
      log.error("[PWA] 更新应用失败:", error);
      pwaState.updateError = error.message;
      pwaState.isUpdating = false;
      return false;
    }
  }

  // 检查应用更新
  async checkForUpdate() {
    if (!pwaState.registration) {
      log.warn("[PWA] Service Worker 未注册");
      return false;
    }

    try {
      log.debug("检查应用更新...");
      await pwaState.registration.update();
      return true;
    } catch (error) {
      log.error("[PWA] 检查更新失败:", error);
      return false;
    }
  }

  // 强制刷新页面（更新后）
  reloadApp() {
    log.debug("重新加载应用以应用更新");
    window.location.reload();
  }

  // 初始化推送通知
  async initPushNotifications() {
    if (!("Notification" in window)) {
      log.warn("[PWA] 浏览器不支持推送通知");
      return;
    }

    // 检查当前权限状态
    pwaState.notificationPermission = Notification.permission;
    log.debug(`通知权限状态: ${pwaState.notificationPermission}`);

    // 如果已授权，尝试获取推送订阅
    if (pwaState.notificationPermission === "granted" && pwaState.registration) {
      try {
        const subscription = await pwaState.registration.pushManager.getSubscription();
        pwaState.pushSubscription = subscription;
        log.debug("推送订阅状态:", subscription ? "已订阅" : "未订阅");
      } catch (error) {
        log.error("[PWA] 获取推送订阅失败:", error);
      }
    }
  }

  // 请求通知权限
  async requestNotificationPermission() {
    if (!("Notification" in window)) {
      throw new Error("浏览器不支持推送通知");
    }

    try {
      const permission = await Notification.requestPermission();
      pwaState.notificationPermission = permission;

      if (permission === "granted") {
        log.debug("通知权限已授予");
        await this.initPushNotifications();
        return true;
      } else {
        log.debug("通知权限被拒绝");
        return false;
      }
    } catch (error) {
      log.error("[PWA] 请求通知权限失败:", error);
      throw error;
    }
  }

  // 检查后台同步支持
  checkBackgroundSyncSupport() {
    if ("serviceWorker" in navigator && "sync" in window.ServiceWorkerRegistration.prototype) {
      pwaState.backgroundSyncSupported = true;
      log.debug("后台同步功能受支持");
    } else {
      pwaState.backgroundSyncSupported = false;
      log.debug("后台同步功能不受支持");
    }
  }

  // 注册后台同步
  async registerBackgroundSync(tag) {
    if (!pwaState.backgroundSyncSupported || !pwaState.registration) {
      log.warn("[PWA] 后台同步不可用");
      return false;
    }

    try {
      await pwaState.registration.sync.register(tag);
      log.debug(`后台同步已注册: ${tag}`);
      return true;
    } catch (error) {
      log.error("[PWA] 注册后台同步失败:", error);
      return false;
    }
  }

  // 获取Background Sync状态
  async getBackgroundSyncStatus() {
    if (!pwaState.registration || !pwaState.registration.active) {
      return { error: "Service Worker未激活" };
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      pwaState.registration.active.postMessage({ type: "GET_SYNC_STATUS" }, [messageChannel.port2]);

      // 设置超时
      setTimeout(() => {
        resolve({ error: "获取状态超时" });
      }, 5000);
    });
  }

  // 手动触发Background Sync
  async triggerManualSync(tag = "sync-offline-queue") {
    if (!pwaState.backgroundSyncSupported || !pwaState.registration) {
      log.warn("[PWA] 后台同步不可用，使用传统同步");
      await this.fallbackSync();
      return false;
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();

      messageChannel.port1.onmessage = (event) => {
        resolve(event.data);
      };

      pwaState.registration.active.postMessage({ type: "REGISTER_BACKGROUND_SYNC", data: { tag } }, [messageChannel.port2]);

      // 设置超时
      setTimeout(() => {
        resolve({ success: false, error: "注册超时" });
      }, 5000);
    });
  }
}

// 先定义对象避免循环依赖
export const pwaUtils = {
  // 状态访问
  state: pwaState,

  // 网络状态
  isOnline: () => !pwaState.isOffline,
  isOffline: () => pwaState.isOffline,

  // 安装相关
  isInstallable: () => pwaState.isInstallable,
  isInstalled: () => pwaState.isInstalled,
  install: () => log.warn("PWA安装功能需要在PWA管理器初始化后使用"),

  // 更新相关
  isUpdateAvailable: () => pwaState.isUpdateAvailable,
  needRefresh: () => pwaState.needRefresh,
  isUpdating: () => pwaState.isUpdating,
  update: () => log.warn("PWA更新功能需要在PWA管理器初始化后使用"),
  checkForUpdate: () => log.warn("PWA检查更新功能需要在PWA管理器初始化后使用"),
  reloadApp: () => window.location.reload(),

  // 版本信息
  getVersion: () => pwaState.version,
  getSWVersion: () => pwaState.swVersion,

  // Service Worker 状态
  getSWState: () => pwaState.swState,
  getRegistration: () => pwaState.registration,

  // 缓存状态
  getCacheStatus: () => pwaState.cacheStatus,

  // 推送通知相关
  getNotificationPermission: () => pwaState.notificationPermission,
  requestNotificationPermission: () => log.warn("PWA通知功能需要在PWA管理器初始化后使用"),
  getPushSubscription: () => pwaState.pushSubscription,

  // 后台同步相关
  isBackgroundSyncSupported: () => pwaState.backgroundSyncSupported,
  isSyncInProgress: () => pwaState.syncInProgress,
  registerBackgroundSync: (tag) => log.warn("PWA后台同步功能需要在PWA管理器初始化后使用"),
  getBackgroundSyncStatus: () => log.warn("PWA后台同步状态功能需要在PWA管理器初始化后使用"),
  triggerManualSync: (tag) => log.warn("PWA手动同步功能需要在PWA管理器初始化后使用"),

  // 离线存储工具
  storage: {
    savePaste: (paste) => offlineStorage.savePaste(paste),
    getPaste: (slug) => offlineStorage.getPaste(slug),
    saveFile: (file) => offlineStorage.saveFile(file),
    getFile: (slug) => offlineStorage.getFile(slug),
    saveDirectory: (path, data) => offlineStorage.saveDirectory(path, data),
    getDirectory: (path) => offlineStorage.getDirectory(path),
    saveSetting: (key, value) => offlineStorage.saveSetting(key, value),
    getSetting: (key) => offlineStorage.getSetting(key),
    clearExpiredCache: () => offlineStorage.clearExpiredCache(),
    clearAllApiCache: () => offlineStorage.clearAllApiCache(),
    clearExpiredSettings: (maxAge) => offlineStorage.clearExpiredSettings(maxAge),

    // 离线操作队列
    addToOfflineQueue: (operation) => offlineStorage.addToOfflineQueue(operation),
    getOfflineQueue: () => offlineStorage.getOfflineQueue(),
    removeFromOfflineQueue: (id) => offlineStorage.removeFromOfflineQueue(id),

    // 数据库状态检查（调试用）
    checkDatabaseStatus: () => offlineStorage.checkDatabaseStatus(),
  },
};

// 创建PWA管理器实例
const pwaManager = new PWAManager();

const bindManagerFunctions = () => {
  pwaUtils.install = () => pwaManager.installApp();
  pwaUtils.update = () => pwaManager.updateApp();
  pwaUtils.checkForUpdate = () => pwaManager.checkForUpdate();
  pwaUtils.requestNotificationPermission = () => pwaManager.requestNotificationPermission();
  pwaUtils.registerBackgroundSync = (tag) => pwaManager.registerBackgroundSync(tag);
  pwaUtils.getBackgroundSyncStatus = () => pwaManager.getBackgroundSyncStatus();
  pwaUtils.triggerManualSync = (tag) => pwaManager.triggerManualSync(tag);
  log.debug("功能绑定完成");
};

pwaManager.readyPromise
  .then(bindManagerFunctions)
  .catch((error) => {
    log.error("[PWA] 初始化失败，部分PWA功能不可用:", error);
  });

// 导出实例
export { pwaManager };
