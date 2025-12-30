/**
 * multipart（签名 + 传输）
 * - signPart：为某个分片获取/刷新预签名 URL（含并发去重）
 * - uploadPartBytes：真正 PUT 分片（含跳过、暂停/恢复、过期重签重试）
 *
 */

import * as fsApi from "@/api/services/fsService.js";
import { resolveAbsoluteApiUrl } from "./tools.js";

/**
 * 签名分片
 * @param {Object} file Uppy文件对象
 * @param {Object} partData 分片数据 {uploadId, key, partNumber, body}
 * @returns {Promise<Object>} {url, headers}
 */
export async function signPart(file, partData) {
  try {
    const session = this.uploadSessions.get(file.id);
    if (!session) {
      throw new Error("找不到上传会话信息");
    }

    console.log(`[StorageAdapter] signPart被调用: 分片${partData.partNumber}`);

    // 不在signPart中处理已上传分片，断点续传由 listParts + uploadPartBytes 内部处理

    if (session.strategy === "single_session") {
      // OneDrive/Graph uploadSession: 所有分片共用一个 uploadUrl，通过 Content-Range 标记区间
      // 这里不使用 resumeOffset，而是始终按全局 partNumber 计算 Range:
      // start = (partNumber - 1) * partSize
      // 已上传的分片通过 listParts 返回的 PartNumber 列表由 HTTPCommunicationQueue 跳过。
      const totalSize = session.fileSize || file.size;
      const partSize = session.partSize || this.config.partSize || 5 * 1024 * 1024;

      const partNumber = partData.partNumber;
      if (typeof partNumber !== "number" || !Number.isFinite(partNumber) || partNumber <= 0) {
        throw new Error(`无效的单会话分片编号: ${partNumber}`);
      }

      const body = partData.body;
      const currentSize =
        (body && (body.size ?? body.byteLength)) != null
          ? body.size ?? body.byteLength
          : null;
      if (currentSize == null || !Number.isFinite(currentSize) || currentSize <= 0) {
        throw new Error("无法确定当前分片大小，用于计算 Content-Range");
      }

      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + currentSize, totalSize) - 1;

      if (start >= totalSize) {
        throw new Error(
          `分片区间超出文件大小: start=${start}, totalSize=${totalSize}, partNumber=${partNumber}`,
        );
      }

      const urlRaw = session.session?.uploadUrl || session.uploadId;
      const url = resolveAbsoluteApiUrl(urlRaw);
      if (!url) {
        throw new Error("single_session 会话缺少有效的 uploadUrl");
      }

      // 对于 single_session（OneDrive / GoogleDrive 后端中转），需要带上认证头，
      const authHeaders = this.authProvider.getAuthHeaders() || {};

      return {
        url,
        headers: {
          ...authHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        },
        strategy: "single_session",
        partNumber,
        fileId: file.id,
        key: session.key || null,
      };
    }

    // 默认 per_part_url 策略（S3 等）：从缓存的预签名URL列表中找到对应分片
    // LFS 去重/秒传：对象已存在（skipUpload=true），不需要真实的 per-part URL。
    if (session?.skipUpload === true) {
      return {
        url: resolveAbsoluteApiUrl("/__uppy_skip_upload__"),
        headers: {
          "Content-Type": "application/octet-stream",
          "x-cloudpaste-skip-upload": "1",
        },
        strategy: "per_part_url",
        partNumber: partData.partNumber,
        fileId: file.id,
        key: session.key || null,
        skipUpload: true,
      };
    }

    const urls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
    let urlInfo = urls.find((url) => url.partNumber === partData.partNumber);

    if (!urlInfo && session.uploadId && session.key) {
      // 如果本地没有该分片的 URL，向后端请求签名（批量/按需）
      // - S3：批量拿一段 URL，避免每片都请求一次
      // - HF：可以按需取回指定 partNumber 的 URL
      try {
        const fullPath = this.buildFullPathFromKey(session.key);
        const policy = session?.policy || {};
        const signingModeRaw = policy?.signingMode || policy?.signing_mode || null;
        const signingMode = String(signingModeRaw || "on_demand");

        const maxPartsPerRequestRaw =
          policy?.maxPartsPerRequest ?? policy?.max_parts_per_request ?? null;
        const maxPartsPerRequestParsed = Number(maxPartsPerRequestRaw);
        const maxPartsPerRequest =
          Number.isFinite(maxPartsPerRequestParsed) && maxPartsPerRequestParsed > 0
            ? Math.floor(maxPartsPerRequestParsed)
            : 1;

        let partNumbersToSign = [partData.partNumber];

        if (signingMode === "batched" && maxPartsPerRequest > 1) {
          const totalPartsCandidate =
            session?.totalParts ?? session?.total_parts ?? null;
          const totalPartsFromSession = Number(totalPartsCandidate);
          const partSizeCandidate =
            session?.partSize ?? session?.part_size ?? this.config.partSize ?? 5 * 1024 * 1024;
          const effectivePartSize = Number(partSizeCandidate) || 5 * 1024 * 1024;
          const totalParts =
            Number.isFinite(totalPartsFromSession) && totalPartsFromSession > 0
              ? Math.floor(totalPartsFromSession)
              : Math.ceil(file.size / effectivePartSize);

          const startPn = Number(partData.partNumber);
          const endPn = Math.min(startPn + maxPartsPerRequest - 1, totalParts);
          partNumbersToSign = Array.from({ length: endPn - startPn + 1 }, (_, i) => startPn + i);
        }

        // 同一个 uploadId 在同一时刻只允许 1 个 sign-parts 请求，其它 signPart 等它完成后再复用结果。
        if (session._cloudpasteSignPartsInFlight) {
          try {
            await session._cloudpasteSignPartsInFlight;
          } catch {}
          const latestUrls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
          urlInfo = latestUrls.find((url) => url.partNumber === partData.partNumber);
        }

        // 如果等待后仍然没有 URL，才真正发起签名请求
        if (!urlInfo) {
          const p = fsApi.signMultipartParts(fullPath, session.uploadId, partNumbersToSign);
          session._cloudpasteSignPartsInFlight = p;

          let signResponse;
          try {
            signResponse = await p;
          } finally {
            // 只清理自己设置的那个 Promise（避免并发覆盖）
            if (session._cloudpasteSignPartsInFlight === p) {
              session._cloudpasteSignPartsInFlight = null;
            }
          }

          // 后端可能会返回新的 policy（例如 maxPartsPerRequest/urlTtlSeconds），合并到 session 里
          if (signResponse?.success && signResponse?.data?.policy) {
            session.policy = signResponse.data.policy;
          }

          const refreshedUrls = signResponse?.success ? (signResponse?.data?.presignedUrls || []) : [];
          if (Array.isArray(refreshedUrls) && refreshedUrls.length > 0) {
            const latestUrls = Array.isArray(session.presignedUrls) ? session.presignedUrls : [];
            const merged = [...latestUrls];
            for (const u of refreshedUrls) {
              const pn = Number(u?.partNumber);
              const existingIndex = merged.findIndex((x) => Number(x?.partNumber) === pn);
              if (existingIndex >= 0) merged[existingIndex] = u;
              else merged.push(u);
            }
            merged.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
            session.presignedUrls = merged;
            urlInfo = merged.find((url) => url.partNumber === partData.partNumber);
          }
        }
      } catch (e) {
        console.warn("[StorageAdapter] signPart 请求签名URL失败（可忽略）:", e?.message || e);
      }
    }

    if (!urlInfo) {
      const available = (Array.isArray(session.presignedUrls) ? session.presignedUrls : [])
        .map((u) => Number(u?.partNumber))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const hint =
        available.length > 0
          ? `当前会话仅有分片: [${available.join(", ")}]。很可能是“Uppy 切片大小”和“后端返回 partSize”不一致。`
          : "当前会话没有任何 presignedUrls。";
      throw new Error(`找不到分片 ${partData.partNumber} 的预签名URL。${hint}`);
    }

    return {
      url: resolveAbsoluteApiUrl(urlInfo.url),
      headers: {
        "Content-Type": "application/octet-stream",
        ...(session?.skipUpload === true ? { "x-cloudpaste-skip-upload": "1" } : {}),
      },
      strategy: "per_part_url",
      partNumber: partData.partNumber,
      fileId: file.id,
      uploadId: session.uploadId,
      key: session.key || null,
    };
  } catch (error) {
    console.error("[StorageAdapter] 签名分片失败:", error);
    throw error;
  }
}

