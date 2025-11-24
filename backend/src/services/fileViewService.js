/**
 * 文件查看服务层
 * 负责文件分享查看、下载、预览相关的业务逻辑
 */

import { ensureRepositoryFactory } from "../utils/repositories.js";
import { verifyPassword } from "../utils/crypto.js";
import { getEffectiveMimeType, getContentTypeAndDisposition } from "../utils/fileUtils.js";
import { getFileBySlug, isFileAccessible } from "./fileService.js";
import { ObjectStore } from "../storage/object/ObjectStore.js";

/**
 * 文件查看服务类
 */
export class FileViewService {
  /**
   * 构造函数
   * @param {D1Database} db - 数据库实例
   * @param {string} encryptionSecret - 加密密钥
   */
  constructor(db, encryptionSecret, repositoryFactory = null) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = ensureRepositoryFactory(db, repositoryFactory);
  }

  /**
   * 增加文件查看次数并检查是否超过限制
   * @param {Object} file - 文件对象
   * @returns {Promise<Object>} 包含更新后的文件信息和状态
   */
  async incrementAndCheckFileViews(file) {
    // 使用 FileRepository 递增访问计数
    const fileRepository = this.repositoryFactory.getFileRepository();

    await fileRepository.incrementViews(file.id);

    // 重新获取更新后的文件信息（包含存储配置）
    const updatedFile = await fileRepository.findByIdWithStorageConfig(file.id);

    // 检查是否超过最大访问次数
    if (updatedFile.max_views && updatedFile.max_views > 0 && updatedFile.views > updatedFile.max_views) {
      // 已超过最大查看次数，执行删除
      await this.checkAndDeleteExpiredFile(updatedFile);
      return {
        isExpired: true,
        reason: "max_views",
        file: updatedFile,
      };
    }

    return {
      isExpired: false,
      file: updatedFile,
    };
  }

  /**
   * 检查并删除过期文件
   * @param {Object} file - 文件对象
   */
  async checkAndDeleteExpiredFile(file) {
    try {
      console.log(`开始删除过期文件: ${file.id}`);

      // 通过 ObjectStore 按存储路径删除对象
      if (file.storage_path && file.storage_config_id && file.storage_type) {
        try {
          const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
          await objectStore.deleteByStoragePath(file.storage_config_id, file.storage_path, { db: this.db });
          console.log(`已从存储删除文件: ${file.storage_path}`);
        } catch (e) {
          console.warn("删除存储对象失败（已忽略以完成记录删除）:", e?.message || e);
        }
      }

      // 从数据库删除文件记录
      const fileRepository = this.repositoryFactory.getFileRepository();
      await fileRepository.deleteFile(file.id);

      console.log(`已从数据库删除文件记录: ${file.id}`);
    } catch (error) {
      console.error(`删除过期文件失败 (${file.id}):`, error);
      throw error;
    }
  }

  /**
   * 处理文件下载请求
   * @param {string} slug - 文件slug
   * @param {Request} request - 原始请求
   * @param {boolean} forceDownload - 是否强制下载
   * @returns {Promise<Response>} 响应对象
   */
  async handleFileDownload(slug, request, forceDownload = false) {
    try {
      // 查询文件详情
      const file = await getFileBySlug(this.db, slug, this.encryptionSecret);

      // 检查文件是否存在
      if (!file) {
        return new Response("文件不存在", { status: 404 });
      }

      // 检查文件是否受密码保护
      if (file.password) {
        // 如果有密码，检查URL中是否包含密码参数
        const url = new URL(request.url);
        const passwordParam = url.searchParams.get("password");

        if (!passwordParam) {
          return new Response("需要密码访问此文件", { status: 401 });
        }

        // 验证密码
        const passwordValid = await verifyPassword(passwordParam, file.password);
        if (!passwordValid) {
          return new Response("密码错误", { status: 401 });
        }
      }

      // 检查文件是否可访问
      const accessCheck = await isFileAccessible(this.db, file, this.encryptionSecret);
      if (!accessCheck.accessible) {
        if (accessCheck.reason === "expired") {
          return new Response("文件已过期", { status: 410 });
        }
        return new Response("文件不可访问", { status: 403 });
      }

      // 文件预览和下载端点默认不增加访问计数
      let result = { isExpired: false, file };

      // 如果文件已到达最大访问次数限制
      if (result.isExpired) {
        console.log(`文件(${file.id})已达到最大查看次数，准备删除...`);
        try {
          // 使用 FileRepository 再次检查文件是否被成功删除
          const fileRepository = this.repositoryFactory.getFileRepository();

          const fileStillExists = await fileRepository.findById(file.id);
          if (fileStillExists) {
            console.log(`文件(${file.id})仍然存在，再次尝试删除...`);
            await this.checkAndDeleteExpiredFile(result.file);
          }
        } catch (error) {
          console.error(`尝试再次删除文件(${file.id})时出错:`, error);
        }
        return new Response("文件已达到最大查看次数", { status: 410 });
      }

      // 检查文件存储信息
      if (!result.file.storage_config_id || !result.file.storage_path || !result.file.storage_type) {
        return new Response("文件存储信息不完整", { status: 404 });
      }

      const fileRecord = result.file;
      const useProxyFlag = fileRecord.use_proxy ?? 0;

      // use_proxy = 1 时，走真正的本机代理，通过 ObjectStore 调用底层驱动的 downloadFile
      if (useProxyFlag === 1) {
        // 获取文件的MIME类型（用于覆盖/统一 Content-Type）
        const contentType = getEffectiveMimeType(fileRecord.mimetype, fileRecord.filename);

        // 处理 Range 请求（透传给底层驱动）
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader) {
          console.log(`🎬 分享下载 - 代理 Range 请求: ${rangeHeader}`);
        }

        // 通过 ObjectStore 封装的 storage-first 视图进行下载代理
        const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
        const driverResponse = await objectStore.downloadByStoragePath(fileRecord.storage_config_id, fileRecord.storage_path, {
          request,
        });

        // 基于文件记录重新计算 Content-Type / Content-Disposition，保持分享层一致性
        const { contentType: finalContentType, contentDisposition } = getContentTypeAndDisposition(
          fileRecord.filename,
          fileRecord.mimetype,
          { forceDownload }
        );

        const responseHeaders = new Headers(driverResponse.headers || {});
        responseHeaders.set("Content-Type", finalContentType);
        responseHeaders.set("Content-Disposition", contentDisposition);

        // 设置CORS头部
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        responseHeaders.set("Access-Control-Allow-Headers", "Range, Content-Type");
        responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

        return new Response(driverResponse.body, {
          status: driverResponse.status,
          statusText: driverResponse.statusText,
          headers: responseHeaders,
        });
      }

      // use_proxy != 1 时，尝试走直链：custom_host 优先，其次 PRESIGNED；不再“代理直链”
      let directUrl = null;
      try {
        const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
        const links = await objectStore.generateLinksByStoragePath(fileRecord.storage_config_id, fileRecord.storage_path, {
          forceDownload,
        });
        directUrl = links?.download?.url || links?.preview?.url || null;
      } catch (e) {
        console.error("生成存储直链失败:", e);
      }

      if (!directUrl) {
        return new Response("当前存储不支持直链下载", { status: 501 });
      }

      const redirectHeaders = new Headers();
      redirectHeaders.set("Location", directUrl);

      return new Response(null, {
        status: 302,
        headers: redirectHeaders,
      });
    } catch (error) {
      console.error("代理文件下载出错:", error);
      return new Response("获取文件失败: " + error.message, { status: 500 });
    }
  }
}

// 导出便捷函数供路由使用
export async function handleFileDownload(slug, db, encryptionSecret, request, forceDownload = false, repositoryFactory = null) {
  const service = new FileViewService(db, encryptionSecret, repositoryFactory);
  return service.handleFileDownload(slug, request, forceDownload);
}

export async function checkAndDeleteExpiredFile(db, file, encryptionSecret, repositoryFactory = null) {
  const service = new FileViewService(db, encryptionSecret, repositoryFactory);
  return await service.checkAndDeleteExpiredFile(file);
}
