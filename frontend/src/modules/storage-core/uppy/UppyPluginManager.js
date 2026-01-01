/**
 * Uppy 插件管理器
 * 负责管理所有媒体插件的状态、配置和生命周期
 */

import { useLocalStorage } from "@vueuse/core";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("UppyPluginManager");

/**
 * 插件管理器类
 */
export class UppyPluginManager {
  constructor(uppyInstance, locale = "zh-CN") {
    this.uppy = uppyInstance;
    this.locale = locale;

    // 插件状态
    this.pluginStates = this.loadPluginStates();

    // 插件定义
    this.pluginDefinitions = this.createPluginDefinitions();

    // 插件构造函数缓存（避免重复动态加载）
    this._pluginCtorCache = new Map();
  }

  /**
   * 从localStorage加载插件状态
   */
  loadPluginStates() {
    const defaultState = {
      webcam: true,
      screen: false,
      audio: false,
      imageEditor: true,
      urlImport: true,
    };

    try {
      this._storedPluginStates = useLocalStorage("uppy-plugin-states", defaultState);
      const stored = this._storedPluginStates.value;
      if (stored && typeof stored === "object") {
        return { ...defaultState, ...stored };
      }
    } catch (e) {
      log.warn("Failed to load plugin states:", e);
    }
    // 默认状态：摄像头和URL导入开启，其他关闭
    return defaultState;
  }

  /**
   * 保存插件状态到localStorage
   */
  savePluginStates() {
    try {
      if (this._storedPluginStates) this._storedPluginStates.value = { ...(this.pluginStates || {}) };
    } catch (e) {
      log.warn("Failed to save plugin states:", e);
    }
  }

