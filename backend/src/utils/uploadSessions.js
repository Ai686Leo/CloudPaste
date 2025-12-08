/**
 * 通用上传会话表操作工具
 * - 面向各存储驱动的前端分片/断点续传会话管理（S3 / OneDrive / 其他）
 * - 仅负责持久化与查询，不承载业务逻辑，便于在不同驱动间复用
 */

import { DbTables, UserType } from "../constants/index.js";
import { generateUUID } from "./common.js";

/**
 * 将 userIdOrInfo 规范化为 upload_sessions.user_id 的存储格式
 * - admin: 直接使用管理员ID
 * - apiKey: 统一加前缀 apikey:
 * - 其他类型: 转为字符串
 *
 * @param {string|Object|null} userIdOrInfo
 * @param {string|null} userType
 * @returns {string}
 */
export function normalizeUploadSessionUserId(userIdOrInfo, userType) {
  if (!userType) {
    return String(userIdOrInfo ?? "");
  }

  if (userType === UserType.ADMIN) {
    if (typeof userIdOrInfo === "object" && userIdOrInfo !== null) {
      return String(userIdOrInfo.id ?? userIdOrInfo.sub ?? "");
    }
    return String(userIdOrInfo ?? "");
  }

  if (userType === UserType.API_KEY) {
    let identifier = userIdOrInfo;
    if (typeof userIdOrInfo === "object" && userIdOrInfo !== null) {
      identifier = userIdOrInfo.id ?? userIdOrInfo.key ?? "";
    }
    return `apikey:${String(identifier ?? "")}`;
  }

  return String(userIdOrInfo ?? "");
}

/**
 * 计算上传会话的文件指纹（meta-v1）
 * - 目标：在同一用户/挂载/路径/文件名/文件大小下，指纹是稳定且可重复计算的
 * - 仅依赖业务层元数据，不依赖 provider 的 UploadId / uploadUrl
 *
 * @param {Object} params
 * @param {string|Object|null} params.userIdOrInfo
 * @param {string|null} params.userType
 * @param {string} params.storageType
 * @param {string} params.storageConfigId
 * @param {string|null} params.mountId
 * @param {string} params.fsPath
 * @param {string} params.fileName
 * @param {number} params.fileSize
 * @returns {{ algo: string, value: string }}
 */
export function computeUploadSessionFingerprintMetaV1(params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
  } = params || {};

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const safe = {
    userId: String(userId ?? ""),
    userType: String(userType ?? ""),
    storageType: String(storageType ?? ""),
    storageConfigId: String(storageConfigId ?? ""),
    mountId: String(mountId ?? ""),
    fsPath: String(fsPath ?? ""),
    fileName: String(fileName ?? ""),
    fileSize: Number.isFinite(fileSize) ? String(fileSize) : "",
  };

  const algo = "meta-v1";
  const value = [
    algo,
    safe.userId,
    safe.userType,
    safe.storageType,
    safe.storageConfigId,
    safe.mountId,
    safe.fsPath,
    safe.fileName,
    safe.fileSize,
  ].join("|");

  return { algo, value };
}

/**
 * 创建上传会话记录
 *
 * @param {D1Database} db
 * @param {Object} payload
 * @returns {Promise<{id: string}>}
 */
