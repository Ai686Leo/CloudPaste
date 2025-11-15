/**
 * S3 驱动侧 tester：统一承载 S3/R2/B2/AWS 等 S3 兼容存储的连通性与前端可用性测试
 * - 读权限（ListObjectsV2）
 * - 写权限（PutObject + DeleteObject，可按提供商跳过）
 * - CORS 预检（OPTIONS 到预签名 PUT）
 * - 前端模拟直传（预签名 PUT → HEAD 验证 → 清理）
 */
import { createS3Client } from "../utils/s3Utils.js";
import {
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3ProviderTypes } from "../../../../constants/index.js";
import { formatFileSize } from "../../../../utils/common.js";

const buildPrefix = (defaultFolder) => {
  const df = defaultFolder || "";
  if (!df) return "";
  return df.endsWith("/") ? df : df + "/";
};

const getCorsHeaders = (provider, origin) => {
  const baseHeaders = ["content-type", "x-amz-content-sha256", "x-amz-date", "authorization"];
  if (provider === S3ProviderTypes.B2) {
    baseHeaders.push("x-bz-content-sha1", "x-requested-with");
  }
  const headers = {
    Origin: origin || "https://example.com",
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": baseHeaders.join(","),
  };
  return headers;
};

const getUploadHeaders = (provider, origin, contentType) => {
  const headers = { "Content-Type": contentType || "text/plain" };
  if (origin) headers["Origin"] = origin;
  if (provider === S3ProviderTypes.B2) {
    headers["X-Bz-Content-Sha1"] = "do_not_verify";
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  return headers;
};

const shouldSkipWriteTest = (provider) => provider === S3ProviderTypes.B2;

async function collectLifecycleInfo(client, bucket) {
  try {
    const resp = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
    const rules = resp?.Rules || [];
    if (!rules.length) {
      return { supported: true, hasRules: false };
    }
    const summary = rules.map((rule) => ({
      id: rule.ID || null,
      status: rule.Status || "UNKNOWN",
      filter: rule.Filter || null,
      transitions: rule.Transitions || [],
      expiration: rule.Expiration || null,
    }));
    return { supported: true, hasRules: true, rules: summary };
  } catch (error) {
    const code = error?.name || error?.Code;
    if (code === "NoSuchLifecycleConfiguration") {
      return { supported: true, hasRules: false };
    }
    return { supported: false, error: error?.message || String(error) };
  }
}

export async function s3TestConnection(config, encryptionSecret, requestOrigin = null) {
  const client = await createS3Client(config, encryptionSecret);
  const prefix = buildPrefix(config.default_folder);
  const provider = config.provider_type;
  const expiresIn = config.signature_expires_in || 300;

  const result = {
    read: { success: false, error: null, note: "后端直接测试，不代表前端访问" },
    write: { success: false, error: null, note: "后端直接测试，不代表前端上传" },
    cors: { success: false, error: null, note: "CORS 预检仅作诊断，仍以前端实际结果为准" },
    frontendSim: { success: false, error: null, note: "预签名 PUT 链路测试（由后端模拟）" },
    connectionInfo: {
      bucket: config.bucket_name,
      endpoint: config.endpoint_url || "默认",
      region: config.region || "默认",
      pathStyle: config.path_style ? "是" : "否",
      provider: provider,
      defaultFolder: config.default_folder || "",
      customHost: config.custom_host || "未配置",
      signatureExpiresIn: `${expiresIn}秒`,
    },
    diagnostics: {
      lifecycle: null,
    },
  };

  // 1) 读权限（ListObjectsV2）
  try {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket_name, MaxKeys: 10, Prefix: prefix || undefined })
    );
    result.read.success = true;
    result.read.objectCount = list.Contents?.length || 0;
    if (list.Contents && list.Contents.length > 0) {
      result.read.firstObjects = list.Contents.slice(0, 3).map((o) => ({
        key: o.Key,
        size: formatFileSize(o.Size),
        lastModified: new Date(o.LastModified).toISOString(),
      }));
    }
  } catch (e) {
    result.read.success = false;
    result.read.error = e?.message || String(e);
  }

  // 2) 写权限（可选：B2 默认跳过）
  const writeKey = `${prefix}__write_test_${Date.now()}.txt`;
  const writeBody = new TextEncoder().encode("cloudpaste write test");
  if (shouldSkipWriteTest(provider)) {
    result.write = {
      success: true,
      note: "根据提供商特性（B2），跳过后端写入测试（不代表无法上传）",
      uploadTime: 0,
      testFile: "(skipped)",
    };
  } else {
    try {
      const t0 = performance.now();
      await client.send(new PutObjectCommand({ Bucket: config.bucket_name, Key: writeKey, Body: writeBody, ContentType: "text/plain" }));
      const t1 = performance.now();
      result.write.success = true;
      result.write.uploadTime = Math.round(t1 - t0);
      result.write.testFile = writeKey;
      // 清理
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket_name, Key: writeKey }));
        result.write.cleaned = true;
      } catch (cleanupErr) {
        result.write.cleaned = false;
        result.write.cleanupError = cleanupErr?.message || String(cleanupErr);
      }
    } catch (e) {
      result.write.success = false;
      result.write.error = e?.message || String(e);
    }
  }

  // 3) CORS 预检（OPTIONS 到预签名 PUT）
  try {
    const probeKey = `${prefix}__cors_probe_${Date.now()}.txt`;
    const presigned = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: config.bucket_name, Key: probeKey, ContentType: "text/plain" }),
      { expiresIn }
    );
    const corsHeaders = getCorsHeaders(provider, requestOrigin);
    const resp = await fetch(presigned, { method: "OPTIONS", headers: corsHeaders }).catch(() => null);
    if (resp && (resp.ok || resp.status === 204 || resp.status === 200)) {
      const allowOrigin = resp.headers.get("Access-Control-Allow-Origin") || resp.headers.get("access-control-allow-origin");
      const allowMethods = resp.headers.get("Access-Control-Allow-Methods") || resp.headers.get("access-control-allow-methods");
      const allowHeaders = resp.headers.get("Access-Control-Allow-Headers") || resp.headers.get("access-control-allow-headers");
      const maxAge = resp.headers.get("Access-Control-Max-Age") || resp.headers.get("access-control-max-age");
      result.cors.success = Boolean(allowOrigin);
      result.cors.allowOrigin = allowOrigin || "";
      result.cors.allowMethods = allowMethods || "";
      result.cors.allowHeaders = allowHeaders || "";
      result.cors.maxAge = maxAge || "";
      result.cors.statusCode = resp.status;
      const allowedMethodsList = (allowMethods || "")
        .split(",")
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean);
      const supportsPut = allowedMethodsList.includes("PUT") || allowedMethodsList.includes("*");
      const supportsOrigin = !requestOrigin || allowOrigin === "*" || allowOrigin === requestOrigin;
      result.cors.uploadSupported = !!(supportsPut && supportsOrigin);
      result.cors.supportedNotes = result.cors.uploadSupported ? "" : "允许的方法或来源未覆盖当前请求";
    } else {
      result.cors.success = false;
      result.cors.statusCode = resp?.status || 0;
      result.cors.error = "未返回有效的 CORS 预检响应";
    }
  } catch (e) {
    result.cors.success = false;
    result.cors.error = `CORS 预检失败: ${e?.message || String(e)}`;
  }

  // 4) 前端模拟：签名 PUT 上传 + HEAD 验证 + 清理
  try {
    const ts = Date.now();
    const simKey = `${prefix}frontend_test_${ts}.txt`;
    const contentType = "text/plain";
    const step = {
      step1: { name: "获取预签名URL", success: false, duration: 0 },
      step2: { name: "模拟文件上传", success: false, duration: 0 },
      step3: { name: "验证上传结果", success: false, duration: 0 },
    };
    result.frontendSim.steps = step;

    // step1
    const t1s = performance.now();
    const put = new PutObjectCommand({ Bucket: config.bucket_name, Key: simKey, ContentType: contentType, Metadata: { "test-provider": provider, "test-purpose": "cloudpaste-frontend-simulation", "test-timestamp": `${ts}` } });
    const presigned = await getSignedUrl(client, put, { expiresIn });
    const t1e = performance.now();
    step.step1.success = true;
    step.step1.duration = Math.round(t1e - t1s);
    step.step1.presignedUrl = presigned.substring(0, 80) + "...";

    // step2
    const t2s = performance.now();
    const uploadHeaders = getUploadHeaders(provider, requestOrigin, contentType);
    const body = new TextEncoder().encode(`CloudPaste 前端模拟上传 @ ${new Date().toISOString()}`);
    const uploadResp = await fetch(presigned, { method: "PUT", headers: uploadHeaders, body });
    const t2e = performance.now();
    if (uploadResp.ok) {
      step.step2.success = true;
      step.step2.duration = Math.round(t2e - t2s);
      step.step2.statusCode = uploadResp.status;
      step.step2.etag = (uploadResp.headers.get("ETag") || "").replace(/"/g, "") || null;
      step.step2.bytesUploaded = body.byteLength;
      const exposeHeaders =
        uploadResp.headers.get("Access-Control-Expose-Headers") ||
        uploadResp.headers.get("access-control-expose-headers");
      if (exposeHeaders) {
        result.cors.exposeHeaders = exposeHeaders;
      }
      if (step.step2.duration > 0) {
        const seconds = step.step2.duration / 1000;
        const bytesPerSecond = seconds > 0 ? body.byteLength / seconds : body.byteLength;
        step.step2.uploadSpeed = `${formatFileSize(bytesPerSecond)}/s`;
      } else {
        step.step2.uploadSpeed = `${formatFileSize(body.byteLength)}/s`;
      }
    } else {
      step.step2.success = false;
      step.step2.duration = Math.round(t2e - t2s);
      step.step2.statusCode = uploadResp.status;
      step.step2.statusText = uploadResp.statusText;
      throw new DriverError(`HTTP ${uploadResp.status}: ${uploadResp.statusText}`);
    }

    // step3
    const t3s = performance.now();
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket_name, Key: simKey }));
    const t3e = performance.now();
    step.step3.success = true;
    step.step3.duration = Math.round(t3e - t3s);
    step.step3.headResult = {
      contentLength: head?.ContentLength || 0,
      contentType: head?.ContentType || "",
      etag: head?.ETag || "",
    };
    step.step3.fileSize = head?.ContentLength || 0;
    step.step3.contentType = head?.ContentType || "";

    // 清理
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket_name, Key: simKey }));
      step.step3.fileCleaned = true;
    } catch (cleanupErr) {
      step.step3.fileCleaned = false;
      step.step3.cleanupError = cleanupErr?.message || String(cleanupErr);
    }

    result.frontendSim.success = true;
    result.frontendSim.totalDuration = step.step1.duration + step.step2.duration + step.step3.duration;
    result.frontendSim.testFile = simKey;
    result.presignedPutTest = result.frontendSim;
  } catch (e) {
    result.frontendSim.success = false;
    result.frontendSim.error = e?.message || String(e);
    result.presignedPutTest = result.frontendSim;
  }

  result.diagnostics.lifecycle = await collectLifecycleInfo(client, config.bucket_name);

  // 汇总消息
  const basicConnectSuccess = result.read.success;
  const frontendUsable = result.cors.success && result.frontendSim.success;
  let overallSuccess = basicConnectSuccess && frontendUsable;
  let message = "S3配置测试";
  if (basicConnectSuccess) {
    if (result.write.success) {
      if (frontendUsable) {
        message += "成功 (读写权限均可用，前端上传测试通过)";
      } else if (result.cors.success) {
        message += "部分成功 (读写权限可用，CORS配置正确，但前端上传模拟失败)";
      } else {
        message += "部分成功 (读写权限可用，但CORS配置有问题)";
      }
    } else {
      if (result.cors.success) {
        message += "部分成功 (仅读权限可用，CORS配置正确)";
      } else {
        message += "部分成功 (仅读权限可用，CORS配置有问题)";
      }
    }
  } else {
    message += "失败 (读取权限不可用)";
  }

  return { success: overallSuccess, message, result };
}
import { DriverError } from "../../../../http/errors.js";
