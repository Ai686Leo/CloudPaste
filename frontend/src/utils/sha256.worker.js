/**
 * 专用 WebWorker：计算 Blob/File 的 SHA-256（hex）
 *
 * - 用 hash-wasm 的 createSHA256().update().digest() “增量”
 * - 主线程会根据文件大小决定是否用 Worker（阈值默认 10MB）
 */

import { createSHA256 } from "hash-wasm";

/**
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {string}
 */
function bufferToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * @param {Blob} file
 * @returns {Promise<string>}
 */
async function sha256HexFromBlobStream(file) {
  const sha256 = await createSHA256();
  sha256.init();

  const reader = file.stream().getReader();
  const total = file.size || 0;
  let doneBytes = 0;
  let lastReportAt = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // value 是 Uint8Array
    sha256.update(value);
    doneBytes += value.length;

    const now = Date.now();
    if (total > 0 && now - lastReportAt > 200) {
      lastReportAt = now;
      // 0~1
      self.postMessage({ progress: doneBytes / total });
    }
  }

  const hex = sha256.digest("hex");
  return typeof hex === "string" ? hex : bufferToHex(hex);
}

self.addEventListener("message", async (event) => {
  try {
    const data = event?.data || {};
    const file = data.file;
    if (!file || typeof file.stream !== "function") {
      self.postMessage({ error: "sha256 worker: file 无效" });
      return;
    }

    const hex = await sha256HexFromBlobStream(file);
    self.postMessage({ sha256: hex, progress: 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: message });
  }
});

