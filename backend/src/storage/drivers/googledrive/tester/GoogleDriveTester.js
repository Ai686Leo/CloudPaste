/**
 * Google Drive 驱动 tester
 *
 * 职责：
 * - 验证当前配置下是否能成功获取 access_token
 * - 验证 root_id 目录是否可以正常列举（基本读权限）
 * - 通过创建/删除临时目录验证写权限（与 OneDrive/WebDAV tester 风格对齐）
 *
 * 注意：
 * - 写测试仅创建一个临时空目录，随后立即删除，尽量减少对用户盘的影响
 * - 不对配置做额外必填约束，后端校验仍由 StorageFactory._validateGoogleDriveConfig 负责
 */

import { GoogleDriveAuthManager } from "../GoogleDriveAuthManager.js";
import { GoogleDriveApiClient } from "../GoogleDriveApiClient.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

/**
 * @param {Object} config 存储配置
 * @param {string} encryptionSecret 加密密钥（当前未使用，预留与其他 tester 一致的签名）
 * @param {string|null} requestOrigin 请求来源 Origin（当前未使用）
 */
export async function googleDriveTestConnection(config, encryptionSecret, requestOrigin = null) {
  const startedAt = Date.now();
  const rootId = config.root_id || "root";
  const useOnlineApi = config?.use_online_api === 1;
  const enableDiskUsage = config?.enable_disk_usage === 1;

  // secret 字段可能以 encrypted:* 存在（由存储配置 CRUD 统一加密写入）
  const clientSecretRaw = await decryptIfNeeded(config.client_secret, encryptionSecret);
  const refreshTokenRaw = await decryptIfNeeded(config.refresh_token, encryptionSecret);
  const clientSecret = typeof clientSecretRaw === "string" ? clientSecretRaw : config.client_secret;
  const refreshToken = typeof refreshTokenRaw === "string" ? refreshTokenRaw : config.refresh_token;

  const info = {
    rootId,
    region: "global",
    useOnlineApi,
    endpoint_url: useOnlineApi ? (config.endpoint_url || null) : "https://www.googleapis.com",
    quota: null,
    responseTimeMs: null,
  };
  const checks = [];

  // 1. 创建认证管理器并测试 access_token 获取
  const authManager = new GoogleDriveAuthManager({
    useOnlineApi,
    apiAddress: config.endpoint_url,
    clientId: config.client_id,
    clientSecret,
    refreshToken,
    rootId,
    disableDiskUsage: !enableDiskUsage,
    logger: console,
  });

  try {
    await authManager.getAccessToken();
    checks.push({ key: "oauth", label: "OAuth 认证", success: true });
  } catch (error) {
    checks.push({ key: "oauth", label: "OAuth 认证", success: false, error: error?.message || String(error) });
    return {
      success: false,
      message: `OAuth 认证失败: ${error.message}`,
      result: { info, checks },
    };
  }

  // 2. 使用 ApiClient 做一次根目录 list 测试，验证基本读权限
  const apiClient = new GoogleDriveApiClient({ authManager });

  const readState = { success: false, error: null, objectCount: 0, firstObjects: [] };
  try {
    const res = await apiClient.listFiles(rootId, { pageSize: 10 });
    const files = Array.isArray(res.files) ? res.files : [];
    readState.success = true;
    readState.objectCount = files.length;
    readState.firstObjects = files.slice(0, 3).map((item) => ({
      key: item.name || "",
      size: typeof item.size === "number" ? item.size : 0,
      lastModified: item.modifiedTime ? new Date(item.modifiedTime).toISOString() : new Date().toISOString(),
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
      { key: "rootId", label: "Root ID", value: rootId },
      { key: "objectCount", label: "对象数量", value: readState.objectCount },
      ...(Array.isArray(readState.firstObjects) && readState.firstObjects.length
        ? [{ key: "sample", label: "示例对象", value: readState.firstObjects }]
        : []),
    ],
  });

  // 3. 写测试：创建并删除一个临时文件夹，验证写权限
  // 注意：使用文件夹测试是因为 GoogleDriveApiClient 没有简单的文件上传方法
  // 创建文件夹同样需要写权限，效果等同于文件上传测试
  const writeState = {
    success: false,
    error: null,
    testFile: null,
    uploadTimeMs: 0,
    cleaned: false,
    cleanupError: null,
    note: "通过创建/删除临时文件夹进行写权限测试",
  };
  const testFolderName = `__gdrive_test_${Date.now()}`;
  writeState.testFile = testFolderName;
  try {
    const writeStart = Date.now();
    const folder = await apiClient.createFolder(rootId, testFolderName);
    writeState.uploadTimeMs = Date.now() - writeStart;
    
    if (folder && folder.id) {
      writeState.success = true;
      try {
        await apiClient.deleteFile(folder.id);
        writeState.cleaned = true;
      } catch (cleanupError) {
        writeState.cleaned = false;
        writeState.cleanupError = cleanupError?.message || String(cleanupError);
      }
    } else {
      writeState.success = false;
      writeState.error = "创建测试文件夹失败：返回结果缺少 id";
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
    ...(writeState.note ? { note: writeState.note } : {}),
    items: [
      { key: "testFile", label: "测试文件", value: writeState.testFile },
      { key: "uploadTimeMs", label: "上传耗时(ms)", value: writeState.uploadTimeMs },
      { key: "cleaned", label: "已清理", value: writeState.cleaned === true },
      ...(writeState.cleanupError ? [{ key: "cleanupError", label: "清理错误", value: writeState.cleanupError }] : []),
    ],
  });

  // 4. 可选：获取配额信息，丰富 info（对齐 WebDAV 前端显示字段）
  try {
    const quota = await apiClient.getQuota();
    if (quota && typeof quota === "object") {
      info.quota = {
        total: quota.limit ?? null,
        used: quota.usage ?? null,
        available: quota.limit != null && quota.usage != null ? quota.limit - quota.usage : null, // 前端期望 available 字段
      };
    }
  } catch {
    // 配额获取失败不影响整体测试结果，静默忽略或按需记录
  }

  // 5. 端点地址信息（前端显示需要）
  if (config.use_online_api && config.endpoint_url) info.endpoint_url = config.endpoint_url;
  else info.endpoint_url = "https://www.googleapis.com";

  // 6. 汇总整体状态与消息（对齐 OneDrive/WebDAV tester 的语义）
  info.responseTimeMs = Date.now() - startedAt;
  const basicConnectSuccess = readState.success === true;
  const writeSuccess = writeState.success === true;
  const overallSuccess = basicConnectSuccess && writeSuccess;

  let message = "Google Drive 配置测试";
  if (basicConnectSuccess) {
    if (writeSuccess) {
      message += "成功 (读写权限均可用)";
    } else {
      message += "部分成功 (仅读权限可用)";
    }
  } else {
    message += "失败 (读取根目录失败)";
  }

  return {
    success: overallSuccess,
    message,
    result: { info, checks },
  };
}
