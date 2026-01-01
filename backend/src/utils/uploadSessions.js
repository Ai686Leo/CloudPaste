/**
 * 通用上传会话表操作工具
 * - 面向各存储驱动的前端分片/断点续传会话管理（S3 / OneDrive / 其他）
 * - 仅负责持久化与查询，不承载业务逻辑，便于在不同驱动间复用
 * - 不直接操作云端 Provider 的真实上传会话生命周期（如 S3 UploadId / OneDrive uploadSession），
 *   仅维护应用侧的控制面视图，底层资源清理依赖各存储自身的生命周期策略或专用任务
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
    status = "initiated",
    expiresAt = null,
    id: customId = null,
  } = payload;

  const now = new Date().toISOString();
  const id = customId || `upl_${generateUUID()}`;
  const userId = normalizeUploadSessionUserId(userIdOrInfo, userType);

  // D1 bind 只支持基础类型，这里把 providerMeta 统一落库为 JSON 字符串
  let providerMetaText = null;
  if (providerMeta !== null && providerMeta !== undefined) {
    if (typeof providerMeta === "string") {
      providerMetaText = providerMeta;
    } else if (typeof providerMeta === "object") {
      try {
        providerMetaText = JSON.stringify(providerMeta);
      } catch {
        providerMetaText = null;
      }
    } else {
      providerMetaText = String(providerMeta);
    }
  }

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
      providerMetaText,
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

  const stmt = db.prepare(sql);
  const result = await stmt.bind(...values).run();

  console.log("[uploadSessions] 会话状态更新完成", {
    storageType,
    status,
    changes: result?.meta?.changes ?? result?.changes ?? 0,
  });
}

/**
 * 按会话 ID 更新 upload_sessions（通用工具）
 *
 *
 * @param {D1Database} db
 * @param {Object} params
 * @returns {Promise<{changes:number}>}
 */
export async function updateUploadSessionById(db, params) {
  const {
    id,
    storageType = null,
    expectedStatus = null,
    status,
    bytesUploaded,
    uploadedParts,
    nextExpectedRange,
    errorCode,
    errorMessage,
    providerUploadUrl,
    providerUploadId,
    providerMeta,
    partSize,
    totalParts,
    expiresAt,
  } = params || {};

  if (!db || !id) {
    return { changes: 0 };
  }

  const sets = [];
  const bindings = [];

  if (status !== undefined) {
    sets.push("status = ?");
    bindings.push(status);
  }
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
  if (errorCode !== undefined) {
    sets.push("error_code = ?");
    bindings.push(errorCode);
  }
  if (errorMessage !== undefined) {
    sets.push("error_message = ?");
    bindings.push(errorMessage);
  }
  if (providerUploadUrl !== undefined) {
    sets.push("provider_upload_url = ?");
    bindings.push(providerUploadUrl);
  }
  if (providerUploadId !== undefined) {
    sets.push("provider_upload_id = ?");
    bindings.push(providerUploadId);
  }
  if (providerMeta !== undefined) {
    const finalMeta =
      providerMeta && typeof providerMeta === "object"
        ? JSON.stringify(providerMeta)
        : providerMeta;
    sets.push("provider_meta = ?");
    bindings.push(finalMeta);
  }
  if (typeof partSize === "number" && Number.isFinite(partSize)) {
    sets.push("part_size = ?");
    bindings.push(partSize);
  }
  if (typeof totalParts === "number" && Number.isFinite(totalParts)) {
    sets.push("total_parts = ?");
    bindings.push(totalParts);
  }
  if (typeof expiresAt === "string" || expiresAt === null) {
    sets.push("expires_at = ?");
    bindings.push(expiresAt);
  }

  if (sets.length === 0) {
    return { changes: 0 };
  }

  // 始终更新 updated_at
  sets.push("updated_at = ?");
  bindings.push(new Date().toISOString());

  const whereParts = ["id = ?"];
  const whereBindings = [String(id)];

  if (storageType) {
    whereParts.push("storage_type = ?");
    whereBindings.push(String(storageType));
  }
  if (expectedStatus) {
    whereParts.push("status = ?");
    whereBindings.push(String(expectedStatus));
  }

  const sql = `
    UPDATE ${DbTables.UPLOAD_SESSIONS}
    SET ${sets.join(", ")}
    WHERE ${whereParts.join(" AND ")}
  `;

  const result = await db
    .prepare(sql)
    .bind(...bindings, ...whereBindings)
    .run();

  return {
    changes: result?.meta?.changes ?? result?.changes ?? 0,
  };
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
  const now = new Date().toISOString();

  // 基础条件：按存储类型、用户与状态过滤
  // - 返回“仍可能继续”的会话：initiated/uploading
  // - initiated 是否要在前端展示为“可恢复”
  const sqlParts = [
    `SELECT * FROM ${DbTables.UPLOAD_SESSIONS} WHERE storage_type = ? AND user_id = ? AND status IN (?, ?)`,
  ];
  const values = [storageType, userId, "initiated", "uploading"];

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

  // 过滤掉已过期的会话（如果 expires_at 有值）
  sqlParts.push("AND (expires_at IS NULL OR expires_at > ?)");
  values.push(now);

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
 * 按会话ID查询单个上传会话记录
 *
 * @param {D1Database} db
 * @param {{ id: string }} params
 * @returns {Promise<Object|null>}
 */
export async function findUploadSessionById(db, params) {
  const { id } = params || {};
  if (!id) {
    return null;
  }

  const sql = `
    SELECT *
    FROM ${DbTables.UPLOAD_SESSIONS}
    WHERE id = ?
    LIMIT 1
  `;

  const result = await db.prepare(sql).bind(id).all();
  const rows = result?.results || [];
  return rows.length > 0 ? rows[0] : null;
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
