/**
 * StorageStreaming 工具函数
 * - Range 解析
 * - 条件请求评估
 * - 响应头构造
 * - 错误映射
 */

import { ApiStatus } from "../../constants/index.js";

/**
 * 解析 HTTP Range 头
 * @param {string | null} rangeHeader - Range 头值（如 "bytes=0-1023"）
 * @param {number | null} fileSize - 文件总大小（可为 null，此时无法计算后缀范围和满足性）
 * @returns {{ start: number, end: number, isValid: boolean, isSatisfiable: boolean, unknownSize?: boolean } | null}
 */
export function parseRangeHeader(rangeHeader, fileSize) {
  // 没有 Range 头，返回 null
  if (!rangeHeader) {
    return null;
  }

  // 说明：当前函数只解析 single-range（例如 bytes=0-1023 / bytes=500- / bytes=-500）。
  // multi-range（例如 bytes=0-99,200-299）由上层（StorageStreaming）单独处理。
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return { start: 0, end: 0, isValid: false, isSatisfiable: false };
  }

  const [, startStr, endStr] = match;
  let start, end;

  // 文件大小未知的情况（WebDAV HEAD 可能不返回 Content-Length）
  const sizeUnknown = fileSize === null || fileSize <= 0;

  if (startStr === "" && endStr !== "") {
    // 后缀范围：bytes=-500 表示最后 500 字节
    // 需要知道文件大小才能计算
    if (sizeUnknown) {
      // 无法计算后缀范围，但语法有效
      return { start: 0, end: 0, isValid: true, isSatisfiable: false, unknownSize: true };
    }
    const suffixLength = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // 开放范围：bytes=500- 表示从 500 到末尾
    start = parseInt(startStr, 10);
    if (sizeUnknown) {
      // 文件大小未知，无法确定 end，但可以尝试请求
      // 标记为 unknownSize，让上层决定如何处理
      return { start, end: Infinity, isValid: true, isSatisfiable: true, unknownSize: true };
    }
    end = fileSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    // 完整范围：bytes=0-1023
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (!sizeUnknown) {
      end = Math.min(end, fileSize - 1);
    }
  } else {
    return { start: 0, end: 0, isValid: false, isSatisfiable: false };
  }

  // 基本语法检查
  if (start > end && end !== Infinity) {
    return { start, end, isValid: true, isSatisfiable: false, unknownSize: sizeUnknown };
  }

  // 如果知道文件大小，检查范围是否可满足
  if (!sizeUnknown && start >= fileSize) {
    return { start, end, isValid: true, isSatisfiable: false };
  }

  return { start, end, isValid: true, isSatisfiable: true, unknownSize: sizeUnknown };
}

/**
 * 解析 HTTP Multi-Range（多段 Range）头
 * - 仅支持 bytes=... 形式
 * - 需要 fileSize 已知（否则无法计算后缀范围/满足性）
 *
 * @param {string|null} rangeHeader
 * @param {number|null} fileSize
 * @returns {{ ranges: Array<{ start: number, end: number }>, isValid: boolean, hasNoOverlap: boolean } | null}
 */
export function parseMultiRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) return null;
  if (!String(rangeHeader).startsWith("bytes=")) return { ranges: [], isValid: false, hasNoOverlap: false };

  const sizeUnknown = fileSize === null || fileSize <= 0;
  if (sizeUnknown) {
    // size 未知无法可靠解析 multi-range（尤其是 suffix-range）
    return { ranges: [], isValid: true, hasNoOverlap: false };
  }

  const spec = String(rangeHeader).slice("bytes=".length);
  const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { ranges: [], isValid: false, hasNoOverlap: false };
  }

  /** @type {Array<{start:number,end:number}>} */
  const ranges = [];
  let noOverlap = false;

  for (const part of parts) {
    const [startRaw, endRaw, extra] = part.split("-");
    if (extra !== undefined) {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }
    const startStr = (startRaw ?? "").trim();
    const endStr = (endRaw ?? "").trim();
    if (startStr === "" && endStr === "") {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }

    // suffix-range: bytes=-500
    if (startStr === "") {
      if (endStr.startsWith("-")) return { ranges: [], isValid: false, hasNoOverlap: false };
      const suffixLength = parseInt(endStr, 10);
      if (!Number.isFinite(suffixLength) || suffixLength < 0) {
        return { ranges: [], isValid: false, hasNoOverlap: false };
      }
      const n = Math.min(suffixLength, fileSize);
      const start = Math.max(0, fileSize - n);
      const end = fileSize - 1;
      ranges.push({ start, end });
      continue;
    }

    // start-end or start-
    const start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) {
      return { ranges: [], isValid: false, hasNoOverlap: false };
    }
    if (start >= fileSize) {
      noOverlap = true;
      continue;
    }

    let end;
    if (endStr === "") {
      end = fileSize - 1;
    } else {
      end = parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) {
        return { ranges: [], isValid: false, hasNoOverlap: false };
      }
      end = Math.min(end, fileSize - 1);
    }

    ranges.push({ start, end });
  }

  return { ranges, isValid: true, hasNoOverlap: noOverlap && ranges.length === 0 };
}

/**
 * If-Range 语义：
 * - 若 If-Range 与当前资源的 ETag/Last-Modified 不匹配 → 必须忽略 Range（返回 200 全量），避免客户端拼接错乱/花屏。
 * - 若匹配 → 才允许继续按 Range 返回 206。
 *
 * @param {Request|null} request
 * @param {string|null} etag
 * @param {Date|null} lastModified
 * @returns {boolean} true 表示应忽略 Range
 */
