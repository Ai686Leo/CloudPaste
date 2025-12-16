import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getVirtualDirectoryListing, isVirtualPath } from "../../storage/fs/utils/VirtualDirectory.js";
import { createErrorResponse, getQueryBool, jsonOk } from "../../utils/common.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { LinkService } from "../../storage/link/LinkService.js";
import { resolveDocumentPreview } from "../../services/documentPreviewService.js";
import { StorageStreaming, STREAMING_CHANNELS } from "../../storage/streaming/index.js";
import { normalizePath as normalizeFsPath } from "../../storage/fs/utils/PathResolver.js";

const fnv1a32Init = () => 0x811c9dc5;

const fnv1a32Update = (hash, input) => {
  const str = typeof input === "string" ? input : String(input ?? "");
  let next = hash >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    next ^= str.charCodeAt(i);
    // 32-bit FNV-1a: next *= 16777619
    next = (next + ((next << 1) + (next << 4) + (next << 7) + (next << 8) + (next << 24))) >>> 0;
  }
  return next >>> 0;
};

const computeDirectoryListEtag = (result) => {
  // 如果目录结果来自服务端缓存，可能已携带上次计算出的 ETag（避免重复 O(n) 扫描）。
  if (result && typeof result.dirEtag === "string" && result.dirEtag.length > 0) {
    return result.dirEtag;
  }

  if (!result || !Array.isArray(result.items)) {
    return null;
  }

  const mountId = result.mount_id ?? "";
  const dirPath = result.path ?? "";

  // 强一致性优先：ETag 需要随目录条目变化而变化。
  // - 使用轻量 hash（FNV-1a 32）
  // - 参与字段：path/isDirectory/size/modified/etag（若存在）
  // - 不依赖条目对象引用，确保跨缓存一致
  let hash = fnv1a32Init();
  hash = fnv1a32Update(hash, mountId);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, dirPath);
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, result.type ?? "");
  hash = fnv1a32Update(hash, "|");
  hash = fnv1a32Update(hash, String(result.items.length));

  for (const item of result.items) {
    hash = fnv1a32Update(hash, "|");
    hash = fnv1a32Update(hash, item?.path ?? "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.isDirectory ? "1" : "0");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, typeof item?.size === "number" ? String(item.size) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.modified ? String(item.modified) : "");
    hash = fnv1a32Update(hash, ":");
    hash = fnv1a32Update(hash, item?.etag ? String(item.etag) : "");
  }

  const hex = (hash >>> 0).toString(16);
  // 弱 ETag：目录列表是“派生视图”，避免中间层对比语义过强
  return `W/"${mountId}:${hex}"`;
};

