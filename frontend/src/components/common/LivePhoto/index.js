/**
 * Live Photo 组件导出入口
 *
 * @module LivePhoto
 */

export { default as LivePhotoViewer } from "./LivePhotoViewer.vue";
export { useLivePhoto, LivePhotoErrorType, PlaybackStyle } from "./useLivePhoto.js";

// 默认导出组件
export { default } from "./LivePhotoViewer.vue";
