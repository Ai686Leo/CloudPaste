/**
 * OneDriveTester
 *
 * OneDrive 存储配置连接测试器
 * - 验证 OAuth 凭据有效性
 * - 验证 Graph API 访问权限
 * - 验证根目录可访问性
 */

import { OneDriveAuthManager } from "../auth/OneDriveAuthManager.js";
import { OneDriveGraphClient } from "../client/OneDriveGraphClient.js";

/**
 * 测试 OneDrive 存储配置连接
 * @param {Object} config 存储配置
 * @returns {Promise<{success: boolean, message: string, result: { read: Object, write: Object, info: Object }}>}
 */
export async function oneDriveTestConnection(config) {
  const startTime = Date.now();

  try {
    const region = config.region || "global";
    const rawDefaultFolder = config.default_folder || "";
    const defaultFolder = rawDefaultFolder.toString().replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    const basePrefix = defaultFolder ? `/${defaultFolder}` : "/";

    /** @type {{ read: any, write: any, info: any }} */
    const result = {
      read: {
        success: false,
        error: null,
        prefix: basePrefix,
        objectCount: 0,
        firstObjects: [],
      },
      write: {
        success: false,
        error: null,
        testFile: null,
        uploadTime: 0,
        cleaned: false,
        cleanupError: null,
        note: "通过 Graph API 进行小文件写入测试",
      },
      info: {
        region,
        defaultFolder: defaultFolder || "(根目录)",
        driveName: null,
        driveType: null,
        quota: null,
        responseTime: null,
      },
    };

    // 1. 验证必填配置（保持与 OneDriveAuthManager / StorageFactory._validateOneDriveConfig 一致）
    // 至少需要 refresh_token 或 token_renew_endpoint 之一
    if (!config.refresh_token && !config.token_renew_endpoint) {
      return {
        success: false,
        message: "配置缺少 refresh_token 或 token_renew_endpoint",
        result,
      };
    }

    // 当未配置 token_renew_endpoint 时，必须提供 client_id 以便直接调用微软 OAuth 端点刷新 token
    if (!config.token_renew_endpoint && !config.client_id) {
      return {
        success: false,
        message: "配置缺少 client_id（未配置 token_renew_endpoint 时必填）",
        result,
      };
    }

    // 2. 创建认证管理器并测试 token 获取
    const authManager = new OneDriveAuthManager({
      region,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      refreshToken: config.refresh_token,
      tokenRenewEndpoint: config.token_renew_endpoint,
      redirectUri: config.redirect_uri,
      useOnlineApi: config.use_online_api,
    });

    try {
      // 尝试获取 access token 以验证 OAuth 凭据有效性
      await authManager.getAccessToken();
    } catch (error) {
      result.read.error = error?.message || String(error);
      return {
        success: false,
        message: `OAuth 认证失败: ${error.message}`,
        result,
      };
    }

    // 3. 创建 Graph 客户端
    const graphClient = new OneDriveGraphClient({
      region,
      authManager,
    });

    // 4. 读测试：列出根目录
    try {
      const children = await graphClient.listChildren("");
      const items = Array.isArray(children) ? children : [];
      result.read.success = true;
      result.read.objectCount = items.length;
      result.read.firstObjects = items.slice(0, 3).map((item) => ({
        key: item.name || "",
        size: typeof item.size === "number" ? item.size : 0,
        lastModified: item.lastModifiedDateTime
          ? new Date(item.lastModifiedDateTime).toISOString()
          : new Date().toISOString(),
      }));
    } catch (error) {
      result.read.success = false;
      result.read.error = error?.message || String(error);
    }

    // 5. 写测试
    const testFileName = `__onedrive_test_${Date.now()}.txt`;
    result.write.testFile = defaultFolder ? `${defaultFolder}/${testFileName}` : testFileName;
    try {
      const writeStart = Date.now();
      await graphClient.uploadSmall(testFileName, "cloudpaste onedrive connectivity test", {
        contentType: "text/plain",
      });
      result.write.uploadTime = Date.now() - writeStart;
      result.write.success = true;

      try {
        await graphClient.deleteItem(testFileName);
        result.write.cleaned = true;
      } catch (cleanupError) {
        result.write.cleaned = false;
        result.write.cleanupError = cleanupError?.message || String(cleanupError);
      }
    } catch (error) {
      result.write.success = false;
      result.write.error = error?.message || String(error);
    }

    // 6. 额外信息：根驱动器/配额
    let rootInfo = null;
    try {
      rootInfo = await graphClient.getItem("");
    } catch (error) {
      result.info.error = error?.message || String(error);
    }

    if (rootInfo) {
      result.info.driveName = rootInfo.name || "OneDrive";
      result.info.driveType = rootInfo.driveType || "personal";
      result.info.quota = rootInfo.quota
        ? {
            total: rootInfo.quota.total,
            used: rootInfo.quota.used,
            remaining: rootInfo.quota.remaining,
          }
        : null;
    }

    const elapsed = Date.now() - startTime;
    result.info.responseTime = `${elapsed}ms`;

    // 7. 汇总整体状态与消息（对齐 WebDAV/S3 tester 风格）
    const basicConnectSuccess = result.read.success === true;
    const writeSuccess = result.write.success === true;

    const overallSuccess = basicConnectSuccess && writeSuccess;
    let message = "OneDrive 配置测试";

    if (basicConnectSuccess) {
      if (writeSuccess) {
        message += "成功 (读写权限均可用)";
      } else {
        message += "部分成功 (仅读权限可用)";
      }
    } else {
      message += "失败 (读取权限不可用)";
    }

    return {
      success: overallSuccess,
      message,
      result,
    };
  } catch (error) {
    return {
      success: false,
      message: `连接测试失败: ${error.message}`,
      result: {
        read: {
          success: false,
          error: error?.message || String(error),
        },
        write: {
          success: false,
          error: null,
        },
        info: {
          error: error?.message || String(error),
        },
      },
    };
  }
}
