/**
 * FS 搜索游标工具（cursor/keyset pagination）
 *
 * - token 对前端保持不透明（base64url(JSON)）
 * - 游标携带“稳定排序键”用于 seek 分页，避免 offset 深页性能灾难
 * - 游标携带必要的筛选参数用于一致性校验
 */

function base64UrlEncode(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  // Node 环境（Docker）
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64url");
  }
  // Workers 环境
  const encoded = btoa(unescape(encodeURIComponent(text)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  if (!input) return null;
  // Node 环境（Docker）
  if (typeof Buffer !== "undefined") {
    try {
      return Buffer.from(String(input), "base64url").toString("utf8");
    } catch {
      return null;
    }
  }
  // Workers 环境
  try {
    const padded = String(input).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded);
    return decodeURIComponent(
      Array.prototype.map
        .call(bin, (c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   modifiedMs:number,
 *   fsPath:string,
 *   id:number,
 *   q:string,
 *   scope:"global"|"mount"|"directory",
 *   mountId?:string,
 *   pathPrefix?:string|null
 * }} cursor
 */
export function encodeSearchCursor(cursor) {
  const payload = {
    v: 1,
    modifiedMs: Number(cursor?.modifiedMs) || 0,
    fsPath: String(cursor?.fsPath || ""),
    id: Number(cursor?.id) || 0,
    q: String(cursor?.q || ""),
    scope: cursor?.scope || "global",
    mountId: String(cursor?.mountId || ""),
    pathPrefix: cursor?.pathPrefix ? String(cursor.pathPrefix) : "",
  };
  return base64UrlEncode(payload);
}

/**
 * @param {string|null|undefined} token
 * @returns {null | {
 *   modifiedMs:number,
 *   fsPath:string,
 *   id:number,
 *   q:string,
 *   scope:"global"|"mount"|"directory",
 *   mountId:string,
 *   pathPrefix:string
 * }}
 */
export function decodeSearchCursor(token) {
  if (!token) return null;
  try {
    const raw = base64UrlDecode(token);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return null;

    const modifiedMs = Number(parsed.modifiedMs);
    const fsPath = String(parsed.fsPath || "");
    const id = Number(parsed.id);
    const q = String(parsed.q || "");
    const scope = parsed.scope;
    const mountId = String(parsed.mountId || "");
    const pathPrefix = String(parsed.pathPrefix || "");

    if (!Number.isFinite(modifiedMs) || !Number.isFinite(id)) return null;
    if (!fsPath) return null;
    if (!q) return null;
    if (scope !== "global" && scope !== "mount" && scope !== "directory") return null;
    return { modifiedMs, fsPath, id, q, scope, mountId, pathPrefix };
  } catch {
    return null;
  }
}

