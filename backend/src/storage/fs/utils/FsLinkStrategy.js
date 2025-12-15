import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

/**
 * FS 视图下的统一文件链接生成策略（挂载路径）
 * - 根据驱动能力与挂载配置，在预签名与代理之间做决策
 * - 作为 FileSystem.generateFileLink / features.read.getFileInfo 的唯一入口
 */
export async function generateFileLink(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  const db = fs.mountManager.db;
  const request = options.request || null;
  const forceDownload = options.forceDownload || false;
  const forceProxy = options.forceProxy || false;
  const channel = "web";

  // 三段式决策：
  // 1）强制代理挂载（web_proxy 等价 MustProxy）→ 一律走代理能力
  const mustProxy = !!mount?.web_proxy || forceProxy;

  if (mustProxy && typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(path, {
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      channel,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: null,
    };
  }

  // 2）非强制代理挂载：优先使用直链能力（custom_host / 预签名等）
  if (!mustProxy && driver.hasCapability(CAPABILITIES.DIRECT_LINK)) {
    const result = await driver.generateDownloadUrl(path, {
      mount,
      subPath,
      db,
      userIdOrInfo,
      userType,
      request,
      expiresIn: options.expiresIn,
      forceDownload,
    });

    // 约定：驱动在 generateDownloadUrl 边界统一输出 canonical 字段 result.url
    // 此处仅消费 canonical url，不再读取驱动返回的任何 legacy 链接字段
    const url = typeof result === "string" ? result : result?.url || null;

    return {
      url,
      type: result?.type || "native_direct",
      expiresIn: result?.expiresIn || options.expiresIn || null,
      proxyPolicy: null,
    };
  }

  // 3）无任何直链能力时：若驱动实现了 generateProxyUrl，则兜底走代理
  if (typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(path, {
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      channel,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: null,
    };
  }

  throw new DriverError(`存储驱动 ${driver.getType()} 不支持生成可用文件链接`, {
    status: ApiStatus.NOT_IMPLEMENTED,
    code: "DRIVER_ERROR.NOT_IMPLEMENTED",
    expose: true,
  });
}
