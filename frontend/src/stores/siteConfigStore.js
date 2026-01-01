/**
 * 站点配置状态管理Store
 * 管理站点级别的配置信息，如站点标题等
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { api } from "@/api";
import { createLogger } from "@/utils/logger.js";

// 配置常量
const STORAGE_KEY = "cloudpaste_site_config";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时缓存时间
const log = createLogger("SiteConfig");

// ===== Favicon 工具函数 =====

/**
 * 根据URL获取favicon MIME类型
 * @param {string} url - favicon URL
 * @returns {string} MIME类型
 */
const getFaviconType = (url) => {
  if (url.startsWith("data:")) {
    if (url.includes("image/svg")) return "image/svg+xml";
    if (url.includes("image/png")) return "image/png";
    if (url.includes("image/x-icon")) return "image/x-icon";
    if (url.includes("image/jpeg")) return "image/jpeg";
    return "image/x-icon"; // 默认
  }

  const ext = url.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "image/x-icon";
  }
};

/**
 * 更新页面favicon
 * @param {string} faviconUrl - favicon URL，空字符串表示使用默认图标
 */
const updatePageFavicon = (faviconUrl) => {
  try {
    // 查找现有的favicon link标签
    let faviconLink = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');

    // 如果没有找到，创建一个新的
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.rel = "icon";
      document.head.appendChild(faviconLink);
    }

    // 设置favicon URL和类型
    if (faviconUrl && faviconUrl.trim()) {
      const finalUrl = faviconUrl.trim();
      faviconLink.href = finalUrl;
      faviconLink.type = getFaviconType(finalUrl);
    } else {
      // 使用默认favicon
      faviconLink.href = "/cloudpaste.svg";
      faviconLink.type = "image/svg+xml";
    }

    log.debug("页面favicon已更新:", faviconLink.href);
  } catch (error) {
    log.error("更新页面favicon失败:", error);
    // 失败时设置默认favicon
    try {
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink) {
        faviconLink.href = "/cloudpaste.svg";
        faviconLink.type = "image/svg+xml";
      }
    } catch (fallbackError) {
      log.error("设置默认favicon也失败:", fallbackError);
    }
  }
};

