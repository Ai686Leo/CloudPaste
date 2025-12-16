/**
 * Live Photo 工具函数
 *
 * 用于检测和配对 Live Photo 文件（图片 + 视频）
 *
 * Apple Live Photo 文件结构：
 * - 图片文件：.heic, .heif, .jpg, .jpeg, .png
 * - 视频文件：.mov, .mp4 (通常与图片同名)
 *
 * @module livePhotoUtils
 */

/**
 * Live Photo 支持的图片扩展名
 */
export const LIVE_PHOTO_IMAGE_EXTENSIONS = ["heic", "heif", "jpg", "jpeg", "png", "avif", "webp"];

/**
 * Live Photo 支持的视频扩展名
 */
export const LIVE_PHOTO_VIDEO_EXTENSIONS = ["mov", "mp4"];

/**
 * 获取文件扩展名（小写）
 * @param {string} filename - 文件名
 * @returns {string} 扩展名
 */
export function getExtension(filename) {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * 获取文件基础名（不含扩展名）
 * @param {string} filename - 文件名
 * @returns {string} 基础名
 */
export function getBaseName(filename) {
  if (!filename) return "";
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

/**
 * 检查文件是否为 Live Photo 支持的图片格式
 * @param {string} filename - 文件名
 * @returns {boolean}
 */
export function isLivePhotoImage(filename) {
  const ext = getExtension(filename);
  return LIVE_PHOTO_IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 在文件列表中查找 Live Photo 配对的视频文件
 *
 * 匹配规则：
 * 1. 完全同名匹配：IMG_1234.heic -> IMG_1234.mov
 * 2. 带后缀匹配：IMG_1234.heic -> IMG_1234_live.mov
 *
 * @param {string} imageFilename - 图片文件名
 * @param {Array<Object>} fileList - 文件列表，每个对象需要有 name 属性
 * @returns {Object|null} 匹配的视频文件对象，或 null
 */
export function findLivePhotoVideo(imageFilename, fileList) {
  if (!imageFilename || !fileList || !Array.isArray(fileList)) {
    return null;
  }

  const baseName = getBaseName(imageFilename);
  if (!baseName) return null;

  // 可能的视频文件名模式
  const possibleVideoNames = [];

  for (const ext of LIVE_PHOTO_VIDEO_EXTENSIONS) {
    // 完全同名
    possibleVideoNames.push(`${baseName}.${ext}`);
    // 带 _live 后缀：部分导出/转存工具会将 Live Photo 的视频部分重命名为 *_live.mov
    possibleVideoNames.push(`${baseName}_live.${ext}`);
    // 带 _video 后缀：部分工具会将视频部分显式标注为 *_video.mov
    possibleVideoNames.push(`${baseName}_video.${ext}`);
  }

  // 在文件列表中查找匹配的视频
  for (const file of fileList) {
    const fileName = file.name || file.filename || "";
    const lowerFileName = fileName.toLowerCase();

    for (const videoName of possibleVideoNames) {
      if (lowerFileName === videoName.toLowerCase()) {
        return file;
      }
    }
  }

  return null;
}

/**
 * 检测文件是否为 Live Photo（需要在文件列表中有配对的视频）
 *
 * @param {Object} file - 文件对象，需要有 name 属性
 * @param {Array<Object>} fileList - 同目录下的文件列表
 * @returns {Object} { isLivePhoto: boolean, videoFile: Object|null }
 */
export function detectLivePhoto(file, fileList) {
  const filename = file?.name || file?.filename || "";

  // 检查是否为支持的图片格式
  if (!isLivePhotoImage(filename)) {
    return { isLivePhoto: false, videoFile: null };
  }

  // 查找配对的视频文件
  const videoFile = findLivePhotoVideo(filename, fileList);

  return {
    isLivePhoto: !!videoFile,
    videoFile,
  };
}