export const registerBrowseRoutes = (router, helpers) => {
  const { getAccessibleMounts, getServiceParams, verifyPathPasswordToken } = helpers;

  router.get("/api/fs/list", async (c) => {
    const db = c.env.DB;
    const rawPath = c.req.query("path") || "/";
    const path = normalizeFsPath(rawPath, true);
    const refresh = getQueryBool(c, "refresh", false);
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (refresh) {
      console.log("[后端路由] 收到强制刷新请求:", { path, refresh });
    }

    // 管理员不受路径密码限制；仅对非管理员用户应用路径密码控制
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mounts = await getAccessibleMounts(db, userIdOrInfo, userType);

    if (isVirtualPath(path, mounts)) {
      const basicPath = userType === UserType.API_KEY ? userIdOrInfo.basicPath : null;
      const result = await getVirtualDirectoryListing(mounts, path, basicPath);

      const etag = computeDirectoryListEtag(result);
      if (etag) {
        const ifNoneMatch = c.req.header("if-none-match") || null;
        c.header("ETag", etag);
        c.header("Cache-Control", "private, no-cache");
        c.header("Vary", "Authorization, X-FS-Path-Token");

        if (!refresh && ifNoneMatch === etag) {
          return c.body(null, 304);
        }

        result.dirEtag = etag;
      }

      return jsonOk(c, result, "获取目录列表成功");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.listDirectory(path, userIdOrInfo, userType, { refresh });
    const etag = computeDirectoryListEtag(result);
    if (etag) {
      const ifNoneMatch = c.req.header("if-none-match") || null;
      c.header("ETag", etag);
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Authorization, X-FS-Path-Token");

      if (!refresh && ifNoneMatch === etag) {
        return c.body(null, 304);
      }

      result.dirEtag = etag;
    }

    return jsonOk(c, result, "获取目录列表成功");
  });

  router.get("/api/fs/get", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 对受路径密码保护的文件路径应用与目录列表相同的校验逻辑
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);

    // 通过 LinkService 生成语义清晰的预览/下载入口
    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const previewLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: false,
      request: c.req.raw,
    });

    const downloadLink = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: true,
      request: c.req.raw,
    });

    const previewUrl = previewLink.url || null;
    const downloadUrl = downloadLink.url || null;
    const linkType = previewLink.kind;

    const responsePayload = {
      ...result,
      previewUrl,
      downloadUrl,
      linkType,
    };

    const documentPreview = await resolveDocumentPreview(
      {
        type: responsePayload.type,
        typeName: responsePayload.typeName,
        mimetype: responsePayload.mimetype,
        filename: responsePayload.name,
        name: responsePayload.name,
        size: responsePayload.size,
      },
      {
        previewUrl,
        linkType,
        use_proxy: responsePayload.use_proxy ?? 0,
      },
    );

    return jsonOk(
      c,
      {
        ...responsePayload,
        documentPreview,
      },
      "获取文件信息成功",
    );
  });

  //内部
  router.get("/api/fs/download", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 下载路由与元数据路由共享相同的路径密码校验规则
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: true,
      request: c.req.raw,
    });

    if (link.url) {
      // 无论直链还是代理 / Worker 入口，只要给出了 URL，一律通过 302 交给下游处理
      return c.redirect(link.url, 302);
    }

    // 未能生成任何 URL 时兜底：使用 StorageStreaming 层做服务端流式下载
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });
    return response;
  });

  /**
   * 文件内容访问接口（统一内容 API）
   * - 语义：返回指定 FS 路径下文件的原始内容，用于前端预览、编码检测等场景
   * - 特点：始终由 CloudPaste 后端代理访问上游存储，避免前端直接对第三方直链发起跨域请求
   * - 与 /api/fs/download 的区别：content 更偏“读取内容”，download 更偏“触发下载（可 302 直链）”
   */
  router.get("/api/fs/content", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 路径密码校验规则与 /list /get /download 保持一致
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const streaming = new StorageStreaming({
      mountManager,
      storageFactory: null,
      encryptionSecret,
    });

    const rangeHeader = c.req.header("Range") || null;
    const response = await streaming.createResponse({
      path,
      channel: STREAMING_CHANNELS.FS_WEB,
      rangeHeader,
      request: c.req.raw,
      userIdOrInfo,
      userType,
      db,
    });

    return response;
  });

  router.get("/api/fs/file-link", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const expiresInParam = c.req.query("expires_in");
    const parsedExpiresIn =
      expiresInParam === undefined || expiresInParam === "null" ? null : parseInt(expiresInParam, 10);
    const expiresIn = parsedExpiresIn !== null && Number.isNaN(parsedExpiresIn) ? null : parsedExpiresIn;
    const forceDownload = getQueryBool(c, "force_download", false);

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    // 与目录列表/文件信息/下载保持一致：对受路径密码保护的路径进行校验
    if (userType !== UserType.ADMIN && typeof verifyPathPasswordToken === "function") {
      const pathToken = c.req.header("x-fs-path-token") || c.req.query("path_token") || null;
      const verification = await verifyPathPasswordToken(db, path, pathToken, encryptionSecret);

      if (verification.requiresPassword && !verification.verified) {
        return c.json(
          {
            ...createErrorResponse(
              ApiStatus.FORBIDDEN,
              verification.error === "PASSWORD_CHANGED"
                ? "目录路径密码已更新，请重新输入"
                : "该目录需要密码访问",
              "FS_PATH_PASSWORD_REQUIRED",
            ),
            data: {
              path,
              requiresPassword: true,
            },
          },
          ApiStatus.FORBIDDEN,
        );
      }
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      expiresIn,
      forceDownload,
      request: c.req.raw,
    });

    const responsePayload = {
      url: link.url,
      linkType: link.kind,
    };

    return jsonOk(c, responsePayload, "获取文件直链成功");
  });
};
