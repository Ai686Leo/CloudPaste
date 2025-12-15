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

/**
 * @param {Object} config 存储配置
 * @param {string} encryptionSecret 加密密钥（当前未使用，预留与其他 tester 一致的签名）
 * @param {string|null} requestOrigin 请求来源 Origin（当前未使用）
 */
export async function googleDriveTestConnection(config, encryptionSecret, requestOrigin = null) {
  const rootId = config.root_id || "root";

  /** @type {{ read: any, write: any, info: any }} */
  const result = {
    read: {
      success: false,
      error: null,
      prefix: "/",
      objectCount: 0,
      firstObjects: [],
    },
    info: {
      rootId,
      region: "global",
      useOnlineApi: !!config.use_online_api,
      apiAddress: config.api_address || null,
    },
    write: {
      success: false,
      error: null,
      testFile: null,
      uploadTime: 0,
      cleaned: false,
      cleanupError: null,
      note: "通过创建/删除临时文件夹进行写权限测试",
    },
  };

  // 1. 创建认证管理器并测试 access_token 获取
  const authManager = new GoogleDriveAuthManager({
    useOnlineApi: !!config.use_online_api,
    apiAddress: config.api_address,
    clientId: config.client_id,
    clientSecret: config.client_secret,
    refreshToken: config.refresh_token,
    rootId,
    disableDiskUsage: !config.enable_disk_usage,
    logger: console,
  });

  try {
    await authManager.getAccessToken();
  } catch (error) {
    result.read.error = error?.message || String(error);
    return {
      success: false,
      message: `OAuth 认证失败: ${error.message}`,
      result,
    };
  }

  // 2. 使用 ApiClient 做一次根目录 list 测试，验证基本读权限
  const apiClient = new GoogleDriveApiClient({ authManager });

  try {
    const res = await apiClient.listFiles(rootId, { pageSize: 10 });
    const files = Array.isArray(res.files) ? res.files : [];
    result.read.success = true;
    result.read.objectCount = files.length;
    result.read.firstObjects = files.slice(0, 3).map((item) => ({
      key: item.name || "",
      size: typeof item.size === "number" ? item.size : 0,
      lastModified: item.modifiedTime ? new Date(item.modifiedTime).toISOString() : new Date().toISOString(),
    }));
  } catch (error) {
    result.read.success = false;
    result.read.error = error?.message || String(error);
  }

  // 3. 写测试：创建并删除一个临时文件夹，验证写权限
  // 注意：使用文件夹测试是因为 GoogleDriveApiClient 没有简单的文件上传方法
  // 创建文件夹同样需要写权限，效果等同于文件上传测试
  const testFolderName = `__gdrive_test_${Date.now()}`;
  result.write.testFile = testFolderName;
  try {
    const writeStart = Date.now();
    const folder = await apiClient.createFolder(rootId, testFolderName);
    result.write.uploadTime = Date.now() - writeStart;
    
    if (folder && folder.id) {
      result.write.success = true;
      try {
        await apiClient.deleteFile(folder.id);
        result.write.cleaned = true;
      } catch (cleanupError) {
        result.write.cleaned = false;
        result.write.cleanupError = cleanupError?.message || String(cleanupError);
      }
    } else {
      result.write.success = false;
      result.write.error = "创建测试文件夹失败：返回结果缺少 id";
    }
  } catch (error) {
    result.write.success = false;
    result.write.error = error?.message || String(error);
  }

  // 4. 可选：获取配额信息，丰富 info（对齐 WebDAV 前端显示字段）
  try {
    const quota = await apiClient.getQuota();
    if (quota && typeof quota === "object") {
      result.info.quota = {
        total: quota.limit ?? null,
        used: quota.usage ?? null,
        available: quota.limit != null && quota.usage != null ? quota.limit - quota.usage : null, // 前端期望 available 字段
      };
    }
  } catch {
    // 配额获取失败不影响整体测试结果，静默忽略或按需记录
  }

  // 5. 添加端点地址信息（前端显示需要）
  if (config.use_online_api && config.api_address) {
    result.info.endpoint = config.api_address;
  } else {
    result.info.endpoint = "https://www.googleapis.com"; // Google Drive 官方 API 端点
  }

  // 6. 汇总整体状态与消息（对齐 OneDrive/WebDAV tester 的语义）
  const basicConnectSuccess = result.read.success === true;
  const writeSuccess = result.write.success === true;
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
    result,
  };
}