export function shouldIgnoreRangeForIfRange(request, etag, lastModified) {
  if (!request) return false;
  const ifRange = request.headers?.get?.("if-range");
  if (!ifRange) return false;

  // 1) ETag 形式（W/"..." 或 "..."）
  const trimmed = String(ifRange).trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("W/\"")) {
    if (!etag) return true;
    const a = String(etag).trim().replace(/^W\//, "");
    const b = trimmed.replace(/^W\//, "");
    return a !== b;
  }

  // 2) HTTP-date 形式
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) {
    // 无法解析，保守处理：忽略 Range
    return true;
  }
  if (!lastModified) return true;
  // 资源最后修改时间 <= If-Range 时间 → 认为未变化，允许 Range；否则忽略 Range
  return lastModified > date;
}

/**
 * 评估条件请求头
 * @param {Request | null} request - HTTP 请求
 * @param {string | null} etag - 资源 ETag
 * @param {Date | null} lastModified - 资源最后修改时间
 * @returns {{ shouldReturn304: boolean, shouldReturn412: boolean }}
 */
export function evaluateConditionalHeaders(request, etag, lastModified) {
  if (!request) {
    return { shouldReturn304: false, shouldReturn412: false };
  }

  const ifNoneMatch = request.headers?.get?.("if-none-match");
  const ifMatch = request.headers?.get?.("if-match");
  const ifModifiedSince = request.headers?.get?.("if-modified-since");
  const ifUnmodifiedSince = request.headers?.get?.("if-unmodified-since");

  // If-None-Match: 如果 ETag 匹配，返回 304
  if (ifNoneMatch && etag) {
    const tags = ifNoneMatch.split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (tags.includes("*") || tags.includes(etag.replace(/^W\//, ""))) {
      return { shouldReturn304: true, shouldReturn412: false };
    }
  }

  // If-Match: 如果 ETag 不匹配，返回 412
  if (ifMatch && etag) {
    const tags = ifMatch.split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (!tags.includes("*") && !tags.includes(etag.replace(/^W\//, ""))) {
      return { shouldReturn304: false, shouldReturn412: true };
    }
  }

  // If-Modified-Since: 如果未修改，返回 304
  if (ifModifiedSince && lastModified) {
    const ifModifiedDate = new Date(ifModifiedSince);
    if (!isNaN(ifModifiedDate.getTime()) && lastModified <= ifModifiedDate) {
      return { shouldReturn304: true, shouldReturn412: false };
    }
  }

  // If-Unmodified-Since: 如果已修改，返回 412
  if (ifUnmodifiedSince && lastModified) {
    const ifUnmodifiedDate = new Date(ifUnmodifiedSince);
    if (!isNaN(ifUnmodifiedDate.getTime()) && lastModified > ifUnmodifiedDate) {
      return { shouldReturn304: false, shouldReturn412: true };
    }
  }

  return { shouldReturn304: false, shouldReturn412: false };
}

/**
 * 构建响应头
 * @param {import('./types.js').StorageStreamDescriptor} descriptor - 流描述对象
 * @param {{ start: number, end: number } | null} range - 范围（如果是 206 响应）
 * @param {import('./types.js').StreamingChannel} channel - 访问通道
 * @returns {Headers}
 */
export function buildResponseHeaders(descriptor, range, channel) {
  const headers = new Headers();

  // Content-Type
  if (descriptor.contentType) {
    headers.set("Content-Type", descriptor.contentType);
  } else {
    headers.set("Content-Type", "application/octet-stream");
  }

  // Content-Length
  if (range && descriptor.size !== null) {
    const contentLength = range.end - range.start + 1;
    headers.set("Content-Length", String(contentLength));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${descriptor.size}`);
  } else if (descriptor.size !== null) {
    headers.set("Content-Length", String(descriptor.size));
  }

  // Accept-Ranges
  headers.set("Accept-Ranges", "bytes");

  // ETag
  if (descriptor.etag) {
    headers.set("ETag", descriptor.etag);
  }

  // Last-Modified
  if (descriptor.lastModified) {
    headers.set("Last-Modified", descriptor.lastModified.toUTCString());
  }

  // Cache-Control（按 channel 设置）
  switch (channel) {
    case "fs-web":
    case "webdav":
      headers.set("Cache-Control", "private, no-cache");
      break;
    case "proxy":
    case "share":
      headers.set("Cache-Control", "public, max-age=3600");
      break;
    default:
      // internal channels: no cache headers
      break;
  }

  return headers;
}

/**
 * 将驱动错误映射到 HTTP 状态码
 * @param {Error} error - 驱动错误
 * @returns {{ status: number, message: string }}
 */
export function mapDriverErrorToHttpStatus(error) {
  // 某些驱动错误的 code 可能不是字符串（例如对象/数字），这里统一转为字符串避免运行时报错
  const rawCode = error?.code;
  const code = typeof rawCode === "string" ? rawCode : String(rawCode ?? "");
  const status = error?.status || ApiStatus.INTERNAL_ERROR;

  if (code.includes("NOT_FOUND") || status === ApiStatus.NOT_FOUND) {
    return { status: ApiStatus.NOT_FOUND, message: "文件不存在" };
  }

  if (code.includes("FORBIDDEN") || status === ApiStatus.FORBIDDEN) {
    return { status: ApiStatus.FORBIDDEN, message: "访问被拒绝" };
  }

  if (code.includes("STREAM_CLOSED")) {
    return { status: ApiStatus.INTERNAL_ERROR, message: "流已关闭" };
  }

  return { status: ApiStatus.INTERNAL_ERROR, message: error?.message || "内部错误" };
}
