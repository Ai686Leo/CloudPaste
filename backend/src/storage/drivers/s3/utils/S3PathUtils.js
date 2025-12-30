import path from "node:path";

/**
 * S3路径处理工具
 * 提供S3存储驱动专用的路径规范化功能
 */

/**
 * 规范化S3子路径
 * @param {string} subPath - 子路径
 * @param {boolean} asDirectory - 是否作为目录处理
 * @returns {string} 规范化的S3子路径
 */
export function normalizeS3SubPath(subPath, asDirectory = false) {
  // 规范化S3子路径，移除开头的斜杠
  const __raw = subPath == null ? "" : String(subPath);
  let s3SubPath = __raw.startsWith("/") ? __raw.substring(1) : __raw;

  // 如果路径为空，设置为根路径
  if (!s3SubPath) {
    s3SubPath = "";
  }

  // 规范化S3子路径，移除多余的斜杠
  s3SubPath = s3SubPath.replace(/\/+/g, "/");

  // 如果作为目录处理，确保路径以斜杠结尾
  if (asDirectory && s3SubPath !== "" && !s3SubPath.endsWith("/")) {
    s3SubPath += "/";
  }

  // 注意：root_prefix在调用时单独处理，避免重复添加
  // 在getS3DirectoryListing中会将s3SubPath与root_prefix组合

  return s3SubPath;
}

/**
 * 智能检查路径是否已经是完整的文件路径
 * @param {string} s3SubPath - S3子路径
 * @param {string} originalFileName - 原始文件名
 * @returns {boolean} 是否为完整文件路径
 */
export function isCompleteFilePath(s3SubPath, originalFileName) {
  if (!s3SubPath || !originalFileName) return false;

  const pathInfo = path.parse(s3SubPath);
  const originalInfo = path.parse(originalFileName);

  // 检查是否有文件扩展名（区分文件和目录）
  if (!pathInfo.ext) {
    // 无扩展名情况：检查是否为原始文件名或带随机后缀的版本
    return pathInfo.base === originalFileName || pathInfo.base.startsWith(originalFileName + "-");
  }

  // 有扩展名情况：检查扩展名匹配 + 文件名模式
  if (pathInfo.ext === originalInfo.ext) {
    // 检查文件名是否匹配或者是带随机后缀的版本（如 black-abc123）
    return pathInfo.name === originalInfo.name || pathInfo.name.startsWith(originalInfo.name + "-");
  }

  return false;
}

/**
 * 组合 S3 对象 Key（目录前缀 + 文件名）。
 * - 兼容：subPath 可能已经是完整文件路径（例如 share upload / ObjectStore 等场景）
 * - 兼容：subPath 可能带前导 /（统一去掉，保持 AWS SDK Key 习惯）
 * @param {string} s3SubPath
 * @param {string} originalFileName
 * @returns {string}
 */
export function resolveS3ObjectKey(s3SubPath, originalFileName) {
  const raw = s3SubPath == null ? "" : String(s3SubPath);
  let base = raw.startsWith("/") ? raw.slice(1) : raw;
  base = base.replace(/\/+/g, "/");

  const safeNameRaw = originalFileName == null ? "" : String(originalFileName);
  const safeName = safeNameRaw.replace(/^\/+/, "");
  if (!safeName) return base;

  if (base && isCompleteFilePath(base, safeName)) {
    return base;
  }
  if (base && !base.endsWith("/")) {
    return `${base}/${safeName}`;
  }
  return `${base || ""}${safeName}`;
}

/**
 * 检查S3子路径是否为挂载点根目录（空字符串）
 * @param {string} s3SubPath - S3子路径
 * @returns {boolean} 是否为挂载点根目录
 */
export function isMountRootPath(s3SubPath) {
  return !s3SubPath || s3SubPath.trim() === "";
}

/**
 * 规范化 S3 的 root_prefix
 * - 去掉前导 /
 * - 合并重复 /
 * - 非空时确保以 / 结尾
 * @param {unknown} rootPrefix
 * @returns {string}
 */
export function normalizeS3RootPrefix(rootPrefix) {
  const raw = String(rootPrefix || "").trim();
  if (!raw) return "";
  let p = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return "";
  return p.endsWith("/") ? p : `${p}/`;
}

/**
 * 把“挂载内的相对路径”映射到“真实 S3 Key”（包含 root_prefix）
 * - 如果 key 已经包含 root_prefix，则不重复添加
 * - 兼容 key 为空（代表挂载根目录）
 * @param {Object} s3ConfigOrDriverConfig
 * @param {string} key
 * @returns {string}
 */
export function applyS3RootPrefix(s3ConfigOrDriverConfig, key) {
  const prefix = normalizeS3RootPrefix(s3ConfigOrDriverConfig?.root_prefix);
  const raw = key == null ? "" : String(key);
  const normalizedKey = raw.replace(/\\+/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");

  if (!prefix) return normalizedKey;
  if (!normalizedKey) return prefix;
  if (normalizedKey.startsWith(prefix)) return normalizedKey;
  return `${prefix}${normalizedKey}`.replace(/\/+/g, "/");
}
