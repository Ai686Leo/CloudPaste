import { ValidationError } from "../http/errors.js";

/**
 * 代理功能相关常量配置
 * 统一管理代理功能的配置参数，避免硬编码
 */

/**
 * 代理路由配置（CloudPaste 本地 /api/p 代理）
 */
export const PROXY_CONFIG = {
  // 代理路由前缀（本地签名代理入口）
  ROUTE_PREFIX: "/api/p",

  // 代理用户类型标识
  USER_TYPE: "proxy",

  // 默认WebDAV策略
  DEFAULT_WEBDAV_POLICY: "302_redirect",

  // 支持的WebDAV策略
  WEBDAV_POLICIES: {
    REDIRECT: "302_redirect", // 存储直链重定向（仅对具备 DirectLink 能力的驱动生效，如 S3）
    USE_PROXY_URL: "use_proxy_url", // 基于 storage_config.url_proxy 的代理 URL 重定向
    NATIVE_PROXY: "native_proxy", // 本地服务器代理
  },

  // 签名相关配置
  SIGN_PARAM: "sign", // 签名参数名
  TIMESTAMP_PARAM: "ts", // 时间戳参数名
};

/**
 * 对外反向代理/Proxy 入口前缀（部署位置可以是 Worker、VPS、Vercel 等）
 * - FS 视图：/proxy/fs/<path>
 * - 分享视图：/proxy/share/<slug>
 */
export const WORKER_ENTRY = {
  FS_PREFIX: "/proxy/fs",
  SHARE_PREFIX: "/proxy/share",
};

/**
 * 代理安全配置
 */
export const PROXY_SECURITY = {
  // 最大路径长度
  MAX_PATH_LENGTH: 2048,

  // 禁止的路径模式
  FORBIDDEN_PATTERNS: [
    "..", // 路径遍历
    "\\", // 反斜杠
    "\0", // 空字节
  ],

  // URL解码错误消息
  DECODE_ERROR_MESSAGE: "无效的路径格式",
};

/**
 * 构建本地 /api/p 代理URL（仅用于 CloudPaste 内部）
 * @param {string} path - 文件路径（挂载视图路径）
 * @param {boolean} download - 是否为下载模式
 * @returns {string} 代理URL
 */
export function buildProxyPath(path, download = false) {
  const basePath = `${PROXY_CONFIG.ROUTE_PREFIX}${path}`;
  return download ? `${basePath}?download=true` : basePath;
}

/**
 * 构建完整的本地 /api/p 代理URL
 * @param {Request} request - 请求对象
 * @param {string} path - 文件路径
 * @param {boolean} download - 是否为下载模式
 * @returns {string} 完整的代理URL
 */
export function buildFullProxyUrl(request, path, download = false) {
  if (!request) {
    return buildProxyPath(path, download);
  }

  try {
    const url = new URL(request.url);
    const proxyPath = buildProxyPath(path, download);
    return `${url.protocol}//${url.host}${proxyPath}`;
  } catch (error) {
    console.warn("构建完整代理URL失败:", error);
    return buildProxyPath(path, download);
  }
}

/**
 * 构建带签名的本地 /api/p 代理URL
 * @param {Request} request - 请求对象
 * @param {string} path - 文件路径
 * @param {Object} options - 选项
 * @returns {string} 带签名的代理URL
 */
export function buildSignedProxyUrl(request, path, options = {}) {
  const { download = false, signature, requestTimestamp, needsSignature = true } = options;

  // 如果不需要签名，返回普通URL
  if (!needsSignature || !signature) {
    return buildFullProxyUrl(request, path, download);
  }

  // 构建基础路径（可能是相对路径）
  const proxyPath = buildProxyPath(path, download);

  // 尝试在 request 的上下文中构建绝对URL；失败时回退到相对路径并直接拼接查询串
  try {
    const base = request ? new URL(request.url) : null;
    const url = base ? new URL(proxyPath, base) : new URL(proxyPath, "http://localhost");

    // 添加签名参数
    url.searchParams.set(PROXY_CONFIG.SIGN_PARAM, signature);

    // 预览时添加时间戳参数
    if (!download && requestTimestamp) {
      url.searchParams.set(PROXY_CONFIG.TIMESTAMP_PARAM, requestTimestamp);
    }

    return url.toString();
  } catch (error) {
    // 保底：构建相对URL并拼接查询参数，避免抛出异常影响上游流程
    const hasQuery = proxyPath.includes("?");
    let result = proxyPath + (hasQuery ? "&" : "?") + `${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
    if (!download && requestTimestamp) {
      result += `&${PROXY_CONFIG.TIMESTAMP_PARAM}=${encodeURIComponent(requestTimestamp)}`;
    }
    return result;
  }
}

/**
 * 基于 storage_config.url_proxy 构建 Worker / 反代入口 URL
 * - 不关心业务语义，仅负责 host 拼接与签名参数追加
 * @param {string|null} baseOrigin - 代理 / Worker 根地址（例如 https://proxy.example.com）
 * @param {string} entryPath - 入口路径（例如 /proxy/fs/xxx 或 /proxy/share/slug）
 * @param {{ signature?: string }} [options]
 * @returns {string} 完整可访问 URL
 */
export function buildSignedWorkerUrl(baseOrigin, entryPath, options = {}) {
  const { signature } = options;

  // 未配置 baseOrigin 时，回退为相对路径 + 可选签名参数
  if (!baseOrigin) {
    if (!signature) {
      return entryPath;
    }
    const hasQuery = entryPath.includes("?");
    return `${entryPath}${hasQuery ? "&" : "?"}${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
  }

  try {
    const base = baseOrigin.endsWith("/") ? baseOrigin : `${baseOrigin}/`;
    const relative = entryPath.startsWith("/") ? entryPath.slice(1) : entryPath;
    const url = new URL(relative, base);

    if (signature) {
      url.searchParams.set(PROXY_CONFIG.SIGN_PARAM, signature);
    }

    return url.toString();
  } catch (error) {
    // 构建失败时使用简单拼接作为兜底
    const cleanBase = baseOrigin.endsWith("/") ? baseOrigin.slice(0, -1) : baseOrigin;
    let result = `${cleanBase}${entryPath}`;
    if (signature) {
      const hasQuery = result.includes("?");
      result += `${hasQuery ? "&" : "?"}${PROXY_CONFIG.SIGN_PARAM}=${encodeURIComponent(signature)}`;
    }
    return result;
  }
}

/**
 * 安全解码URL路径（仅用于本地 /api/p 代理入口）
 * @param {string} encodedPath - 编码的路径
 * @returns {string} 解码后的路径
 * @throws {Error} 路径格式无效或包含危险字符
 */
export function safeDecodeProxyPath(encodedPath) {
  try {
    const decoded = decodeURIComponent(encodedPath);

    // 检查危险字符
    for (const pattern of PROXY_SECURITY.FORBIDDEN_PATTERNS) {
      if (decoded.includes(pattern)) {
        throw new ValidationError("路径包含禁止的字符");
      }
    }

    // 检查路径长度
    if (decoded.length > PROXY_SECURITY.MAX_PATH_LENGTH) {
      throw new ValidationError("路径长度超出限制");
    }

    return decoded;
  } catch (error) {
    throw new ValidationError(PROXY_SECURITY.DECODE_ERROR_MESSAGE);
  }
}