  /**
   * 获取插件国际化文本
   */
  getPluginTexts() {
    const isZh = this.locale === "zh-CN";
    return {
      webcam: {
        label: isZh ? "摄像头" : "Webcam",
        description: isZh ? "拍照和录制视频" : "Take photos and record videos",
        strings: {
          pluginNameCamera: isZh ? "摄像头" : "Camera",
          smile: isZh ? "微笑！" : "Smile!",
          takePicture: isZh ? "拍照" : "Take a picture",
          startRecording: isZh ? "开始录制" : "Begin recording",
          stopRecording: isZh ? "停止录制" : "Stop recording",
          allowAccessTitle: isZh ? "请允许访问您的摄像头" : "Please allow access to your camera",
          allowAccessDescription: isZh
            ? "为了拍照或录制视频，请允许此网站访问摄像头。"
            : "In order to take pictures or record video with your camera, please allow camera access for this site.",
        },
      },
      screen: {
        label: isZh ? "屏幕录制" : "Screen Capture",
        description: isZh ? "录制屏幕或应用窗口" : "Record screen or application window",
        strings: {
          startCapturing: isZh ? "开始屏幕录制" : "Begin screen capture",
          stopCapturing: isZh ? "停止屏幕录制" : "Stop screen capture",
          submitRecordedFile: isZh ? "提交录制文件" : "Submit recorded file",
          streamActive: isZh ? "录制中" : "Recording active",
          streamPassive: isZh ? "录制暂停" : "Recording stopped",
          micDisabled: isZh ? "麦克风被禁用" : "Microphone disabled",
          recording: isZh ? "录制中" : "Recording",
        },
      },
      audio: {
        label: isZh ? "音频录制" : "Audio Recording",
        description: isZh ? "录制音频文件" : "Record audio files",
        strings: {
          pluginNameAudio: isZh ? "音频" : "Audio",
          startAudioRecording: isZh ? "开始录音" : "Begin audio recording",
          stopAudioRecording: isZh ? "停止录音" : "Stop audio recording",
          allowAudioAccessTitle: isZh ? "请允许访问您的麦克风" : "Please allow access to your microphone",
          allowAudioAccessDescription: isZh
            ? "为了录制音频，请允许此网站访问麦克风。"
            : "In order to record audio with your microphone, please allow microphone access for this site.",
          noAudioTitle: isZh ? "麦克风不可用" : "Microphone not available",
          noAudioDescription: isZh ? "为了录制音频，请连接麦克风或其他音频输入设备" : "To record audio, please connect a microphone or other audio input device",
          recordingStoppedMaxSize: isZh ? "录制已停止，因为文件大小即将超出限制" : "Recording stopped because file size is about to exceed the limit",
          recordingLength: isZh ? "录制时长 %{recording_length}" : "Recording length %{recording_length}",
          submitRecordedFile: isZh ? "提交录制文件" : "Submit recorded file",
          discardRecordedFile: isZh ? "丢弃录制文件" : "Discard recorded file",
        },
      },
      imageEditor: {
        label: isZh ? "图片编辑" : "Image Editor",
        description: isZh ? "编辑和优化图片" : "Edit and optimize images",
        strings: {
          edit: isZh ? "编辑" : "Edit",
          save: isZh ? "保存" : "Save",
          cancel: isZh ? "取消" : "Cancel",
          revert: isZh ? "还原" : "Revert",
          crop: isZh ? "裁剪" : "Crop",
          rotate: isZh ? "旋转" : "Rotate",
          flip: isZh ? "翻转" : "Flip",
          brightness: isZh ? "亮度" : "Brightness",
          contrast: isZh ? "对比度" : "Contrast",
          saturation: isZh ? "饱和度" : "Saturation",
        },
      },
      urlImport: {
        label: isZh ? "URL导入" : "URL Import",
        description: isZh ? "从链接导入文件" : "Import files from URL",
        strings: {
          pluginName: isZh ? "URL" : "URL",
          importFromUrl: isZh ? "从URL导入" : "Import from URL",
          enterUrl: isZh ? "输入文件URL" : "Enter file URL",
          analyzing: isZh ? "分析中..." : "Analyzing...",
          downloading: isZh ? "下载中..." : "Downloading...",
          analyzeUrl: isZh ? "分析 URL" : "Analyze URL",
          download: isZh ? "下载" : "Download",
          fileInfoReady: isZh ? "文件信息已获取" : "File info retrieved",
          unknownFile: isZh ? "未知文件" : "Unknown file",
          reInput: isZh ? "重新输入" : "Re-enter",
          cannotGetUrlInfo: isZh ? "无法获取URL信息" : "Cannot retrieve URL info",
          analysisFailed: isZh ? "URL分析失败" : "URL analysis failed",
          missingFileInfo: isZh ? "缺少文件信息" : "Missing file info",
          downloadFailed: isZh ? "下载失败" : "Download failed",
          downloadComplete: isZh ? "下载完成" : "Download complete",
          progressPercent: "%{progress}%",
          cancelDownload: isZh ? "取消下载" : "Cancel",
          downloadCancelled: isZh ? "下载已取消" : "Download cancelled",
        },
      },
    };
  }

