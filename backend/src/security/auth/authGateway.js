import { createAuthService } from "./AuthService.js";
import { useRepositories } from "../../utils/repositories.js";

/**
 * 轻量化的认证入口，仅负责调用 AuthService 并缓存结果。
 * 旧版 authGateway 的各种权限判断已经迁移至 securityContext/authorize，
 * 因此这里只保留最小必要逻辑，避免后续维护混淆。
 */
export const performAuth = async (c) => {
  let authResult = c.get("authResult");
  let authService = c.get("authService");

  if (!authResult) {
    const repositoryFactory = c.get("repos") ?? useRepositories(c);
    authService = createAuthService(c.env.DB, repositoryFactory);

    const authHeader = c.req.header("Authorization");
    authResult = await authService.authenticate(authHeader);

    if (!authResult.isAuthenticated) {
      const customAuthKey = c.req.header("X-Custom-Auth-Key");
      if (customAuthKey) {
        const customAuthHeader = `ApiKey ${customAuthKey}`;
        authResult = await authService.authenticate(customAuthHeader);
      }
    }

    c.set("authResult", authResult);
    c.set("authService", authService);
  }

  return authResult;
};
