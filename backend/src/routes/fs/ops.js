import { ValidationError, NotFoundError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { useRepositories } from "../../utils/repositories.js";
import { usePolicy } from "../../security/policies/policies.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const renamePathResolver = (c) => {
  const body = c.get("jsonBody");
  return [body?.oldPath, body?.newPath].filter(Boolean);
};

const listPathsResolver = (field) => (c) => {
  const body = c.get("jsonBody");
  const value = body?.[field];
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const copyItemsResolver = (c) => {
  const body = c.get("jsonBody");
  if (!body?.items) {
    return [];
  }
  const targets = [];
  for (const item of body.items) {
    if (item?.sourcePath) {
      targets.push(item.sourcePath);
    }
    if (item?.targetPath) {
      targets.push(item.targetPath);
    }
  }
  return targets;
};

export const registerOpsRoutes = (router, helpers) => {
  const { getServiceParams, getStorageConfigByUserType } = helpers;

  router.post("/api/fs/rename", parseJsonBody, usePolicy("fs.rename", { pathResolver: renamePathResolver }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const oldPath = body.oldPath;
    const newPath = body.newPath;

    if (!oldPath || !newPath) {
      throw new ValidationError("请提供原路径和新路径");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.renameItem(oldPath, newPath, userIdOrInfo, userType);

    return jsonOk(c, undefined, "重命名成功");
  });

  router.delete("/api/fs/batch-remove", parseJsonBody, usePolicy("fs.delete", { pathResolver: listPathsResolver("paths") }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const paths = body.paths;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      throw new ValidationError("请提供有效的路径数组");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.batchRemoveItems(paths, userIdOrInfo, userType);

    return jsonOk(c, result, "批量删除成功");
  });

  router.post("/api/fs/batch-copy", parseJsonBody, usePolicy("fs.copy", { pathResolver: copyItemsResolver }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const items = body.items;
    const skipExisting = body.skipExisting !== false;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError("请提供有效的复制项数组");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const copyItems = items.map((item) => ({ ...item, skipExisting }));
    const result = await fileSystem.batchCopyItems(copyItems, userIdOrInfo, userType);

    const totalSuccess = result.success || 0;
    const totalSkipped = result.skipped || 0;
    const totalFailed = (result.failed && result.failed.length) || 0;
    const allDetails = result.details || [];
    const allFailedItems = result.failed || [];
    const hasCrossStorageOperations = result.hasCrossStorageOperations || false;
    const crossStorageResults = result.crossStorageResults || [];

    if (hasCrossStorageOperations) {
      return jsonOk(
        c,
        {
          crossStorage: true,
          requiresClientSideCopy: true,
          standardCopyResults: {
            success: totalSuccess,
            skipped: totalSkipped,
            failed: totalFailed,
          },
          crossStorageResults,
          failed: allFailedItems,
          details: allDetails,
        },
        "FILE_COPY_SUCCESS"
      );
    }

    return jsonOk(
      c,
      {
        crossStorage: false,
        success: totalSuccess,
        skipped: totalSkipped,
        failed: totalFailed,
        details: allDetails,
      },
      "FILE_COPY_SUCCESS"
    );
  });

  router.post("/api/fs/batch-copy-commit", parseJsonBody, usePolicy("fs.copy", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const body = c.get("jsonBody");
    const { targetMountId, files } = body;

    if (!targetMountId || !Array.isArray(files) || files.length === 0) {
      throw new ValidationError("请提供有效的目标挂载点ID和文件列表");
    }

    const repositoryFactory = useRepositories(c);
    const mountRepository = repositoryFactory.getMountRepository();
    const mount = await mountRepository.findById(targetMountId);
    if (!mount) {
      throw new NotFoundError("目标挂载点不存在");
    }

    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const storageConfig = await getStorageConfigByUserType(db, mount.storage_config_id, userIdOrInfo, userType, getEncryptionSecret(c));
    if (!storageConfig) {
      throw new NotFoundError("存储配置不存在");
    }

    const mountManager = new MountManager(db, getEncryptionSecret(c), repositoryFactory);
    const fsForCommit = new FileSystem(mountManager);
    const results = await fsForCommit.commitCrossStorageCopy(mount, files);

    const hasFailures = results.failed.length > 0;
    const hasSuccess = results.success.length > 0;
    const overallSuccess = hasSuccess;

    return jsonOk(c, { ...results, crossStorage: true }, "FILE_COPY_SUCCESS");
  });
};
