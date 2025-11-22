import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getVirtualDirectoryListing, isVirtualPath } from "../../storage/fs/utils/VirtualDirectory.js";
import { createErrorResponse, getQueryBool, jsonOk } from "../../utils/common.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";

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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);

    return jsonOk(c, result, "获取文件信息成功");
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const response = await fileSystem.downloadFile(path, null, c.req.raw, userIdOrInfo, userType);
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.generatePresignedUrl(path, userIdOrInfo, userType, {
      operation: "download",
      userType,
      userId: userType === UserType.ADMIN ? userIdOrInfo : userIdOrInfo.id,
      expiresIn,
      forceDownload,
    });

    return jsonOk(c, result, "获取文件直链成功");
  });
};