  /**
   * 创建插件定义
   */
  createPluginDefinitions() {
    const texts = this.getPluginTexts();

    return [
      {
        key: "imageEditor",
        label: texts.imageEditor.label,
        description: texts.imageEditor.description,
        enabled: this.pluginStates.imageEditor,
        cssLoader: () => import("@uppy/image-editor/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/image-editor");
          return mod?.default || mod;
        },
        config: {
          quality: 0.8,
          locale: {
            strings: texts.imageEditor.strings,
          },
        },
      },
      {
        key: "webcam",
        label: texts.webcam.label,
        description: texts.webcam.description,
        enabled: this.pluginStates.webcam,
        cssLoader: () => import("@uppy/webcam/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/webcam");
          return mod?.default || mod;
        },
        config: {
          modes: ["video-audio", "video-only", "picture"],
          mirror: true,
          showRecordingLength: true,
          locale: {
            strings: texts.webcam.strings,
          },
        },
      },
      {
        key: "screen",
        label: texts.screen.label,
        description: texts.screen.description,
        enabled: this.pluginStates.screen,
        cssLoader: () => import("@uppy/screen-capture/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/screen-capture");
          return mod?.default || mod;
        },
        config: {
          displayMediaConstraints: {
            video: {
              width: { min: 640, ideal: 1920, max: 1920 },
              height: { min: 480, ideal: 1080, max: 1080 },
            },
            audio: true,
          },
          locale: {
            strings: texts.screen.strings,
          },
        },
      },
      {
        key: "audio",
        label: texts.audio.label,
        description: texts.audio.description,
        enabled: this.pluginStates.audio,
        cssLoader: () => import("@uppy/audio/dist/style.min.css"),
        pluginLoader: async () => {
          const mod = await import("@uppy/audio");
          return mod?.default || mod;
        },
        config: {
          showRecordingLength: true,
          locale: {
            strings: texts.audio.strings,
          },
        },
      },
      {
        key: "urlImport",
        label: texts.urlImport.label,
        description: texts.urlImport.description,
        enabled: this.pluginStates.urlImport,
        pluginLoader: async () => {
          const mod = await import("./plugins/UrlImportPlugin.js");
          return mod?.default || mod?.UrlImportPlugin || mod;
        },
        config: {
          // 传入语言包配置（会与插件的 defaultLocale 合并）
          locale: {
            strings: texts.urlImport.strings,
          },
          // API回调函数（由外部设置）
          validateUrlInfo: null,
          fetchUrlContent: null,
        },
      },
    ];
  }

  /**
   * 获取插件列表（用于UI显示）
   */
  getPluginList() {
    return this.pluginDefinitions.map((plugin) => ({
      key: plugin.key,
      label: plugin.label,
      description: plugin.description,
      enabled: plugin.enabled,
    }));
  }

  /**
   * 切换插件状态
   */
  togglePlugin(pluginKey) {
    const plugin = this.pluginDefinitions.find((p) => p.key === pluginKey);
    if (plugin) {
      plugin.enabled = !plugin.enabled;
      this.pluginStates[pluginKey] = plugin.enabled;
      this.savePluginStates();
      return plugin.enabled;
    }
    return false;
  }

  /**
   * 设置URL导入插件的回调函数
   * @param {Object} callbacks - 回调函数对象
   * @param {Function} callbacks.validateUrlInfo - URL验证函数
   * @param {Function} callbacks.fetchUrlContent - URL下载函数
   * @param {Function} callbacks.onShowModal - 显示模态框回调
   * @param {Function} callbacks.onHideModal - 隐藏模态框回调
   */
  setUrlImportCallbacks(callbacks = {}) {
    const urlPlugin = this.pluginDefinitions.find(p => p.key === 'urlImport');
    if (urlPlugin && urlPlugin.config) {
      Object.assign(urlPlugin.config, callbacks);
    }
  }

  /**
   * 添加所有启用的插件到Uppy实例
   */
  async addPluginsToUppy() {
    if (!this.uppy) return;

    // 添加用户选择的插件
    for (const plugin of this.pluginDefinitions) {
      if (!plugin?.enabled) continue;

      try {
        if (typeof plugin.cssLoader === "function") {
          await plugin.cssLoader();
        }

        const PluginCtor = await this._loadPluginCtor(plugin);
        if (!PluginCtor) continue;
        this.uppy.use(PluginCtor, plugin.config || {});
      } catch (e) {
        log.warn("[UppyPluginManager] 插件加载失败:", plugin?.key, e);
      }
    }
  }

  /**
   * 动态加载插件构造函数（带缓存）
   * @param {Object} pluginDef - 插件定义
   * @returns {Promise<any>}
   */
  async _loadPluginCtor(pluginDef) {
    const key = pluginDef?.key;
    if (!key) return null;

    if (this._pluginCtorCache?.has(key)) {
      return this._pluginCtorCache.get(key);
    }

    if (typeof pluginDef.pluginLoader !== "function") {
      return null;
    }

    const ctor = await pluginDef.pluginLoader();
    this._pluginCtorCache.set(key, ctor);
    return ctor;
  }

  /**
   * 更新语言设置
   */
  updateLocale(newLocale) {
    this.locale = newLocale;
    this.pluginDefinitions = this.createPluginDefinitions();
  }

  /**
   * 获取启用的插件数量
   */
  getEnabledPluginsCount() {
    return this.pluginDefinitions.filter((p) => p.enabled).length;
  }
}

/**
 * 创建插件管理器实例
 */
export function createUppyPluginManager(uppyInstance, locale = "zh-CN") {
  return new UppyPluginManager(uppyInstance, locale);
}
