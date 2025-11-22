/**
 * FS Meta 元信息服务
 */
import { get, post, put, del } from "../client.js";

/**
 * 获取所有元信息记录
 * @returns {Promise<Array>}
 */
export async function getAllFsMeta() {
  return await get("/fs-meta/list");
}

/**
 * 获取单个元信息记录
 * @param {number} id
 * @returns {Promise<Object>}
 */
export async function getFsMetaById(id) {
  return await get(`/fs-meta/${id}`);
}

/**
 * 创建元信息记录
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export async function createFsMeta(data) {
  return await post("/fs-meta/create", data);
}

/**
 * 更新元信息记录
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<void>}
 */
export async function updateFsMeta(id, data) {
  return await put(`/fs-meta/${id}`, data);
}

/**
 * 删除元信息记录
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteFsMeta(id) {
  return await del(`/fs-meta/${id}`);
}

/**
 * 验证路径密码
 * @param {string} path - 目录路径
 * @param {string} password - 密码
 * @returns {Promise<{verified: boolean, token?: string, message: string}>}
 */
export async function verifyFsMetaPassword(path, password) {
  const response = await post("/fs/meta/password/verify", { path, password });

  if (response && typeof response === "object" && "data" in response) {
    const data = /** @type {{ verified: boolean; token?: string|null; requiresPassword?: boolean; path?: string }} */ (
      response.data
    );
    return {
      verified: Boolean(data.verified),
      token: data.token ?? null,
      requiresPassword: data.requiresPassword ?? Boolean(data.token),
      path: data.path ?? path,
      message: response.message || "密码验证成功",
    };
  }

  // 兼容旧格式，直接返回原始响应
  return response;
}
