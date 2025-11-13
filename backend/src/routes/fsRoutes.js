import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { getStorageConfigByIdForAdmin, getPublicStorageConfigById } from "../services/storageConfigService.js";
import { getAccessibleMountsForUser } from "../security/helpers/access.js";
import { registerBrowseRoutes } from "./fs/browse.js";
import { registerWriteRoutes } from "./fs/write.js";
import { registerMultipartRoutes } from "./fs/multipart.js";
import { registerOpsRoutes } from "./fs/ops.js";
import { registerSearchShareRoutes } from "./fs/search_share.js";

const fsRoutes = new Hono();

// 负责把 principal 映射为 legacy FS 服务层仍在使用的 userInfo 结构。
const unifiedFsAuthMiddleware = async (c, next) => {
  const principal = c.get("principal");

  if (!principal || principal.type === "guest") {
    throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "需要认证访问" });
  }

  if (principal.isAdmin) {
    c.set("userInfo", {
      type: UserType.ADMIN,
      id: principal.id,
      hasFullAccess: true,
    });
  } else if (principal.type === UserType.API_KEY) {
    const apiKeyInfo = principal.attributes?.keyInfo ?? {
      id: principal.id,
      basicPath: principal.attributes?.basicPath ?? "/",
      permissions: principal.authorities,
    };

    c.set("userInfo", {
      type: UserType.API_KEY,
      info: apiKeyInfo,
      hasFullAccess: false,
    });
  } else {
    throw new HTTPException(ApiStatus.FORBIDDEN, { message: "不支持的身份类型" });
  }

  await next();
};

const FS_BASE_PATH = "/api/fs";

const baseFsPolicy = usePolicy("fs.base");
fsRoutes.use(`${FS_BASE_PATH}/*`, baseFsPolicy, unifiedFsAuthMiddleware);

fsRoutes.use(`${FS_BASE_PATH}/list`, usePolicy("fs.list"));
fsRoutes.use(`${FS_BASE_PATH}/get`, usePolicy("fs.read"));
fsRoutes.use(`${FS_BASE_PATH}/download`, usePolicy("fs.read"));
fsRoutes.use(`${FS_BASE_PATH}/file-link`, usePolicy("fs.share-link"));


const getServiceParams = (userInfo) => {
  if (userInfo.type === UserType.ADMIN) {
    return { userIdOrInfo: userInfo.id, userType: UserType.ADMIN };
  }
  return { userIdOrInfo: userInfo.info, userType: UserType.API_KEY };
};

// 统一命名：根据用户类型获取“存储配置”（保持实现不变）
const getStorageConfigByUserType = async (db, configId, userIdOrInfo, userType, encryptionSecret) => {
  if (userType === UserType.ADMIN) {
    return await getStorageConfigByIdForAdmin(db, configId, userIdOrInfo);
  }
  return await getPublicStorageConfigById(db, configId);
};

const sharedContext = {
  // FS 子路由只需要这三个 helper 即可完成鉴权相关操作。
  getAccessibleMounts: getAccessibleMountsForUser,
  getServiceParams,
  getStorageConfigByUserType,
};

registerBrowseRoutes(fsRoutes, sharedContext);
registerWriteRoutes(fsRoutes, sharedContext);
registerMultipartRoutes(fsRoutes, sharedContext);
registerOpsRoutes(fsRoutes, sharedContext);
registerSearchShareRoutes(fsRoutes, sharedContext);


export default fsRoutes;
