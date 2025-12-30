/**
 * 存储驱动能力接口统一导出
 * 模块化能力接口
 */

import { ValidationError } from "../../../http/errors.js";

// 基础驱动接口
export { BaseDriver } from "./BaseDriver.js";

// 能力接口（仅导出检测函数和标识符，具体实现由各驱动提供）
export { isReaderCapable, READER_CAPABILITY } from "./ReaderCapable.js";
export { isWriterCapable, WRITER_CAPABILITY } from "./WriterCapable.js";
export { isDirectLinkCapable, DIRECT_LINK_CAPABILITY } from "./DirectLinkCapable.js";
export { isMultipartCapable, MULTIPART_CAPABILITY } from "./MultipartCapable.js";
export { isAtomicCapable, ATOMIC_CAPABILITY } from "./AtomicCapable.js";
export { isProxyCapable, PROXY_CAPABILITY } from "./ProxyCapable.js";
export { isPagedListCapable, PAGED_LIST_CAPABILITY } from "./PagedListCapable.js";

// 导入检查函数用于内部使用
import { isReaderCapable } from "./ReaderCapable.js";
import { isWriterCapable } from "./WriterCapable.js";
import { isDirectLinkCapable } from "./DirectLinkCapable.js";
import { isMultipartCapable } from "./MultipartCapable.js";
import { isAtomicCapable } from "./AtomicCapable.js";
import { isProxyCapable } from "./ProxyCapable.js";
import { isPagedListCapable } from "./PagedListCapable.js";

/**
 * 所有可用的能力标识符
 */
export const CAPABILITIES = {
  READER: "ReaderCapable",
  WRITER: "WriterCapable",
  DIRECT_LINK: "DirectLinkCapable",
  MULTIPART: "MultipartCapable",
  ATOMIC: "AtomicCapable",
  PROXY: "ProxyCapable",
  PAGED_LIST: "PagedListCapable",
};

/**
 * 所有驱动必须实现的基础契约
 * - StorageFactory 在实例化后会统一校验
 */
export const BASE_REQUIRED_METHODS = ["stat", "exists"];


/**
 * 能力对应的最小方法契约映射表
 * - 该表用于在运行时对驱动进行契约校验（例如 StorageFactory.validateDriverContract）
 * - 每个能力列出的方法名必须在驱动实例上存在且为 function，才视为满足该能力的"最小实现"
 *
 * 约定说明：
 * - READER: 面向所有需要"读取"能力的场景（FS Web / Share / WebDAV 等），必须能够列目录、获取文件信息以及下载文件。
 *   StreamHandle 结构：{ stream: NodeReadable | ReadableStream, close(): Promise<void> }
 * - WRITER: 面向"写入/修改"能力，涵盖上传、建目录、重命名、批量删除/复制等基本操作。
 * - DIRECT_LINK: 最小要求是能够生成下载直链 generateDownloadUrl；
 *   - 对于 S3 等对象存储，通常还会额外实现 generateUploadUrl / generatePresignedUrl，用于预签名上传；
 *   - 对于 WebDAV 等仅支持下载直链的驱动，可以只实现 generateDownloadUrl 即可，不强制要求上传相关方法。
 * - PROXY: 要求实现 generateProxyUrl，返回可供应用层直接 302 或 fetch 的代理 URL。
 * - MULTIPART: 对应前端分片上传生命周期的完整方法集合。
 */
