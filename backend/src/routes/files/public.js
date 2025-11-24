import { ApiStatus } from "../../constants/index.js";
import { AppError, NotFoundError, AuthenticationError, ValidationError } from "../../http/errors.js";
import { jsonOk } from "../../utils/common.js";
import { generateFileDownloadUrl, getFileBySlug, getPublicFileInfo, incrementAndCheckFileViews, isFileAccessible } from "../../services/fileService.js";
import { verifyPassword } from "../../utils/crypto.js";
import { useRepositories } from "../../utils/repositories.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";

export const registerFilesPublicRoutes = (router) => {
  router.get("/api/file-view/:slug", async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const encryptionSecret = getEncryptionSecret(c);

    const file = await getFileBySlug(db, slug);
    const accessCheck = await isFileAccessible(db, file, encryptionSecret);
    if (!accessCheck.accessible) {
      if (accessCheck.reason === "expired") {
        throw new AppError("文件已过期", { status: ApiStatus.GONE, code: "GONE", expose: true });
      }
      throw new NotFoundError("文件不存在");
    }

    const requiresPassword = !!file.password;
    if (!requiresPassword) {
      const result = await incrementAndCheckFileViews(db, file, encryptionSecret);
      if (result.isExpired) {
        throw new AppError("文件已达到最大查看次数", { status: ApiStatus.GONE, code: "GONE", expose: true });
      }
      const urlsObj = await generateFileDownloadUrl(db, result.file, encryptionSecret, c.req.raw);
      const publicInfo = await getPublicFileInfo(db, result.file, requiresPassword, urlsObj, encryptionSecret);
      return jsonOk(c, publicInfo, "获取文件成功");
    }

    const publicInfo = await getPublicFileInfo(db, file, true, null, encryptionSecret);
    return jsonOk(c, publicInfo, "获取文件成功");
  });

  router.get("/api/public/files/:slug", async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const encryptionSecret = getEncryptionSecret(c);

    const file = await getFileBySlug(db, slug);
    const accessCheck = await isFileAccessible(db, file, encryptionSecret);
    if (!accessCheck.accessible) {
      if (accessCheck.reason === "expired") {
        throw new AppError("文件已过期", { status: ApiStatus.GONE, code: "GONE", expose: true });
      }
      throw new NotFoundError("文件不存在");
    }

    const requiresPassword = !!file.password;

    if (!requiresPassword) {
      const result = await incrementAndCheckFileViews(db, file, encryptionSecret);

      if (result.isExpired) {
        await (async () => {
          const repositoryFactory = useRepositories(c);
          const fileRepository = repositoryFactory.getFileRepository();
          const fileStillExists = await fileRepository.findById(file.id);
          if (fileStillExists) {
            console.log(`文件(${file.id})达到最大访问次数但未被删除，再次尝试删除...`);
            const { checkAndDeleteExpiredFile } = await import("../../services/fileViewService.js");
            await checkAndDeleteExpiredFile(db, result.file, encryptionSecret, repositoryFactory);
          }
        })().catch((error) => {
          console.error(`尝试再次删除文件(${file.id})时出错:`, error);
        });
        throw new AppError("文件已达到最大查看次数", { status: ApiStatus.GONE, code: "GONE", expose: true });
      }

      const urlsObj = await generateFileDownloadUrl(db, result.file, encryptionSecret, c.req.raw);
      const publicInfo = await getPublicFileInfo(db, result.file, requiresPassword, urlsObj, encryptionSecret);

      return jsonOk(c, publicInfo, "获取文件成功");
    }

    const publicInfo = await getPublicFileInfo(db, file, true, null, encryptionSecret);
    return jsonOk(c, publicInfo, "获取文件成功");
  });

  router.post("/api/public/files/:slug/verify", async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const body = await c.req.json();
    const encryptionSecret = getEncryptionSecret(c);

    if (!body.password) {
      throw new ValidationError("密码是必需的");
    }

    const file = await getFileBySlug(db, slug);
    const accessCheck = await isFileAccessible(db, file, encryptionSecret);
    if (!accessCheck.accessible) {
      if (accessCheck.reason === "expired") {
        throw new AppError("文件已过期", { status: ApiStatus.GONE, code: "GONE", expose: true });
      }
      throw new NotFoundError("文件不存在");
    }

    if (!file.password) {
      const urlsObj = await generateFileDownloadUrl(db, file, encryptionSecret, c.req.raw);
      const publicInfo = await getPublicFileInfo(db, file, false, urlsObj, encryptionSecret);
      return jsonOk(c, publicInfo, "此文件不需要密码");
    }

    const passwordValid = await verifyPassword(body.password, file.password);
    if (!passwordValid) {
      throw new AuthenticationError("密码不正确");
    }

    const result = await incrementAndCheckFileViews(db, file, encryptionSecret);

    if (result.isExpired) {
      throw new AppError("文件已达到最大查看次数", { status: ApiStatus.GONE, code: "GONE", expose: true });
    }

    const urlsObj = await generateFileDownloadUrl(db, result.file, encryptionSecret, c.req.raw);
    let fileWithPassword = result.file;

    if (fileWithPassword.password) {
      const repositoryFactory = useRepositories(c);
      const fileRepository = repositoryFactory.getFileRepository();
      const passwordInfo = await fileRepository.getFilePassword(result.file.id);
      if (passwordInfo && passwordInfo.plain_password) {
        fileWithPassword = {
          ...fileWithPassword,
          plain_password: passwordInfo.plain_password,
        };
      }
    }

      const publicInfo = await getPublicFileInfo(db, fileWithPassword, false, urlsObj, encryptionSecret);

    return jsonOk(c, publicInfo, "密码验证成功");
  });
};
