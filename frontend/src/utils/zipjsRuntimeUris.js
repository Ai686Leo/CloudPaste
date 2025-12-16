/**
 * zip.js（@zip.js/zip.js 2.8+）
 * - 将 Worker/WASM 资源作为标准 exports 暴露出来
 * - 通过 `configure({ workerURI, wasmURI })` 明确资源地址，避免构建器/部署路径导致的隐式加载问题
 *
 */

import zipWorkerUri from "@zip.js/zip.js/dist/zip-web-worker.js?url";
import zipWasmUri from "@zip.js/zip.js/dist/zip-module.wasm?url";

export const ZIPJS_RUNTIME_URIS = Object.freeze({
  workerURI: zipWorkerUri,
  wasmURI: zipWasmUri,
});

/**
 * 获取 zip.js 的全局默认配置（按需在业务入口调用一次 configure）
 * - 避免在模块加载阶段访问 navigator（兼容 SSR/构建期执行）
 */
export function getZipJsDefaultConfig() {
  const hardwareConcurrency = typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 2;

  return {
    ...ZIPJS_RUNTIME_URIS,
    chunkSize: 64 * 1024,
    maxWorkers: hardwareConcurrency,
    terminateWorkerTimeout: 5000, // 5秒
    useWebWorkers: true,
    useCompressionStream: true,
  };
}
