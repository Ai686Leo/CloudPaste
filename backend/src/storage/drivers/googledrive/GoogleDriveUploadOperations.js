/**
 * Google Drive 上传操作模块
 * - 负责前端分片上传（single_session + 后端中转）的具体实现
 */

import { DriverError } from "../../../http/errors.js";
import {
  createUploadSessionRecord,
  updateUploadSessionStatusByFingerprint,
  listActiveUploadSessions,
  findUploadSessionById,
} from "../../../utils/uploadSessions.js";

export class GoogleDriveUploadOperations {
  /**
   * @param {import("./GoogleDriveStorageDriver.js").GoogleDriveStorageDriver} driver
   */
  constructor(driver) {
    this.driver = driver;
  }

  /**
   * 初始化前端分片上传
   * - 创建 Google Drive resumable 会话
   * - 在本地 upload_sessions 表中记录会话信息
   * - 返回 single_session 策略，供前端通过 AwsS3 + StorageAdapter 进行分片上传
   *
   * @param {string} subPath 挂载视图下的子路径（目录或完整相对路径）
   * @param {Object} options 选项参数
   * @returns {Promise<Object>} 初始化结果（InitResult）
   */
  async initializeFrontendMultipartUpload(subPath, options = {}) {
    const {
      fileName,
      fileSize,
      partSize = this.driver.chunkSizeMb
        ? this.driver.chunkSizeMb * 1024 * 1024
        : 5 * 1024 * 1024,
      partCount,
      mount,
      db,
      userIdOrInfo,
      userType,
    } = options;

    if (!fileName || typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DriverError("Google Drive 分片上传初始化失败：缺少有效的 fileName 或 fileSize", {
        status: 400,
      });
    }

    if (!db || !mount?.storage_config_id) {
      throw new DriverError(
        "Google Drive 分片上传初始化失败：缺少数据库或存储配置（storage_config_id）",
        {
          status: 500,
        },
      );
    }

    // Google Drive 要求分片大小为 256KB 的整数倍，除最后一片外
    const unit = 256 * 1024;
    const rawPartSize = partSize || 5 * 1024 * 1024;
    const effectivePartSize =
      Math.max(unit, Math.round(rawPartSize / unit) * unit) || 5 * 1024 * 1024;
    const calculatedPartCount =
      partCount || Math.max(1, Math.ceil(fileSize / effectivePartSize));

    // 规范化挂载内目录路径，用于计算父目录 ID 和 FS 视图路径
    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    // 解析父目录 fileId
    let parentId = this.driver.rootId || "root";
    if (base) {
      const parentPath = `/${base}`;
      const { fileId, isDirectory } = await this.driver._resolvePathToFileId(parentPath, {
        subPath: parentPath,
        mount,
      });
      if (!isDirectory) {
        throw new DriverError("Google Drive 分片上传初始化失败：目标父路径不是目录", {
          status: 400,
        });
      }
      parentId = fileId;
    }

    const metadata = {
      name: fileName,
      parents: [parentId],
      mimeType: "application/octet-stream",
    };

    // 初始化 Google Drive resumable 会话
    const initUrl = new URL("files", "https://www.googleapis.com/upload/drive/v3/");
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("supportsAllDrives", "true");
    initUrl.searchParams.set("includeItemsFromAllDrives", "true");

    const uploadUrl = await this.driver.authManager.withAccessToken(async (token) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": metadata.mimeType,
      };
      if (Number.isFinite(fileSize) && fileSize > 0) {
        headers["X-Upload-Content-Length"] = String(fileSize);
      }

      const res = await fetch(initUrl.toString(), {
        method: "POST",
        redirect: "follow",
        headers,
        body: JSON.stringify(metadata),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new DriverError("初始化 Google Drive 分片上传会话失败", {
          status: res.status,
          details: { response: text },
        });
      }

      const location = res.headers.get("location") || res.headers.get("Location");
      if (!location) {
        throw new DriverError("Google Drive 分片上传会话未返回 Location", { status: 500 });
      }
      return location;
    });

