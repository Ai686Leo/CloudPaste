/**
 * 文件篮 Composable
 * 处理文件篮相关的业务逻辑，连接Store和组件
 */

import { computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useFileBasketStore } from "@/stores/fileBasketStore.js";
import { useAuthStore } from "@/stores/authStore.js";
import { useTaskManager } from "@/utils/taskManager.js";
import { api } from "@/api";
import { formatNowForFilename } from "@/utils/timeUtils.js";
import { usePathPassword } from "@/composables/usePathPassword.js";
import { getZipJsDefaultConfig } from "@/utils/zipjsRuntimeUris.js";

// zip.js 全局 configure
let isZipJsConfigured = false;

export function useFileBasket() {
  const { t } = useI18n();
  const fileBasketStore = useFileBasketStore();
  const authStore = useAuthStore();
  const taskManager = useTaskManager();
  const pathPassword = usePathPassword();

  // ===== 全局清理状态跟踪 =====

  // 跟踪所有活动的XMLHttpRequest（全局级别）
  const globalActiveXHRs = new Set();

  // 跟踪所有事件监听器
  const globalEventListeners = new Set();

  // 跟踪所有活动的 ZIP 写入流（File System Access API）
  const globalActiveZipWritables = new Set();

  // 全局清理函数
  const globalCleanup = () => {
    // 取消所有活动的XMLHttpRequest
    globalActiveXHRs.forEach((xhr) => {
      if (xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort();
      }
    });
    globalActiveXHRs.clear();

    // 中止所有活动的 ZIP 写入流
    globalActiveZipWritables.forEach((writable) => {
      try {
        if (writable && typeof writable.abort === "function") {
          writable.abort();
        }
      } catch (e) {
        console.warn("中止 ZIP 写入流失败:", e?.message || e);
      }
    });
    globalActiveZipWritables.clear();

    // 移除所有事件监听器
    globalEventListeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });
    globalEventListeners.clear();

    console.log("文件篮composable已清理所有资源");
  };

  // ===== Store状态解构 =====
  const { collectedFiles, isBasketOpen, collectionCount, hasCollection, collectionTotalSize, collectionTotalSizeMB, filesByDirectory, directoryCount, isInitialized } =
    storeToRefs(fileBasketStore);

  // ===== 计算属性 =====

  /**
   * 文件篮按钮显示文本
   */
  const basketButtonText = computed(() => {
    try {
      if (collectionCount.value === 0) {
        return t("fileBasket.button.empty");
      }
      return t("fileBasket.button.withCount", { count: collectionCount.value });
    } catch (error) {
      console.warn("国际化函数调用失败，使用默认文本:", error);
      // 使用默认文本作为后备
      if (collectionCount.value === 0) {
        return "文件篮";
      }
      return `文件篮 (${collectionCount.value})`;
    }
  });

  /**
   * 文件篮摘要信息
   */
  const basketSummary = computed(() => {
    return {
      fileCount: collectionCount.value,
      directoryCount: directoryCount.value,
      totalSizeMB: collectionTotalSizeMB.value,
      isEmpty: !hasCollection.value,
    };
  });

  // ===== 文件篮操作方法 =====

  /**
   * 添加文件到篮子
   * @param {Object|Array} files - 文件或文件数组
   * @param {string} currentPath - 当前目录路径
   * @returns {Object} 操作结果
   */
  const addToBasket = (files, currentPath) => {
    try {
      const fileArray = Array.isArray(files) ? files : [files];
      const fileItems = fileArray.filter((item) => !item.isDirectory);

      if (fileItems.length === 0) {
        return {
          success: false,
          message: t("fileBasket.messages.noFilesToAdd"),
        };
      }

      fileBasketStore.addToBasket(fileItems, currentPath);

      return {
        success: true,
        message: t("fileBasket.messages.addSuccess", {
          count: fileItems.length,
          total: collectionCount.value,
        }),
      };
    } catch (error) {
      console.error("添加文件到篮子失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.addFailed"),
      };
    }
  };

  /**
   * 从篮子移除文件
   * @param {string|Array} filePaths - 文件路径
   * @returns {Object} 操作结果
   */
  const removeFromBasket = (filePaths) => {
    try {
      fileBasketStore.removeFromBasket(filePaths);
      return {
        success: true,
        message: t("fileBasket.messages.removeSuccess"),
      };
    } catch (error) {
      console.error("从篮子移除文件失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.removeFailed"),
      };
    }
  };

  /**
   * 切换文件在篮子中的状态
   * @param {Object} file - 文件对象
   * @param {string} currentPath - 当前目录路径
   * @returns {Object} 操作结果
   */
  const toggleFileInBasket = (file, currentPath) => {
    try {
      const isInBasket = fileBasketStore.isFileInBasket(file.path);
      fileBasketStore.toggleFileInBasket(file, currentPath);

      return {
        success: true,
        isInBasket: !isInBasket,
        message: isInBasket ? t("fileBasket.messages.removeSuccess") : t("fileBasket.messages.addSuccess", { count: 1, total: collectionCount.value }),
      };
    } catch (error) {
      console.error("切换文件篮状态失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.toggleFailed"),
      };
    }
  };

  /**
   * 批量添加选中文件到篮子
   * @param {Array} selectedFiles - 选中的文件列表
   * @param {string} currentPath - 当前目录路径
   * @returns {Object} 操作结果
   */
  const addSelectedToBasket = (selectedFiles, currentPath) => {
    try {
      const addedCount = fileBasketStore.addSelectedToBasket(selectedFiles, currentPath);

      if (addedCount === 0) {
        return {
          success: false,
          message: t("fileBasket.messages.noFilesToAdd"),
        };
      }

      return {
        success: true,
        addedCount,
        message: t("fileBasket.messages.batchAddSuccess", {
          count: addedCount,
          total: collectionCount.value,
        }),
      };
    } catch (error) {
      console.error("批量添加文件到篮子失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.batchAddFailed"),
      };
    }
  };

  // ===== 面板管理方法 =====

  /**
   * 打开文件篮面板
   */
  const openBasket = () => {
    fileBasketStore.openBasket();
  };

  /**
   * 关闭文件篮面板
   */
  const closeBasket = () => {
    fileBasketStore.closeBasket();
  };

  /**
   * 切换文件篮面板显示状态
   */
  const toggleBasket = () => {
    fileBasketStore.toggleBasket();
  };

  // ===== 清理方法 =====

  /**
   * 清空文件篮
   * @returns {Object} 操作结果
   */
  const clearBasket = () => {
    try {
      fileBasketStore.clearBasket();
      return {
        success: true,
        message: t("fileBasket.messages.clearSuccess"),
      };
    } catch (error) {
      console.error("清空文件篮失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.clearFailed"),
      };
    }
  };

  /**
   * 重置文件篮（清空并关闭面板）
   */
  const resetBasket = () => {
    fileBasketStore.resetBasket();
  };

  // ===== 打包下载方法 =====

  /**
   * 尝试使用 File System Access API 创建 ZIP 写入目标
   * - 仅在 Chromium 系浏览器、且 secure context 下可用
   * - 不可用时返回 null（由调用方降级到 BlobWriter + file-saver）
   * @param {string} suggestedName
   * @returns {Promise<null | { mode: "fs_access", writable: any, fileName: string }>}
   */
  const tryPickZipSaveTarget = async (suggestedName) => {
    if (typeof window === "undefined") return null;
    if (typeof window.showSaveFilePicker !== "function") return null;
    if (!window.isSecureContext) return null;

    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || "CloudPaste.zip",
      types: [
        {
          description: "ZIP 文件",
          accept: {
            "application/zip": [".zip"],
          },
        },
      ],
      excludeAcceptAllOption: true,
    });

    const writable = await handle.createWritable();
    return {
      mode: "fs_access",
      writable,
      fileName: handle?.name || suggestedName || "CloudPaste.zip",
    };
  };

  /**
   * 创建打包下载任务
   * @returns {Promise<Object>} 操作结果
   */
  const createPackTask = async () => {
    try {
      if (!hasCollection.value) {
        return {
          success: false,
          message: t("fileBasket.messages.emptyBasket"),
        };
      }

      // 先生成文件名（保持与旧逻辑一致），用于：
      // - File System Access API 的 suggestedName
      // - Blob 模式下 saveAs 的下载文件名
      const timestamp = formatNowForFilename();
      const suggestedZipFileName = `CloudPaste_${timestamp}.zip`;

      // 优先尝试 File System Access API
      /** @type {null | { mode: "fs_access", writable: any, fileName: string }} */
      let outputTarget = null;
      /** @type {string} */
      let zipFileName = suggestedZipFileName;
      try {
        const picked = await tryPickZipSaveTarget(suggestedZipFileName);
        if (picked) {
          outputTarget = picked;
          zipFileName = picked.fileName || suggestedZipFileName;
        }
      } catch (e) {
        // 用户取消“保存为”对话框：不创建任务，直接提示
        if (e?.name === "AbortError") {
          return {
            success: false,
            message: "已取消保存",
          };
        }
        throw e;
      }

      // 创建任务
      const taskName = t("fileBasket.task.name", {
        count: collectionCount.value,
        directories: directoryCount.value,
      });

      const taskId = taskManager.addTask("download", taskName, collectionCount.value);

      // 启动异步打包处理
      processPackTask(taskId, { outputTarget, zipFileName });

      return {
        success: true,
        taskId,
        message: t("fileBasket.messages.taskCreated", { taskName }),
      };
    } catch (error) {
      console.error("创建打包任务失败:", error);
      return {
        success: false,
        message: t("fileBasket.messages.taskCreateFailed"),
      };
    }
  };

  /**
   * 处理打包任务（异步）
   * @param {number} taskId - 任务ID
   * @param {{ outputTarget?: null | { mode: "fs_access", writable: any, fileName: string }, zipFileName?: string }} [options]
   */
  const processPackTask = async (taskId, options = {}) => {
    // 初始化文件状态跟踪
    const fileStates = new Map();

    // 清理函数
    const cleanup = () => {
      if (fileStates) {
        fileStates.clear();
      }
    };

    const outputTarget = options?.outputTarget || null;
    const zipFileName = options?.zipFileName || `CloudPaste_${formatNowForFilename()}.zip`;
    const isFsAccessMode = outputTarget?.mode === "fs_access" && outputTarget?.writable;

    try {
      if (isFsAccessMode) {
        globalActiveZipWritables.add(outputTarget.writable);
      }

      // 更新任务状态
      taskManager.updateTaskProgress(taskId, 0, {
        status: t("fileBasket.task.preparing"),
        total: collectionCount.value,
        processed: 0,
        currentFile: "",
        startTime: new Date().toISOString(),
      });

      // 获取收集的文件
      const files = fileBasketStore.getCollectedFiles();

      // 动态导入 zip.js（file-saver 仅在 Blob 模式需要）
      const { ZipWriter, BlobWriter, BlobReader, HttpReader, configure } = await import("@zip.js/zip.js");
      const saveAs = isFsAccessMode ? null : (await import("file-saver")).saveAs;

      // 显式配置 workerURI/wasmURI
      if (!isZipJsConfigured) {
        configure(getZipJsDefaultConfig());
        isZipJsConfigured = true;
      }

      // 创建 ZipWriter
      console.log(`处理 ${files.length} 个文件`);
      const zipOutput = isFsAccessMode ? outputTarget.writable : new BlobWriter("application/zip");
      const zipWriter = new ZipWriter(zipOutput, {
        // 生成 >4GB 的 zip，需要显式开启 zip64
        zip64: true,
        keepOrder: true, // 保持文件顺序
        useWebWorkers: true, // 启用Web Workers
        useCompressionStream: true, // 使用原生压缩流
        bufferedWrite: false, // 不缓冲写入，减少内存占用
      });
      const failedFiles = [];
      const addedFiles = new Set();

      /**
       * 预先分配 ZIP 内路径（避免并发下 addedFiles 竞态）
       * @param {any} file
       * @returns {string}
       */
      const reserveZipPath = (file) => {
        const directoryName = (file?.sourceDirectory || "")
          .replace(/^\//, "")
          .replace(/\//g, "_") || "root";
        const zipPath = `${directoryName}/${file.name}`;

        let finalZipPath = zipPath;
        let counter = 1;
        while (addedFiles.has(finalZipPath)) {
          const lastDotIndex = zipPath.lastIndexOf(".");
          if (lastDotIndex > 0) {
            const name = zipPath.substring(0, lastDotIndex);
            const ext = zipPath.substring(lastDotIndex);
            finalZipPath = `${name}_${counter}${ext}`;
          } else {
            finalZipPath = `${zipPath}_${counter}`;
          }
          counter++;
        }
        addedFiles.add(finalZipPath);
        return finalZipPath;
      };

      /**
       * 有限并发执行器（避免网络/Worker/内存峰值）
       * @template T
       * @param {T[]} items
       * @param {number} limit
       * @param {(item:T)=>Promise<any>} worker
       */
      const runWithConcurrency = async (items, limit, worker) => {
        const safeLimit = Math.max(1, Math.min(limit || 1, items.length || 1));
        let index = 0;
        const runners = Array.from({ length: safeLimit }).map(async () => {
          while (index < items.length) {
            const current = items[index++];
            await worker(current);
          }
        });
        await Promise.all(runners);
      };

      // 初始化文件状态
      files.forEach((file) => {
        fileStates.set(file.path, {
          name: file.name,
          path: file.path,
          size: file.size,
          status: "pending",
          progress: 0,
          receivedBytes: 0,
          totalBytes: file.size || 0,
        });
      });

      const processOneFile = async (file) => {
        try {
          const finalZipPath = reserveZipPath(file);
          const downloadUrl = await getFileDownloadUrl(file);

          // 更新文件状态
          let fileState = fileStates.get(file.path);
          if (fileState) {
            fileState.status = "downloading";
          }

          await zipWriter.add(
            finalZipPath,
            new HttpReader(downloadUrl, {
              preventHeadRequest: true, // 避免额外的HEAD请求
              useXHR: false, // 使用fetch API
            }),
            {
              useWebWorkers: true, // 启用Web Workers
              useCompressionStream: true, // 使用原生压缩流
              onprogress: (progress, total) => {
                if (fileState) {
                  fileState.progress = total > 0 ? Math.round((progress / total) * 100) : 0;
                  fileState.receivedBytes = progress;
                  fileState.totalBytes = total;

                  const completedFiles = Array.from(fileStates.values()).filter((f) => f.status === "completed").length;
                  const currentRatio = total > 0 ? progress / total : 0;
                  const overallProgress = Math.round(((completedFiles + currentRatio) / files.length) * 90);

                  taskManager.updateTaskProgress(taskId, overallProgress, {
                    status: t("fileBasket.task.downloading"),
                    currentFile: `${file.name} (${fileState.progress}%)`,
                    processed: completedFiles,
                    total: files.length,
                  });
                }
              },
            }
          );

          // 文件完成
          fileState = fileStates.get(file.path);
          if (fileState) {
            fileState.status = "completed";
            fileState.progress = 100;
          }

          return { success: true, fileName: file.name };
        } catch (error) {
          console.error(`添加文件 ${file.name} 失败:`, error);
          failedFiles.push({ fileName: file.name, path: file.path, error: error.message });

          const failedFileState = fileStates.get(file.path);
          if (failedFileState) {
            failedFileState.status = "failed";
            failedFileState.progress = 0;
          }

          return { success: false, fileName: file.name, error: error.message };
        }
      };

      // 有限并发添加文件到 ZIP（避免峰值过高）
      await runWithConcurrency(files, 4, processOneFile);

      // 添加错误报告
      if (failedFiles.length > 0) {
        const errorReport = [t("fileBasket.task.failedFilesHeader"), "", ...failedFiles.map(({ fileName, path, error }) => `${path} (${fileName}): ${error}`)].join("\n");

        await zipWriter.add("下载失败文件列表.txt", new BlobReader(new Blob([errorReport], { type: "text/plain" })));
      }

      // 生成ZIP
      taskManager.updateTaskProgress(taskId, 95, {
        status: t("fileBasket.task.generating"),
        currentFile: "",
        processed: files.length,
        total: files.length,
      });

      // 目录结构显式用 Zip64 写入，避免超大包在 central directory 阶段触发边界问题
      const zipResult = await zipWriter.close(undefined, { zip64: true });
      if (!isFsAccessMode) {
        saveAs(zipResult, zipFileName);
      }

      // 完成任务
      const successCount = files.length - failedFiles.length;
      taskManager.completeTask(taskId, {
        status: t("fileBasket.task.completed"),
        successCount,
        failedCount: failedFiles.length,
        zipFileName,
        endTime: new Date().toISOString(),
        summary:
          failedFiles.length > 0
            ? t("fileBasket.task.summaryWithFailures", { success: successCount, failed: failedFiles.length })
            : t("fileBasket.task.summarySuccess", { count: successCount }),
      });

      // 打包完成后自动清空文件篮
      fileBasketStore.clearBasket();
    } catch (error) {
      console.error("打包任务失败:", error);
      taskManager.failTask(
        taskId,
        error?.message || String(error),
        {
          status: t("fileBasket.task.failed"),
          error: error?.message || String(error),
          endTime: new Date().toISOString(),
        }
      );
    } finally {
      // File System Access 模式下，失败时尽量中止写入，避免留下不完整文件
      if (isFsAccessMode && outputTarget?.writable) {
        try {
          const tasks = taskManager.getTasks();
          const task = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
          const shouldAbort = task?.status !== "completed";
          if (shouldAbort && typeof outputTarget.writable.abort === "function") {
            await outputTarget.writable.abort();
          }
        } catch (e) {
          console.warn("中止 ZIP 写入失败:", e?.message || e);
        }
      }

      if (isFsAccessMode && outputTarget?.writable) {
        globalActiveZipWritables.delete(outputTarget.writable);
      }

      cleanup();
    }
  };

  /**
   * 获取文件下载URL
   * @param {Object} file - 文件对象
   * @returns {Promise<string>} 下载URL
   */
  const getFileDownloadUrl = async (file) => {
    try {
      // 优先使用控制面提供的 downloadUrl；缺失时按需签发 file-link
      if (file?.downloadUrl) {
        return file.downloadUrl;
      }

      const getFileLinkApi = api.fs.getFileLink;
      const isAdmin = authStore.isAdmin;

      /** @type {{ headers?: Record<string,string> }} */
      const requestOptions = {};
      if (!isAdmin) {
        const token = pathPassword.getPathToken(file.path);
        if (token) {
          requestOptions.headers = {
            "X-FS-Path-Token": token,
          };
        }
      }

      const url = await getFileLinkApi(file.path, null, true, requestOptions);

      if (url) {
        return url;
      }

      throw new Error(t("fileBasket.errors.noDownloadUrl"));
    } catch (error) {
      console.error(`获取文件 ${file.name} 下载链接失败:`, error);
      throw error;
    }
  };

  // ===== 工具方法 =====

  /**
   * 检查文件是否在篮子中
   * @param {string} filePath - 文件路径
   * @returns {boolean}
   */
  const isFileInBasket = (filePath) => {
    return fileBasketStore.isFileInBasket(filePath);
  };

  /**
   * 获取篮子摘要信息
   * @returns {Object}
   */
  const getBasketSummary = () => {
    return fileBasketStore.getCollectionSummary();
  };

  // ===== 组件卸载清理 =====

  onUnmounted(() => {
    globalCleanup();
  });

  return {
    // Store状态
    collectedFiles,
    isBasketOpen,
    collectionCount,
    hasCollection,
    collectionTotalSize,
    collectionTotalSizeMB,
    filesByDirectory,
    directoryCount,
    isInitialized,

    // 计算属性
    basketButtonText,
    basketSummary,

    // 文件篮操作方法
    addToBasket,
    removeFromBasket,
    toggleFileInBasket,
    addSelectedToBasket,

    // 面板管理方法
    openBasket,
    closeBasket,
    toggleBasket,

    // 清理方法
    clearBasket,
    resetBasket,

    // 打包下载方法
    createPackTask,

    // 工具方法
    isFileInBasket,
    getBasketSummary,

    // 手动清理方法（用于紧急情况）
    globalCleanup,
  };
}
