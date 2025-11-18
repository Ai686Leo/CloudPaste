import { Permission } from "../../constants/permissions.js";
import { authorize } from "../middleware/authorize.js";
import { processWebDAVPath } from "../../webdav/utils/webdavUtils.js";
import { ValidationError } from "../../http/errors.js";

// 所有策略都集中在这里，方便审计和扩展：
//  - key 采用 “域.操作” 命名（fs.read、webdav.manage 等）。
//  - 每条策略只描述权限需求，不嵌入业务细节。
//  - 路由层只需要 usePolicy("xxx")，即可获得一致的 authorize 中间件。

const getFsPathFromQuery = (c) => c.req.query("path") ?? "/";
const getWebDAVPath = (c) => {
  const cached = c.get?.("webdavPath");
  if (cached) {
    return cached;
  }
  const url = new URL(c.req?.url ?? "http://localhost/", "http://localhost");
  return processWebDAVPath(url.pathname, false) || "/";
};

const Policies = {
  "fs.base": {
    permissions: [Permission.MOUNT_VIEW],
    message: "缺少文件系统访问权限",
  },
  "fs.list": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathMode: "navigation",
    pathResolver: getFsPathFromQuery,
    message: "缺少目录浏览权限",
  },
  "fs.read": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathResolver: getFsPathFromQuery,
    message: "缺少文件读取权限",
  },
  "fs.share-link": {
    permissions: [Permission.MOUNT_VIEW],
    pathCheck: true,
    pathResolver: getFsPathFromQuery,
    message: "缺少文件直链权限",
  },
  "fs.upload": {
    permissions: [Permission.MOUNT_UPLOAD],
    pathCheck: true,
    message: "缺少文件上传权限",
  },
  "fs.rename": {
    permissions: [Permission.MOUNT_RENAME],
    pathCheck: true,
    message: "缺少文件重命名权限",
  },
  "fs.delete": {
    permissions: [Permission.MOUNT_DELETE],
    pathCheck: true,
    message: "缺少文件删除权限",
  },
  "fs.copy": {
    permissions: [Permission.MOUNT_COPY],
    pathCheck: true,
    message: "缺少文件复制权限",
  },
  "fs.share.create": {
    permissions: [Permission.FILE_SHARE],
    pathCheck: true,
    message: "缺少分享创建权限",
  },
  "fs.search": {
    permissions: [Permission.MOUNT_VIEW],
    message: "缺少文件搜索权限",
  },
  "files.manage": {
    permissions: [Permission.FILE_MANAGE],
    message: "缺少文件分享管理权限",
  },
  "files.create": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少文件分享创建权限",
  },
  "urlupload.manage": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少URL上传权限",
  },
  "s3.upload": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少S3上传权限",
  },
  "s3.config.read": {
    permissions: [Permission.FILE_SHARE],
    message: "缺少存储配置访问权限",
  },
  "webdav.read": {
    permissions: [Permission.WEBDAV_READ],
    pathCheck: true,
    pathResolver: getWebDAVPath,
    message: "缺少 WebDAV 读取权限",
  },
  "webdav.manage": {
    permissions: [Permission.WEBDAV_MANAGE],
    pathCheck: true,
    pathResolver: getWebDAVPath,
    message: "缺少 WebDAV 管理权限",
  },
  "pastes.manage": {
    permissions: [Permission.TEXT_MANAGE],
    message: "缺少文本分享管理权限",
  },
  "pastes.create": {
    permissions: [Permission.TEXT_SHARE],
    message: "缺少文本分享创建权限",
  },
  "pastes.admin": {
    permissions: [],
    adminBypass: false,
    custom: (principal) => Boolean(principal?.isAdmin),
    message: "需要管理员权限",
  },
  "admin.all": {
    permissions: [],
    adminBypass: false,
    custom: (principal) => Boolean(principal?.isAdmin),
    message: "需要管理员权限",
  },
  "auth.authenticated": {
    permissions: [],
    message: "需要认证",
  },
};

export const getPolicy = (name) => {
  const policy = Policies[name];
  if (!policy) {
    return null;
  }
  return { ...policy };
};

export const usePolicy = (name, overrides = {}) => {
  const policy = getPolicy(name);
  if (!policy) {
    throw new ValidationError(`Policy '${name}' 未定义`);
  }

  const merged = { ...policy, ...overrides };
  const policyMessage = overrides.message ?? policy.message;

  return authorize({ ...merged, policyName: name, policyMessage });
};

export { Policies };
