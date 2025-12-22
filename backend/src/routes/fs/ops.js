import { ValidationError, NotFoundError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { useRepositories } from "../../utils/repositories.js";
import { usePolicy } from "../../security/policies/policies.js";
import { jobTypeCatalog } from "../../storage/fs/tasks/JobTypeCatalog.js";

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
  const items = body?.payload?.items ?? body?.items ?? null;
  if (!items) {
    return [];
  }
  const targets = [];
  for (const item of items) {
    if (item?.sourcePath) {
      targets.push(item.sourcePath);
    }
    if (item?.targetPath) {
      targets.push(item.targetPath);
    }
  }
  return targets;
};

const dynamicJobPolicy = async (c, next) => {
  const body = c.get("jsonBody") || {};
  const taskTypeRaw = body.taskType ?? body.task_type ?? "copy";
  const taskType = String(taskTypeRaw || "").trim();

  const def = jobTypeCatalog.tryGet(taskType);
  if (!def) {
    throw new ValidationError(`不支持的任务类型: ${taskType || "(empty)"}`);
  }

  const policy = def.createPolicy?.policy;
  const pathCheck = def.createPolicy?.pathCheck === true;
  if (!policy) {
    throw new ValidationError(`任务类型未配置 createPolicy: ${taskType}`);
  }

  // 目前只有 copy 需要路径鉴权
  if (policy === "fs.copy") {
    return usePolicy("fs.copy", { pathResolver: copyItemsResolver })(c, next);
  }

  if (pathCheck) {
    throw new ValidationError(`任务类型 createPolicy.pathCheck 暂不支持非 copy: ${taskType}`);
  }

  return usePolicy(policy, { pathCheck: false })(c, next);
};

export const registerOpsRoutes = (router, helpers) => {
  const { getServiceParams } = helpers;

  // ========== Job Types API (for UI discovery) ==========
  // 返回“当前用户可见”的任务类型清单
  router.get("/api/fs/job-types", usePolicy("fs.base", { pathCheck: false }), async (c) => {
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);

    const permissions = typeof userIdOrInfo === "object" ? userIdOrInfo?.permissions : undefined;
    const defs = jobTypeCatalog.listVisibleTypes({ userType, permissions });

    const types = defs.map((d) => ({
      taskType: d.taskType,
      i18nKey: d.i18nKey || null,
      displayName: d.displayName || null,
      category: d.category || null,
      capabilities: d.capabilities || null,
    }));

    return jsonOk(c, { types });
  });

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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });

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

  router.post("/api/fs/jobs", parseJsonBody, dynamicJobPolicy, async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");

    const taskTypeRaw = body?.taskType ?? body?.task_type ?? "copy";
    const taskType = String(taskTypeRaw || "").trim();

    // 通用 payload：优先使用 body.payload
    let payload = body?.payload ?? null;

    // 兼容 copy 旧入参：{ items, skipExisting, maxConcurrency, retryPolicy }
    if (taskType === "copy" && !payload) {
      const items = body?.items;
      const options = {
        skipExisting: body?.skipExisting !== false,
        maxConcurrency: body?.maxConcurrency || 10,
        retryPolicy: body?.retryPolicy,
      };
      payload = { items, options };
    }

    // 支持 fs_index_rebuild：允许将 mountIds/options 平铺在 body 上
    if (taskType === "fs_index_rebuild" && !payload) {
      payload = {
        mountIds: body?.mountIds ?? body?.mount_ids ?? undefined,
        options: body?.options ?? {
          batchSize: body?.batchSize ?? undefined,
          maxDepth: body?.maxDepth ?? undefined,
          maxMountsPerRun: body?.maxMountsPerRun ?? undefined,
          refresh: body?.refresh ?? undefined,
        },
      };
    }

    // 支持 fs_index_apply_dirty：允许将 mountIds/options 平铺在 body 上
    if (taskType === "fs_index_apply_dirty" && !payload) {
      payload = {
        mountIds: body?.mountIds ?? body?.mount_ids ?? undefined,
        options: body?.options ?? {
          batchSize: body?.batchSize ?? undefined,
          maxItems: body?.maxItems ?? undefined,
          rebuildDirectorySubtree: body?.rebuildDirectorySubtree ?? undefined,
          maxDepth: body?.maxDepth ?? undefined,
          refresh: body?.refresh ?? undefined,
        },
      };
    }

    if (!payload || typeof payload !== "object") {
      throw new ValidationError("请提供有效的 payload 对象");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    const jobDescriptor = await fileSystem.createJob(taskType, payload, userIdOrInfo, userType);

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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    const { jobs, total } = await fileSystem.listJobs(filter, userIdOrInfo, userType);

    return jsonOk(c, { jobs, total, limit: filter.limit, offset: filter.offset });
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

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory, { env: c.env });
    const fileSystem = new FileSystem(mountManager, c.env);
    await fileSystem.deleteJob(jobId, userIdOrInfo, userType);

    return jsonOk(c, undefined, "作业已删除");
  });
};
