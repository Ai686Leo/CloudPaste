import { api } from "@/api";

/**
 * Admin 账户相关 Service
 *
 * - 封装账号与密码管理相关接口（当前仅包含修改密码）
 *
 * 不负责：
 * - 表单校验、倒计时、登出等 UI/流程控制
 */
export function useAdminAccountService() {
 /**
  * 修改当前登录管理员的密码/用户名
  *
  * @param {string} currentPassword 当前密码
  * @param {string} newPassword 新密码（可选）
  * @param {string} newUsername 新用户名（可选）
  */
  const changePassword = async (currentPassword, newPassword, newUsername) => {
    const resp = await api.admin.changePassword(currentPassword, newPassword, newUsername);
    if (!resp) {
      throw new Error("修改密码失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "修改密码失败");
      }
      return true;
    }
    return true;
  };

  return {
    changePassword,
  };
}
