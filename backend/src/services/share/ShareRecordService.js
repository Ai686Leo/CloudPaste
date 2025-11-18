import { ValidationError } from "../../http/errors.js";
import { ApiStatus, UserType } from "../../constants/index.js";
import { generateFileId, generateUniqueFileSlug } from "../../utils/common.js";
import { hashPassword } from "../../utils/crypto.js";
import { generateFileDownloadUrl } from "../fileService.js";

export class ShareRecordService {
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  resolveCreatedBy(userIdOrInfo, userType) {
    if (userType === UserType.ADMIN || userType === "admin") {
      return userIdOrInfo;
    }
    if (userType === UserType.API_KEY || userType === "apiKey") {
      if (typeof userIdOrInfo === "object" && userIdOrInfo?.id) return `apikey:${userIdOrInfo.id}`;
      return `apikey:${userIdOrInfo}`;
    }
    return "anonymous";
  }

  async createShareRecord({
    mount,
    fsPath,
    storageSubPath = "",
    filename,
    size,
    remark = "",
    userIdOrInfo,
    userType,
    slug,
    override = false,
    password = null,
    expiresInHours = 0,
    maxViews = 0,
    useProxy = undefined,
    mimeType,
    request = null,
    uploadResult = null,
    originalFilenameUsed = true,
    storageConfig = null,
    updateIfExists = false,
  }) {
    if (!mount?.storage_config_id && !storageConfig) {
      throw new ValidationError("缺少挂载或存储配置，无法创建分享");
    }

    const createdBy = this.resolveCreatedBy(userIdOrInfo, userType);

    const finalSlug = await generateUniqueFileSlug(this.db, slug, override, {
      userIdOrInfo,
      userType,
      encryptionSecret: this.encryptionSecret,
      repositoryFactory: this.repositoryFactory,
      db: this.db,
    });

    const fileRepository = this.repositoryFactory.getFileRepository();

    const fileId = generateFileId();
    const now = new Date().toISOString();
    const expiresAt = expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 3600000).toISOString() : null;
    const maxViewsValue = maxViews > 0 ? maxViews : null;
    // use_proxy 默认关闭代理，未显式传入时走直链
    const useProxyFlag = useProxy ? 1 : 0;
    const passwordHash = password ? await hashPassword(password) : null;

    const relativePath = (storageSubPath || "").replace(/^\/+/u, "");
    const storagePath = mount?.storage_config_id ? relativePath : (uploadResult?.storagePath || fsPath || filename);
    const storageType = mount?.storage_type || storageConfig?.storage_type;
    if (!storageType) {
      throw new ValidationError("存储配置缺少 storage_type");
    }
    const storageConfigId = mount?.storage_config_id || storageConfig?.id;

    let finalFileId = fileId;
    let createdAt = now;
    let views = 0;

    if (updateIfExists && storageConfigId && storagePath) {
      const existing = await fileRepository.findByStoragePath(storageConfigId, storagePath, storageType).catch(() => null);
      if (existing) {
        // 更新已有记录（覆盖模式）：不改变 slug/created_by/created_at
        await fileRepository.updateFile(existing.id, {
          filename,
          size,
          mimetype: mimeType,
          etag: uploadResult?.etag || null,
          remark,
          expires_at: expiresAt,
          max_views: maxViewsValue,
          use_proxy: useProxyFlag,
          updated_at: now,
        });

        if (password) {
          await fileRepository.upsertFilePasswordRecord(existing.id, password);
        }

        finalFileId = existing.id;
        createdAt = existing.created_at || now;
        views = existing.views || 0;

        const fileForUrl = {
          id: existing.id,
          slug: existing.slug,
          filename,
          mimetype: mimeType,
          size,
          remark,
          created_at: createdAt,
          storage_config_id: storageConfigId,
          storage_type: storageType,
          storage_path: storagePath,
          file_path: fsPath,
          use_proxy: useProxyFlag,
          public_url: uploadResult?.publicUrl || null,
          etag: uploadResult?.etag || null,
          max_views: maxViewsValue,
          expires_at: expiresAt,
          views,
          created_by: existing.created_by,
        };

        fileForUrl.password_plain = password || null;
        const urls = await generateFileDownloadUrl(this.db, fileForUrl, this.encryptionSecret, request);

        return {
          id: existing.id,
          slug: existing.slug,
          filename,
          mimetype: mimeType,
          size,
          remark,
          created_at: createdAt,
          requires_password: Boolean(password || existing.password),
          views: views,
          max_views: maxViewsValue,
          expires_at: expiresAt,
          url: `/file/${existing.slug}`,
          previewUrl: useProxyFlag ? urls.proxyPreviewUrl : urls.previewUrl,
          downloadUrl: useProxyFlag ? urls.proxyDownloadUrl : urls.downloadUrl,
          // 直链字段统一移除，仅保留代理与通用字段
          proxy_preview_url: urls.proxyPreviewUrl,
          proxy_download_url: urls.proxyDownloadUrl,
          use_proxy: useProxyFlag,
          created_by: existing.created_by,
          used_original_filename: originalFilenameUsed,
          storage_path: storagePath,
          storage_type: storageType,
        };
      }
    }

    // 新建记录（默认或不存在时）
    await fileRepository.createFile({
      id: fileId,
      slug: finalSlug,
      filename,
      storage_config_id: storageConfigId,
      storage_type: storageType,
      storage_path: storagePath,
      file_path: fsPath,
      mimetype: mimeType,
      size,
      etag: uploadResult?.etag || null,
      remark,
      password: passwordHash,
      expires_at: expiresAt,
      max_views: maxViewsValue,
      use_proxy: useProxyFlag,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    });

    if (password) {
      await fileRepository.upsertFilePasswordRecord(fileId, password);
    }

    const fileForUrl = {
      id: fileId,
      slug: finalSlug,
      filename,
      mimetype: mimeType,
      size,
      remark,
      created_at: now,
      storage_config_id: storageConfigId,
      storage_type: storageType,
      storage_path: storagePath,
      file_path: fsPath,
      use_proxy: useProxyFlag,
      public_url: uploadResult?.publicUrl || null,
      etag: uploadResult?.etag || null,
      max_views: maxViewsValue,
      expires_at: expiresAt,
      views: 0,
      created_by: createdBy,
      password_plain: password || null,
    };

    const urls = await generateFileDownloadUrl(this.db, fileForUrl, this.encryptionSecret, request);

    const response = {
      id: fileId,
      slug: finalSlug,
      filename,
      mimetype: mimeType,
      size,
      remark,
      created_at: now,
      requires_password: Boolean(password),
      views: 0,
      max_views: maxViewsValue,
      expires_at: expiresAt,
      url: `/file/${finalSlug}`,
      previewUrl: useProxyFlag ? urls.proxyPreviewUrl : urls.previewUrl,
      downloadUrl: useProxyFlag ? urls.proxyDownloadUrl : urls.downloadUrl,
      // 直链字段统一移除，仅保留代理与通用字段
      proxy_preview_url: urls.proxyPreviewUrl,
      proxy_download_url: urls.proxyDownloadUrl,
      use_proxy: useProxyFlag,
      created_by: createdBy,
      used_original_filename: originalFilenameUsed,
      storage_path: storagePath,
      storage_type: storageType,
    };

    return response;
  }
}
