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
  const { getServiceParams } = helpers;

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

    // ========== 统一任务模式 ==========
    // 所有复制操作统一创建任务，无条件分支
    // 复制策略由 CopyTaskHandler 内部决策
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobDescriptor = await fileSystem.createJob(
      'copy',
      { items, options: { skipExisting } },
      userIdOrInfo,
      userType
    );

    return jsonOk(
      c,
      {
        jobId: jobDescriptor.jobId,
        taskType: jobDescriptor.taskType,
        status: jobDescriptor.status,
        stats: jobDescriptor.stats,
        createdAt: jobDescriptor.createdAt,
      },
      "复制作业已创建"
    );
  });

  // ========== 通用作业 API (Generic Job System) ==========

  router.post("/api/fs/jobs", parseJsonBody, usePolicy("fs.copy", { pathResolver: copyItemsResolver }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");

    // 支持动态任务类型 (默认 'copy' 保持向后兼容)
    const taskType = body.taskType || 'copy';
    const items = body.items;
    const options = {
      skipExisting: body.skipExisting !== false,
      maxConcurrency: body.maxConcurrency || 10,
      retryPolicy: body.retryPolicy,
    };

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError("请提供有效的复制项数组");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobDescriptor = await fileSystem.createJob(taskType, { items, options }, userIdOrInfo, userType);

    return jsonOk(c, jobDescriptor, "作业已创建");
  });

  // 注意：权限检查已移至 FileSystem 业务层，此处仅需基础挂载权限
  router.get("/api/fs/jobs/:jobId", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("请提供作业ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobStatus = await fileSystem.getJobStatus(jobId, userIdOrInfo, userType);

    return jsonOk(c, jobStatus);
  });

  // 注意：权限检查已移至 FileSystem 业务层，此处仅需基础挂载权限
  router.post("/api/fs/jobs/:jobId/cancel", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("请提供作业ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager, c.env);
    await fileSystem.cancelJob(jobId, userIdOrInfo, userType);

    return jsonOk(c, undefined, "作业已取消");
  });

  router.get("/api/fs/jobs", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    // 解析查询参数 (新增 taskType 支持)
    const taskType = c.req.query("taskType");
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const filter = {
      taskType,
      status,
      // 不在此处设置 userId，交由 FileSystem 层根据 userType 判断
      limit: Math.min(limit, 100), // 最大 100 条
      offset: Math.max(offset, 0),
    };

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobs = await fileSystem.listJobs(filter, userIdOrInfo, userType);

    return jsonOk(c, { jobs, total: jobs.length, limit: filter.limit, offset: filter.offset });
  });

  // 注意：权限检查已移至 FileSystem 业务层，此处仅需基础挂载权限
  router.delete("/api/fs/jobs/:jobId", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const jobId = c.req.param("jobId");

    if (!jobId) {
      throw new ValidationError("请提供作业ID");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager, c.env);
    await fileSystem.deleteJob(jobId, userIdOrInfo, userType);

    return jsonOk(c, undefined, "作业已删除");
  });
};
