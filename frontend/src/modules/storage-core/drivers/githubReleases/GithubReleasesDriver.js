import { createCapabilities } from "../types.js";

/**
 * GITHUB_RELEASES 存储驱动
 *
 * - GitHub Releases 在后端是“只读渠道”（主要用于挂载浏览/下载）
 * - 提供任何上传能力，避免误操作
 */
export class GithubReleasesDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        backendStream: false,
        backendForm: false,
        presigned: false,
        url: false,
      },
      fs: {
        backendStream: false,
        backendForm: false,
        presignedSingle: false,
        multipart: false,
      },
    });

    const readonlyError = () => {
      throw new Error("GitHub Releases 是只读存储，不支持上传/写入操作");
    };

    this.share = {
      applyShareUploader: readonlyError,
      applyDirectShareUploader: readonlyError,
      applyUrlUploader: readonlyError,
    };

    this.fs = {
      applyFsUploader: readonlyError,
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }
}

