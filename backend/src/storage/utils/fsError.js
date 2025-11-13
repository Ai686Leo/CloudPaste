import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";

/**
 * 将底层存储错误标准化为 HTTPException
 * 保持最小映射，避免泄漏敏感信息
 */
export function asHTTPException(error, fallbackMessage = "存储操作失败") {
  if (error instanceof HTTPException) {
    return error;
  }

  try {
    // AWS SDK 风格
    if (error?.name === "NoSuchKey" || error?.Code === "NoSuchKey") {
      return new HTTPException(ApiStatus.NOT_FOUND, { message: "对象不存在" });
    }
    if (error?.name === "AccessDenied" || error?.Code === "AccessDenied") {
      return new HTTPException(ApiStatus.FORBIDDEN, { message: "存储访问被拒绝" });
    }
    if (typeof error?.$metadata?.httpStatusCode === "number") {
      const status = error.$metadata.httpStatusCode;
      const mapped = status >= 500 ? ApiStatus.INTERNAL_ERROR : status;
      return new HTTPException(mapped, { message: fallbackMessage });
    }

    // 常见 Node 错误码
    if (error?.code === "ENOENT") {
      return new HTTPException(ApiStatus.NOT_FOUND, { message: "目标不存在" });
    }
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      return new HTTPException(ApiStatus.FORBIDDEN, { message: "权限不足" });
    }
  } catch (_) {
    // 兜底
  }

  return new HTTPException(ApiStatus.INTERNAL_ERROR, { message: fallbackMessage, cause: error });
}

export default asHTTPException;
