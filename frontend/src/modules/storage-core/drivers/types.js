// Storage driver shared types & helpers
// ------------------------------------------------------------
// This module centralizes the enums and helpers required by
// storage drivers so that the rest of the codebase does not need
// to memorize magic strings when selecting strategies or storage
// types.

export const STORAGE_STRATEGIES = Object.freeze({
  S3_BACKEND_DIRECT: "s3Backend-direct",
  PRESIGNED_SINGLE: "presigned-single",
  PRESIGNED_MULTIPART: "presigned-multipart",
});

export const STORAGE_SOURCES = Object.freeze({
  SHARE: "share",
  FS: "fs",
});

export const DRIVER_TYPES = Object.freeze({
  S3: "S3",
  WEBDAV: "WEBDAV",
  LOCAL: "LOCAL",
});

export const DEFAULT_DRIVER_CAPABILITIES = Object.freeze({
  share: {
    direct: false,
    url: false,
  },
  fs: {
    backendDirect: false,
    presignedSingle: false,
    multipart: false,
  },
});

// 创建驱动能力
export function createCapabilities(overrides = {}) {
  return {
    share: {
      ...DEFAULT_DRIVER_CAPABILITIES.share,
      ...(overrides.share || {}),
    },
    fs: {
      ...DEFAULT_DRIVER_CAPABILITIES.fs,
      ...(overrides.fs || {}),
    },
  };
}


// 驱动解析错误
export class DriverResolutionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DriverResolutionError";
    if (options.code) {
      this.code = options.code;
    }
    if (options.meta) {
      this.meta = options.meta;
    }
  }
}
