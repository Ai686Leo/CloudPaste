/**
 * API统一配置文件
 * 管理API请求的基础URL和其他配置
 * 支持本地开发、生产和Docker部署环境
 */

// 默认的开发环境API基础URL
const DEFAULT_DEV_API_URL = "http://localhost:8787";

// 检查是否在Docker环境中运行
const isDockerEnvironment = () => {
  return import.meta.env.VITE_IS_DOCKER === "true";
};

// 优先从全局配置读取，然后根据环境选择不同的回退策略
function getApiBaseUrl() {
  // 首先检查运行时配置 (window.appConfig) - 所有环境通用
  if (typeof window !== "undefined" && window.appConfig && window.appConfig.backendUrl) {
    const runtimeUrl = window.appConfig.backendUrl;
    // 统一使用__BACKEND_URL__作为占位符，避免不同环境处理逻辑不一致
    if (runtimeUrl !== "__" + "BACKEND_URL__") {
      console.log("使用运行时配置的后端URL:", runtimeUrl);
      return runtimeUrl;
    }
  }

  // 非Docker环境下才检查localStorage
  if (!isDockerEnvironment() && typeof window !== "undefined" && window.localStorage) {
    const storedUrl = localStorage.getItem("vite-api-base-url");
    if (storedUrl) {
      console.log("非Docker环境：使用localStorage中的后端URL:", storedUrl);
      return storedUrl;
    }
  }

  // 所有环境都检查环境变量
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl) {
    return envUrl;
  }

  // 生产环境：单 Worker 部署时使用同源（Cloudflare Workers SPA 模式）
  if (import.meta.env.PROD && typeof window !== "undefined") {
    console.log("生产环境：使用同源后端", window.location.origin);
    return window.location.origin;
  }

  // 最后使用默认值
  return DEFAULT_DEV_API_URL;
}

// 获取API基础URL
export const API_BASE_URL = getApiBaseUrl();

// API版本前缀，与后端保持一致
export const API_PREFIX = "/api";

// 完整的API基础URL（包含前缀）
export const getFullApiUrl = (endpoint) => {
  // 如果endpoint已经包含了完整URL，则直接返回
  if (endpoint.startsWith("http")) {
    return endpoint;
  }

  // 确保endpoint以/开头
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // 添加API前缀
  return `${API_BASE_URL}${API_PREFIX}${normalizedEndpoint}`;
};

// 导出环境信息方法，便于调试
export const getEnvironmentInfo = () => {
  return {
    apiBaseUrl: API_BASE_URL,
    apiPrefix: API_PREFIX,
    mode: import.meta.env.MODE,
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    backendUrl: window?.appConfig?.backendUrl || import.meta.env.VITE_BACKEND_URL,
    isDockerBuild: isDockerEnvironment(),
  };
};