    // 规范化挂载视图路径：mount_path + remotePath
    let remotePath;
    if (!base) {
      remotePath = fileName;
    } else {
      const segments = base.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";
      remotePath =
        lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    // 创建 upload_sessions 记录
    let uploadId;
    try {
      const { id } = await createUploadSessionRecord(db, {
        userIdOrInfo,
        userType: userType || null,
        storageType: this.driver.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        source: "FS",
        fileName,
        fileSize,
        mimeType: metadata.mimeType || null,
        checksum: null,
        fingerprintAlgo: null,
        fingerprintValue: null,
        strategy: "single_session",
        partSize: effectivePartSize,
        totalParts: calculatedPartCount,
        bytesUploaded: 0,
        uploadedParts: 0,
        nextExpectedRange: "0-",
        providerUploadId: null,
        providerUploadUrl: uploadUrl,
        providerMeta: null,
        status: "initiated",
        expiresAt: null,
      });
      uploadId = id;
    } catch (error) {
      throw new DriverError("创建 Google Drive 分片上传会话记录失败", {
        status: 500,
        cause: error,
      });
    }

    // 前端上传端点：通过该 URL 将分片传给后端，再由后端转发到 Google Drive
    const sessionUploadUrl = `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(
      uploadId,
    )}`;

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=初始化完成 路径=${fsPath} 文件=${fileName} 大小=${fileSize} uploadId=${uploadId}`,
    );

    return {
      success: true,
      uploadId,
      strategy: "single_session",
      fileName,
      fileSize,
      partSize: effectivePartSize,
      partCount: calculatedPartCount,
      totalParts: calculatedPartCount,
      key: fsPath.replace(/^\/+/, ""),
      session: {
        uploadUrl: sessionUploadUrl,
        providerUploadUrl: uploadUrl,
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
      mount_id: mount?.id ?? null,
      path: fsPath,
      storage_type: this.driver.type,
      userType: userType || null,
      userIdOrInfo: userIdOrInfo || null,
    };
  }

  /**
   * 完成前端分片上传
   * - 对 Google Drive 而言，最后一个分片 PUT 成功即视为完成
   * - 这里主要用于对齐 FS 层行为并返回统一结果结构
   *
   * @param {string} subPath 挂载视图下的子路径
   * @param {Object} options 选项参数
   * @returns {Promise<Object>} 完成结果（CompleteResult）
   */
  async completeFrontendMultipartUpload(subPath, options = {}) {
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType, parts } = options;

    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    let remotePath;
    if (fileName) {
      if (!base) {
        remotePath = fileName;
      } else {
        const segments = base.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";
        remotePath =
          lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
      }
    } else {
      remotePath = base;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    if (db && mount?.storage_config_id && uploadId && fileName && typeof fileSize === "number") {
      try {
        await updateUploadSessionStatusByFingerprint(db, {
          userIdOrInfo,
          userType,
          storageType: this.driver.type,
          storageConfigId: mount.storage_config_id,
          mountId: mount.id ?? null,
          fsPath,
          fileName,
          fileSize,
          status: "completed",
          bytesUploaded: fileSize,
          uploadedParts: Array.isArray(parts) ? parts.length : null,
          nextExpectedRange: null,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        console.warn(
          "[GoogleDriveUploadOperations] 更新 upload_sessions 状态为 completed 失败:",
          error,
        );
      }
    }

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=完成 路径=${fsPath} 文件=${fileName} 大小=${fileSize} uploadId=${uploadId}`,
    );

