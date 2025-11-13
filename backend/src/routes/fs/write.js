import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { getQueryBool, getQueryInt } from "../../utils/common.js";
import { usePolicy } from "../../security/policies/policies.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const parseFormData = async (c, next) => {
  const formData = await c.req.formData();
  c.set("formData", formData);
  await next();
};

const jsonPathResolver = (field = "path") => (c) => c.get("jsonBody")?.[field];

const formPathResolver = (field = "path") => (c) => c.get("formData")?.get(field);

export const registerWriteRoutes = (router, helpers) => {
  const { getServiceParams } = helpers;

  router.post("/api/fs/mkdir", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const path = body.path;

    if (!path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供目录路径" });
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.createDirectory(path, userIdOrInfo, userType);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "目录创建成功",
      success: true,
    });
  });

  router.post("/api/fs/upload", parseFormData, usePolicy("fs.upload", { pathResolver: formPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const formData = c.get("formData");
    const file = formData.get("file");
    const path = formData.get("path");
    const useMultipart = formData.get("use_multipart") === "true";

    if (!file || !path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件和路径" });
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.uploadFile(path, file, userIdOrInfo, userType, { useMultipart });

    if (result.useMultipart) {
      return c.json({
        code: ApiStatus.SUCCESS,
        message: "需要使用分片上传",
        data: result,
        success: true,
      });
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "文件上传成功",
      data: result,
      success: true,
    });
  });

  router.post("/api/fs/update", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const path = body.path;
    const content = body.content;

    if (!path || content === undefined) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件路径和内容" });
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.updateFile(path, content, userIdOrInfo, userType);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "文件更新成功",
      data: result,
      success: true,
    });
  });
};
