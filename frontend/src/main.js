import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import api, { getEnvironmentInfo } from "./api";
import i18n from "./i18n";
import router from "./router";
import MasonryWall from "@yeger/vue-masonry-wall";
import { createLogger } from "@/utils/logger.js";

// 导入vue3-context-menu
import "@imengyu/vue3-context-menu/lib/vue3-context-menu.css";
import ContextMenu from "@imengyu/vue3-context-menu";

// 导入 Notivue（全局提示 / Toast）
import { createNotivue } from "notivue";
import "notivue/notification.css";
import "notivue/notification-progress.css";
import "notivue/animations.css";

// 导入自定义指令
import { contextMenuDirective } from "./components/common/contextMenu.js";

const log = createLogger("Main");
const pwaLog = createLogger("PWA");

// 开发环境：清理旧的 Service Worker
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((registrations) => {
    registrations.forEach((reg) => reg.unregister());
  });
}

// 创建应用实例
const app = createApp(App);

// 创建Pinia实例
const pinia = createPinia();

// 添加全局错误处理
app.config.errorHandler = (err, instance, info) => {
  log.error(`错误: ${err}`);
  log.error(`信息: ${info}`);

  // 生产环境下可以考虑将错误发送到后端记录
  if (import.meta.env.PROD) {
    try {
      // 发送错误到控制台或后端API（如果有）
      log.warn("[生产环境错误]", {
        message: err.message,
        stack: err.stack,
        info,
        url: window.location.href,
        time: new Date().toISOString(),
      });
    } catch (e) {
      // 避免上报过程中出错
      log.error("错误上报失败:", e);
    }
  }

  // i18n特定错误处理
  if (err && err.message && (err.message.includes("i18n") || err.message.includes("vue-i18n") || err.message.includes("useI18n") || err.message.includes("translation"))) {
    log.warn("检测到i18n相关错误:", err.message);
  }

  // 处理特定错误类型
  if (err && err.message) {
    // Vditor 编辑器相关错误
    if (err.message.includes("Cannot read properties of undefined")) {
      if (err.stack && err.stack.includes("Vditor")) {
        log.warn("检测到Vditor编辑器属性访问错误，可能由于组件切换导致");
      } else {
        log.warn("检测到属性访问错误，可能是组件生命周期问题");
      }
    }

    // 处理其他特定错误类型
    if (err.message.includes("currentMode") && err.stack && err.stack.includes("setValue")) {
      log.warn("编辑器值设置错误，可能是编辑器尚未完全初始化");
    }

    if (err.message.includes("element") && err.stack && err.stack.includes("destroy")) {
      log.warn("编辑器销毁错误，可能是DOM已被清理");
    }
  }
};

// 挂载Pinia - 必须在其他插件之前
app.use(pinia);

// 挂载i18n - 必须在挂载应用前使用
app.use(i18n);

// 挂载路由 - 在i18n之后挂载
app.use(router);

// 挂载MasonryWall组件 - 全局注册瀑布流组件
app.use(MasonryWall);

// 挂载vue3-context-menu - 全局注册上下文菜单组件
app.use(ContextMenu);

// 挂载 Notivue - 全局提示系统（右上角）
app.use(
  createNotivue({
    position: "top-right",
    limit: 4,
    enqueue: true,
    pauseOnHover: true,
    pauseOnTouch: true,
    avoidDuplicates: true,
    notifications: {
      global: {
        duration: 2000,
      },
      error: {
        duration: 5000,
      },
    },
  })
);

// 注册自定义指令
app.directive("context-menu", contextMenuDirective);

// 导入并初始化认证Store和站点配置Store
import { useAuthStore } from "./stores/authStore.js";
import { useSiteConfigStore } from "./stores/siteConfigStore.js";

// 导入路由工具函数
import { routerUtils } from "./router";
import { useLocalStorage } from "@vueuse/core";

// 提供全局 navigateTo 函数，保持向后兼容
app.config.globalProperties.$navigateTo = routerUtils.navigateTo;
app.config.globalProperties.$routerUtils = routerUtils;

// 将API服务挂载到全局对象，方便在组件中使用
app.config.globalProperties.$api = api;

// 在开发环境中输出API配置信息
if (import.meta.env.DEV) {
  log.debug("环境信息:", getEnvironmentInfo());
}

const scheduleIdle = (fn) => {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return;
  }
  setTimeout(fn, 800);
};

scheduleIdle(async () => {
  try {
    const mod = await import("./pwa/pwaManager.js");
    const { pwaManager, pwaUtils } = mod || {};

    // 挂载 PWA 工具到全局对象
    app.config.globalProperties.$pwa = pwaUtils;

    if (pwaManager) {
      pwaLog.debug("PWA管理器已初始化");
      pwaLog.debug("支持功能:", {
        安装: pwaUtils?.isInstallable?.(),
        离线存储: !!pwaUtils?.storage,
        版本: pwaUtils?.getVersion?.(),
        网络状态: pwaUtils?.isOnline?.() ? "在线" : "离线",
      });
    }
  } catch (e) {
    pwaLog.warn("[PWA] 延迟加载失败（不影响页面使用）:", e);
  }
});

// 确保加载正确的语言
const savedLang = useLocalStorage("language", i18n.global.locale.value);
if (savedLang.value && i18n.global.locale.value !== savedLang.value) {
  i18n.global.locale.value = savedLang.value;
}

// 挂载应用
app.mount("#app");

// 初始化认证Store和站点配置Store（在应用挂载后）
const authStore = useAuthStore();
const siteConfigStore = useSiteConfigStore();

// 并行初始化两个Store
Promise.all([authStore.initialize(), siteConfigStore.initialize()])
  .then(() => {
    log.debug("认证Store和站点配置Store初始化完成");
  })
  .catch((error) => {
    log.error("Store初始化失败:", error);
  });
