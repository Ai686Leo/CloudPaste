import { decryptValue } from "../../../utils/crypto.js";
import { ValidationError } from "../../../http/errors.js";
import { createClient } from "webdav";
import https from "https";

const normalize = (p) => {
  const cleaned = (p || "").toString().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const parts = cleaned.split("/").filter(Boolean);
  for (const seg of parts) {
    if (seg === "..") {
      throw new ValidationError("default_folder 不允许包含 ..");
    }
  }
  return parts.join("/");
};

const buildPath = (base, sub = "") => {
  const prefix = normalize(base);
  const rel = normalize(sub);
  let combined = prefix;
  if (rel) {
    combined = combined ? `${combined}/${rel}` : rel;
  }
  return combined ? `/${combined}` : "/";
};

export async function webDavTestConnection(config, encryptionSecret) {
  const endpoint = config.endpoint_url;
  if (!endpoint) {
    throw new ValidationError("缺少 endpoint_url");
  }
  const username = config.username;
  const encryptedPassword = config.password;
  const defaultFolder = config.default_folder || "";
  if (!username || !encryptedPassword) {
    throw new ValidationError("缺少 WebDAV 用户名或密码");
  }

  const password = await decryptValue(encryptedPassword, encryptionSecret);
  if (!password) {
    throw new ValidationError("无法解密 WebDAV 密码");
  }

  const agent =
    endpoint.startsWith("https://") && config.tls_insecure_skip_verify
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
  const clientOptions = agent ? { httpsAgent: agent } : {};
  const client = createClient(endpoint, {
    username,
    password,
    ...clientOptions,
  });

  const result = {
    read: { success: false, error: null },
    write: { success: false, error: null },
    info: {
      endpoint,
      defaultFolder,
      tlsSkipVerify: !!config.tls_insecure_skip_verify,
      customHost: config.custom_host || null,
      davCompliance: null,
      quota: null,
      davError: null,
      quotaError: null,
    },
  };

  const basePath = buildPath(defaultFolder);

  // 协议能力测试：DAV 合规信息
  try {
    // 使用默认目录路径探测 DAV 能力（大部分服务对任意路径返回一致的 DAV 头）
    const dav = await client.getDAVCompliance(basePath);
    result.info.davCompliance = dav || null;
  } catch (error) {
    result.info.davError = error?.message || String(error);
  }

  // 配额信息测试（部分服务可能不支持）
  try {
    const quotaRes = await client.getQuota();
    const quotaData = quotaRes && typeof quotaRes === "object" && "data" in quotaRes ? quotaRes.data : quotaRes;
    if (quotaData && typeof quotaData === "object") {
      const used = typeof quotaData.used === "number" ? quotaData.used : null;
      const available = typeof quotaData.available === "number" ? quotaData.available : null;
      result.info.quota = { used, available };
    }
  } catch (error) {
    result.info.quotaError = error?.message || String(error);
  }

  // 读测试：列根目录
  try {
    const dirRes = await client.getDirectoryContents(basePath, { deep: false, glob: "*" });
    const entries =
      Array.isArray(dirRes) && dirRes
        ? dirRes
        : dirRes && typeof dirRes === "object" && "data" in dirRes
        ? dirRes.data
        : [];

    result.read.success = true;
    result.read.prefix = basePath;
    result.read.objectCount = entries.length;

    if (entries.length > 0) {
      result.read.firstObjects = entries.slice(0, 3).map((item) => {
        const name = item.basename || item.filename || "";
        const size = typeof item.size === "number" ? item.size : 0;
        const lastModified = item.lastmod ? new Date(item.lastmod).toISOString() : new Date().toISOString();
        return {
          key: name,
          size,
          lastModified,
        };
      });
    }
  } catch (error) {
    result.read.success = false;
    result.read.error = error?.message || String(error);
  }

  // 写测试：上传/删除临时小文件
  const testFile = `${basePath.endsWith("/") ? basePath : basePath + "/"}__webdav_test_${Date.now()}.txt`;
  result.write.testFile = testFile;
  try {
    const startTime = Date.now();
    await client.putFileContents(testFile, "cloudpaste webdav connectivity test", { overwrite: true });
    result.write.success = true;
    result.write.uploadTime = Date.now() - startTime;
    // 清理
    try {
      await client.deleteFile(testFile);
      result.write.cleaned = true;
    } catch (cleanupError) {
      result.write.cleaned = false;
      result.write.cleanupError = cleanupError?.message || String(cleanupError);
    }
  } catch (error) {
    result.write.success = false;
    result.write.error = error?.message || String(error);
  }

  // 汇总整体状态与消息（与 S3Tester 结构对齐）
  const basicConnectSuccess = result.read.success;
  const writeSuccess = result.write.success;

  const overallSuccess = basicConnectSuccess && writeSuccess;
  let message = "WebDAV 配置测试";

  if (basicConnectSuccess) {
    if (writeSuccess) {
      message += "成功 (读写权限均可用)";
    } else {
      message += "部分成功 (仅读权限可用)";
    }
  } else {
    message += "失败 (读取权限不可用)";
  }

  return { success: overallSuccess, message, result };
}
