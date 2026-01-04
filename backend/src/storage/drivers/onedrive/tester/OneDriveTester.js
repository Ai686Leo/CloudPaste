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
import { decryptIfNeeded } from "../../../../utils/crypto.js";

/**
 * 测试 OneDrive 存储配置连接
 * @param {Object} config 存储配置
 * @returns {Promise<{success: boolean, message: string, result: { read: Object, write: Object, info: Object }}>}
 */
export async function oneDriveTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const startedAt = Date.now();
  try {
    const region = config.region || "global";
    const rawDefaultFolder = config.default_folder || "";
    const defaultFolder = rawDefaultFolder.toString().replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    const basePrefix = defaultFolder ? `/${defaultFolder}` : "/";
    const remoteBase = defaultFolder ? defaultFolder : "";

    const info = {
      region,
      defaultFolder: defaultFolder || "(根目录)",
      driveName: null,
      driveType: null,
      quota: null,
      responseTimeMs: null,
      useOnlineApi: config?.use_online_api === 1,
      tokenRenewEndpoint: config.token_renew_endpoint || null,
    };
    const checks = [];

    // secret 字段可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
    const clientSecretRaw = await decryptIfNeeded(config.client_secret, encryptionSecret);
    const refreshTokenRaw = await decryptIfNeeded(config.refresh_token, encryptionSecret);
    const clientSecret = typeof clientSecretRaw === "string" ? clientSecretRaw : config.client_secret;
    const refreshToken = typeof refreshTokenRaw === "string" ? refreshTokenRaw : config.refresh_token;

    // 1) 配置检查（保持与 OneDriveAuthManager / StorageFactory._validateOneDriveConfig 一致）
    if (!config.redirect_uri) {
      checks.push({ key: "config", label: "配置检查", success: false, error: "配置缺少 redirect_uri" });
      return { success: false, message: "OneDrive 配置检查失败", result: { info, checks } };
    }
    if (!refreshToken) {
      checks.push({ key: "config", label: "配置检查", success: false, error: "配置缺少 refresh_token" });
      return { success: false, message: "OneDrive 配置检查失败", result: { info, checks } };
    }
    if (config?.use_online_api === 1 && !config.token_renew_endpoint) {
      checks.push({
        key: "config",
        label: "配置检查",
        success: false,
        error: "启用 use_online_api 时必须配置 token_renew_endpoint",
      });
      return { success: false, message: "OneDrive 配置检查失败", result: { info, checks } };
    }
    if (config?.use_online_api !== 1 && !config.client_id) {
      checks.push({
        key: "config",
        label: "配置检查",
        success: false,
        error: "配置缺少 client_id（未启用 use_online_api 时必填）",
      });
      return { success: false, message: "OneDrive 配置检查失败", result: { info, checks } };
    }
    checks.push({ key: "config", label: "配置检查", success: true });

    // 2) OAuth 认证
    const authManager = new OneDriveAuthManager({
      region,
      clientId: config.client_id,
      clientSecret,
      refreshToken,
      tokenRenewEndpoint: config.token_renew_endpoint,
      redirectUri: config.redirect_uri,
      useOnlineApi: config?.use_online_api === 1,
    });
    try {
      await authManager.getAccessToken();
      checks.push({ key: "oauth", label: "OAuth 认证", success: true });
    } catch (error) {
      checks.push({ key: "oauth", label: "OAuth 认证", success: false, error: error?.message || String(error) });
      return { success: false, message: `OAuth 认证失败: ${error.message}`, result: { info, checks } };
    }

    // 3) Graph API 读写
    const graphClient = new OneDriveGraphClient({ region, authManager });

    const readState = { success: false, error: null, objectCount: 0, firstObjects: [] };
    try {
      const children = await graphClient.listChildren(remoteBase);
      const items = Array.isArray(children) ? children : [];
      readState.success = true;
      readState.objectCount = items.length;
      readState.firstObjects = items.slice(0, 3).map((item) => ({
        key: item.name || "",
        size: typeof item.size === "number" ? item.size : 0,
        lastModified: item.lastModifiedDateTime
          ? new Date(item.lastModifiedDateTime).toISOString()
          : new Date().toISOString(),
      }));
    } catch (error) {
      readState.success = false;
      readState.error = error?.message || String(error);
    }
    checks.push({
      key: "read",
      label: "读权限",
      success: readState.success === true,
      ...(readState.error ? { error: readState.error } : {}),
      items: [
        { key: "prefix", label: "目录前缀", value: basePrefix },
        { key: "objectCount", label: "对象数量", value: readState.objectCount },
        ...(Array.isArray(readState.firstObjects) && readState.firstObjects.length
          ? [{ key: "sample", label: "示例对象", value: readState.firstObjects }]
          : []),
      ],
    });

    const writeState = { success: false, error: null, testFile: null, uploadTimeMs: 0, cleaned: false, cleanupError: null };
    const testFileName = `__onedrive_test_${Date.now()}.txt`;
    writeState.testFile = defaultFolder ? `${defaultFolder}/${testFileName}` : testFileName;
    try {
      const writeStart = Date.now();
      const remoteTestPath = remoteBase ? `${remoteBase}/${testFileName}` : testFileName;
      await graphClient.uploadSmall(remoteTestPath, "cloudpaste onedrive connectivity test", { contentType: "text/plain" });
      writeState.uploadTimeMs = Date.now() - writeStart;
      writeState.success = true;
      try {
        await graphClient.deleteItem(remoteTestPath);
        writeState.cleaned = true;
      } catch (cleanupError) {
        writeState.cleaned = false;
        writeState.cleanupError = cleanupError?.message || String(cleanupError);
      }
    } catch (error) {
      writeState.success = false;
      writeState.error = error?.message || String(error);
    }
    checks.push({
      key: "write",
      label: "写权限",
      success: writeState.success === true,
      ...(writeState.error ? { error: writeState.error } : {}),
      note: "通过 Graph API 进行小文件写入测试",
      items: [
        { key: "testFile", label: "测试文件", value: writeState.testFile },
        { key: "uploadTimeMs", label: "上传耗时(ms)", value: writeState.uploadTimeMs },
        { key: "cleaned", label: "已清理", value: writeState.cleaned === true },
        ...(writeState.cleanupError ? [{ key: "cleanupError", label: "清理错误", value: writeState.cleanupError }] : []),
      ],
    });

    // 4) 额外信息：根驱动器/配额（失败不影响主流程）
    if (config?.enable_disk_usage === 1) {
      try {
        // driveItem(root) 并不一定包含 quota；quota 属于 Drive 资源（/me/drive）
        const drive = await graphClient.getDrive();
        if (drive) {
          info.driveName = drive.name || "OneDrive";
          info.driveType = drive.driveType || "personal";
          info.quota = drive.quota
            ? {
                total: drive.quota.total ?? null,
                used: drive.quota.used ?? null,
                remaining: drive.quota.remaining ?? null,
                deleted: drive.quota.deleted ?? null,
                state: drive.quota.state ?? null,
              }
            : null;
        }
      } catch (error) {
        info.error = error?.message || String(error);
      }
    } else {
      info.quota = null;
    }

    info.responseTimeMs = Date.now() - startedAt;

    const overallSuccess = readState.success === true && writeState.success === true;
    let message = "OneDrive 配置测试";
    if (readState.success === true) {
      message += writeState.success === true ? "成功 (读写权限均可用)" : "部分成功 (仅读权限可用)";
    } else {
      message += "失败 (读取权限不可用)";
    }

    return { success: overallSuccess, message, result: { info, checks } };
  } catch (error) {
    const msg = error?.message || String(error);
    return {
      success: false,
      message: `连接测试失败: ${msg}`,
      result: { info: { error: msg, responseTimeMs: Date.now() - startedAt }, checks: [{ key: "error", label: "测试执行", success: false, error: msg }] },
    };
  }
}
