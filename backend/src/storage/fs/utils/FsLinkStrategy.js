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

  // 显式要求代理，或挂载层开启 web_proxy 时，统一走代理能力
  const shouldUseProxy = forceProxy || !!mount?.web_proxy;

  // 若需要代理且驱动实现了 generateProxyUrl，则优先走代理
  if (shouldUseProxy && typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(path, {
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      forceProxy: true,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: proxy?.policy || null,
    };
  }

  // 未强制代理时：具备预签名能力的驱动优先走预签名
  if (driver.hasCapability(CAPABILITIES.PRESIGNED)) {
    const result = await driver.generateDownloadUrl(path, {
      mount,
      subPath,
      db,
      userIdOrInfo,
      userType,
      expiresIn: options.expiresIn,
      forceDownload,
    });

    const url =
      typeof result === "string"
        ? result
        : result?.url || result?.presignedUrl || result?.downloadUrl || result?.previewUrl || null;

    return {
      url,
      type: result?.type || "presigned",
      expiresIn: result?.expiresIn || options.expiresIn || null,
      proxyPolicy: null,
    };
  }

  // 不具备预签名能力时：若驱动实现了 generateProxyUrl，则走代理（允许驱动内部根据 custom_host / 策略决定最终URL类型）
  if (typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(path, {
      mount,
      subPath,
      request,
      download: forceDownload,
      db,
      // 未强制代理时，允许驱动根据自身策略（例如 WebDAV 的 custom_host）决定是否使用直链
      forceProxy: false,
    });

    return {
      url: proxy?.url || null,
      type: proxy?.type || "proxy",
      expiresIn: proxy?.expiresIn || null,
      proxyPolicy: proxy?.policy || null,
    };
  }

  throw new DriverError(`存储驱动 ${driver.getType()} 不支持生成可用文件链接`, {
    status: ApiStatus.NOT_IMPLEMENTED,
    code: "DRIVER_ERROR.NOT_IMPLEMENTED",
    expose: true,
  });
}
