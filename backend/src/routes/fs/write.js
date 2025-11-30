import { ValidationError } from "../../http/errors.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { getQueryBool, getQueryInt, jsonOk } from "../../utils/common.js";
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
      throw new ValidationError("请提供目录路径");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.createDirectory(path, userIdOrInfo, userType);

    return jsonOk(c, undefined, "目录创建成功");
  });

  // 表单上传（一次性 multipart/form-data），对应前端“表单上传”模式
  router.post("/api/fs/upload", parseFormData, usePolicy("fs.upload", { pathResolver: formPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const formData = c.get("formData");
    const file = formData.get("file");
    const path = formData.get("path");
    const uploadId = formData.get("upload_id") || null;

    if (!file || !path) {
      throw new ValidationError("请提供文件和路径");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    // 明确走“表单上传”路径：传入 File/Blob 本身，由驱动按表单/缓冲方式处理
    const result = await fileSystem.uploadFile(path, /** @type {any} */ (file), userIdOrInfo, userType, {
      filename: file.name,
      contentType: file.type,
      contentLength: typeof file.size === "number" ? file.size : 0,
      uploadId: uploadId || undefined,
    });

    return jsonOk(c, result, "文件上传成功");
  });

  // 流式上传：直接使用原始请求体作为文件内容，元信息通过 query/header 传递
  router.put("/api/fs/upload", usePolicy("fs.upload", { pathResolver: (ctx) => ctx.req.query("path") }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");

    const path = c.req.query("path");
    const uploadId = c.req.query("upload_id") || null;

    if (!path) {
      throw new ValidationError("请提供文件路径");
    }

    const body = c.req.raw?.body;
    if (!body) {
      throw new ValidationError("请求体为空");
    }

    const contentLengthHeader = c.req.header("content-length");
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) || 0 : 0;
    const contentType = c.req.header("content-type") || undefined;
    const filenameHeaderRaw = c.req.header("x-fs-filename") || null;
    let filenameHeader = filenameHeaderRaw;
    if (filenameHeaderRaw) {
      try {
        filenameHeader = decodeURIComponent(filenameHeaderRaw);
      } catch {
        filenameHeader = filenameHeaderRaw;
      }
    }

    let inferredName = null;
    try {
      const segments = String(path).split("/").filter(Boolean);
      inferredName = segments.length ? segments[segments.length - 1] : null;
    } catch {
      inferredName = null;
    }

    let uploadOptions = {};
    const optionsHeader = c.req.header("x-fs-options");
    if (optionsHeader) {
      try {
        const decoded = Buffer.from(optionsHeader, "base64").toString("utf8");
        uploadOptions = JSON.parse(decoded);
      } catch {
        uploadOptions = {};
      }
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    const result = await fileSystem.uploadFile(path, /** @type {any} */ (body), userIdOrInfo, userType, {
      filename: filenameHeader || uploadOptions.filename || inferredName || "upload.bin",
      contentType,
      contentLength,
      uploadId: uploadId || undefined,
      uploadOptions,
    });

    return jsonOk(c, result, "文件上传成功");
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
      throw new ValidationError("请提供文件路径和内容");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.updateFile(path, content, userIdOrInfo, userType);

    return jsonOk(c, result, "文件更新成功");
  });
};