export async function createUploadSessionRecord(db, payload) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId = null,
    fsPath,
    source,
    fileName,
    fileSize,
    mimeType = null,
    checksum = null,
    fingerprintAlgo = null,
    fingerprintValue = null,
    strategy,
    partSize,
    totalParts,
    bytesUploaded = 0,
    uploadedParts = 0,
    nextExpectedRange = null,
    providerUploadId = null,
    providerUploadUrl = null,
    providerMeta = null,
    status = "active",
    expiresAt = null,
    id: customId = null,
  } = payload;

  const now = new Date().toISOString();
  const id = customId || `upl_${generateUUID()}`;
  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  // 自动补全 fingerprint（如果调用方未显式提供）
  let finalFingerprintAlgo = fingerprintAlgo;
  let finalFingerprintValue = fingerprintValue;
  if (!finalFingerprintAlgo || !finalFingerprintValue) {
    const fp = computeUploadSessionFingerprintMetaV1({
      userIdOrInfo,
      userType,
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      fileName,
      fileSize,
    });
    finalFingerprintAlgo = fp.algo;
    finalFingerprintValue = fp.value;
  }

  await db
    .prepare(
      `
      INSERT INTO ${DbTables.UPLOAD_SESSIONS} (
        id,
        user_id,
        user_type,
        storage_type,
        storage_config_id,
        mount_id,
        fs_path,
        source,
        file_name,
        file_size,
        mime_type,
        checksum,
        fingerprint_algo,
        fingerprint_value,
        strategy,
        part_size,
        total_parts,
        bytes_uploaded,
        uploaded_parts,
        next_expected_range,
        provider_upload_id,
        provider_upload_url,
        provider_meta,
        status,
        created_at,
        updated_at,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .bind(
      id,
      userId,
      userType || "",
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      source,
      fileName,
      fileSize,
      mimeType,
      checksum,
      finalFingerprintAlgo,
      finalFingerprintValue,
      strategy,
      partSize,
      totalParts,
      bytesUploaded,
      uploadedParts,
      nextExpectedRange,
      providerUploadId,
      providerUploadUrl,
      providerMeta,
      status,
      now,
      now,
      expiresAt,
    )
    .run();

  console.log("[uploadSessions] 会话创建完成", {
    storageType,
    status,
  });

  return { id };
}

/**
 * 按文件指纹更新上传会话状态（完成/中止等）
 * - 用于你要求的“同一用户 + 同一挂载 + 同一路径 + 同一文件”统一判断
 *
 * @param {D1Database} db
 * @param {Object} params
 */
export async function updateUploadSessionStatusByFingerprint(db, params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
    status,
    bytesUploaded,
    uploadedParts,
    nextExpectedRange,
    errorCode,
    errorMessage,
  } = params || {};

  if (
    !storageType ||
    !storageConfigId ||
    !mountId ||
    !fsPath ||
    !fileName ||
    !Number.isFinite(fileSize)
  ) {
    console.warn("[uploadSessions] updateUploadSessionStatusByFingerprint 缺少必要参数", {
      storageType,
      storageConfigId,
      mountId,
      fsPath,
      fileName,
      fileSize,
    });
    return;
  }

  const fingerprint = computeUploadSessionFingerprintMetaV1({
    userIdOrInfo,
    userType,
    storageType,
    storageConfigId,
    mountId,
    fsPath,
    fileName,
    fileSize,
  });
  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const sets = [];
  const bindings = [];

  if (typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded)) {
    sets.push("bytes_uploaded = ?");
    bindings.push(bytesUploaded);
  }

  if (typeof uploadedParts === "number" && Number.isFinite(uploadedParts)) {
    sets.push("uploaded_parts = ?");
    bindings.push(uploadedParts);
  }

  if (typeof nextExpectedRange === "string" || nextExpectedRange === null) {
    sets.push("next_expected_range = ?");
    bindings.push(nextExpectedRange);
  }

  if (status) {
    sets.push("status = ?");
    bindings.push(status);
  }

  if (errorCode !== undefined) {
    sets.push("error_code = ?");
    bindings.push(errorCode);
  }

  if (errorMessage !== undefined) {
    sets.push("error_message = ?");
    bindings.push(errorMessage);
  }

  if (sets.length === 0) {
    console.log(
      "[uploadSessions] updateUploadSessionStatusByFingerprint 无需更新（未提供任何可更新字段）",
      { storageType, fingerprintAlgo: fingerprint.algo, fingerprintValue: fingerprint.value, userId },
    );
    return;
  }

  // 始终更新 updated_at
  sets.push("updated_at = ?");
  bindings.push(new Date().toISOString());

  const sql = `
    UPDATE ${DbTables.UPLOAD_SESSIONS}
    SET ${sets.join(", ")}
    WHERE storage_type = ?
      AND fingerprint_algo = ?
      AND fingerprint_value = ?
      AND user_id = ?
  `;
  const values = [
    ...bindings,
    storageType,
    fingerprint.algo,
    fingerprint.value,
    userId,
  ];

  console.log("[uploadSessions] 会话状态更新开始", { storageType, status });

  const stmt = db.prepare(sql);
  const result = await stmt.bind(...values).run();

  console.log("[uploadSessions] 会话状态更新完成", {
    storageType,
    status,
    changes: result?.meta?.changes ?? result?.changes ?? 0,
  });
}

/**
 * 列出指定用户/挂载/路径前缀下的活动上传会话
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<Array<Object>>}
 */
export async function listActiveUploadSessions(db, params) {
  const {
    userIdOrInfo,
    userType,
    storageType,
    mountId = null,
    fsPathPrefix = null,
    limit = 100,
  } = params;

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  // 基础条件：按存储类型、用户与状态过滤
  const sqlParts = [
    `SELECT * FROM ${DbTables.UPLOAD_SESSIONS} WHERE storage_type = ? AND user_id = ? AND status = ?`,
  ];
  const values = [storageType, userId, "active"];

  // 可选挂载过滤
  if (mountId) {
    sqlParts.push("AND mount_id = ?");
    values.push(mountId);
  }

  // 可选路径前缀过滤
  if (fsPathPrefix && fsPathPrefix !== "/") {
    // 移除末尾的斜杠和反斜杠，避免复杂正则在打包阶段被错误转译
    let normalized = fsPathPrefix;
    while (normalized.endsWith("/") || normalized.endsWith("\\")) {
      normalized = normalized.slice(0, -1);
    }
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }
    // 转义 LIKE 通配符，避免路径中出现 %/_ 时扩大匹配范围
    const escaped = normalized.replace(/[%_]/g, "\\$&");
    const likePrefix = `${escaped}%`;
    // 使用单字符转义符（反斜杠），符合 SQLite/D1 对 ESCAPE 的约束
    sqlParts.push("AND fs_path LIKE ? ESCAPE '\\'");
    values.push(likePrefix);
  }

  // 排序与限制
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
  sqlParts.push("ORDER BY created_at DESC");
  sqlParts.push("LIMIT ?");
  values.push(safeLimit);

  const sql = sqlParts.join(" ");

  const result = await db.prepare(sql).bind(...values).all();
  return result?.results || [];
}

/**
 * 按 uploadUrl 查询单个上传会话记录
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<Object|null>}
 */
export async function findUploadSessionByUploadUrl(db, params) {
  const { uploadUrl, storageType, userIdOrInfo, userType } = params;

  if (!uploadUrl || !storageType) {
    return null;
  }

  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  const sql = `
    SELECT *
    FROM ${DbTables.UPLOAD_SESSIONS}
    WHERE storage_type = ?
      AND provider_upload_url = ?
      AND user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await db.prepare(sql).bind(storageType, uploadUrl, userId).all();
  const rows = result?.results || [];
  return rows.length > 0 ? rows[0] : null;
}
