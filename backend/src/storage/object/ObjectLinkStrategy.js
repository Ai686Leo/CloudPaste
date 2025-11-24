/**
 * ObjectLinkStrategy: 统一生成“存储视图”下的直链（preview/download），封装驱动差异
 * 场景：ObjectStore / 分享模块，以 storage_config_id + storage_path 为入口。
 *
 * 设计要点：
 * - 仅负责“直链”能力（custom_host 或 PRESIGNED），不参与应用代理决策
 *   - 分享层的代理由 fileViewService / 路由 (/api/file-view, /api/file-download) 自行处理
 * - 不再按 storage_type 硬编码 WebDAV 等类型，统一通过驱动能力 + storageConfig 决策
 */

import { CAPABILITIES } from "../interfaces/capabilities/index.js";

// 提取驱动返回的 URL
function pickUrl(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    return result.url || result.presignedUrl || result.downloadUrl || result.previewUrl || "";
  }
  return "";
}

function hasPresignedCapability(driver) {
  try {
    return typeof driver?.hasCapability === "function" && driver.hasCapability(CAPABILITIES.PRESIGNED);
  } catch {
    return false;
  }
}

/**
 * 生成“存储视图”下的直链
 * @param {Object} params
 * @param {Object} params.driver              已初始化的存储驱动
 * @param {Object|null} params.mount          挂载点信息（可选，目前存储视图通常为 null）
 * @param {Object|null} params.storageConfig  存储配置（用于 custom_host 等）
 * @param {string} params.path                存储路径（storage_path / key）
 * @param {Request|null} params.request       HTTP 请求（预留，不在此层使用）
 * @param {boolean} params.forceDownload      是否强制下载（预留，当前固定 false/true 传给驱动）
 * @param {string|null} params.userType       用户类型（可选）
 * @param {string|null} params.userId         用户标识（可选）
 * @returns {Promise<Object>} { preview: {url,type} | null, download:{url,type} | null, proxyPolicy }
 */
export async function resolveStorageLinks({
  driver,
  mount = null,
  storageConfig = null,
  path,
  request = null, // eslint-disable-line no-unused-vars
  forceDownload = false, // eslint-disable-line no-unused-vars
  userType = null,
  userId = null,
} = {}) {
  if (!driver || !path) {
    return { preview: null, download: null, proxyPolicy: null };
  }

  const customHost = storageConfig?.custom_host || null;
  const proxyPolicy = mount?.webdav_policy || null;

  // 构建 custom_host 直链
  const buildCustomHostUrl = () => {
    if (!customHost) return "";
    const base = customHost.endsWith("/") ? customHost.slice(0, -1) : customHost;
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `${base}/${normalized}`;
  };

  // 1) custom_host 优先：所有存储类型统一按 custom_host 直出
  if (customHost) {
    const directUrl = buildCustomHostUrl();
    return {
      preview: { url: directUrl, type: "custom_host" },
      download: { url: directUrl, type: "custom_host" },
      proxyPolicy,
    };
  }

  // 2) 无 custom_host：若驱动具备预签名能力，则使用预签名直链
  if (hasPresignedCapability(driver)) {
    const previewRes = await driver.generateDownloadUrl(path, {
      subPath: path,
      forceDownload: false,
      expiresIn: null,
      userType,
      userId,
      mount,
    });
    const downloadRes = await driver.generateDownloadUrl(path, {
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

  // 3) 无 custom_host 且不具备预签名能力：存储视图下不提供直链
  // 分享层可通过自身的 /api/file-view / /api/file-download 代理链路访问
  return { preview: null, download: null, proxyPolicy };
}
