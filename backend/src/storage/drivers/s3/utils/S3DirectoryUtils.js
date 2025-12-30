/**
 * S3目录操作工具
 * 提供S3特定的目录操作功能，如父目录时间更新、目录存在检查等
 */

import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * 更新目录及其所有父目录的修改时间
 * @param {S3Client} s3Client - S3客户端实例
 * @param {string} bucketName - 存储桶名称
 * @param {string} filePath - 文件或目录路径
 * @param {string} rootPrefix - 根前缀
 * @param {boolean} skipMissingDirectories - 是否跳过不存在的目录（用于删除操作）
 */
export async function updateParentDirectoriesModifiedTime(s3Client, bucketName, filePath, rootPrefix = "", skipMissingDirectories = false) {
  try {
    const normalizePrefix = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      let p = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
      p = p.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!p) return "";
      return p.endsWith("/") ? p : `${p}/`;
    };

    const normalizeKey = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      let k = raw.replace(/\\+/g, "/").replace(/\/+/g, "/");
      k = k.replace(/^\/+/, "");
      return k;
    };

    const prefix = normalizePrefix(rootPrefix);
    const keyRaw = normalizeKey(filePath);
    if (!keyRaw) return;

    // 统一为“完整 S3 Key”（包含 root_prefix）
    let fullKey = keyRaw;
    if (prefix && !fullKey.startsWith(prefix)) {
      fullKey = `${prefix}${fullKey}`.replace(/\/+/g, "/");
    }

    const touchDirectoryKey = async (dirKey) => {
      const key = normalizeKey(dirKey);
      if (!key || key === "/") return false;

      // 检查目录是否存在（通过查找目录标记文件）
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      let directoryExists = false;
      try {
        await s3Client.send(headCommand);
        directoryExists = true;
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) {
          throw error;
        }
      }

      // 如果目录不存在且允许跳过缺失目录：直接跳过（用于删除/移动等场景，避免写放大）
      if (!directoryExists && skipMissingDirectories) {
        return false;
      }

      const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: "",
        ContentType: "application/x-directory",
        Metadata: {
          "last-modified": new Date().toISOString(),
        },
      };

      const putCommand = new PutObjectCommand(putParams);
      await s3Client.send(putCommand);
      return true;
    };

    // 获取文件所在的父目录 key（确保以 / 结尾）
    let currentDirKey = fullKey;
    if (!currentDirKey.endsWith("/")) {
      const lastSlashIndex = currentDirKey.lastIndexOf("/");
      if (lastSlashIndex > 0) {
        currentDirKey = currentDirKey.substring(0, lastSlashIndex + 1);
      } else {
        // 文件位于根目录（或 root_prefix 直接就是根），只需要尝试更新 root_prefix
        if (prefix) {
          await touchDirectoryKey(prefix);
        }
        return;
      }
    }

    const updated = new Set();

    // 逐级向上更新父目录，直到 root_prefix（含）为止
    while (currentDirKey && currentDirKey !== "/" && currentDirKey !== prefix) {
      if (updated.has(currentDirKey)) break;
      try {
        const touched = await touchDirectoryKey(currentDirKey);
        if (touched) {
          updated.add(currentDirKey);
          console.log(`已更新目录修改时间: ${currentDirKey}`);
        } else if (skipMissingDirectories) {
          console.log(`跳过不存在的目录: ${currentDirKey}`);
        }
      } catch (error) {
        console.warn(`更新目录修改时间失败 ${currentDirKey}:`, error);
      }

      const lastSlashIndex = currentDirKey.lastIndexOf("/", currentDirKey.length - 2);
      if (lastSlashIndex > 0) {
        currentDirKey = currentDirKey.substring(0, lastSlashIndex + 1);
      } else {
        break;
      }
    }

    // 把 root_prefix 自己也更新一下（当作“挂载根目录”）
    if (prefix && !updated.has(prefix)) {
      try {
        const touched = await touchDirectoryKey(prefix);
        if (touched) {
          console.log(`已更新目录修改时间: ${prefix}`);
        } else if (skipMissingDirectories) {
          console.log(`跳过不存在的目录: ${prefix}`);
        }
      } catch (error) {
        console.warn(`更新目录修改时间失败 ${prefix}:`, error);
      }
    }
  } catch (error) {
    console.warn(`更新父目录修改时间失败:`, error);
  }
}

/**
 * 检查S3目录是否存在
 * 从webdavUtils.js迁移而来，提供S3目录存在性检查
 * @param {S3Client} s3Client - S3客户端
 * @param {string} bucketName - 存储桶名称
 * @param {string} dirPath - 目录路径
 * @returns {Promise<boolean>} 目录是否存在
 */
export async function checkDirectoryExists(s3Client, bucketName, dirPath) {
  // 确保目录路径以斜杠结尾
  const normalizedPath = dirPath.endsWith("/") ? dirPath : dirPath + "/";

  try {
    // 首先尝试作为显式目录对象检查
    try {
      const headParams = {
        Bucket: bucketName,
        Key: normalizedPath,
      };

      const headCommand = new HeadObjectCommand(headParams);
      await s3Client.send(headCommand);
      return true; // 如果存在显式目录对象，直接返回true
    } catch (headError) {
      // 显式目录对象不存在，继续检查隐式目录
      if (headError.$metadata && headError.$metadata.httpStatusCode === 404) {
        // 尝试列出以该路径为前缀的对象
        const listParams = {
          Bucket: bucketName,
          Prefix: normalizedPath,
          MaxKeys: 1, // 只需要一个对象即可确认目录存在
        };

        const listCommand = new ListObjectsV2Command(listParams);
        const listResponse = await s3Client.send(listCommand);

        // 如果有对象以该路径为前缀，则认为目录存在
        return listResponse.Contents && listResponse.Contents.length > 0;
      } else {
        // 其他错误则抛出
        throw headError;
      }
    }
  } catch (error) {
    // 如果是最终的404错误，表示目录不存在
    if (error.$metadata && error.$metadata.httpStatusCode === 404) {
      return false;
    }
    // 其他错误则抛出
    throw error;
  }
}
