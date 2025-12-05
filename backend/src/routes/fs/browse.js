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

export const registerBrowseRoutes = (router, helpers) => {
  const { getAccessibleMounts, getServiceParams, verifyPathPasswordToken } = helpers;

  router.get("/api/fs/list", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path") || "/";
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
      const pathToken = c.req.header("x-fs-path-token") || null;
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

      return jsonOk(c, result, "获取目录列表成功");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.listDirectory(path, userIdOrInfo, userType, { refresh });

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
      const pathToken = c.req.header("x-fs-path-token") || null;
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

    // 通过 LinkService 生成统一 Link 信息，rawUrl 直接使用最终 URL（直链或代理）
    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      forceDownload: false,
      request: c.req.raw,
    });

    // 使用 LinkService 的决策结果作为 Link JSON 核心字段
    const rawUrl = link.url || null;
    const linkType = link.kind;

    const responsePayload = {
      ...result,
      rawUrl,
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
        rawUrl,
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
      const pathToken = c.req.header("x-fs-path-token") || null;
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

  router.get("/api/fs/file-link", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const expiresInParam = c.req.query("expires_in");
    const parsedExpiresIn = expiresInParam === undefined || expiresInParam === "null" ? null : parseInt(expiresInParam, 10);
    const expiresIn = parsedExpiresIn !== null && Number.isNaN(parsedExpiresIn) ? null : parsedExpiresIn;
    const forceDownload = getQueryBool(c, "force_download", false);

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    const linkService = new LinkService(db, encryptionSecret, repositoryFactory);
    const link = await linkService.getFsExternalLink(path, userIdOrInfo, userType, {
      expiresIn,
      forceDownload,
      request: c.req.raw,
    });

    const responsePayload = {
      rawUrl: link.url,
      linkType: link.kind,
    };

    return jsonOk(c, responsePayload, "获取文件直链成功");
  });
};
