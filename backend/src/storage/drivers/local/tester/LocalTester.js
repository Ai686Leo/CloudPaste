/**
 * LOCAL 驱动连接测试器
 * 测试项目：
 * 1. 路径存在性检查
 * 2. 路径是否为目录
 * 3. 读权限检查
 * 4. 写权限检查（非只读模式）
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * 测试本地存储连接
 * @param {object} config - 存储配置
 * @param {string} config.root_path - 本地根目录路径
 * @param {boolean} [config.readonly] - 是否只读模式
 * @returns {Promise<{success: boolean, message: string, result: object}>}
 */
export async function localTestConnection(config) {
  const steps = {
    pathExists: { success: false, error: null },
    isDirectory: { success: false, error: null },
    readPermission: { success: false, error: null },
    writePermission: { success: false, error: null, skipped: false, note: "" },
  };

  const info = {
    rootPath: config.root_path || "",
    readonly: config.readonly === true,
    normalizedPath: "",
  };

  const rootPath = config.root_path;

  // 验证 root_path 配置
  if (!rootPath) {
    return {
      success: false,
      message: "root_path 配置缺失",
      result: {
        info,
        checks: [
          { key: "path", label: "路径检查", success: false, error: "root_path 配置缺失" },
          { key: "read", label: "读权限", success: false, error: "root_path 配置缺失" },
          { key: "write", label: "写权限", success: false, error: "root_path 配置缺失" },
        ],
      },
    };
  }

  // 规范化路径
  const normalizedPath = path.resolve(rootPath);
  info.normalizedPath = normalizedPath;

  // 1. 路径存在性检查
  try {
    await fs.promises.access(normalizedPath, fs.constants.F_OK);
    steps.pathExists.success = true;
  } catch (err) {
    steps.pathExists.error = `路径不存在: ${err.message}`;
    return {
      success: false,
      message: `路径不存在: ${normalizedPath}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路径检查",
            success: false,
            error: steps.pathExists.error,
            items: [
              { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
              { key: "pathExists", label: "路径存在", value: false },
            ],
          },
          { key: "read", label: "读权限", success: false, error: "路径不存在" },
          { key: "write", label: "写权限", success: false, error: "路径不存在" },
        ],
      },
    };
  }

  // 2. 路径是否为目录
  try {
    const stats = await fs.promises.stat(normalizedPath);
    if (stats.isDirectory()) {
      steps.isDirectory.success = true;
    } else {
      steps.isDirectory.error = "指定路径不是目录";
      return {
        success: false,
        message: `指定路径不是目录: ${normalizedPath}`,
        result: {
          info,
          checks: [
            {
              key: "path",
              label: "路径检查",
              success: false,
              error: steps.isDirectory.error,
              items: [
                { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
                { key: "pathExists", label: "路径存在", value: true },
                { key: "isDirectory", label: "是目录", value: false },
              ],
            },
            { key: "read", label: "读权限", success: false, error: "不是目录" },
            { key: "write", label: "写权限", success: false, error: "不是目录" },
          ],
        },
      };
    }
  } catch (err) {
    steps.isDirectory.error = `获取路径信息失败: ${err.message}`;
    return {
      success: false,
      message: `获取路径信息失败: ${err.message}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路径检查",
            success: false,
            error: steps.isDirectory.error,
            items: [
              { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
              { key: "pathExists", label: "路径存在", value: true },
              { key: "isDirectory", label: "是目录", value: false },
            ],
          },
          { key: "read", label: "读权限", success: false, error: "路径信息获取失败" },
          { key: "write", label: "写权限", success: false, error: "路径信息获取失败" },
        ],
      },
    };
  }

  // 3. 读权限检查
  try {
    await fs.promises.access(normalizedPath, fs.constants.R_OK);
    // 尝试实际读取目录内容
    await fs.promises.readdir(normalizedPath);
    steps.readPermission.success = true;
  } catch (err) {
    steps.readPermission.error = `读取权限不足: ${err.message}`;
    return {
      success: false,
      message: `读取权限不足: ${err.message}`,
      result: {
        info,
        checks: [
          {
            key: "path",
            label: "路径检查",
            success: true,
            items: [
              { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
              { key: "pathExists", label: "路径存在", value: true },
              { key: "isDirectory", label: "是目录", value: true },
            ],
          },
          { key: "read", label: "读权限", success: false, error: steps.readPermission.error },
          { key: "write", label: "写权限", success: false, error: "读权限不足（未继续写测试）", skipped: true },
        ],
      },
    };
  }

  // 4. 写权限检查（非只读模式）
  if (config.readonly) {
    steps.writePermission.success = true;
    steps.writePermission.skipped = true;
    steps.writePermission.note = "只读模式，跳过写权限测试";
  } else {
    const testFileName = `.cloudpaste_test_${randomUUID()}.tmp`;
    const testFilePath = path.join(normalizedPath, testFileName);

    try {
      // 检查写权限
      await fs.promises.access(normalizedPath, fs.constants.W_OK);

      // 尝试实际写入测试文件
      const testContent = `CloudPaste connection test - ${new Date().toISOString()}`;
      await fs.promises.writeFile(testFilePath, testContent, "utf8");

      // 验证文件写入成功
      const readBack = await fs.promises.readFile(testFilePath, "utf8");
      if (readBack !== testContent) {
        throw new Error("写入验证失败：读取内容与写入内容不匹配");
      }

      // 清理测试文件
      await fs.promises.unlink(testFilePath);

      steps.writePermission.success = true;
    } catch (err) {
      steps.writePermission.error = `写入权限不足: ${err.message}`;

      // 尝试清理可能残留的测试文件
      try {
        await fs.promises.unlink(testFilePath);
      } catch {
        // 忽略清理错误
      }

      return {
        success: false,
        message: `写入权限不足: ${err.message}`,
        result: {
          info,
          checks: [
            {
              key: "path",
              label: "路径检查",
              success: true,
              items: [
                { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
                { key: "pathExists", label: "路径存在", value: true },
                { key: "isDirectory", label: "是目录", value: true },
              ],
            },
            { key: "read", label: "读权限", success: steps.readPermission.success === true },
            { key: "write", label: "写权限", success: false, error: steps.writePermission.error },
          ],
        },
      };
    }
  }

  // 所有测试通过
  const successMessage = config.readonly
    ? "本地存储连接测试成功（只读模式）"
    : "本地存储连接测试成功";

  return {
    success: true,
    message: successMessage,
    result: {
      info,
      checks: [
        {
          key: "path",
          label: "路径检查",
          success: true,
          items: [
            { key: "normalizedPath", label: "规范化路径", value: normalizedPath },
            { key: "pathExists", label: "路径存在", value: true },
            { key: "isDirectory", label: "是目录", value: true },
          ],
        },
        { key: "read", label: "读权限", success: steps.readPermission.success === true },
        {
          key: "write",
          label: "写权限",
          success: steps.writePermission.success === true,
          ...(steps.writePermission.skipped ? { skipped: true } : {}),
          ...(steps.writePermission.note ? { note: steps.writePermission.note } : {}),
        },
      ],
    },
  };
}
