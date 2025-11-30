/**
 * 文档预览决策服务
 * 负责基于文件元信息与 Link JSON 生成 DocumentPreviewResult
 */

import { FILE_TYPES } from "../constants/index.js";
import previewSettingsCache from "../cache/PreviewSettingsCache.js";
import { getFileExtension } from "../utils/fileTypeDetector.js";

/**
 * 解析文件类型是否属于 Office/文档范畴
 * @param {any} fileMeta - 文件元信息（至少包含 type/typeName/mimetype/filename）
 * @returns {boolean}
 */
function isOfficeLike(fileMeta) {
  if (!fileMeta) return false;

  const typeCode = fileMeta.type;
  if (typeCode === FILE_TYPES.OFFICE || typeCode === FILE_TYPES.DOCUMENT) {
    return true;
  }

  const typeName = (fileMeta.typeName || "").toString().toLowerCase();
  if (typeName === "office" || typeName === "document") {
    return true;
  }

  const mimetype = (fileMeta.mimetype || "").toLowerCase();
  if (
    mimetype.includes("officedocument") ||
    mimetype.includes("ms-excel") ||
    mimetype.includes("ms-powerpoint") ||
    mimetype.includes("msword") ||
    mimetype === "application/rtf" ||
    mimetype === "application/pdf"
  ) {
    return true;
  }

  return false;
}

/**
 * 统一的 DocumentPreview 决策入口
 * @param {Object} fileMeta - 文件元信息（type/typeName/mimetype/filename/size 等）
 * @param {Object} linkJson - Link JSON 视角下的链接信息（rawUrl/linkType/use_proxy 等）
 * @returns {Promise<{providers?: Record<string,string>}>}
 */
export async function resolveDocumentPreview(fileMeta, linkJson) {
  const baseResult = {};

  // 非 Office/文档类型直接拒绝
  if (!isOfficeLike(fileMeta)) {
    return baseResult;
  }

  const link = linkJson || {};
  const rawUrl = link.rawUrl || null;

  // 基于扩展名与 preview_document_apps 配置选择 DocumentApp 模板
  const filename = fileMeta.filename || "";
  const extension = getFileExtension(filename);

  const appsConfig = previewSettingsCache.getDocumentAppsConfig();
  if (!appsConfig || !extension) {
    console.warn(
      "[DocumentPreview] 无有效 DocumentApp 配置或扩展名为空",
      JSON.stringify({
        filename,
        extension,
        hasConfig: !!appsConfig,
        configKeys: appsConfig ? Object.keys(appsConfig) : [],
      }),
    );
    return baseResult;
  }

  const matchedEntry = findMatchedDocumentAppEntry(appsConfig, extension, filename);
  if (!matchedEntry) {
    console.warn(
      "[DocumentPreview] 未找到匹配的 DocumentApp 条目",
      JSON.stringify({
        filename,
        extension,
        configKeys: Object.keys(appsConfig || {}),
      }),
    );
    return baseResult;
  }

  const providers = buildProvidersFromTemplate(matchedEntry.providers, {
    url: rawUrl,
    name: filename,
  });

  console.log(
    "[DocumentPreview] 已生成 providers",
    JSON.stringify({
      filename,
      extension,
      providerKeys: Object.keys(providers),
    }),
  );

  const providerKeys = Object.keys(providers);
  if (!providerKeys.length) {
    return baseResult;
  }

  return {
    providers,
  };
}

/**
 * 在 DocumentApp 配置中根据扩展名/文件名查找匹配条目
 * @param {Object} appsConfig
 * @param {string} extension
 * @param {string} filename
 * @returns {{providers: Object}|null}
 */
function findMatchedDocumentAppEntry(appsConfig, extension, filename) {
  const ext = extension.toLowerCase();

  for (const [pattern, providersConfig] of Object.entries(appsConfig)) {
    if (!providersConfig || typeof providersConfig !== "object") continue;

    let matched = false;

    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      // 正则匹配：用于高级场景（例如按文件名匹配）
      const body = pattern.slice(1, -1);
      try {
        const regex = new RegExp(body);
        matched = regex.test(filename);
      } catch (e) {
        console.warn("preview_document_apps 中正则模式无效，已跳过:", pattern, e);
      }
    } else {
      // 扩展名列表匹配
      const exts = pattern
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length > 0);
      matched = exts.includes(ext);
    }

    if (!matched) continue;

    // 归一化 providersConfig，支持 string 或 object 形式
    const normalizedProviders = {};

    for (const [providerKey, cfg] of Object.entries(providersConfig)) {
      if (!cfg) continue;

      if (typeof cfg === "string") {
        normalizedProviders[providerKey] = {
          urlTemplate: cfg,
        };
      } else if (typeof cfg === "object") {
        normalizedProviders[providerKey] = {
          urlTemplate: cfg.urlTemplate || "",
        };
      }
    }

    return { providers: normalizedProviders };
  }

  return null;
}

/**
 * 根据模板与变量构造 providers 映射
 * @param {Object} providersConfig
 * @param {{url: string|null, name: string}} vars
 * @returns {Record<string,string>}
 */
function buildProvidersFromTemplate(providersConfig, vars) {
  const result = {};

  const url = vars.url || "";
  const name = vars.name || "";

  const valueMap = {
    $url: url,
    $name: name,
    $e_url: url ? encodeURIComponent(url) : "",
  };

  for (const [providerKey, cfg] of Object.entries(providersConfig)) {
    if (!cfg || !cfg.urlTemplate) continue;
    let rendered = cfg.urlTemplate;

    rendered = rendered.replace(/\$e_url|\$url|\$name/g, (token) => valueMap[token] ?? "");

    if (rendered) {
      result[providerKey] = rendered;
    }
  }

  return result;
}
