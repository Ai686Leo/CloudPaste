import { useI18n } from "vue-i18n";

/**
 * Share 上传领域服务
 *
 * - 基于表单数据构造上传 payload
 * - 解析/归类上传错误
 * - 根据整体结果生成统一的提示信息
 *
 * 不直接依赖具体 UI，只返回结构化结果或已翻译好的文案。
 */
export function useShareUploadDomain() {
  const { t } = useI18n();

  const buildPayloadForFile = (formData, slugOverride = "") => ({
    storage_config_id: formData.storage_config_id,
    slug: slugOverride || formData.slug || "",
    path: formData.path || "",
    remark: formData.remark || "",
    password: formData.password || "",
    expires_in: formData.expires_in || "0",
    max_views: Math.max(0, Number(formData.max_views) || 0),
  });

  const processInsufficientStorageError = (errorMessage) => {
    const isInsufficientStorage =
      errorMessage.includes("存储空间不足") ||
      errorMessage.includes("insufficient storage") ||
      errorMessage.includes("超过剩余空间") ||
      errorMessage.includes("exceeds") ||
      (errorMessage.includes("storage") &&
        (errorMessage.includes("limit") || errorMessage.includes("full") || errorMessage.includes("quota")));

    if (!isInsufficientStorage) {
      return errorMessage;
    }

    try {
      const fileSizeMatch = errorMessage.match(/文件大小\((.*?)\)|file size\((.*?)\)/i);
      const remainingSpaceMatch = errorMessage.match(/剩余空间\((.*?)\)|remaining space\((.*?)\)/i);
      const totalCapacityMatch = errorMessage.match(/容量上限为(.*?)。|capacity limit is(.*?)\./i);

      const fileSize = fileSizeMatch ? fileSizeMatch[1] || fileSizeMatch[2] : "";
      const remainingSpace = remainingSpaceMatch ? remainingSpaceMatch[1] || remainingSpaceMatch[2] : "";
      const totalCapacity = totalCapacityMatch ? totalCapacityMatch[1] || totalCapacityMatch[2] : "";

      if (fileSize && remainingSpace && totalCapacity) {
        return t("file.insufficientStorageDetailed", {
          fileSize,
          remainingSpace,
          totalCapacity,
        });
      }
    } catch (error) {
      console.error("处理存储空间不足错误信息失败", error);
    }

    return errorMessage;
  };

  const buildErrorDescriptor = (error) => {
    const raw = error?.message || t("common.unknownError");
    const isSlugConflict =
      (raw.includes("slug") &&
        (raw.includes("already exists") ||
          raw.includes("already taken") ||
          raw.includes("duplicate") ||
          raw.includes("conflict"))) ||
      raw.includes("链接后缀已被占用") ||
      raw.includes("已存在");

    const isInsufficientStorage =
      raw.includes("存储空间不足") ||
      raw.includes("insufficient storage") ||
      raw.includes("超过剩余空间") ||
      raw.includes("exceeds") ||
      (raw.includes("storage") && (raw.includes("limit") || raw.includes("full") || raw.includes("quota")));

    const isPermissionError =
      raw.includes("没有权限使用此存储配置") ||
      raw.includes("没有权限") ||
      raw.includes("权限不足") ||
      raw.includes("permission denied") ||
      raw.includes("forbidden") ||
      raw.includes("unauthorized");

    let messageText = raw;
    if (isSlugConflict) {
      messageText = t("file.messages.slugConflict");
    } else if (isInsufficientStorage) {
      messageText = processInsufficientStorageError(raw);
    } else if (isPermissionError) {
      messageText = t("file.messages.permissionError");
    }

    return { message: messageText, raw, isSlugConflict, isInsufficientStorage, isPermissionError };
  };

  /**
   * 汇总上传结果，生成统一的提示信息
   *
   * @param {Object[]} errors - 由 buildErrorDescriptor 生成的错误描述数组
   * @param {Object[]} uploadResults - 成功上传结果列表
   * @param {number} totalFiles - 本次尝试上传的文件总数
   *
   * @returns {Object|null} summary
   *  - kind: 'error' | 'success'
   *  - severity: 'error' | 'warning'（仅 error 时使用）
   *  - message: string
   */
  const summarizeUploadResults = ({ errors, uploadResults, totalFiles }) => {
    if (errors.length) {
      const allSlugConflicts = errors.every((err) => err.isSlugConflict);
      const hasSlugConflict = errors.some((err) => err.isSlugConflict);
      const allInsufficient = errors.every((err) => err.isInsufficientStorage);
      const allPermission = errors.every((err) => err.isPermissionError);
      const firstStorageError = errors.find((err) => err.isInsufficientStorage);

      if (errors.length === totalFiles) {
        if (allSlugConflicts) {
          return { kind: "error", severity: "error", message: t("file.allSlugConflicts") };
        }
        if (allInsufficient && firstStorageError) {
          return {
            kind: "error",
            severity: "error",
            message: processInsufficientStorageError(firstStorageError.raw),
          };
        }
        if (allPermission) {
          return { kind: "error", severity: "error", message: t("file.allPermissionErrors") };
        }
        return { kind: "error", severity: "error", message: t("file.allUploadsFailed") };
      }

      // 部分失败
      if (hasSlugConflict) {
        const slugCount = errors.filter((err) => err.isSlugConflict).length;
        return {
          kind: "error",
          severity: "warning",
          message:
            slugCount === errors.length
              ? t("file.someSlugConflicts", { count: slugCount })
              : t("file.someUploadsFailed", { count: errors.length }),
        };
      }

      return {
        kind: "error",
        severity: "warning",
        message: t("file.someUploadsFailed", { count: errors.length }),
      };
    }

    if (uploadResults.length > 0) {
      return {
        kind: "success",
        message:
          uploadResults.length > 1
            ? t("file.multipleUploadsSuccessful", { count: uploadResults.length })
            : t("file.uploadSuccessful"),
      };
    }

    return null;
  };

  return {
    buildPayloadForFile,
    buildErrorDescriptor,
    summarizeUploadResults,
  };
}

