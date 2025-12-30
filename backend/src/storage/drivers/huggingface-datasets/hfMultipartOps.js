/**
 * HuggingFace LFS multipart（分片上传）工具
 *
 *
 * LFS batch 请求里可以声明 transfers: ["basic", "multipart"]
 * 若返回 upload.header.chunk_size，则表示 multipart
 * 每个分片的 PUT URL 放在 upload.header["00001"] ... ["99999"]（key 是数字字符串）
 * upload.href 作为 completionUrl，完成时 POST: { oid, parts: [{ partNumber, etag }, ...] }
 */

import { ApiStatus } from "../../../constants/index.js";
import { DriverError } from "../../../http/errors.js";
import { isCommitSha } from "./hfUtils.js";
import { buildAuthHeaders, buildLfsBatchApiUrl } from "./hfHubApi.js";

function isDigitKey(key) {
  return typeof key === "string" && /^[0-9]+$/.test(key);
}

function normalizeOid(oid) {
  return String(oid || "").trim().toLowerCase();
}

/**
 * 尝试从 S3 预签名 URL 里提取有效期（秒）
 * - 标准字段：X-Amz-Expires
 * @param {string} url
 * @returns {number|null}
 */
export function tryParseAmzExpiresSeconds(url) {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const v = u.searchParams.get("X-Amz-Expires");
    const n = v != null ? Number.parseInt(String(v), 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * 从 HuggingFace 返回的 upload.header 解析 multipart 的分片信息
 * @param {any} header
 * @returns {{ chunkSize: number, presignedUrls: Array<{ partNumber: number, url: string }> }}
 */
export function parseHfMultipartHeader(header) {
  const h = header && typeof header === "object" ? header : {};
  const chunkSizeRaw = h.chunk_size;
  const chunkSize = Number.parseInt(String(chunkSizeRaw || "0"), 10);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new DriverError("HuggingFace multipart 响应缺少有效的 chunk_size", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_INVALID_CHUNK_SIZE",
      expose: true,
      details: { chunk_size: chunkSizeRaw },
    });
  }

  const presignedUrls = Object.keys(h)
    .filter((k) => isDigitKey(k))
    .map((k) => ({
      partNumber: Number.parseInt(k, 10),
      url: h[k] ? String(h[k]) : "",
    }))
    .filter((x) => Number.isFinite(x.partNumber) && x.partNumber > 0 && !!x.url)
    .sort((a, b) => a.partNumber - b.partNumber);

  if (presignedUrls.length === 0) {
    throw new DriverError("HuggingFace multipart 响应缺少分片上传 URL（00001...）", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_PART_URLS",
      expose: true,
    });
  }

  return { chunkSize, presignedUrls };
}

/**
 * HuggingFace 的 Git LFS batch endpoint，获取 “上传指令”
 * basic：返回单个 uploadUrl
 * multipart：返回 chunkSize + presignedUrls + completionUrl
 * alreadyUploaded：不返回 upload action（对象已存在，可跳过上传）
 *
 * @param {any} driver HuggingFaceDatasetsStorageDriver 实例
 * @param {{ oid: string, size: number }} params
 * @returns {Promise<{
 *   mode: "already_uploaded"|"basic"|"multipart",
 *   oid: string,
 *   size: number,
 *   uploadUrl: string|null,
 *   completionUrl: string|null,
 *   partSize: number,
 *   presignedUrls: Array<{partNumber:number, url:string}>,
 * }>}
 */
