/**
 * 加密相关工具函数
 */

import { sha256 } from "hono/utils/crypto";
// 导入Node.js的crypto模块以解决ESM环境中的引用错误
import crypto from "crypto";
// 为Node.js环境提供Web Crypto API的兼容层
import { webcrypto } from "crypto";
// 如果环境中没有全局crypto对象，将webcrypto赋值给全局
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

/**
 * 生成密码哈希
 * @param {string} password - 原始密码
 * @returns {Promise<string>} 密码哈希
 */
export async function hashPassword(password) {
  // 使用SHA-256哈希
  return await sha256(password);
}

/**
 * 验证密码
 * @param {string} plainPassword - 原始密码
 * @param {string} hashedPassword - 哈希后的密码
 * @returns {Promise<boolean>} 验证结果
 */
export async function verifyPassword(plainPassword, hashedPassword) {
  // 如果是SHA-256哈希（用于初始管理员密码）
  if (hashedPassword.length === 64) {
    const hashedInput = await sha256(plainPassword);
    return hashedInput === hashedPassword;
  }

  // 默认比较
  return plainPassword === hashedPassword;
}

/**
 * 加密敏感配置
 * @param {string} value - 需要加密的值
 * @param {string} secret - 加密密钥
 * @returns {Promise<string>} 加密后的值
 */
export async function encryptValue(value, secret) {
  // 简单的加密方式
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const secretKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const signature = await crypto.subtle.sign("HMAC", secretKey, data);
  const encryptedValue = "encrypted:" + btoa(String.fromCharCode(...new Uint8Array(signature))) + ":" + btoa(value);

  return encryptedValue;
}

/**
 * 解密敏感配置
 * @param {string} encryptedValue - 加密后的值
 * @param {string} secret - 加密密钥
 * @returns {Promise<string>} 解密后的值
 */
export async function decryptValue(encryptedValue, secret) {
  // 检查是否为加密值
  if (encryptedValue === undefined || encryptedValue === null) {
    // 容错：未提供值时按原样返回，避免空值触发运行时错误
    return encryptedValue;
  }
  if (typeof encryptedValue !== "string") {
    // 非字符串直接返回（保持向后兼容，不在此抛错）
    return encryptedValue;
  }
  if (!encryptedValue.startsWith("encrypted:")) {
    return encryptedValue; // 未加密的值直接返回
  }

  // 从加密格式中提取值
  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    throw new Error("无效的加密格式");
  }

  try {
    // 直接从加密值中提取原始值
    const originalValue = atob(parts[2]);
    return originalValue;
  } catch (error) {
    throw new Error("解密失败: " + error.message);
  }
}

/**
 * 对密钥进行掩码展示
 * @param {string|null|undefined} secret
 * @param {number} visibleTail 显示尾部多少位
 * @returns {string|null|undefined}
 */
export function maskSecret(secret, visibleTail = 4) {
  if (!secret || typeof secret !== "string") return secret;
  if (secret.length <= visibleTail) return "*".repeat(Math.max(0, secret.length));
  return "*".repeat(secret.length - visibleTail) + secret.slice(-visibleTail);
}

/**
 * 如是加密格式则解密，否则直返原值（兼容历史明文）
 * @param {string|null|undefined} value
 * @param {string} encryptionSecret
 * @returns {Promise<string|null|undefined>}
 */
export async function decryptIfNeeded(value, encryptionSecret) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  return await decryptValue(value, encryptionSecret);
}

/**
 * 生成前端可控的密钥展示对象
 * @param {object} cfg 原始配置对象（包含密钥字段）
 * @param {string} encryptionSecret
 * @param {{mode:'none'|'masked'|'plain'}} options
 * @returns {Promise<object>} 带 access_key_id/secret_access_key 处理后的对象
 */
export async function buildSecretView(cfg, encryptionSecret, options = { mode: "none" }) {
  const mode = options.mode || "none";
  const result = { ...cfg };
  if (mode === "none") {
    delete result.access_key_id;
    delete result.secret_access_key;
    return result;
  }
  if (mode === "masked") {
    result.access_key_id = maskSecret(await decryptIfNeeded(cfg.access_key_id, encryptionSecret));
    result.secret_access_key = maskSecret(await decryptIfNeeded(cfg.secret_access_key, encryptionSecret));
    return result;
  }
  if (mode === "plain") {
    result.access_key_id = await decryptIfNeeded(cfg.access_key_id, encryptionSecret);
    result.secret_access_key = await decryptIfNeeded(cfg.secret_access_key, encryptionSecret);
    return result;
  }
  return result;
}
