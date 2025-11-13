import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { useRepositories } from "../../utils/repositories.js";
import { FileShareService } from "../../services/fileShareService.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { usePolicy } from "../../security/policies/policies.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const extractSearchParams = (queryParams) => {
  const query = queryParams.q || "";
  const scope = queryParams.scope || "global";
  const mountId = queryParams.mount_id || "";
  const path = queryParams.path || "";
  const limit = parseInt(queryParams.limit) || 50;
  const offset = parseInt(queryParams.offset) || 0;

  return {
    query,
    scope,
    mountId,
    path,
    limit: Math.min(limit, 200),
    offset: Math.max(offset, 0),
  };
};

export const registerSearchShareRoutes = (router, helpers) => {
  const { getServiceParams, getAccessibleMounts = async () => null } = helpers;

  router.post(
    "/api/fs/create-share",
    parseJsonBody,
    usePolicy("fs.share.create", { pathResolver: (c) => c.get("jsonBody")?.path }),
    async (c) => {
      const db = c.env.DB;
      const encryptionSecret = getEncryptionSecret(c);
      const userInfo = c.get("userInfo");
      const { userIdOrInfo, userType } = getServiceParams(userInfo);

      const body = c.get("jsonBody");
      const { path } = body;

      if (!path) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "文件路径不能为空" });
      }

      const repositoryFactory = useRepositories(c);
      const svc = new FileShareService(db, encryptionSecret, repositoryFactory);
      const result = await svc.createShareFromFileSystem(path, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "分享创建成功",
        data: result,
        success: true,
      });
    }
  );

  router.get("/api/fs/search", usePolicy("fs.search"), async (c) => {
    const db = c.env.DB;
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const searchParams = extractSearchParams(c.req.query());
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);

    if (!searchParams.query || searchParams.query.trim().length < 2) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "搜索查询至少需要2个字符" });
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const accessibleMounts = await getAccessibleMounts(db, userIdOrInfo, userType);
    const result = await fileSystem.searchFiles(searchParams.query, searchParams, userIdOrInfo, userType, accessibleMounts);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "搜索完成",
      data: result,
      success: true,
    });
  });
};