export async function fetchHfLfsUploadInstructions(driver, { oid, size } = {}) {
  driver._requireWriteEnabled();

  const o = normalizeOid(oid);
  const s = Number(size);
  if (!o) {
    throw new DriverError("HuggingFace 分片上传初始化失败：缺少 sha256（oid）", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
      expose: true,
    });
  }
  if (!Number.isFinite(s) || s < 0) {
    throw new DriverError("HuggingFace 分片上传初始化失败：文件大小无效", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_INVALID_SIZE",
      expose: true,
      details: { size },
    });
  }

  const url = buildLfsBatchApiUrl({
    endpointBase: driver._endpointBase,
    repoDesignation: driver._getHubRepoDesignation(),
  });

  /** @type {any} */
  const payload = {
    operation: "upload",
    transfers: ["basic", "multipart"],
    hash_algo: "sha_256",
    objects: [{ oid: o, size: s }],
  };

  const rev = String(driver._revision || "").trim();
  if (rev && !isCommitSha(rev)) {
    payload.ref = { name: `refs/heads/${rev}` };
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(driver._token, {
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      }),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new DriverError(`HuggingFace LFS batch 请求失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
      details: { url },
    });
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new DriverError("HuggingFace 分片上传初始化失败：没有权限（请检查 token 是否有写入权限）", {
      status: ApiStatus.FORBIDDEN,
      code: "DRIVER_ERROR.HUGGINGFACE_FORBIDDEN",
      expose: true,
      details: { url },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`HuggingFace LFS batch 请求失败: HTTP ${resp.status}`, {
      status: resp.status >= 500 ? ApiStatus.BAD_GATEWAY : resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: resp.status < 500,
      details: { url, response: text?.slice?.(0, 800) || "" },
    });
  }

  /** @type {any} */
  const json = await resp.json().catch(() => ({}));
  const objects = Array.isArray(json?.objects) ? json.objects : [];
  const item = objects.find((x) => String(x?.oid || "") === o) || objects[0] || null;

  if (!item) {
    // 兜底：按“已存在”处理，让上层至少能 commit 登记
    return {
      mode: "already_uploaded",
      oid: o,
      size: s,
      uploadUrl: null,
      completionUrl: null,
      partSize: s,
      presignedUrls: [],
    };
  }

  if (item?.error?.message) {
    const code = Number(item?.error?.code);
    throw new DriverError(`HuggingFace LFS batch 返回错误：${String(item.error.message)}`, {
      status: Number.isFinite(code) && code >= 400 ? code : ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: true,
      details: { lfsError: item.error, oid: o, size: s },
    });
  }

  const upload = item?.actions?.upload || null;
  if (!upload) {
    return {
      mode: "already_uploaded",
      oid: o,
      size: s,
      uploadUrl: null,
      completionUrl: null,
      partSize: s,
      presignedUrls: [],
    };
  }

  const href = upload?.href ? String(upload.href) : "";
  const header = upload?.header && typeof upload.header === "object" ? upload.header : null;

  // multipart：header.chunk_size 存在，且 part urls 在 header["00001"...]
  if (header && header.chunk_size) {
    const { chunkSize, presignedUrls } = parseHfMultipartHeader(header);
    if (!href) {
      throw new DriverError("HuggingFace multipart 响应缺少 completionUrl（actions.upload.href）", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_COMPLETION_URL",
        expose: true,
      });
    }

    // 可选一致性校验（不强拦，只给更清晰的错误）
    const expectedParts = Math.ceil(s / chunkSize);
    if (expectedParts !== presignedUrls.length) {
      throw new DriverError("HuggingFace multipart 响应分片数量不匹配（可能是上游协议变化）", {
        status: ApiStatus.BAD_GATEWAY,
        code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_PARTS_MISMATCH",
        expose: true,
        details: { expectedParts, actualParts: presignedUrls.length, chunkSize, size: s },
      });
    }

    return {
      mode: "multipart",
      oid: o,
      size: s,
      uploadUrl: null,
      completionUrl: href,
      partSize: chunkSize,
      presignedUrls,
    };
  }

  // basic：单个 uploadUrl
  if (!href) {
    throw new DriverError("HuggingFace 预签名上传失败：上游没有返回 uploadUrl", {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_NO_UPLOAD_URL",
      expose: true,
      details: { oid: o, size: s },
    });
  }

  return {
    mode: "basic",
    oid: o,
    size: s,
    uploadUrl: href,
    completionUrl: null,
    partSize: s,
    presignedUrls: [{ partNumber: 1, url: href }],
  };
}

/**
 * 完成 HuggingFace multipart 上传（调用 completionUrl）
 * @param {{ completionUrl: string, oid: string, parts: Array<{partNumber:number, etag:string}> }} params
 */
export async function completeHfLfsMultipartUpload({ completionUrl, oid, parts } = {}) {
  const url = String(completionUrl || "").trim();
  const o = normalizeOid(oid);
  const p = Array.isArray(parts) ? parts : [];

  if (!url) {
    throw new DriverError("HuggingFace multipart 完成失败：缺少 completionUrl", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_COMPLETION_URL",
      expose: true,
    });
  }
  if (!o) {
    throw new DriverError("HuggingFace multipart 完成失败：缺少 oid", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_PRESIGN_MISSING_SHA256",
      expose: true,
    });
  }
  if (p.length === 0) {
    throw new DriverError("HuggingFace multipart 完成失败：缺少 parts", {
      status: ApiStatus.BAD_REQUEST,
      code: "DRIVER_ERROR.HUGGINGFACE_MULTIPART_MISSING_PARTS",
      expose: true,
    });
  }

  const payload = {
    oid: o,
    parts: p.map((x) => ({
      partNumber: Number(x?.partNumber),
      etag: String(x?.etag || ""),
    })),
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new DriverError(`HuggingFace multipart 完成失败：网络错误（${e?.message || "fetch failed"}）`, {
      status: ApiStatus.BAD_GATEWAY,
      code: "DRIVER_ERROR.HUGGINGFACE_UPSTREAM_NETWORK",
      expose: false,
      details: { url },
    });
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new DriverError(`HuggingFace multipart 完成失败: HTTP ${resp.status}`, {
      status: resp.status >= 500 ? ApiStatus.BAD_GATEWAY : resp.status,
      code: "DRIVER_ERROR.HUGGINGFACE_HTTP",
      expose: resp.status < 500,
      details: { url, response: text?.slice?.(0, 800) || "" },
    });
  }

  return await resp.json().catch(() => ({}));
}
