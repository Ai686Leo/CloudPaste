/**
 * FS 输入校验工具
 *
 */

const INVALID_FILENAME_CHARS = /[\/\\?<>*:|"]/;

/**
 * 规范化 FS 视图路径（用于比较/拆分，不直接用于存储访问）
 * - 把 \\ 视为分隔符，统一换成 /
 * - 合并重复 /
 * - 确保以 / 开头
 * - 非根去掉末尾 /
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeFsViewPath(input) {
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);
  let p = raw.replace(/\\+/g, "/");
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p === "/") return "/";
  p = p.replace(/\/+$/g, "");
  return p || "/";
}

/**
 * 获取路径的父目录（返回值以 / 结尾，根目录返回 /）
 * @param {string} input
 * @returns {string}
 */
export function getParentDir(input) {
  const p = normalizeFsViewPath(input);
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx + 1);
}

/**
 * 获取路径最后一段名称（basename）
 * @param {string} input
 * @returns {string}
 */
export function getBasename(input) {
  const p = normalizeFsViewPath(input);
  if (p === "/") return "";
  return p.slice(p.lastIndexOf("/") + 1);
}

/**
 * 校验“文件/目录名称”是否合法（不是路径）
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateFsItemName(input) {
  const name = typeof input === "string" ? input.trim() : input == null ? "" : String(input).trim();

  if (!name) {
    return { valid: false, message: "名称不能为空" };
  }

  if (name === "." || name === "..") {
    return { valid: false, message: "名称不能是 . 或 .." };
  }

  if (INVALID_FILENAME_CHARS.test(name)) {
    return { valid: false, message: "名称包含非法字符（/ \\\\ ? < > * : | \")" };
  }

  return { valid: true, value: name };
}

/**
 * 校验重命名：必须在同一目录内修改最后一段名称
 * @param {unknown} oldPath
 * @param {unknown} newPath
 * @returns {{ valid: true } | { valid: false, message: string }}
 */
export function validateRenameSameDirectory(oldPath, newPath) {
  const oldParent = getParentDir(oldPath);
  const newParent = getParentDir(newPath);

  if (oldParent !== newParent) {
    return {
      valid: false,
      message: "重命名只允许修改名称，不支持输入路径层级（包含 / 或 \\\\ 会被当成目录分隔符）",
    };
  }

  const newName = getBasename(newPath);
  const nameValidation = validateFsItemName(newName);
  if (!nameValidation.valid) {
    return nameValidation;
  }

  return { valid: true };
}

/**
 * 校验目录路径：逐段检查每个 segment 是否为合法 name
 * - 允许多级目录（例如 /a/b/c/）
 * - 只要某一段 name 不合法，就返回失败
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export function validateDirectoryPathSegments(input) {
  const normalized = normalizeFsViewPath(input);
  if (normalized === "/") return { valid: true, value: "/" };

  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    const r = validateFsItemName(segment);
    if (!r.valid) return r;
  }
  return { valid: true, value: normalized };
}
