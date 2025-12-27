/**
 * FS 路径工具
 *
 * - 系统内部只认 `/` 作为路径分隔符
 * - 反斜杠 `\\` 被视为“分隔符”，会被统一替换为 `/`
 * - 合并重复的 `//`
 * - 根路径固定为 `/`
 * - “视图路径”统一为方案 1：`/a/b`（非根不保留末尾 `/`）
 * - 调用“目录类 API”时，才补尾巴 `/`
 *
 */

/**
 * 规范化“视图路径”
 * @param {unknown} input
 * @returns {string}
 */
export const normalizeFsPath = (input) => {
  const raw = typeof input === "string" ? input : input == null ? "" : String(input);

  // 1) 把 Windows 风格路径分隔符统一成 /
  let p = raw.replace(/\\+/g, "/");

  // 2) 空值兜底
  if (!p) return "/";

  // 3) 确保以 / 开头
  if (!p.startsWith("/")) p = `/${p}`;

  // 4) 合并重复 /
  p = p.replace(/\/{2,}/g, "/");

  // 5) 根路径固定为 /
  if (p === "/") return "/";

  // 6) 非根路径：去掉末尾 /
  p = p.replace(/\/+$/g, "");

  return p || "/";
};

/**
 * 目录 API 路径：在视图路径基础上确保目录以 `/` 结尾
 * @param {unknown} input
 * @returns {string}
 */
export const toDirApiPath = (input) => {
  const normalized = normalizeFsPath(input);
  if (normalized === "/") return "/";
  return `${normalized}/`;
};

/**
 * 判断 target 是否等于 ancestor，或在 ancestor 之下
 * - ancestor 为 `/` 时永远 true
 * @param {unknown} ancestor
 * @param {unknown} target
 * @returns {boolean}
 */
export const isSameOrSubPath = (ancestor, target) => {
  const base = normalizeFsPath(ancestor);
  const cur = normalizeFsPath(target);
  if (base === "/") return true;
  return cur === base || cur.startsWith(`${base}/`);
};

const INVALID_FS_NAME_CHARS = /[\/\\?<>*:|"]/;

/**
 * 校验文件/文件夹“名称”（不是路径）
 * @param {unknown} input
 * @returns {{ valid: true, value: string } | { valid: false, message: string }}
 */
export const validateFsItemName = (input) => {
  const name = typeof input === "string" ? input.trim() : input == null ? "" : String(input).trim();

  if (!name) {
    return { valid: false, message: "EMPTY" };
  }

  if (name === "." || name === "..") {
    return { valid: false, message: "DOTS" };
  }

  if (INVALID_FS_NAME_CHARS.test(name)) {
    return { valid: false, message: "CHARS" };
  }

  return { valid: true, value: name };
};

/**
 * 生成给 InputDialog 用的 validator
 * - InputDialog 约定：validator 返回 true 表示通过；返回 string 表示错误提示
 * - 这里把 validateFsItemName 的错误码映射成 i18n 文案
 *
 * @param {(key: string, params?: any) => string} t
 * @returns {(value: unknown) => true | string}
 */
export const createFsItemNameDialogValidator = (t) => {
  return (value) => {
    const result = validateFsItemName(value);
    if (result.valid) return true;

    const translate = typeof t === "function" ? t : (key) => String(key);
    switch (result.message) {
      case "EMPTY":
        return translate("common.dialogs.invalidNameEmpty");
      case "DOTS":
        return translate("common.dialogs.invalidNameDots");
      case "CHARS":
        return translate("common.dialogs.invalidNameChars");
      default:
        return translate("common.dialogs.invalidInput");
    }
  };
};