export const useSiteConfigStore = defineStore("siteConfig", () => {
  // ===== 状态定义 =====

  // 站点配置
  const siteTitle = ref("CloudPaste"); // 默认站点标题
  const siteFaviconUrl = ref(""); // 站点图标URL
  const siteFooterMarkdown = ref("© 2025 CloudPaste. 保留所有权利。"); // 页脚Markdown内容
  const siteCustomHead = ref(""); // 自定义头部
  const siteCustomBody = ref(""); // 自定义body

  // 前台页面入口开关
  const siteHomeEditorEnabled = ref(true);
  const siteUploadPageEnabled = ref(true);
  const siteMountExplorerEnabled = ref(true);

  // 公告
  const siteAnnouncementEnabled = ref(false);
  const siteAnnouncementContent = ref("");

  const isLoading = ref(false);
  const lastUpdated = ref(null);
  const isInitialized = ref(false);

  // 缓存：只在需要时写入，避免首次加载就占用 localStorage
  const storedConfig = useLocalStorage(STORAGE_KEY, null, { writeDefaults: false });

  // ===== 计算属性 =====

  /**
   * 检查缓存是否有效
   */
  const isCacheValid = computed(() => {
    if (!lastUpdated.value) return false;
    const now = Date.now();
    return now - lastUpdated.value < CACHE_TTL;
  });

  /**
   * 获取完整的站点配置对象
   */
  const siteConfig = computed(() => ({
    title: siteTitle.value,
    faviconUrl: siteFaviconUrl.value,
    announcementEnabled: siteAnnouncementEnabled.value,
    announcementContent: siteAnnouncementContent.value,
    footerMarkdown: siteFooterMarkdown.value,
    customHead: siteCustomHead.value,
    customBody: siteCustomBody.value,
    homeEditorEnabled: siteHomeEditorEnabled.value,
    uploadPageEnabled: siteUploadPageEnabled.value,
    mountExplorerEnabled: siteMountExplorerEnabled.value,
    lastUpdated: lastUpdated.value,
    isInitialized: isInitialized.value,
  }));

  // ===== 私有方法 =====

  /**
   * 从localStorage加载缓存的配置
   */
  const loadFromStorage = () => {
    try {
      const config = storedConfig.value;
      if (config && typeof config === "object") {
        if (config.title) {
          siteTitle.value = config.title;
        }
        if (config.faviconUrl !== undefined) {
          siteFaviconUrl.value = config.faviconUrl || "";
        }
        if (config.footerMarkdown !== undefined) {
          siteFooterMarkdown.value = config.footerMarkdown; // 直接使用缓存值，包括空字符串
        }
        if (config.customHead !== undefined) {
          siteCustomHead.value = config.customHead || "";
        }
        if (config.customBody !== undefined) {
          siteCustomBody.value = config.customBody || "";
        }
        if (config.homeEditorEnabled !== undefined) {
          siteHomeEditorEnabled.value = !!config.homeEditorEnabled;
        }
        if (config.uploadPageEnabled !== undefined) {
          siteUploadPageEnabled.value = !!config.uploadPageEnabled;
        }
        if (config.mountExplorerEnabled !== undefined) {
          siteMountExplorerEnabled.value = !!config.mountExplorerEnabled;
        }
        if (config.announcementEnabled !== undefined) {
          siteAnnouncementEnabled.value = !!config.announcementEnabled;
        }
        if (config.announcementContent !== undefined) {
          siteAnnouncementContent.value = config.announcementContent || "";
        }
        if (config.lastUpdated) {
          lastUpdated.value = config.lastUpdated;
        }

        // 兼容旧缓存：如果缓存里没有公告字段，则强制视为“缓存不新鲜”，让初始化阶段走一次 API 拉取
        if (config.announcementEnabled === undefined && config.announcementContent === undefined) {
          lastUpdated.value = null;
        }
        log.debug("从缓存加载站点配置:", config);
        return true;
      }
    } catch (error) {
      log.warn("加载站点配置缓存失败:", error);
      // 清除损坏的缓存
      storedConfig.remove?.();
    }
    return false;
  };

  /**
   * 保存配置到localStorage
   */
  const saveToStorage = () => {
    try {
      const config = {
        title: siteTitle.value,
        faviconUrl: siteFaviconUrl.value,
        announcementEnabled: siteAnnouncementEnabled.value,
        announcementContent: siteAnnouncementContent.value,
        footerMarkdown: siteFooterMarkdown.value,
        customHead: siteCustomHead.value,
        customBody: siteCustomBody.value,
        homeEditorEnabled: siteHomeEditorEnabled.value,
        uploadPageEnabled: siteUploadPageEnabled.value,
        mountExplorerEnabled: siteMountExplorerEnabled.value,
        lastUpdated: lastUpdated.value,
      };
      storedConfig.value = config;
      log.debug("站点配置已保存到缓存:", config);
    } catch (error) {
      log.error("保存站点配置到缓存失败:", error);
    }
  };

  /**
   * 从API获取站点配置
   */
  const fetchFromAPI = async () => {
    try {
      // 获取站点设置分组（分组ID = 4）
      const response = await api.system.getSettingsByGroup(4, false);

      if (response && response.success && response.data) {
        // 查找站点标题设置
        const titleSetting = response.data.find((setting) => setting.key === "site_title");
        if (titleSetting && titleSetting.value) {
          siteTitle.value = titleSetting.value;
        } else {
          // 如果没有找到设置或值为空，使用默认值
          siteTitle.value = "CloudPaste";
        }

        // 查找站点图标设置
        const faviconSetting = response.data.find((setting) => setting.key === "site_favicon_url");
        if (faviconSetting) {
          siteFaviconUrl.value = faviconSetting.value || "";
        } else {
          siteFaviconUrl.value = "";
        }

        // 查找公告设置（站点级：用于全局 Header 显示入口）
        const announcementEnabledSetting = response.data.find((setting) => setting.key === "site_announcement_enabled");
        if (announcementEnabledSetting) {
          siteAnnouncementEnabled.value = announcementEnabledSetting.value === "true";
        } else {
          siteAnnouncementEnabled.value = false;
        }

        const announcementContentSetting = response.data.find((setting) => setting.key === "site_announcement_content");
        if (announcementContentSetting) {
          siteAnnouncementContent.value = announcementContentSetting.value || "";
        } else {
          siteAnnouncementContent.value = "";
        }

        // 查找页脚Markdown设置
        const footerSetting = response.data.find((setting) => setting.key === "site_footer_markdown");
        if (footerSetting) {
          // 直接使用API返回的值，不填充默认值（保持用户的清空状态）
          siteFooterMarkdown.value = footerSetting.value;
        } else {
          // 如果API中没有这个设置，保持当前值（通常是初始默认值）
          // 不强制设置为空，让首次安装时保持默认值
        }

        // 查找自定义头部设置
        const customHeadSetting = response.data.find((setting) => setting.key === "site_custom_head");
        if (customHeadSetting) {
          siteCustomHead.value = customHeadSetting.value || "";
        } else {
          siteCustomHead.value = "";
        }

        // 查找自定义body设置
        const customBodySetting = response.data.find((setting) => setting.key === "site_custom_body");
        if (customBodySetting) {
          siteCustomBody.value = customBodySetting.value || "";
        } else {
          siteCustomBody.value = "";
        }

        // 前台页面入口开关
        const homeEditorEnabledSetting = response.data.find((setting) => setting.key === "site_home_editor_enabled");
        if (homeEditorEnabledSetting) {
          siteHomeEditorEnabled.value = homeEditorEnabledSetting.value === "true";
        } else {
          siteHomeEditorEnabled.value = true;
        }

        const uploadPageEnabledSetting = response.data.find((setting) => setting.key === "site_upload_page_enabled");
        if (uploadPageEnabledSetting) {
          siteUploadPageEnabled.value = uploadPageEnabledSetting.value === "true";
        } else {
          siteUploadPageEnabled.value = true;
        }

        const mountExplorerEnabledSetting = response.data.find((setting) => setting.key === "site_mount_explorer_enabled");
        if (mountExplorerEnabledSetting) {
          siteMountExplorerEnabled.value = mountExplorerEnabledSetting.value === "true";
        } else {
          siteMountExplorerEnabled.value = true;
        }

        lastUpdated.value = Date.now();
        saveToStorage();

        log.debug("从API加载站点配置成功:", {
          title: siteTitle.value,
          faviconUrl: siteFaviconUrl.value,
          announcementEnabled: siteAnnouncementEnabled.value,
          announcementContent: siteAnnouncementContent.value ? "已设置" : "未设置",
          footerMarkdown: siteFooterMarkdown.value,
          customHead: siteCustomHead.value ? "已设置" : "未设置",
          customBody: siteCustomBody.value ? "已设置" : "未设置",
          homeEditorEnabled: siteHomeEditorEnabled.value,
          uploadPageEnabled: siteUploadPageEnabled.value,
          mountExplorerEnabled: siteMountExplorerEnabled.value,
        });
        return true;
      } else {
        throw new Error(response?.message || "获取站点配置失败");
      }
    } catch (error) {
      log.error("从API获取站点配置失败:", error);
      // API失败时保持当前值或使用默认值
      if (!siteTitle.value || siteTitle.value === "") {
        siteTitle.value = "CloudPaste";
      }
      return false;
    }
  };

  // ===== 公共方法 =====

  /**
   * 初始化站点配置
   * 优先使用缓存，缓存无效时从API获取
   */
  const initialize = async () => {
    if (isInitialized.value) {
      log.debug("站点配置已初始化，跳过重复初始化");
      return;
    }

    log.debug("初始化站点配置...");
    isLoading.value = true;

    try {
      // 1. 尝试从缓存加载
      const cacheLoaded = loadFromStorage();

      // 2. 如果缓存有效，直接使用缓存
      if (cacheLoaded && isCacheValid.value) {
        log.debug("使用有效的缓存配置");
      } else {
        // 3. 缓存无效或不存在，从API获取
        log.debug("缓存无效或不存在，从API获取站点配置");
        await fetchFromAPI();
      }

      // 统一应用配置（避免重复代码）
      updatePageFavicon(siteFaviconUrl.value);
      injectCustomContent();
      isInitialized.value = true;
    } catch (error) {
      log.error("初始化站点配置失败:", error);
      // 初始化失败时使用默认值
      siteTitle.value = "CloudPaste";
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 刷新站点配置
   * 强制从API重新获取配置
   */
  const refresh = async () => {
    log.debug("刷新站点配置...");
    isLoading.value = true;

    try {
      await fetchFromAPI();
      log.debug("站点配置刷新成功");
    } catch (error) {
      log.error("刷新站点配置失败:", error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 更新站点标题
   * 用于管理员修改设置后立即更新缓存
   */
  const updateSiteTitle = (newTitle) => {
    if (newTitle && typeof newTitle === "string") {
      siteTitle.value = newTitle.trim() || "CloudPaste";
      lastUpdated.value = Date.now();
      saveToStorage();
      log.debug("站点标题已更新:", siteTitle.value);
    }
  };

  /**
   * 更新站点图标
   * 用于管理员修改设置后立即更新缓存和页面favicon
   */
  const updateSiteFavicon = (newFaviconUrl) => {
    if (typeof newFaviconUrl === "string") {
      siteFaviconUrl.value = newFaviconUrl.trim();
      lastUpdated.value = Date.now();
      saveToStorage();

      // 立即更新页面favicon
      updatePageFavicon(siteFaviconUrl.value);

      log.debug("站点图标已更新:", siteFaviconUrl.value);
    }
  };

  /**
   * 更新页脚Markdown内容
   * 用于管理员修改设置后立即更新缓存
   */
  const updateSiteFooter = (newFooterMarkdown) => {
    if (typeof newFooterMarkdown === "string") {
      siteFooterMarkdown.value = newFooterMarkdown;
      lastUpdated.value = Date.now();
      saveToStorage();
      log.debug("页脚内容已更新:", siteFooterMarkdown.value);
    }
  };

  /**
   * 注入自定义头部内容到页面头部
   */
  const injectCustomHead = () => {
    // 清理旧的注入内容（兼容旧实现：#cloudpaste-custom-head）
    document.querySelectorAll("[data-cloudpaste-custom-head='true']").forEach((node) => node.remove());
    document.getElementById("cloudpaste-custom-head")?.remove();

    const raw = siteCustomHead.value || "";
    if (!raw.trim()) return;

    // 用 template 解析字符串为 DOM 节点
    const template = document.createElement("template");
    template.innerHTML = raw;

    // 放到 head 的开头，且保持用户输入顺序
    const anchor = document.head.firstChild;
    const children = Array.from(template.content.children);

    children.forEach((node, index) => {
      try {
        const tag = node.tagName?.toLowerCase?.() || "";

        // script 需要“重新创建”才会执行
        if (tag === "script") {
          const newScript = document.createElement("script");
          newScript.setAttribute("data-cloudpaste-custom-head", "true");

          // 复制所有属性（src/async/defer/type/crossorigin 等）
          Array.from(node.attributes || []).forEach((attr) => {
            try {
              newScript.setAttribute(attr.name, attr.value);
            } catch (e) {
              // 忽略单个属性复制失败
            }
          });

          // 内联脚本内容
          if (!newScript.src) {
            newScript.textContent = node.textContent || "";
          }

          document.head.insertBefore(newScript, anchor);
          return;
        }

        // 其它标签（style/link/meta 等）直接插入 head
        node.setAttribute("data-cloudpaste-custom-head", "true");
        document.head.insertBefore(node, anchor);
      } catch (error) {
        log.error(`自定义头部注入失败 (${index + 1}):`, error);
      }
    });

    log.debug("自定义头部内容已注入");
  };

  // ===== DOM查询缓存和性能优化 =====

  // DOM查询缓存
  let appContainerCache = null;
  let injectTimeout = null;
  let pendingBodyInjectRetries = 0;

  /**
   * 获取Vue应用容器（带缓存）
   */
  const getAppContainer = () => {
    if (!appContainerCache || !document.contains(appContainerCache)) {
      appContainerCache = document.querySelector(".app-container");
    }
    return appContainerCache;
  };

  /**
   * 注入自定义body内容到Vue应用内部
   * 支持JavaScript脚本执行
   */
  const injectCustomBody = () => {
    // 清理旧内容和脚本
    document.getElementById("cloudpaste-custom-body")?.remove();
    document.querySelectorAll('script[data-cloudpaste-custom="true"]').forEach((script) => script.remove());

    if (!siteCustomBody.value) return;

    const targetContainer = getAppContainer();
    if (!targetContainer) {
      if (pendingBodyInjectRetries < 30) {
        pendingBodyInjectRetries += 1;
        clearTimeout(injectTimeout);
        injectTimeout = setTimeout(() => {
          injectCustomBody();
        }, 100);
        return;
      }

      // 兜底：重试多次仍找不到容器时，退回插入到 body，至少保证内容不丢
      log.warn("未找到 .app-container，已退回把自定义 body 内容插入到 document.body");
      pendingBodyInjectRetries = 0;
    } else {
      pendingBodyInjectRetries = 0;
    }

    // 创建并注入容器
    const container = document.createElement("div");
    container.id = "cloudpaste-custom-body";
    container.innerHTML = siteCustomBody.value;

    // 注入到Vue应用容器；兜底时才插入 body
    (targetContainer || document.body).appendChild(container);

    // 执行脚本
    container.querySelectorAll("script").forEach((script, index) => {
      try {
        const newScript = document.createElement("script");
        newScript.setAttribute("data-cloudpaste-custom", "true");

        if (script.src) {
          // 外部脚本
          newScript.src = script.src;
          if (script.async) newScript.async = true;
          if (script.defer) newScript.defer = true;
          if (script.type) newScript.type = script.type;
        } else {
          // 内联脚本
          newScript.textContent = script.textContent;
          if (script.type) newScript.type = script.type;
        }

        document.head.appendChild(newScript);
        script.remove(); // 移除原脚本标签
      } catch (error) {
        log.error(`脚本执行失败 (${index + 1}):`, error);
      }
    });

    log.debug("自定义body内容已注入并执行");
  };

  /**
   * 防抖版本的自定义内容注入
   */
  const debouncedInjectCustomContent = () => {
    clearTimeout(injectTimeout);
    injectTimeout = setTimeout(() => {
      injectCustomHead();
      injectCustomBody();
    }, 100);
  };

  /**
   * 注入所有自定义内容
   */
  const injectCustomContent = () => {
    injectCustomHead();
    injectCustomBody();
  };

  /**
   * 更新自定义头部内容并立即注入
   */
  const updateCustomHead = (newHead) => {
    siteCustomHead.value = newHead || "";
    injectCustomHead();
    saveToStorage();
  };

  /**
   * 更新自定义body内容并立即注入
   */
  const updateCustomBody = (newBody) => {
    siteCustomBody.value = newBody || "";
    injectCustomBody();
    saveToStorage();
  };

  /**
   * 清理所有自定义DOM内容
   */
  const cleanupCustomContent = () => {
    // 清理自定义头部内容（兼容旧实现：#cloudpaste-custom-head）
    document.querySelectorAll("[data-cloudpaste-custom-head='true']").forEach((node) => node.remove());
    document.getElementById("cloudpaste-custom-head")?.remove();

    // 清理自定义body内容
    const existingBody = document.getElementById("cloudpaste-custom-body");
    if (existingBody) existingBody.remove();

    // 清理自定义脚本
    const existingScripts = document.querySelectorAll('script[data-cloudpaste-custom="true"]');
    existingScripts.forEach((script) => script.remove());

    // 清理DOM缓存
    appContainerCache = null;
  };

  /**
   * 重置配置
   */
  const reset = () => {
    siteTitle.value = "CloudPaste";
    siteFaviconUrl.value = "";
    siteAnnouncementEnabled.value = false;
    siteAnnouncementContent.value = "";
    siteFooterMarkdown.value = "© 2025 CloudPaste. 保留所有权利。";
    siteCustomHead.value = "";
    siteCustomBody.value = "";
    siteHomeEditorEnabled.value = true;
    siteUploadPageEnabled.value = true;
    siteMountExplorerEnabled.value = true;
    lastUpdated.value = null;
    isInitialized.value = false;
    storedConfig.remove?.();

    // 重置favicon为默认
    updatePageFavicon("");

    // 清理所有自定义内容
    cleanupCustomContent();

    log.debug("站点配置已重置");
  };

  /**
   * 获取缓存统计信息
   */
  const getCacheStats = () => {
    return {
      isInitialized: isInitialized.value,
      isCacheValid: isCacheValid.value,
      lastUpdated: lastUpdated.value,
      cacheAge: lastUpdated.value ? Date.now() - lastUpdated.value : null,
      title: siteTitle.value,
      faviconUrl: siteFaviconUrl.value,
      announcementEnabled: siteAnnouncementEnabled.value,
      announcementContent: siteAnnouncementContent.value,
      footerMarkdown: siteFooterMarkdown.value,
      homeEditorEnabled: siteHomeEditorEnabled.value,
      uploadPageEnabled: siteUploadPageEnabled.value,
      mountExplorerEnabled: siteMountExplorerEnabled.value,
    };
  };

  // 返回store的状态和方法
  return {
    // 状态
    siteTitle,
    siteFaviconUrl,
    siteAnnouncementEnabled,
    siteAnnouncementContent,
    siteFooterMarkdown,
    siteCustomHead,
    siteCustomBody,
    siteHomeEditorEnabled,
    siteUploadPageEnabled,
    siteMountExplorerEnabled,
    isLoading,
    lastUpdated,
    isInitialized,

    // 计算属性
    isCacheValid,
    siteConfig,

    // 方法
    initialize,
    refresh,
    updateSiteTitle,
    updateSiteFavicon,
    updateSiteFooter,
    updateCustomHead,
    updateCustomBody,
    injectCustomContent,
    debouncedInjectCustomContent,
    reset,
    getCacheStats,
  };
});
