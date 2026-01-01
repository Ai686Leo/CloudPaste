/**
 * HTTP 伪装工具
 *
 */

// ============================================================================
// 静态 User-Agent 池
// ============================================================================

/** 桌面浏览器 UA（Chrome、Firefox、Safari、Edge） */
const DESKTOP_USER_AGENTS = [
  // Chrome - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Chrome - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome - Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Firefox - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Firefox - Linux
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Safari - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  // Edge - Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // Edge - macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
];

/** 移动浏览器 UA */
const MOBILE_USER_AGENTS = [
  // Chrome - Android
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
  // Safari - iOS
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
];

/**
 * 获取随机 User-Agent
 * @param {string} deviceCategory - 'desktop' 或 'mobile'，默认 'desktop'
 */
export function getRandomUserAgent(deviceCategory = "desktop") {
  const pool = deviceCategory === "mobile" ? MOBILE_USER_AGENTS : DESKTOP_USER_AGENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================================
// 随机 IP 生成
// ============================================================================

/** IP 地址段（APNIC 亚太区域） */
const IP_RANGES = [
  { min: 1884815360, max: 1884890111 }, // 112.74.128.0 - 112.75.145.255
  { min: 1883242496, max: 1883308031 }, // 112.32.0.0 - 112.32.255.255
  { min: 1746927616, max: 1746993151 }, // 104.16.0.0 - 104.16.255.255
];

function long2ip(ip) {
  return `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`;
}

/** 生成随机 IP 地址 */
export function randomIP() {
  const range = IP_RANGES[Math.floor(Math.random() * IP_RANGES.length)];
  const ip = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  return long2ip(ip);
}

// ============================================================================
// 浏览器类型检测与 Client Hints
// ============================================================================

/**
 * 从 UA 检测浏览器类型
 * @param {string} ua - User-Agent 字符串
 * @returns {'chrome'|'edge'|'firefox'|'safari'|'unknown'}
 */
function detectBrowserType(ua) {
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "chrome";
  if (ua.includes("Firefox/")) return "firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari";
  return "unknown";
}

/**
 * 从 UA 提取 Chromium 版本号
 * @param {string} ua - User-Agent 字符串
 * @returns {string} 版本号
 */
function extractChromiumVersion(ua) {
  const match = ua.match(/Chrome\/(\d+)\./);
  return match ? match[1] : "132";
}

/**
 * 从 UA 检测操作系统平台
 * @param {string} ua - User-Agent 字符串
 * @returns {string} 平台名称
 */
function detectPlatform(ua) {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Linux") && !ua.includes("Android")) return "Linux";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  return "Windows";
}

/**
 * 根据 UA 生成动态 Client Hints
 * 仅 Chromium 系浏览器 (Chrome/Edge) 发送 Client Hints
 * Firefox/Safari 不支持 Client Hints
 * @param {string} ua - User-Agent 字符串
 * @returns {Object} Client Hints 头部对象
 */
function getClientHints(ua) {
  const browserType = detectBrowserType(ua);

  // Firefox/Safari 不发送 Client Hints
  if (browserType !== "chrome" && browserType !== "edge") {
    return {};
  }

  const version = extractChromiumVersion(ua);
  const platform = detectPlatform(ua);
  const isMobile = ua.includes("Mobile");
  const brandName = browserType === "edge" ? "Microsoft Edge" : "Google Chrome";

  return {
    "Sec-CH-UA": `"Chromium";v="${version}", "Not_A Brand";v="24", "${brandName}";v="${version}"`,
    "Sec-CH-UA-Mobile": isMobile ? "?1" : "?0",
    "Sec-CH-UA-Platform": `"${platform}"`,
  };
}

// ============================================================================
// 浏览器请求头
// ============================================================================

/** 基础浏览器请求头 */
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  DNT: "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

// ============================================================================
// 伪装客户端类
// ============================================================================

/**
 * HTTP 伪装客户端
 *
 *
 * @example
 * const client = new MasqueradeClient();
 * const response = await client.fetch('https://mirrors.tuna.tsinghua.edu.cn/');
 */
export class MasqueradeClient {
  /**
   * @param {Object} options - 配置选项
   * @param {string} options.deviceCategory - 'desktop' 或 'mobile'，默认 'desktop'
   * @param {boolean} options.rotateIP - 每次请求是否更换 IP，默认 true
   * @param {boolean} options.rotateUA - 每次请求是否更换 UA，默认 false
   */
  constructor(options = {}) {
    this.options = {
      deviceCategory: "desktop",
      rotateIP: true,
      rotateUA: false,
      ...options,
    };

    if (!this.options.rotateUA) {
      this._cachedUA = getRandomUserAgent(this.options.deviceCategory);
    }
  }

  getUserAgent() {
    if (this.options.rotateUA) {
      return getRandomUserAgent(this.options.deviceCategory);
    }
    return this._cachedUA;
  }

  /**
   * 构建伪装请求头
   * @param {Object} extra - 额外的请求头
   * @param {string} targetUrl - 目标 URL，用于生成 Referer
   */
  buildHeaders(extra = {}, targetUrl = null) {
    const fakeIP = this.options.rotateIP ? randomIP() : this._cachedIP || (this._cachedIP = randomIP());
    const userAgent = this.getUserAgent();
    const clientHints = getClientHints(userAgent);

    const headers = {
      "User-Agent": userAgent,
      "X-Real-IP": fakeIP,
      "X-Forwarded-For": fakeIP,
      ...BROWSER_HEADERS,
      ...clientHints,
      ...extra,
    };

    // 添加 Referer 头
    if (targetUrl) {
      try {
        headers["Referer"] = new URL(targetUrl).origin + "/";
      } catch {
        // URL 解析失败时忽略 Referer
      }
    }

    return headers;
  }

  /** 发起伪装请求 */
  async fetch(url, options = {}) {
    const headers = this.buildHeaders(options.headers, url);
    return fetch(url, { ...options, headers });
  }

  async head(url, options = {}) {
    return this.fetch(url, { ...options, method: "HEAD" });
  }

  async get(url, options = {}) {
    return this.fetch(url, { ...options, method: "GET" });
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 构建伪装请求头（便捷函数）
 * @param {Object} extra - 额外的请求头
 * @param {string} deviceCategory - 'desktop' 或 'mobile'，默认 'desktop'
 * @param {string} targetUrl - 目标 URL，用于生成 Referer
 */
export function buildMasqueradeHeaders(extra = {}, deviceCategory = "desktop", targetUrl = null) {
  const fakeIP = randomIP();
  const userAgent = getRandomUserAgent(deviceCategory);
  const clientHints = getClientHints(userAgent);

  const headers = {
    "User-Agent": userAgent,
    "X-Real-IP": fakeIP,
    "X-Forwarded-For": fakeIP,
    ...BROWSER_HEADERS,
    ...clientHints,
    ...extra,
  };

  // 添加 Referer 头
  if (targetUrl) {
    try {
      headers["Referer"] = new URL(targetUrl).origin + "/";
    } catch {
      // URL 解析失败时忽略 Referer
    }
  }

  return headers;
}

/** 发起伪装请求 */
export async function masqueradeFetch(url, options = {}) {
  const headers = buildMasqueradeHeaders(options.headers, "desktop", url);
  return fetch(url, { ...options, headers });
}

export { DESKTOP_USER_AGENTS, MOBILE_USER_AGENTS };
