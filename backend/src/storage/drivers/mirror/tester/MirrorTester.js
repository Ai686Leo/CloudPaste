/**
 * MIRROR 驱动 tester（只读）
 *
 */

import { ValidationError } from "../../../../http/errors.js";
import { MirrorStorageDriver } from "../MirrorStorageDriver.js";

export async function mirrorTestConnection(config, _encryptionSecret, _requestOrigin = null) {
  const info = {
    preset: String(config?.preset || "").trim().toLowerCase(),
    endpoint_url: String(config?.endpoint_url || "").trim(),
  };
  const readState = {
    success: false,
    note: "只读测试：抓取上游根目录并解析条目",
    itemCount: 0,
    sampleNames: [],
    error: null,
  };

  try {
    const driver = new MirrorStorageDriver(config, _encryptionSecret);
    await driver.initialize();

    const mount = { id: "mirror_tester", mount_path: "/", storage_type: "MIRROR" };
    const listing = await driver.listDirectory("/", { path: "/", mount, subPath: "/", db: null });

    const items = Array.isArray(listing?.items) ? listing.items : [];
    info.preset = driver.preset;
    info.endpoint_url = driver.endpointUrl;

    readState.sampleNames = items
      .slice(0, 20)
      .map((it) => it?.name)
      .filter(Boolean);
    readState.itemCount = items.length;
    readState.success = items.length > 0;

    const checks = [
      {
        key: "read",
        label: "读权限",
        success: readState.success === true,
        note: readState.note,
        items: [
          { key: "itemCount", label: "条目数量", value: readState.itemCount },
          { key: "sampleNames", label: "目录样本", value: readState.sampleNames },
        ],
      },
      {
        key: "write",
        label: "写权限",
        success: true,
        skipped: true,
        note: "MIRROR 为只读存储，跳过写测试",
      },
    ];

    return {
      success: readState.success === true,
      message: readState.success === true
        ? "MIRROR 连通性测试成功（已抓到目录条目）"
        : "MIRROR 连通性测试部分成功（可访问，但未解析到条目）",
      result: { info, checks },
    };
  } catch (e) {
    // 配置错误：直接抛给上层（与其它 tester 行为一致）
    if (e instanceof ValidationError) throw e;
    readState.success = false;
    readState.error = e?.message || String(e);
    const checks = [
      { key: "read", label: "读权限", success: false, error: readState.error, note: readState.note },
      { key: "write", label: "写权限", success: true, skipped: true, note: "MIRROR 为只读存储，跳过写测试" },
    ];
    return { success: false, message: `MIRROR 连通性测试失败：${readState.error}`, result: { info, checks } };
  }
}
