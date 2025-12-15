/**
 * 路径处理工具
 * 提供基础的路径规范化功能
 */

/**
 * 规范化路径格式
 * @param {string} path - 输入路径
 * @param {boolean} isDirectory - 是否为目录路径
 * @returns {string} 规范化的路径
 */
export function normalizePath(path, isDirectory = false) {
  // 确保路径以斜杠开始
  path = path.startsWith("/") ? path : "/" + path;
  // 如果是目录，确保路径以斜杠结束
  if (isDirectory) {
    path = path.endsWith("/") ? path : path + "/";
  }
  return path;
}

/**
 * 判断 FS 视图路径是否表示目录
 * 约定：以斜杠结尾的路径视为目录（包括根路径）
 * @param {string} path - FS 视图路径
 * @returns {boolean}
 */
export function isDirectoryPath(path) {
  return typeof path === "string" && path.endsWith("/");
}

/**
 * 判断目标路径是否为源路径本身或其子路径
 * - 统一处理 / 与 \\ 分隔符，并去除首尾多余分隔符
 * - 仅用于逻辑判断，不访问底层存储
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isSelfOrSubPath(sourcePath, targetPath) {
  const normalize = (p) =>
    (p || "")
      .replace(/^[/\\]+|[/\\]+$/g, "")
      .replace(/[\\\/]+/g, "/");

  const srcNorm = normalize(sourcePath);
  const dstNorm = normalize(targetPath);

  if (!srcNorm) return false;
  return dstNorm === srcNorm || (dstNorm && dstNorm.startsWith(`${srcNorm}/`));
}
