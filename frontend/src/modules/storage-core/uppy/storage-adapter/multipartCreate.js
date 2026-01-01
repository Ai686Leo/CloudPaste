/**
 * multipart（创建/恢复会话）
 * - 负责 createMultipartUpload 这条链路（包含：续传恢复、init 新会话、写入 uploadSessions）
 */

import * as fsApi from "@/api/services/fsService.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("MultipartCreate");

/**
 * 创建分片上传
 * @param {Object} file Uppy文件对象
 * @returns {Promise<Object>} {uploadId, key}
 */
export async function createMultipartUpload(file) {
  try {
    log.debug(`创建分片上传: ${file.name}`);

    // 检查是否为ServerResume标记的可恢复上传
    if (file.meta.resumable && file.meta.existingUpload && file.meta.serverResume) {
      const existingUpload = file.meta.existingUpload;
      log.debug(`尝试恢复现有上传: uploadId=${existingUpload.uploadId}, key=${existingUpload.key}`);

      const existingStrategy = existingUpload.strategy || "per_part_url";

      try {
        // 1. 先验证uploadId有效性 - 使用完整的挂载点路径
        const fullPathForValidation = this.buildFullPathFromKey(existingUpload.key);
        log.debug(`验证uploadId有效性: ${fullPathForValidation}`);
        const listPartsResponse = await fsApi.listMultipartParts(
          fullPathForValidation,
          existingUpload.uploadId,
          file.name,
        );

        if (!listPartsResponse.success) {
          throw new Error(`uploadId已失效: ${listPartsResponse.message}`);
        }
        if (listPartsResponse?.data?.uploadNotFound === true) {
          throw new Error("uploadId已失效：服务器侧多部分上传已不存在（可能已完成/已中止/被清理）");
        }

        // ===== 断点续传：已上传分片来源（ledger）=====
        // - server_can_list：服务端（驱动）可直接 ListParts（S3/R2 等）
        // - client_keeps：客户端本地保存（HuggingFace 等：只有 presignedUrl，没有 S3 凭证，服务端无法 ListParts）
        // - server_records：服务端维护 upload_parts（single_session/Telegram 等）
        const effectivePolicy = listPartsResponse?.data?.policy || existingUpload?.policy || null;
        const ledgerPolicyRaw =
          effectivePolicy?.partsLedgerPolicy ?? effectivePolicy?.parts_ledger_policy ?? null;
        const ledgerPolicy = String(ledgerPolicyRaw || "");

        const serverParts = Array.isArray(listPartsResponse?.data?.parts) ? listPartsResponse.data.parts : [];
        const partsLedger = this._createPartsLedger(effectivePolicy, existingUpload.key);
        try {
          await partsLedger.load?.();
        } catch {}

        const uploadedParts =
          ledgerPolicy === "client_keeps"
            ? partsLedger
                .toAwsPartsArray()
                .map((p) => ({
                  partNumber: Number(p?.PartNumber),
                  etag: p?.ETag ?? null,
                  size: Number(p?.Size ?? 0),
                }))
                .filter((p) => Number.isFinite(p.partNumber) && p.partNumber > 0)
            : serverParts;

        // server_can_list / server_records：用服务端回源结果初始化内存账本（用于跳过 + complete 合并）
        if (ledgerPolicy !== "client_keeps") {
          try {
            partsLedger.replaceAll(serverParts);
          } catch {}
        }

        const uploadedCount = Array.isArray(uploadedParts) ? uploadedParts.length : 0;
        const sourceLabel = ledgerPolicy === "client_keeps" ? "本地账本" : "服务器";
        log.debug(`${sourceLabel}返回: 找到${uploadedCount}个已上传分片（按驱动语义解析）`);

        // per_part_url 策略（S3 等）：保持原有的预签名URL刷新与本地缓存逻辑
        if (existingStrategy === "per_part_url") {
          // 恢复上传时，优先使用“原会话的 partSize”
          const fullPath = this.buildFullPathFromKey(existingUpload.key);
          log.debug(`路径转换: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`);

          // ===== per_part_url 恢复：按需/批量获取分片签名 URL =====
          // 由后端 policy 驱动。
          const basePolicy = effectivePolicy || existingUpload?.policy || null;
          const refreshPolicyRaw =
            basePolicy?.refreshPolicy ?? basePolicy?.refresh_policy ?? null;
          const refreshPolicy = String(refreshPolicyRaw || "server_decides");
          const signingModeRaw = basePolicy?.signingMode || basePolicy?.signing_mode || null;
          const signingMode = String(signingModeRaw || "on_demand");

          const maxPartsPerRequestRaw =
            basePolicy?.maxPartsPerRequest ?? basePolicy?.max_parts_per_request ?? null;
          const maxPartsPerRequestParsed = Number(maxPartsPerRequestRaw);
          const maxPartsPerRequest =
            Number.isFinite(maxPartsPerRequestParsed) && maxPartsPerRequestParsed > 0
              ? Math.floor(maxPartsPerRequestParsed)
              : 1;

          const partSizeCandidate =
            existingUpload.partSize ??
            existingUpload.part_size ??
            this.config.partSize ??
            5 * 1024 * 1024;
          const effectivePartSize = Number(partSizeCandidate) || 5 * 1024 * 1024;

          const totalPartsCandidate =
            existingUpload.totalParts ??
            existingUpload.total_parts ??
            existingUpload.partCount ??
            existingUpload.part_count ??
            null;
          const totalPartsFromServer = Number(totalPartsCandidate);
          const totalParts =
            Number.isFinite(totalPartsFromServer) && totalPartsFromServer > 0
              ? Math.floor(totalPartsFromServer)
              : Math.ceil(file.size / effectivePartSize);

          // 选择“下一片需要上传的 partNumber”，并按策略取一批 URL
          const uploadedPartNumbers = (uploadedParts || [])
            .map((p) => Number(p?.partNumber ?? p?.PartNumber))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => a - b);
          const uploadedSet = new Set(uploadedPartNumbers);

          let nextNeededPartNumber = 1;
          while (nextNeededPartNumber <= totalParts && uploadedSet.has(nextNeededPartNumber)) {
            nextNeededPartNumber += 1;
          }

          const hasMoreParts = nextNeededPartNumber <= totalParts;
          let partNumbersToSign = [];

          if (hasMoreParts) {
            if (refreshPolicy === "server_decides") {
              // partNumbers=[] 表示“由后端决定返回哪些 URL”
              partNumbersToSign = [];
            } else {
              // client_part_numbers：由前端提供明确 partNumbers（可按 signingMode 做批量）
              if (signingMode === "batched" && maxPartsPerRequest > 1) {
                const endPn = Math.min(
                  nextNeededPartNumber + maxPartsPerRequest - 1,
                  totalParts,
                );
                partNumbersToSign = Array.from(
                  { length: endPn - nextNeededPartNumber + 1 },
                  (_, i) => nextNeededPartNumber + i,
                );
              } else {
                partNumbersToSign = [nextNeededPartNumber];
              }
            }
          }

          let signResponse = { success: true, data: { presignedUrls: [], policy: basePolicy } };
          if (hasMoreParts) {
            signResponse = await fsApi.signMultipartParts(
              fullPath,
              existingUpload.uploadId,
              partNumbersToSign,
            );
            if (!signResponse.success) {
              throw new Error(signResponse.message || "获取分片签名失败");
            }
          }

          const refreshResponse = signResponse;

          const resetUploadedParts = refreshResponse?.data?.resetUploadedParts === true;
          if (resetUploadedParts) {
            try {
              partsLedger.clearInMemory?.();
              partsLedger.clearPersistent?.();
            } catch {}
          }
          // 如果后端提示“会话重置”，说明之前服务器返回的 uploadedParts 已经不可信（通常是旧 provider uploadId 的记录）
          // 这时必须把已上传分片当作 0，避免跳过导致 complete 失败。
          const effectiveUploadedParts = resetUploadedParts ? [] : uploadedParts;

          const standardParts = effectiveUploadedParts.map((part) => ({
            PartNumber: part.partNumber,
            Size: part.size,
            ETag: part.etag,
          }));

          const uploadedBytes = effectiveUploadedParts.reduce((sum, part) => sum + part.size, 0);
          const progressPercent = Math.round((uploadedBytes / file.size) * 100);

          if (standardParts.length > 0) {
            const partNums = standardParts
              .map((p) => p.PartNumber)
              .sort((a, b) => a - b);
            log.debug(`服务器已上传分片: [${partNums.join(", ")}] (${progressPercent}%)`);
          }

          this.uploadSessions.set(file.id, {
            strategy: "per_part_url",
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
            presignedUrls: refreshResponse?.data?.presignedUrls || [],
            policy: refreshResponse?.data?.policy || basePolicy || null,
            partsLedger,
            path: this.currentPath,
            fileName: file.name,
            fileSize: file.size,
            partSize: effectivePartSize,
            totalParts,
            resumed: true, // 标记为恢复的上传
          });

          log.debug("per_part_url 模式断点续传恢复成功");
          return {
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
          };
        }

        // single_session 策略（OneDrive 等）：使用单一 uploadUrl + Content-Range
        if (existingStrategy === "single_session") {
          const fullPath = this.buildFullPathFromKey(existingUpload.key);
          log.debug(`single_session 恢复: StorageKey=${existingUpload.key} -> FullPath=${fullPath}`);

          // 对于 single_session，后端的 signMultipartParts 返回最新的会话信息
          const refreshResponse = await fsApi.signMultipartParts(
            fullPath,
            existingUpload.uploadId,
            [1], // 对于 single_session，partNumbers 仅为参数校验占位
          );

          if (!refreshResponse.success) {
            throw new Error(refreshResponse.message || "刷新会话信息失败");
          }

          const data = refreshResponse.data || {};
          const session = data.session || {};
          const uploadUrl = session.uploadUrl || existingUpload.uploadId;
          const nextExpectedRanges = session.nextExpectedRanges || [];

          let resumeOffset = 0;
          if (Array.isArray(nextExpectedRanges) && nextExpectedRanges.length > 0) {
            const firstRange = String(nextExpectedRanges[0]);
            const startStr = firstRange.split("-")[0];
            const parsed = Number.parseInt(startStr, 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
              resumeOffset = parsed;
            }
          }

          const effectivePartSize =
            existingUpload.partSize || this.config.partSize || 5 * 1024 * 1024;

          // 结合服务器返回的已上传分片列表，推导已完成的分片数量
          // 从1开始连续编号，如果出现空洞则只取最大连续分片号
          let completedParts = 0;
          if (Array.isArray(uploadedParts) && uploadedParts.length > 0) {
            const partNumbers = uploadedParts
              .map((p) => p.partNumber ?? p.PartNumber)
              .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
              .sort((a, b) => a - b);

            let expected = 1;
            for (const n of partNumbers) {
              if (n === expected) {
                completedParts = n;
                expected += 1;
              } else {
                break;
              }
            }
          }

          this.uploadSessions.set(file.id, {
            strategy: "single_session",
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
            session: {
              uploadUrl,
              nextExpectedRanges,
            },
            path: this.currentPath,
            fileName: file.name,
            fileSize: file.size,
            partSize: effectivePartSize,
            resumed: true,
            resumeOffset,
            completedParts,
          });

          log.debug(`single_session 模式断点续传恢复成功，resumeOffset=${resumeOffset}，completedParts=${completedParts}`);

          return {
            uploadId: existingUpload.uploadId,
            key: existingUpload.key,
          };
        }

        log.warn(
          `[StorageAdapter] 未知的 existingUpload.strategy=${existingStrategy}，将回退为全新上传`,
        );
      } catch (error) {
        log.warn(`[StorageAdapter] 断点续传失败，创建新上传: ${error.message}`);

        // 清除失效的上传标记
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, {
            resumable: false,
            existingUpload: null,
            serverResume: false,
          });
        }

        // 继续创建新的上传（不要递归调用，直接继续执行下面的代码）
      }
    }

    // 创建新的分片上传（统一走 FS /fs/multipart/init，依据 strategy 分流）
    const partSize = this.config.partSize || 5 * 1024 * 1024; // 5MB
    const meta = file?.meta || {};
    // 如果预初始化已经拿到 init 结果，这里直接复用，避免重复请求
    const preinit = meta?.cloudpasteMultipartInit && typeof meta.cloudpasteMultipartInit === "object" ? meta.cloudpasteMultipartInit : null;
    const sha256 =
      typeof meta?.cloudpasteSha256 === "string" && meta.cloudpasteSha256
        ? meta.cloudpasteSha256
        : typeof meta?.sha256 === "string" && meta.sha256
          ? meta.sha256
          : null;

    const response = preinit
      ? { success: true, data: preinit }
      : await fsApi.initMultipartUpload(
          this.currentPath,
          file.name,
          file.size,
          file.type,
          partSize,
          { sha256 },
        );

    if (!response?.success) {
      throw new Error(response?.message || "初始化分片上传失败");
    }

    const init = response?.data || {};
    const strategy = init.strategy || "per_part_url";
    const uploadId = init.uploadId;
    const initPartSize = Number(init.partSize || init.part_size || 0);
    // 统一：key 存“无前导 /”的 storageKey 格式（用于缓存与续传标识）
    const key = String(
      init?.key || `${this.currentPath}/${file.name}`.replace(/\/+/g, "/").replace(/^\/+/, ""),
    ).replace(/^\/+/, "");

    if (!uploadId) {
      throw new Error("初始化分片上传失败：缺少 uploadId");
    }

    // 确保 AwsS3.getChunkSize 能读到后端返回的 partSize
    if (this.uppyInstance && Number.isFinite(initPartSize) && initPartSize > 0) {
      try {
        this.uppyInstance.setFileMeta(file.id, { [this._multipartChunkSizeKey]: Math.floor(initPartSize) });
      } catch {}
    }

    if (strategy === "per_part_url") {
      // S3 等 per-part 预签名 URL 策略
      const presignedUrls = Array.isArray(init.presignedUrls) ? init.presignedUrls : [];
      const policy = init.policy || null;
      const signingModeRaw = policy?.signingMode || policy?.signing_mode || null;
      const signingMode = String(signingModeRaw || "eager");
      const partsLedger = this._createPartsLedger(policy, key);
      try {
        await partsLedger.load?.();
      } catch {}

      // 需要某个分片 URL 时，由 signPart 触发 /fs/multipart/sign-parts 批量获取
      if (presignedUrls.length === 0 && signingMode === "eager") {
        throw new Error("初始化分片上传失败：per_part_url 策略缺少 presignedUrls");
      }

      this.uploadSessions.set(file.id, {
        strategy,
        uploadId,
        key,
        presignedUrls,
        policy,
        partsLedger,
        path: this.currentPath,
        fileName: file.name,
        fileSize: file.size,
        partSize: init.partSize || partSize,
        totalParts: init.totalParts || init.partCount || null,
        skipUpload: init.skipUpload === true,
        resumed: false,
      });

      // 统一写入：用于 UI 在上传完成后统计“跳过上传（秒传/去重）”数量
      try {
        if (this.uppyInstance) {
          this.uppyInstance.setFileMeta(file.id, { cloudpasteSkipUpload: init.skipUpload === true });
        }
      } catch {}

      try {
        partsLedger.clearInMemory?.();
        partsLedger.clearPersistent?.();
      } catch {}
      log.debug(`新上传初始化完成，已重置分片账本: ${key}`);

      return {
        uploadId,
        key,
      };
    }

    if (strategy === "single_session") {
      // OneDrive 等使用单一 uploadUrl + Content-Range 的策略
      const session = init.session || {};
      if (!session.uploadUrl) {
        throw new Error("初始化分片上传失败：single_session 策略缺少 session.uploadUrl");
      }

      this.uploadSessions.set(file.id, {
        strategy,
        uploadId,
        key,
        session,
        path: this.currentPath,
        fileName: file.name,
        fileSize: file.size,
        partSize: init.partSize || partSize,
        resumed: false,
        resumeOffset: 0,
      });

      log.debug("新的 single_session 分片上传会话已创建（OneDrive/Graph 模式）");

      return {
        uploadId,
        key,
      };
    }

    throw new Error(`不支持的分片上传策略: ${String(strategy)}`);
  } catch (error) {
    log.error("[StorageAdapter] 创建分片上传失败:", error);
    throw error;
  }
}
