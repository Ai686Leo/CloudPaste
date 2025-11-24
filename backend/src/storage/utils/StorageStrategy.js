/**
 * StorageStrategy: 统一生成文件访问链接（直链/代理），封装驱动差异
 * 输入：driver、storageConfig/mount、路径等
 * 输出：preview/download 链接及类型信息
 */

// 提取驱动返回的 URL
function pickUrl(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    return result.url || result.presignedUrl || result.downloadUrl || result.previewUrl || "";
  }
  return "";
}

/**
 * 生成可用链接
 * @param {Object} params
 * @param {Object} params.driver              已初始化的存储驱动
 * @param {Object|null} params.mount          挂载点信息（可选）
 * @param {Object|null} params.storageConfig  存储配置（可选，主要用于上下文字段透传）
 * @param {string} params.path                存储路径或 mount 下的路径
 * @param {Request|null} params.request       HTTP 请求（用于代理 URL 拼装）
 * @param {boolean} params.forceDownload      是否强制下载
 * @param {string|null} params.userType       用户类型
 * @param {string|null} params.userId         用户标识
 * @returns {Promise<Object>} { preview: {url,type}, download:{url,type}, proxyPolicy }
 */
export async function resolveStorageLinks({
  driver,
  mount = null,
  storageConfig = null,
  path,
  request = null,
  forceDownload = false,
  userType = null,
  userId = null,
} = {}) {
  if (!driver || !path) {
    return { preview: null, download: null, proxyPolicy: null };
  }

  const type = driver?.type || storageConfig?.storage_type || mount?.storage_type || "";
  const customHost = storageConfig?.custom_host || null;
  const webProxyEnabled = !!mount?.web_proxy;
  const proxyPolicy = mount?.webdav_policy || null;

  // 构建 custom_host 直链
  const buildCustomHostUrl = () => {
    if (!customHost) return "";
    const base = customHost.endsWith("/") ? customHost.slice(0, -1) : customHost;
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `${base}/${normalized}`;
  };

  // 优先考虑挂载的代理模式
  const preferProxy = webProxyEnabled && typeof driver.generateProxyUrl === "function";
  if (preferProxy) {
    const previewProxy = await driver.generateProxyUrl(path, { mount, request, download: false });
    const downloadProxy = await driver.generateProxyUrl(path, { mount, request, download: true });
    return {
      preview: { url: previewProxy?.url || null, type: "proxy" },
      download: { url: downloadProxy?.url || null, type: "proxy" },
      proxyPolicy: mount?.webdav_policy || null,
    };
  }

  // 根据存储类型与 custom_host 决策
  const isWebDav = type?.toLowerCase?.() === "webdav";

  // 如果有 custom_host 且未强制代理：直链使用 custom_host
  if (customHost) {
    const directUrl = buildCustomHostUrl();
    return {
      preview: { url: directUrl, type: "custom_host" },
      download: { url: directUrl, type: "custom_host" },
      proxyPolicy,
    };
  }

  // 无 custom_host
  if (!isWebDav && typeof driver.generatePresignedUrl === "function") {
    // S3类：预签名
    const previewRes = await driver.generatePresignedUrl(path, {
      subPath: path,
      forceDownload: false,
      expiresIn: null,
      userType,
      userId,
      mount,
    });
    const downloadRes = await driver.generatePresignedUrl(path, {
      subPath: path,
      forceDownload: true,
      expiresIn: null,
      userType,
      userId,
      mount,
    });
    return {
      preview: { url: pickUrl(previewRes), type: "presigned" },
      download: { url: pickUrl(downloadRes), type: "presigned" },
      proxyPolicy,
    };
  }

  // WebDAV 或无预签名能力：走代理（如果 driver 支持代理）
  if (typeof driver.generateProxyUrl === "function") {
    const previewProxy = await driver.generateProxyUrl(path, { mount, request, download: false });
    const downloadProxy = await driver.generateProxyUrl(path, { mount, request, download: true });
    return {
      preview: { url: previewProxy?.url || null, type: "proxy" },
      download: { url: downloadProxy?.url || null, type: "proxy" },
      proxyPolicy,
    };
  }

  // 无法生成
  return { preview: null, download: null, proxyPolicy };
}