/**
 * 上传分片字节
 * 控制实际的分片上传过程，在这里处理已上传分片的跳过逻辑
 * @param {Object} options {signature, body, onComplete, size, onProgress, signal}
 * @returns {Promise<Object>} {ETag}
 */
export async function uploadPartBytes({ signature, body, onComplete, size, onProgress, signal }) {
  try {
    const { url, headers } = signature;

    // 统一跳过逻辑（用于“对象已存在/秒传”或某些驱动明确要求跳过网络直传）
    const sigHeaders = headers || {};
    const shouldSkip =
      signature?.skipUpload === true ||
      sigHeaders?.["x-cloudpaste-skip-upload"] === "1" ||
      sigHeaders?.["X-CloudPaste-Skip-Upload"] === "1";

    if (shouldSkip) {
      console.log("[StorageAdapter] skipUpload=true，跳过分片 PUT，直接进入 complete 阶段");
      // 单文件预签名：把“本次上传没有 ETag”记回会话，供 commit 阶段兜底使用
      try {
        const fileId = signature && typeof signature.fileId === "string" ? signature.fileId : null;
        if (fileId) {
          const session = this.uploadSessions.get(fileId);
          if (session) session.etag = null;
        }
      } catch {}
      try {
        onProgress?.({ loaded: size, total: size, lengthComputable: true });
      } catch {}
      try {
        onComplete?.(null);
      } catch {}
      return { ETag: null };
    }

    if (!url) {
      throw new Error("Cannot upload to an undefined URL");
    }

    console.log(`[StorageAdapter] uploadPartBytes被调用: ${url}`);

    const isSingleSession = signature && signature.strategy === "single_session";
    const signatureKey =
      signature && typeof signature.key === "string" && signature.key ? String(signature.key) : null;
    const storageKey = signatureKey ? signatureKey.replace(/^\/+/, "") : null;

    // 初始从签名中获取分片编号和文件ID
    let partNumber = signature && typeof signature.partNumber === "number"
      ? signature.partNumber
      : null;
    let fileId = signature && typeof signature.fileId === "string" ? signature.fileId : null;

    // 仅做 partNumber 的兜底解析（某些实现可能没把 partNumber 放进 signature）
    if (partNumber == null) {
      try {
        const urlObject = new URL(url);
        const partNumberRaw = urlObject.searchParams.get("partNumber");
        partNumber =
          partNumberRaw != null && partNumberRaw !== ""
            ? parseInt(partNumberRaw, 10)
            : null;
      } catch {
        // ignore
      }
    }

    if (partNumber != null) {
      console.log(`[StorageAdapter] 🔄 处理分片${partNumber}上传...`);
    }

    // 兜底：如果 signature 没带 fileId，就尝试从 url 反查
    if (!fileId) {
      fileId = this.getFileIdFromUrl(url);
    }

    // per_part_url 的“跳过已上传分片”统一走 PartsLedger
    const sessionForPolicy = fileId ? this.uploadSessions.get(fileId) : null;
    let partsLedger = sessionForPolicy?.partsLedger || null;
    if (!isSingleSession && storageKey) {
      if (!partsLedger) {
        partsLedger = this._createPartsLedger(sessionForPolicy?.policy || null, storageKey);
        try {
          await partsLedger.load?.();
        } catch {}
        if (sessionForPolicy) sessionForPolicy.partsLedger = partsLedger;
      }

      if (partNumber != null && partsLedger?.hasPart?.(partNumber)) {
        const existingPart = partsLedger.getPart(partNumber);
        if (existingPart?.ETag) {
          console.log(
            `[StorageAdapter] ✅ 分片${partNumber}已存在（账本命中），跳过上传 (ETag: ${existingPart.ETag})`,
          );

          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                onProgress(size);
              } catch {}
              try {
                onComplete(existingPart.ETag);
              } catch {}
              resolve({ ETag: existingPart.ETag });
            }, 0);
          });
        }
      }
    }

    // 针对 single_session（OneDrive 等）执行基于会话状态的跳过逻辑
    if (isSingleSession) {
      const session = fileId ? this.uploadSessions.get(fileId) : null;
      if (
        session &&
        typeof session.completedParts === "number" &&
        session.completedParts > 0 &&
        partNumber != null &&
        partNumber <= session.completedParts
      ) {
        console.log(
          `[StorageAdapter] ✅ single_session 分片${partNumber}已完成，跳过上传（逻辑跳过，不发HTTP请求）`,
        );

        // 模拟一个瞬间完成的上传过程，保持与实际上传一致的回调行为
        return new Promise((resolve) => {
          setTimeout(() => {
            try {
              onProgress(size);
            } catch {}
            const etag = `onedrive-part-${partNumber}`;
            try {
              onComplete(etag);
            } catch {}
            resolve({ ETag: etag });
          }, 0);
        });
      }
    }

    // 针对 per_part_url（S3 等）执行“暂停/恢复”逻辑；single_session 模式不会进入该分支
    if (!isSingleSession && storageKey && partNumber != null) {
      // 检查文件是否被自定义暂停（同样仅在 per_part_url 模式下有效）
      const pauseFileId = fileId || this.getFileIdFromUrl(url);
      if (pauseFileId && this.isFilePaused(pauseFileId)) {
        console.log(`[StorageAdapter] ⏸️ 分片${partNumber}被暂停，等待恢复...`);

        // 返回一个等待恢复的Promise
        return new Promise((resolve, reject) => {
          let resumeTimer = null;
          const checkResume = () => {
            if (!this.isFilePaused(pauseFileId)) {
              if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
              }
              console.log(`[StorageAdapter] ▶️ 分片${partNumber}恢复上传`);
              this.uploadPartBytes({
                signature,
                body,
                onComplete,
                size,
                onProgress,
                signal,
              })
                .then(resolve)
                .catch(reject);
              return;
            }
            resumeTimer = setTimeout(checkResume, 100);
          };
          resumeTimer = setTimeout(checkResume, 100);

          if (signal) {
            signal.addEventListener("abort", () => {
              if (resumeTimer) {
                clearTimeout(resumeTimer);
                resumeTimer = null;
              }
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
        });
      }
    }

    const uploadOnce = (uploadUrl) =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);

        if (headers) {
          Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key]);
          });
        }

        xhr.responseType = "text";

        // 处理取消信号
        function onabort() {
          xhr.abort();
        }
        function cleanup() {
          if (signal) {
            signal.removeEventListener("abort", onabort);
          }
        }
        if (signal) {
          signal.addEventListener("abort", onabort);
        }

        xhr.onabort = () => {
          cleanup();
          const err = new DOMException("The operation was aborted", "AbortError");
          reject(err);
        };

        const progressHandler = (evt) => {
          try {
            const loaded = evt?.loaded ?? 0;
            const total = evt?.total ?? size;
            onProgress?.({ loaded, total, lengthComputable: true });
          } catch {}
        };
        xhr.upload.addEventListener("progress", progressHandler);

        xhr.addEventListener("load", (ev) => {
          cleanup();
          const target = ev.target;

          if (target.status < 200 || target.status >= 300) {
            try {
              console.error("[StorageAdapter] uploadPartBytes HTTP error", {
                status: target.status,
                statusText: target.statusText,
                responseText: target.responseText,
              });
            } catch {}

            const error = new Error(`HTTP ${target.status}: ${target.statusText}`);
            error.source = target;
            reject(error);
            return;
          }

          try { onProgress?.({ loaded: size, total: size, lengthComputable: true }); } catch {}

          // 获取 ETag
          let etag = target.getResponseHeader("ETag");

          // 对于 single_session 策略（OneDrive 等），服务器不会返回 ETag 头部，
          // 这里只需要为 Uppy 提供一个占位值即可，后端不会依赖该 ETag 完成合并。
          if (etag === null && isSingleSession) {
            etag = `onedrive-part-${Date.now()}`;
          }

          if (etag === null) {
            reject(
              new Error(
                "Could not read the ETag header. This likely means CORS is not configured correctly.",
              ),
            );
            return;
          }

          // 单文件预签名：把 ETag 写回 uploadSessions，commit 阶段优先取这里
          if (partNumber == null && fileId) {
            try {
              const session = this.uploadSessions.get(fileId);
              if (session) session.etag = etag;
            } catch {}
          }

          // 将成功上传的分片写入 PartsLedger（用于：跳过重复 PUT、complete 时提交完整 parts）
          // - client_keeps：会落盘到 localStorage（带 debounce）
          // - server_can_list：只写内存（避免 S3 双真相源）
          if (!isSingleSession && storageKey && partNumber != null) {
            try {
              partsLedger?.recordPart?.({
                ETag: etag,
                PartNumber: partNumber,
                Size: size,
              });
            } catch {}

            console.log(
              `[StorageAdapter] 🚀 分片${partNumber}上传成功，已写入分片账本 (ETag: ${etag})`,
            );
          }

          try { onComplete(etag); } catch {}
          resolve({ ETag: etag });
        });

        xhr.addEventListener("error", (ev) => {
          cleanup();
          const error = new Error("Upload failed");
          error.source = ev.target;
          reject(error);
        });

        xhr.send(body);
      });

    // 失败策略默认无感重试
    // - 对 per_part_url：遇到“签名过期/403”时，尝试重新签名当前分片并重传
    // - 超过最大重试次数仍失败，则抛出错误交给 Uppy/UI
    const retryMaxAttemptsCandidate =
      sessionForPolicy?.policy?.retryPolicy?.maxAttempts ??
      sessionForPolicy?.policy?.retry_policy?.maxAttempts ??
      null;
    const retryMaxAttemptsParsed = Number(retryMaxAttemptsCandidate);
    const maxAttempts =
      Number.isFinite(retryMaxAttemptsParsed) && retryMaxAttemptsParsed > 0
        ? Math.floor(retryMaxAttemptsParsed)
        : Number(this.config.maxRetries) || 3;

    let lastError = null;
    let currentUrl = url;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (attempt > 1) {
          console.warn(
            `[StorageAdapter] ⚠️ 分片${partNumber ?? "?"}重试上传 attempt=${attempt}/${maxAttempts}`,
          );
        }
        return await uploadOnce(currentUrl);
      } catch (err) {
        lastError = err;

        // AbortError 直接退出，不重试
        if (err?.name === "AbortError") {
          throw err;
        }

        const status = err?.source?.status ?? null;
        const responseText = String(err?.source?.responseText || "");

        // single_session（OneDrive/GoogleDrive/Telegram）：
        if (
          isSingleSession &&
          status === 404 &&
          /upload session was not found|itemNotFound/i.test(responseText)
        ) {
          throw new Error("上传会话已过期（OneDrive 上游返回 404），请重新开始上传");
        }

        const mayBeExpiredSignature =
          !isSingleSession &&
          (status === 401 ||
            status === 403 ||
            (status === 400 && /expired|signature|token|Request has expired/i.test(responseText)));

        // 只有“可能是预签名过期”才尝试重新签名
        if (!mayBeExpiredSignature || attempt >= maxAttempts) {
          throw err;
        }

        // 重新签名当前 partNumber（只对 per_part_url 有意义）
        if (!storageKey || partNumber == null) {
          throw err;
        }

        const uploadIdForSign =
          sessionForPolicy?.uploadId || signature?.uploadId || signature?.upload_id || null;
        if (!uploadIdForSign) {
          throw err;
        }

        try {
          const fsPath = this.buildFullPathFromKey(storageKey);
          const signResp = await fsApi.signMultipartParts(fsPath, uploadIdForSign, [partNumber]);
          const resetUploadedParts = signResp?.success && signResp?.data?.resetUploadedParts === true;
          if (resetUploadedParts) {
            // 服务端明确提示“会话已重置”，说明旧的已上传分片/ETag 已经不可信。
            // 为了避免“无感从头重传导致用户懵”，这里选择：
            // 1) 清空本地缓存（避免误跳过分片导致 complete 失败）
            // 2) 抛出明确错误，交给 UI 提示用户手动重新开始上传
            try {
              partsLedger?.clearInMemory?.();
              partsLedger?.clearPersistent?.();
            } catch {}
            try {
              if (sessionForPolicy) {
                sessionForPolicy.presignedUrls = [];
              }
            } catch {}
            throw new Error("上传链接已过期：服务器已重置上传会话，请重新开始上传");
          }
          const refreshed = signResp?.success ? (signResp?.data?.presignedUrls || []) : [];
          const picked =
            refreshed.find((u) => Number(u?.partNumber) === Number(partNumber)) || refreshed[0] || null;
          const nextUrl = picked?.url ? resolveAbsoluteApiUrl(picked.url) : null;

          if (!nextUrl) {
            throw new Error("重新签名失败：后端未返回新的 presignedUrl");
          }

          // 更新 session 的 presignedUrls 缓存（便于后续分片复用）
          try {
            if (sessionForPolicy && Array.isArray(sessionForPolicy.presignedUrls)) {
              const merged = [...sessionForPolicy.presignedUrls];
              const existingIndex = merged.findIndex((x) => Number(x?.partNumber) === Number(partNumber));
              if (existingIndex >= 0) merged[existingIndex] = picked;
              else merged.push(picked);
              merged.sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
              sessionForPolicy.presignedUrls = merged;
            }
            if (signResp?.data?.policy && sessionForPolicy) {
              sessionForPolicy.policy = signResp.data.policy;
            }
          } catch {}

          currentUrl = nextUrl;
          // 继续下一轮循环重试
          continue;
        } catch (signError) {
          console.warn("[StorageAdapter] 重新签名失败，将抛出原始上传错误:", signError?.message || signError);
          const signMsg = String(signError?.message || "");
          if (signMsg.includes("重置上传会话") || signMsg.includes("重置") || signMsg.includes("重新开始上传")) {
            throw signError;
          }
          throw err;
        }
      }
    }

    // 理论上不会到这里，兜底
    throw lastError || new Error("uploadPartBytes failed");
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn("[StorageAdapter] uploadPartBytes已中断(AbortError):", error);
    } else {
      console.error("[StorageAdapter] uploadPartBytes失败:", error);
    }
    throw error;
  }
}
