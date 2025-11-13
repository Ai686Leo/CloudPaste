/**
 * 存储配置服务API（通用命名）
 */
import { get, post, put, del } from "../client";

// 通用：获取存储配置（支持分页）
export function getStorageConfigs(params = {}) {
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());
  const queryString = queryParams.toString();
  return get(`/storage${queryString ? `?${queryString}` : ""}`);
}

// 通用：获取单个存储配置
export function getStorageConfig(id) {
  return get(`/storage/${id}`);
}

// 通用：获取单个存储配置（受控揭示密钥：masked/plain）
export function getStorageConfigReveal(id, mode = "masked") {
  const q = mode === "plain" ? "plain" : "masked";
  return get(`/storage/${id}?reveal=${q}`);
}

// 通用：创建存储配置
export function createStorageConfig(config) {
  return post("/storage", config);
}

// 通用：更新存储配置
export function updateStorageConfig(id, config) {
  return put(`/storage/${id}`, config);
}

// 通用：删除存储配置
export function deleteStorageConfig(id) {
  return del(`/storage/${id}`);
}

// 通用：设置默认存储配置
export function setDefaultStorageConfig(id) {
  return put(`/storage/${id}/set-default`);
}

// 通用：测试存储配置
export function testStorageConfig(id) {
  return post(`/storage/${id}/test`);
}
