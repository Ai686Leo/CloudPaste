/**
 * MIRROR 驱动 tester（只读）
 *
 */

import { ValidationError } from "../../../../http/errors.js";
import { MirrorStorageDriver } from "../MirrorStorageDriver.js";

export async function mirrorTestConnection(config, _encryptionSecret, _requestOrigin = null) {
  const result = {
    info: {
      preset: String(config?.preset || "").trim().toLowerCase(),
      endpoint_url: String(config?.endpoint_url || "").trim(),
    },
    // 统一输出 read/write，匹配前端 TestResultProcessor 的通用判定逻辑
    read: {
      success: false,
      note: "只读测试：抓取上游根目录并解析条目",
      itemCount: 0,
      sampleNames: [],
      error: null,
    },
    write: {
      // MIRROR 只读：写测试不应该失败（否则前端会显示“写权限失败”）
      success: true,
      skipped: true,
      note: "MIRROR 为只读存储，跳过写测试",
      error: null,
    },
  };

  try {
    const driver = new MirrorStorageDriver(config, _encryptionSecret);
    await driver.initialize();

    const mount = { id: "mirror_tester", mount_path: "/", storage_type: "MIRROR" };
    const listing = await driver.listDirectory("/", { mount, subPath: "/", db: null });

    const items = Array.isArray(listing?.items) ? listing.items : [];
    result.info.preset = driver.preset;
    result.info.endpoint_url = driver.endpointUrl;
    result.info.endpoint = driver.endpointUrl;

    result.read.sampleNames = items
      .slice(0, 20)
      .map((it) => it?.name)
      .filter(Boolean);
    result.read.itemCount = items.length;
    result.read.success = items.length > 0;

    return {
      success: result.read.success,
      message: result.read.success
        ? "MIRROR 连通性测试成功（已抓到目录条目）"
        : "MIRROR 连通性测试部分成功（可访问，但未解析到条目）",
      result,
    };
  } catch (e) {
    // 配置错误：直接抛给上层（与其它 tester 行为一致）
    if (e instanceof ValidationError) throw e;
    result.read.success = false;
    result.read.error = e?.message || String(e);
    return { success: false, message: `MIRROR 连通性测试失败：${result.read.error}`, result };
  }
}