export const REQUIRED_METHODS_BY_CAPABILITY = {
  [CAPABILITIES.READER]: ["listDirectory", "getFileInfo", "downloadFile"],
  [CAPABILITIES.WRITER]: [
    "uploadFile",
    "createDirectory",
    "renameItem",
    "batchRemoveItems",
    "copyItem",
  ],
  /**
   * DIRECT_LINK 能力：
   * - 最小要求：generateDownloadUrl
   * - 扩展能力（可选）：generateUploadUrl / generatePresignedUrl
   *   这些方法通常只在支持预签名上传的驱动（如 S3/R2）上实现；
   *   WebDAV 之类只实现下载直链的驱动，只要提供 generateDownloadUrl 即可通过契约校验。
   */
  [CAPABILITIES.DIRECT_LINK]: ["generateDownloadUrl"],
  [CAPABILITIES.PROXY]: ["generateProxyUrl"],
  [CAPABILITIES.MULTIPART]: [
    "initializeFrontendMultipartUpload",
    "completeFrontendMultipartUpload",
    "abortFrontendMultipartUpload",
    "listMultipartUploads",
    "listMultipartParts",
    "signMultipartParts",
  ],
  /**
   * ATOMIC 能力：
   * - 最小要求：renameItem / copyItem
   * - 这些方法保证原子性操作（重命名、复制）
   */
  [CAPABILITIES.ATOMIC]: ["renameItem", "copyItem"],
  /**
   * PAGED_LIST 能力：
   * - 最小要求：supportsDirectoryPagination()
   * - listDirectory 的分页参数约定由各驱动自行实现（通常通过 options.paged/cursor/limit）
   */
  [CAPABILITIES.PAGED_LIST]: ["supportsDirectoryPagination"],
};


/**
 * 能力检查函数映射
 */
export const CAPABILITY_CHECKERS = {
  [CAPABILITIES.READER]: isReaderCapable,
  [CAPABILITIES.WRITER]: isWriterCapable,
  [CAPABILITIES.DIRECT_LINK]: isDirectLinkCapable,
  [CAPABILITIES.MULTIPART]: isMultipartCapable,
  [CAPABILITIES.ATOMIC]: isAtomicCapable,
  [CAPABILITIES.PROXY]: isProxyCapable,
  [CAPABILITIES.PAGED_LIST]: isPagedListCapable,
};

/**
 * 检查对象是否支持指定能力
 * @param {Object} obj - 要检查的对象
 * @param {string} capability - 能力名称
 * @returns {boolean} 是否支持该能力
 */
export function hasCapability(obj, capability) {
  const checker = CAPABILITY_CHECKERS[capability];
  if (!checker) {
    throw new ValidationError(`未知的能力类型: ${capability}`);
  }
  return checker(obj);
}

/**
 * 获取对象支持的所有能力
 * @param {Object} obj - 要检查的对象
 * @returns {Array<string>} 支持的能力列表
 */
export function getObjectCapabilities(obj) {
  const capabilities = [];

  for (const [capability, checker] of Object.entries(CAPABILITY_CHECKERS)) {
    if (checker(obj)) {
      capabilities.push(capability);
    }
  }

  return capabilities;
}

/**
 * 验证对象是否实现了所需的能力
 * @param {Object} obj - 要验证的对象
 * @param {Array<string>} requiredCapabilities - 所需的能力列表
 * @returns {Object} 验证结果
 */
export function validateCapabilities(obj, requiredCapabilities) {
  const supportedCapabilities = getObjectCapabilities(obj);
  const missingCapabilities = requiredCapabilities.filter((capability) => !supportedCapabilities.includes(capability));

  return {
    isValid: missingCapabilities.length === 0,
    supportedCapabilities,
    missingCapabilities,
    requiredCapabilities,
  };
}

/**
 * 能力接口的混入工具
 * 用于将多个能力接口混入到一个类中
 * @param {Function} BaseClass - 基础类
 * @param {...Function} capabilities - 能力接口类
 * @returns {Function} 混入后的类
 */
export function mixinCapabilities(BaseClass, ...capabilities) {
  class MixedClass extends BaseClass {}

  // 混入所有能力接口的方法
  for (const Capability of capabilities) {
    const proto = Capability.prototype;
    const propertyNames = Object.getOwnPropertyNames(proto);

    for (const name of propertyNames) {
      if (name !== "constructor") {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor) {
          Object.defineProperty(MixedClass.prototype, name, descriptor);
        }
      }
    }
  }

  return MixedClass;
}
