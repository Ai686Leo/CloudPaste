import { ref } from "vue";
import { useUploaderClient } from "@/modules/storage-core/index.js";

/**
 * Share 上传领域控制器
 *
 * 统一管理基于 Uppy 的分享上传会话（Share / URL），
 * 将对 useUploaderClient / driver 的直接依赖集中在 modules 层。
 *
 * - 创建 / 记录当前活跃的上传会话
 * - 提供统一的销毁 / 取消入口
 *
 * 不负责：
 * - UI 提示与文案（交给组件）
 * - 队列状态与错误汇总（交给调用方或上层 service）
 */
export function useShareUploadController() {
  const uploaderClient = useUploaderClient();

  const activeShareSession = ref(null);
  const activeUrlSession = ref(null);

  const disposeGenericSession = (sessionRef, { cancel = false } = {}) => {
    const session = sessionRef.value;
    if (!session) return;

    if (cancel) {
      try {
        session.cancel?.();
      } catch {
        // ignore cancel error
      }
    }

    try {
      session.destroy?.();
    } catch {
      // ignore destroy error
    }

    sessionRef.value = null;
  };

  const disposeShareSession = (options = {}) => {
    disposeGenericSession(activeShareSession, options);
  };

  const disposeUrlSession = (options = {}) => {
    disposeGenericSession(activeUrlSession, options);
  };

  /**
   * 创建分享上传会话（Share Upload）。
   *
   * 调用方负责：
   * - session.addFiles(...)
   * - await session.start()
   * - 使用 events 处理进度与结果
   */
  const createShareSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeShareSession();

    const session = uploaderClient.createShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
    });

    activeShareSession.value = session;
    return session;
  };

  /**
   * 创建基于 /share/upload 的直传分享会话（多存储通用）。
   * shareMode: 'stream' | 'form' | 'multipart'（前端内部使用）
   */
  const createDirectShareSession = ({ payload, events, uppyOptions, uppy, shareMode } = {}) => {
    disposeShareSession();

    const session = uploaderClient.createDirectShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
      shareMode,
    });

    activeShareSession.value = session;
    return session;
  };

  /**
   * 创建 URL 上传会话（Url Upload）。
   *
   * 与 Share 类似，调用方负责 addFiles / start。
   */
  const createUrlSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeUrlSession();

    const session = uploaderClient.createUrlUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
    });

    activeUrlSession.value = session;
    return session;
  };

  /**
   * 创建基于 /share/upload 的 URL 直传分享会话（与文件直传共享同一底层实现）。
   * URL 上传仅使用流式模式，shareMode 固定为 'stream'。
   */
  const createUrlDirectSession = ({ payload, events, uppyOptions, uppy } = {}) => {
    disposeUrlSession();

    const session = uploaderClient.createDirectShareUploadSession({
      payload,
      events,
      uppyOptions,
      uppy,
      shareMode: "stream",
    });

    activeUrlSession.value = session;
    return session;
  };

  /**
   * 创建 FS 上传会话（用于挂载浏览器上传弹窗）
   *
   * 这是对 useUploaderClient.createFsUploadSession 的领域包装，
   * 目的是让 UI 不再直接依赖 uploaderClient 与 driver。
   */
  const createFsUploadSession = ({ storageConfigId, fsOptions = {}, events, uppyOptions, uppy } = {}) => {
    return uploaderClient.createFsUploadSession({
      storageConfigId,
      fsOptions,
      events,
      uppyOptions,
      uppy,
    });
  };

  /**
   * 便捷方法：基于 payload 与 meta 批量启动分享上传。
   *
   * 约定：
   * - files: 原始 File 列表
   * - buildMeta(file, index): 为每个文件生成 meta（如 slug/path 等）
   * - events / uppyOptions: 直接传给底层 createShareSession
   * - uppy: 可选的外部 Uppy 实例
   *
   * 返回：
   * - session: Uppy 会话对象
   * - ids: addFiles 返回的文件 id 列表
   */
  const startShareUpload = ({ files = [], payload, buildMeta, events, uppyOptions, uppy } = {}) => {
    const session = createShareSession({ payload, events, uppyOptions, uppy });
    const ids = Array.isArray(files) && files.length
      ? session.addFiles(files, buildMeta)
      : [];
    return { session, ids };
  };

  /**
   * 基于 /share/upload 的直传分享上传（S3/WebDAV 等多存储通用）。
   */
  const startDirectShareUpload = ({ files = [], payload, buildMeta, events, uppyOptions, uppy, shareMode } = {}) => {
    const session = createDirectShareSession({ payload, events, uppyOptions, uppy, shareMode });
    const ids = Array.isArray(files) && files.length ? session.addFiles(files, buildMeta) : [];
    return { session, ids };
  };

  /**
   * 便捷方法：启动单次 URL 上传（调用方负责构造文件描述）。
   * 保持与 startShareUpload 一致的调用方式。
   */
  const startUrlUpload = ({ files = [], payload, buildMeta, events, uppyOptions } = {}) => {
    const session = createUrlSession({ payload, events, uppyOptions });
    const ids = Array.isArray(files) && files.length
      ? session.addFiles(files, buildMeta)
      : [];
    return { session, ids };
  };

  return {
    activeShareSession,
    activeUrlSession,
    createShareSession,
    createDirectShareSession,
    createUrlSession,
    createUrlDirectSession,
    createFsUploadSession,
    startShareUpload,
    startDirectShareUpload,
    startUrlUpload,
    disposeShareSession,
    disposeUrlSession,
  };
}