    return {
      success: true,
      fileName: fileName || (remotePath ? remotePath.split("/").pop() : null),
      size: fileSize ?? null,
      contentType: null,
      storagePath: remotePath || "",
      publicUrl: null,
      uploadId: uploadId || null,
      message: "Google Drive 分片上传完成",
    };
  }

  /**
   * 中止前端分片上传
   * - 当前实现仅更新 upload_sessions 状态，依赖 Google Drive 会话过期机制
   */
  async abortFrontendMultipartUpload(subPath, options = {}) {
    const { uploadId, fileName, fileSize, mount, db, userIdOrInfo, userType } = options;

    if (!db || !mount?.storage_config_id || !uploadId || !fileName) {
      return { success: true };
    }

    const base =
      typeof subPath === "string"
        ? subPath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    let remotePath;
    if (fileName) {
      if (!base) {
        remotePath = fileName;
      } else {
        const segments = base.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";
        remotePath =
          lastSegment.toLowerCase() === fileName.toLowerCase() ? base : `${base}/${fileName}`;
      }
    } else {
      remotePath = base;
    }

    let fsPath = remotePath || "";
    if (mount?.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (remotePath || "").replace(/^\/+/g, "");
      fsPath = rel ? `${basePath}/${rel}` : basePath;
    }
    if (!fsPath.startsWith("/")) {
      fsPath = `/${fsPath}`;
    }

    try {
      await updateUploadSessionStatusByFingerprint(db, {
        userIdOrInfo,
        userType,
        storageType: this.driver.type,
        storageConfigId: mount.storage_config_id,
        mountId: mount.id ?? null,
        fsPath,
        fileName,
        fileSize: typeof fileSize === "number" ? fileSize : 0,
        status: "aborted",
        bytesUploaded: null,
        uploadedParts: null,
        nextExpectedRange: null,
        errorCode: null,
        errorMessage: null,
      });
    } catch (error) {
      console.warn(
        "[GoogleDriveUploadOperations] 更新 upload_sessions 状态为 aborted 失败:",
        error,
      );
    }

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=中止 路径=${fsPath} 文件=${fileName} uploadId=${uploadId}`,
    );

    return { success: true };
  }

  /**
   * 列出进行中的分片上传
   * - 基于 upload_sessions 表，返回的结构与 ServerResumePlugin 使用的字段相兼容
   *
   * @param {string} subPath 挂载内路径前缀
   * @param {Object} options 选项参数
   * @returns {Promise<Object>} { uploads: Array }
   */
  async listMultipartUploads(subPath = "", options = {}) {
    const { mount, db, userIdOrInfo, userType } = options;

    if (!db || !mount?.id) {
      return {
        success: true,
        uploads: [],
      };
    }

    let fsPathPrefix = subPath || "";
    if (mount.mount_path) {
      const basePath = (mount.mount_path || "").replace(/\/+$/g, "") || "/";
      const rel = (subPath || "").replace(/^\/+/g, "");
      fsPathPrefix = rel ? `${basePath}/${rel}` : basePath;
    }

    const sessions = await listActiveUploadSessions(db, {
      userIdOrInfo,
      userType,
      storageType: this.driver.type,
      mountId: mount.id ?? null,
      fsPathPrefix,
      limit: 100,
    });

    const uploads = sessions.map((row) => ({
      key: (row.fs_path || "/").replace(/^\/+/, ""),
      uploadId: row.id,
      initiated: row.created_at,
      storageClass: null,
      owner: null,
      fileName: row.file_name,
      fileSize: row.file_size,
      partSize: row.part_size,
      strategy: row.strategy || "single_session",
      storageType: row.storage_type,
      sessionId: row.id,
      bytesUploaded: row.bytes_uploaded ?? 0,
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    }));

    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=列出会话 count=${uploads.length} 路径前缀=${fsPathPrefix}`,
    );

    return {
      success: true,
      uploads,
    };
  }

  /**
   * 列出指定上传任务的已上传分片
   * - 对于 Google Drive single_session 模式，由于 Drive 不提供 per-part 列表，
   *   默认基于 upload_sessions.bytes_uploaded 与 partSize 估算“已完成的完整分片”数量。
   * - 为了与 OneDrive 行为对齐，优先尝试向 Google Drive 查询远端会话状态（Range），
   *   若查询成功则以后端返回的 bytesUploaded 为准，同步回本地 upload_sessions；
   *   查询失败时再回退到本地记录。
   * - 用于配合 ServerResumePlugin / StorageAdapter 的服务端断点续传逻辑：
   *   返回从 1 开始、连续的已完成分片编号列表，最后一块未对齐的数据将由前端重新上传。
   */
  async listMultipartParts(_subPath, uploadId, options = {}) {
    const { mount, db, userIdOrInfo, userType } = options || {};
    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    if (!uploadId || !db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }

    try {
      // Google Drive 场景下，uploadId 即 upload_sessions.id
      const sessionRow = await findUploadSessionById(db, { id: uploadId });
      if (!sessionRow) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const totalSize = Number(sessionRow.file_size) || null;
      const partSize = Number(sessionRow.part_size) || 5 * 1024 * 1024;

      if (!totalSize || !Number.isFinite(totalSize) || !Number.isFinite(partSize) || partSize <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      let bytesUploaded = null;

      // 优先尝试向 Google Drive 查询远端会话状态，以云端为准
      if (sessionRow.provider_upload_url) {
        try {
          const statusInfo = await this._getResumableUploadStatus(
            sessionRow.provider_upload_url,
            totalSize,
          );

          if (
            statusInfo &&
            typeof statusInfo.bytesUploaded === "number" &&
            Number.isFinite(statusInfo.bytesUploaded) &&
            statusInfo.bytesUploaded > 0
          ) {
            bytesUploaded = statusInfo.bytesUploaded;

            // 尝试同步更新本地 upload_sessions 状态（非关键路径）
            if (db && mount?.storage_config_id) {
              try {
                await updateUploadSessionStatusByFingerprint(db, {
                  userIdOrInfo,
                  userType,
                  storageType: this.driver.type,
                  storageConfigId: sessionRow.storage_config_id,
                  mountId: sessionRow.mount_id ?? mount.id ?? null,
                  fsPath: sessionRow.fs_path,
                  fileName: sessionRow.file_name,
                  fileSize: totalSize,
                  status: statusInfo.done ? "completed" : "uploading",
                  bytesUploaded,
                  nextExpectedRange: statusInfo.nextExpectedRange ?? null,
                });
              } catch (syncError) {
                console.warn(
                  "[GoogleDriveUploadOperations] 同步远端会话状态到 upload_sessions 失败(listMultipartParts):",
                  syncError,
                );
              }
            }
          }
        } catch (statusError) {
          console.warn(
            "[GoogleDriveUploadOperations] 查询 Google Drive 会话状态失败(listMultipartParts)，回退使用本地记录:",
            statusError,
          );
        }
      }

      // 若远端查询不可用或结果无效，则回退到本地记录的 bytes_uploaded
      if (!Number.isFinite(bytesUploaded) || bytesUploaded == null || bytesUploaded <= 0) {
        const localBytes =
          typeof sessionRow.bytes_uploaded === "number"
            ? Number(sessionRow.bytes_uploaded)
            : null;

        if (!Number.isFinite(localBytes) || localBytes <= 0) {
          return {
            success: true,
            uploadId: uploadId || null,
            parts: [],
            policy,
          };
        }
        bytesUploaded = localBytes;
      }

      // 取整计算“已完成的完整分片”数量，最后一块未对齐的数据将由前端重新上传
      const completedParts = Math.floor(bytesUploaded / partSize);
      if (completedParts <= 0) {
        return {
          success: true,
          uploadId: uploadId || null,
          parts: [],
          policy,
        };
      }

      const parts = [];
      for (let partNumber = 1; partNumber <= completedParts; partNumber += 1) {
        parts.push({
          partNumber,
          size: partSize,
          // Google Drive 不暴露 per-part etag，这里使用伪造的 etag 仅用于本地缓存与跳过逻辑
          etag: `gdrive-part-${partNumber}`,
        });
      }

      const result = {
        success: true,
        uploadId: uploadId || null,
        parts,
        policy,
      };
      console.log(
        `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=列出分片 uploadId=${uploadId} 完整分片数=${parts.length}`,
      );
      return result;
    } catch (error) {
      console.warn(
        "[GoogleDriveUploadOperations] listMultipartParts 异常，回退为空分片列表:",
        error,
      );
      return {
        success: true,
        uploadId: uploadId || null,
        parts: [],
        policy,
      };
    }
  }

  /**
   * 刷新现有上传会话的 URL/状态
   * - 对于 Google Drive single_session 模式，uploadUrl 不会变化
   * - 为了与 OneDrive 行为对齐，会优先尝试向云端查询最新进度并同步回本地，再返回会话信息
   *
   * @param {string} subPath
   * @param {string} uploadId
   * @param {Array<number>} _partNumbers
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async signMultipartParts(subPath, uploadId, _partNumbers, options = {}) {
    const { mount, db, userIdOrInfo, userType } = options;
    if (!uploadId) {
      throw new DriverError("Google Drive 刷新分片会话失败：缺少 uploadId", {
        status: 400,
        expose: true,
      });
    }

    const policy = {
      refreshPolicy: "server_decides",
      partsLedgerPolicy: "server_records",
      retryPolicy: { maxAttempts: 3 },
    };

    // 即使缺少 db/mount，也必须返回严格的最小字段结构（被 DriverContractEnforcer 强制校验）
    if (!db || !mount?.storage_config_id) {
      return {
        success: true,
        uploadId: String(uploadId),
        strategy: "single_session",
        session: {
          uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
          nextExpectedRanges: [],
        },
        policy,
        message: "缺少 db/mount，上游会话状态无法刷新，已回退为最小可用返回结构",
      };
    }

    const sessionRow = await findUploadSessionById(db, { id: uploadId });
    if (!sessionRow) {
      return {
        success: true,
        uploadId: String(uploadId),
        strategy: "single_session",
        session: {
          uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
          nextExpectedRanges: [],
        },
        policy,
        message: "未找到 upload_sessions 记录，已回退为最小可用返回结构",
      };
    }

    const totalSize = Number(sessionRow.file_size) || null;
    let nextExpectedRange = sessionRow.next_expected_range || null;
    let bytesUploaded =
      typeof sessionRow.bytes_uploaded === "number"
        ? Number(sessionRow.bytes_uploaded)
        : null;

    // 优先尝试向 Google Drive 查询远端会话状态，以云端为准
    if (totalSize && sessionRow.provider_upload_url) {
      try {
        const statusInfo = await this._getResumableUploadStatus(
          sessionRow.provider_upload_url,
          totalSize,
        );

        if (
          statusInfo &&
          typeof statusInfo.bytesUploaded === "number" &&
          Number.isFinite(statusInfo.bytesUploaded)
        ) {
          bytesUploaded = statusInfo.bytesUploaded;
          nextExpectedRange = statusInfo.nextExpectedRange ?? null;
        }

        // 同步远端状态到本地 upload_sessions（非关键路径）
        if (db && mount?.storage_config_id) {
          try {
            await updateUploadSessionStatusByFingerprint(db, {
              userIdOrInfo,
              userType,
              storageType: this.driver.type,
              storageConfigId: sessionRow.storage_config_id,
              mountId: sessionRow.mount_id ?? mount.id ?? null,
              fsPath: sessionRow.fs_path,
              fileName: sessionRow.file_name,
              fileSize: totalSize,
              status: statusInfo.done ? "completed" : "uploading",
              bytesUploaded,
              nextExpectedRange,
            });
          } catch (syncError) {
            console.warn(
              "[GoogleDriveUploadOperations] 同步远端会话状态到 upload_sessions 失败(signMultipartParts):",
              syncError,
            );
          }
        }
      } catch (statusError) {
        const status = statusError?.status;
        const code = statusError?.code;

        // 当远端会话不存在或已过期时，标记本地会话为失效并向上抛出明确错误，
        // 让前端放弃断点续传并重新创建上传（对齐 OneDrive 行为）。
        if (status === 404 || code === "UPLOAD_SESSION_NOT_FOUND") {
          if (db && mount?.storage_config_id && sessionRow) {
            try {
              await updateUploadSessionStatusByFingerprint(db, {
                userIdOrInfo,
                userType,
                storageType: this.driver.type,
                storageConfigId: sessionRow.storage_config_id,
                mountId: sessionRow.mount_id ?? mount.id ?? null,
                fsPath: sessionRow.fs_path,
                fileName: sessionRow.file_name,
                fileSize: sessionRow.file_size,
                status: "error",
                errorCode: "UPLOAD_SESSION_NOT_FOUND",
                errorMessage: "Google Drive upload session not found or expired",
              });
            } catch (markError) {
              console.warn(
                "[GoogleDriveUploadOperations] 标记 upload_sessions 会话为失效失败(signMultipartParts):",
                markError,
              );
            }
          }

          throw new DriverError("Google Drive 上传会话不存在或已过期，无法继续断点续传", {
            status: 404,
            code: "UPLOAD_SESSION_NOT_FOUND",
            expose: true,
          });
        }

        console.warn(
          "[GoogleDriveUploadOperations] 查询 Google Drive 会话状态失败(signMultipartParts)，回退使用本地记录:",
          statusError,
        );
      }
    }

    const nextRanges = nextExpectedRange ? [String(nextExpectedRange)] : [];

    const result = {
      success: true,
      uploadId: String(uploadId),
      strategy: "single_session",
      session: {
        uploadUrl: `/api/fs/multipart/upload-chunk?upload_id=${encodeURIComponent(uploadId)}`,
        nextExpectedRanges: nextRanges,
      },
      policy: {
        refreshPolicy: "server_decides",
        partsLedgerPolicy: "server_records",
        retryPolicy: { maxAttempts: 3 },
      },
    };
    console.log(
      `[StorageUpload] type=GOOGLE_DRIVE mode=前端分片-single_session status=刷新会话 uploadId=${uploadId} nextExpectedRange=${nextExpectedRange ?? "null"}`,
    );
    return result;
  }

  /**
   * 后端中转前端分片到 Google Drive resumable 会话
   * - 被 /api/fs/multipart/upload-chunk 调用
   *
   * @param {Object} sessionRow upload_sessions 表中的会话记录
   * @param {any} body 分片数据（ReadableStream 或 Buffer）
   * @param {Object} options 选项参数
   * @returns {Promise<{ status: number, done: boolean }>}
   */
  async proxyFrontendMultipartChunk(sessionRow, body, options = {}) {
    const { contentRange, contentLength } = options;

    const uploadUrl = sessionRow.provider_upload_url;
    if (!uploadUrl) {
      throw new DriverError("Google Drive 上传会话缺少 provider_upload_url", { status: 500 });
    }

    const res = await this.driver.authManager.withAccessToken(async (token) => {
      /** @type {Record<string,string>} */
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Range": contentRange,
      };
      if (Number.isFinite(contentLength) && contentLength > 0) {
        headers["Content-Length"] = String(contentLength);
      }

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body,
        redirect: "follow",
      });
      return response;
    });

    const status = res.status;
    let done = false;

    if (status >= 200 && status < 300) {
      done = true;
    } else if (status === 308) {
      done = false;
    } else {
      const text = await res.text();
      throw new DriverError("Google Drive 分片上传失败", {
        status,
        details: { response: text },
      });
    }

    return { status, done };
  }

  /**
   * 查询 Google Drive resumable upload 会话状态
   * - 通过发送 Content-Length: 0 + Content-Range: bytes * / totalSize 的空 PUT 请求
   * - 根据返回的 HTTP 状态码与 Range 头推导已上传字节数
   * @param {string} uploadUrl
   * @param {number|null} totalSize
   * @returns {Promise<{ bytesUploaded: number|null, nextExpectedRange: string|null, done: boolean }>}
   * @private
   */
  async _getResumableUploadStatus(uploadUrl, totalSize) {
    if (!uploadUrl) {
      return { bytesUploaded: null, nextExpectedRange: null, done: false };
    }

    const res = await this.driver.authManager.withAccessToken(async (token) => {
      /** @type {Record<string, string>} */
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Length": "0",
        // 按官方文档要求，使用 bytes */totalSize 查询会话状态
        "Content-Range":
          typeof totalSize === "number" && Number.isFinite(totalSize) && totalSize > 0
            ? `bytes */${totalSize}`
            : "bytes */*",
      };

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        redirect: "follow",
      });
      return response;
    });

    const status = res.status;

    // 308 Resume Incomplete: 会话仍在进行中，Range 头包含已接收的最后一个字节位置
    if (status === 308) {
      const rangeHeader = res.headers.get("Range") || res.headers.get("range") || null;
      let bytesUploaded = null;

      if (rangeHeader && /^bytes=\d+-\d+$/i.test(rangeHeader)) {
        const lastStr = rangeHeader.split("-")[1];
        const last = Number.parseInt(lastStr, 10);
        if (Number.isFinite(last) && last >= 0) {
          bytesUploaded = last + 1;
        }
      }

      const nextExpectedRange =
        typeof bytesUploaded === "number" && Number.isFinite(bytesUploaded)
          ? `${bytesUploaded}-`
          : null;

      return {
        bytesUploaded,
        nextExpectedRange,
        done: false,
      };
    }

    // 2xx: 说明会话已完成或直接返回了最终资源
    if (status >= 200 && status < 300) {
      return {
        bytesUploaded:
          typeof totalSize === "number" && Number.isFinite(totalSize) ? totalSize : null,
        nextExpectedRange: null,
        done: true,
      };
    }

    // 404: 会话不存在或已过期
    if (status === 404) {
      throw new DriverError("Google Drive 上传会话不存在或已过期，无法继续断点续传", {
        status: 404,
        code: "UPLOAD_SESSION_NOT_FOUND",
        expose: true,
      });
    }

    const text = await res.text();
    throw new DriverError("查询 Google Drive 上传会话状态失败", {
      status,
      details: { response: text },
    });
  }
}
