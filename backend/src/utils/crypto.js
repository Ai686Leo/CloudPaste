/**
 * 加密相关工具函数
 */

import { sha256 } from "hono/utils/crypto";
import { ValidationError } from "../http/errors.js";
// 导入Node.js的crypto模块以解决ESM环境中的引用错误
import crypto from "crypto";
// 为Node.js环境提供Web Crypto API的兼容层
import { webcrypto } from "crypto";
// 如果环境中没有全局crypto对象，将webcrypto赋值给全局
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

/**
 * base64 编码工具（兼容 Node / 浏览器 / Workers）
 */
const base64EncodeBytes = (bytes) => {
  // Node 环境：优先用 Buffer，稳定且性能好
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  // Web/Worker 环境：把 bytes 转成二进制字符串，再 btoa
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64DecodeToBytes = (base64) => {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(String(base64), "base64"));
  }

  const bin = atob(String(base64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

const base64EncodeUtf8 = (text) => {
  const encoder = new TextEncoder();
  return base64EncodeBytes(encoder.encode(String(text)));
};

const base64DecodeUtf8 = (base64) => {
  const decoder = new TextDecoder("utf-8");
  const bytes = base64DecodeToBytes(base64);
  return decoder.decode(bytes);
};

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
  const signatureB64 = base64EncodeBytes(new Uint8Array(signature));
  const payloadB64 = base64EncodeUtf8(value);
  const encryptedValue = `encrypted:${signatureB64}:${payloadB64}`;

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
    throw new ValidationError("无效的加密格式");
  }

  try {
    // 直接从加密值中提取原始值
    const originalValue = base64DecodeUtf8(parts[2]);
    return originalValue;
  } catch (error) {
    throw new ValidationError("解密失败: " + error.message);
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
 * @returns {Promise<object>} 带密钥字段处理后的对象
 */
export async function buildSecretView(cfg, encryptionSecret, options = { mode: "none" }) {
  const mode = options.mode || "none";
  const result = { ...cfg };

  // 统一的 secret 字段集合
  // - S3: access_key_id / secret_access_key
  // - WebDAV: password
  // - OneDrive/GoogleDrive: client_secret / refresh_token
  // - Telegram: bot_token
  // - GitHub: token
  // - HuggingFace: hf_token
  const SECRET_FIELDS = [
    "access_key_id",
    "secret_access_key",
    "password",
    "client_secret",
    "refresh_token",
    "bot_token",
    "token",
    "hf_token",
  ];

  if (mode === "none") {
    for (const key of SECRET_FIELDS) {
      delete result[key];
    }
    return result;
  }
  if (mode === "masked") {
    for (const key of SECRET_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      result[key] = maskSecret(await decryptIfNeeded(cfg[key], encryptionSecret));
    }
    return result;
  }
  if (mode === "plain") {
    for (const key of SECRET_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      result[key] = await decryptIfNeeded(cfg[key], encryptionSecret);
    }
    return result;
  }
  return result;
}
