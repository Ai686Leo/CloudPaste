import { createErrorResponse } from "../../utils/common.js";
import { normalizeError } from "../errors.js";

//  buildContext 用于构建错误上下文
const buildContext = (c) => {
  const principal = c.get("principal");
  const userInfo = c.get("userInfo");
  const userType = userInfo?.type || (principal?.isAdmin ? "admin" : principal?.type) || "guest";
  const userId = userInfo?.id ?? principal?.id ?? null;

  return {
    method: c.req.method,
    path: c.req.path,
    reqId: c.get("reqId"),
    userType,
    userId,
  };
};

//  errorBoundary 用于处理错误边界
export const errorBoundary = () => {
  return async (c, next) => {
    try {
      await next();
    } catch (error) {
      const context = buildContext(c);
      const normalized = normalizeError(error, context);

      c.set("handledError", normalized);

      const logPayload = {
        type: "error",
        reqId: context.reqId,
        method: context.method,
        path: context.path,
        status: normalized.status,
        code: normalized.code,
        userType: context.userType,
        userId: context.userId,
      };

      if (normalized.originalError?.stack) {
        logPayload.stack = normalized.originalError.stack.split("\n")[0];
      }

      console.error(JSON.stringify(logPayload), normalized.originalError);

      const responseMessage = normalized.expose ? normalized.publicMessage : "服务器内部错误";
      return c.json(createErrorResponse(normalized.status, responseMessage), normalized.status);
    }
  };
};

