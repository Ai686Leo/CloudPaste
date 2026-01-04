/**
 * MirrorStorageDriver（只读）
 *
 * - 把“HTTP 镜像站”的目录页当成“网盘目录”来浏览
 * - 目录：抓上游目录页（大多数是 HTML），解析出文件/文件夹列表
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { DriverError, NotFoundError, ValidationError } from "../../../http/errors.js";
import { buildFileInfo } from "../../utils/FileInfoBuilder.js";
import { createHttpStreamDescriptor } from "../../streaming/StreamDescriptorUtils.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { XMLParser } from "fast-xml-parser";
import { MasqueradeClient } from "../../../utils/httpMasquerade.js";

const PRESETS = /** @type {const} */ ({
  TUNA: "tuna",
  USTC: "ustc",
  ALIYUN: "aliyun",
});

const DEFAULT_MAX_LISTING_BYTES = 2 * 1024 * 1024; // 2MB：内置保护，不暴露配置
const DEFAULT_MAX_ENTRIES = 1000; // 默认最大条目数

function parseHttpDate(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\s+/g, " ")
    .trim();
}

function parseChinaMirrorDateTime(text) {
  const t = String(text || "").trim();
  // 常见：2025-12-31 06:25:06 或 2025-12-31 06:25
  const m = t.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const date = m[1];
  const time = `${m[2]}:${m[3] || "00"}`;
  // 这些镜像站（清华/中科大/阿里云）页面显示的“更新时间”通常是北京时间（UTC+8）。
  const ms = Date.parse(`${date}T${time}+08:00`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function parseHumanSizeToBytes(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (raw === "-" || raw.toLowerCase() === "dir") return null;

  const m = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]+)$/);
  if (!m) return null;

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;

  const unit = m[2].toUpperCase();
  const bin = 1024;
  const dec = 1000;

  // 镜像站常见（tuna 使用 KiB/MiB/GiB，aliyun 使用 KB/MB/GB）
  switch (unit) {
    case "B":
      return Math.round(value);
    case "KB":
      return Math.round(value * dec);
    case "MB":
      return Math.round(value * dec * dec);
    case "GB":
      return Math.round(value * dec * dec * dec);
    case "KIB":
      return Math.round(value * bin);
    case "MIB":
      return Math.round(value * bin * bin);
    case "GIB":
      return Math.round(value * bin * bin * bin);
    default:
      return null;
  }
}

function looksLikeDirectoryListingHtml(html) {
  const text = String(html || "");
  const lower = text.toLowerCase();

  // 常见 nginx/lighttpd 目录页
  if (lower.includes("<title>index of") || lower.includes("index of /")) return true;
  if (lower.includes("<pre") && (lower.includes("parent directory") || lower.includes("parent directory/") || lower.includes("href=\"../\""))) {
    return true;
  }

  // 清华/阿里云这类“表格目录页”
  if (lower.includes("<table") && (lower.includes("file name") || lower.includes("filename") || lower.includes("class=\"link\""))) {
    return true;
  }

  // 阿里云目录页的特征
  if (lower.includes("class=\"mirror-nav\"") && lower.includes("index of")) return true;

  return false;
}

async function readTextWithLimit(resp, maxBytes) {
  if (!resp) return { text: "", truncated: false };
  if (!maxBytes || maxBytes <= 0) {
    return { text: await resp.text(), truncated: false };
  }

  const body = resp.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await resp.text();
    if (text.length > maxBytes) {
      return { text: text.slice(0, maxBytes), truncated: true };
    }
    return { text, truncated: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let truncated = false;
  let out = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength || 0;
      if (total > maxBytes) {
        truncated = true;
        out += decoder.decode(value, { stream: true });
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }

  return { text: out, truncated };
}

function looksLikeJson(text) {
  const t = String(text || "").trim();
  return t.startsWith("{") || t.startsWith("[");
}

function looksLikeXml(text) {
  const t = String(text || "").trim();
  return t.startsWith("<?xml") || (t.startsWith("<") && t.includes(">"));
}

function normalizePreset(preset) {
  const p = String(preset || "").trim().toLowerCase();
  if (p === PRESETS.TUNA) return PRESETS.TUNA;
  if (p === PRESETS.USTC) return PRESETS.USTC;
  if (p === PRESETS.ALIYUN) return PRESETS.ALIYUN;
  return null;
}

function normalizeEndpointUrl(endpointUrl) {
  const raw = String(endpointUrl || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let normalized = parsed.toString();
  if (!normalized.endsWith("/")) normalized += "/";
  return normalized;
}

function normalizeSubPath(subPath, { asDirectory = false } = {}) {
  const raw = subPath == null ? "" : String(subPath);
  let s = raw.replace(/[\\\\]+/g, "/");
  s = s.replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  if (asDirectory) {
    if (!s.endsWith("/")) s += "/";
  } else {
    if (s.length > 1) s = s.replace(/\/+$/g, "");
  }
  return s;
}

function toRelativePath(subPathOrPath, { asDirectory = false } = {}) {
  const normalized = normalizeSubPath(subPathOrPath, { asDirectory });
  if (normalized === "/") return "";
  return normalized.replace(/^\/+/, "");
}

function isBadHref(href) {
  const h = String(href || "").trim();
  if (!h) return true;
  if (h === "../" || h === "./") return true;
  if (h.startsWith("#")) return true;
  if (h.startsWith("?")) return true;
  if (/^javascript:/i.test(h)) return true;
  if (/^mailto:/i.test(h)) return true;
  if (/^data:/i.test(h)) return true;
  // 允许绝对 URL / 以 / 开头的路径：
  // - USTC/阿里云等目录页可能返回绝对链接（/ubuntu/dists/ 或 https://.../ubuntu/dists/）
  // - 后续会用“同源 + 当前目录 direct child”过滤，避免把导航外链当成目录项
  return false;
}

function normalizeListingName(raw) {
  return safeDecodeURIComponent(String(raw || "").trim().replace(/\/+$/g, ""));
}

function extractDirectChildFromHref(href, baseUrl) {
  const raw = String(href || "").trim();
  if (!raw) return null;
  if (raw === "../" || raw === "./") return null;
  if (raw.startsWith("#")) return null;
  if (raw.startsWith("?")) return null;
  if (/^javascript:/i.test(raw)) return null;
  if (/^mailto:/i.test(raw)) return null;
  if (/^data:/i.test(raw)) return null;

  if (!baseUrl) return null;

  let base;
  let resolved;
  try {
    base = new URL(String(baseUrl));
    resolved = new URL(raw, base);
  } catch {
    return null;
  }

  // 只接受同源链接，避免阿里云页面的大量外链混入
  if (resolved.origin !== base.origin) return null;

  // developer.aliyun.com/mirror/ 的分页列表页：
  // - 目录入口是 /mirror/<name>（没有结尾 /）
  // - 这些 name 对应的真实镜像目录在 mirrors.aliyun.com/<name>/ 下
  const basePathname = String(base.pathname || "/");
  const targetPathname = String(resolved.pathname || "/");
  if (
    base.hostname.endsWith("developer.aliyun.com") &&
    (basePathname === "/mirror/" || basePathname === "/mirror")
  ) {
    const m = targetPathname.match(/^\/mirror\/([^/]+)\/?$/);
    if (!m || !m[1]) return null;
    const name = normalizeListingName(m[1]);
    if (!name) return null;
    // DNS/NTP 不是镜像目录，避免混入
    const lower = name.toLowerCase();
    if (lower === "dns" || lower === "ntp") return null;
    return { name, isDirectory: true };
  }

  // 阿里云 mirrors 站点根路径会 301 到 developer 的“镜像站门户页”，但 endpoint_url 仍是 mirrors.aliyun.com。
  // 该门户页的目录入口是：/mirror/<name>，而真实镜像目录在 mirrors 域名下是：/<name>/。
  // 因此在“根目录列表”场景，把 /mirror/<name> 映射成目录 <name>/；并忽略 /mirror（筛选/分类链接）等无意义入口。
  if (base.hostname.endsWith("mirrors.aliyun.com") && basePathname === "/") {
    const m = targetPathname.match(/^\/mirror\/([^/]+)\/?$/);
    if (!m || !m[1]) return null;
    const name = normalizeListingName(m[1]);
    if (!name) return null;
    const lower = name.toLowerCase();
    if (lower === "dns" || lower === "ntp") return null;
    return { name, isDirectory: true };
  }

  // 只接受“当前目录的直接子项”
  // 例：base.pathname=/ubuntu/，允许 /ubuntu/dists/，但不允许 /ubuntu/dists/jammy/
  const basePathRaw = basePathname;
  const targetPathRaw = targetPathname;

  const basePath = safeDecodeURIComponent(basePathRaw);
  const targetPath = safeDecodeURIComponent(targetPathRaw);
  if (!targetPath.startsWith(basePath)) return null;

  const rest = targetPath.slice(basePath.length);
  if (!rest) return null;

  const trimmed = rest.replace(/^\/+/, "").replace(/\/+$/g, "");
  if (!trimmed) return null;
  if (trimmed.includes("/")) return null;

  const name = normalizeListingName(trimmed);
  if (!name) return null;

  return { name, isDirectory: targetPathRaw.endsWith("/") };
}

function extractAnchors(html, maxEntries = DEFAULT_MAX_ENTRIES) {
  const text = String(html || "");
  const anchors = [];
  const re = /<a\s+[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(text))) {
    const href = m[2] || m[3] || m[4] || "";
    const labelHtml = m[5] || "";
    anchors.push({ href: href.trim(), label: stripHtmlTags(labelHtml) });
    if (anchors.length >= maxEntries * 3) break; // 粗略防护：先截断原始候选
  }
  return anchors;
}

function sliceAliyunPortalMirrorSection(html) {
  // 阿里云 mirrors 首页是“门户页”，里面包含三块：
  // - list-box-mirror：真正的镜像目录入口（/mirror/<name>）
  // - list-box-dns / list-box-ntp：DNS/NTP 服务入口（/mirror/DNS / /mirror/NTP），这些在 Worker 抓取视角下是 404
  // 为了避免把 DNS/NTP 解析成“目录项”并产生大量重复，这里只保留 mirror 区块。
  const raw = String(html || "");
  const lower = raw.toLowerCase();
  const start = lower.indexOf("list-box-mirror");
  if (start < 0) return raw;

  const dns = lower.indexOf("list-box-dns", start);
  const ntp = lower.indexOf("list-box-ntp", start);
  const candidates = [dns, ntp].filter((n) => n > start);
  const end = candidates.length ? Math.min(...candidates) : raw.length;
  return raw.slice(start, end);
}

function parseHtmlListingGeneric(html, baseUrl = null, maxEntries = DEFAULT_MAX_ENTRIES) {
  const anchors = extractAnchors(html, maxEntries);
  const entries = [];
  for (const a of anchors) {
    if (isBadHref(a.href)) continue;
    const cleanHref = a.href.split("?")[0].split("#")[0];
    const direct = baseUrl ? extractDirectChildFromHref(cleanHref, baseUrl) : null;
    if (baseUrl && !direct) continue;

    const isDirectory = baseUrl ? direct.isDirectory : cleanHref.endsWith("/");
    // 当 baseUrl 存在时，必须用 href 推导的 direct.name 当“真实名字”，避免把导航文字当成目录名
    // 例：USTC 根页面里有 “使用帮助 >” 这样的文字链接，href 实际是 /help/
    const rawName = baseUrl
      ? direct.name
      : a.label || cleanHref.replace(/\/+$/g, "").split("/").filter(Boolean).pop() || "";
    const name = normalizeListingName(rawName);
    if (!name) continue;
    entries.push({ name, isDirectory, size: null, modified: null, href: cleanHref });
    if (entries.length >= maxEntries) break;
  }
  return entries;
}

function parseHtmlListingUstc(html, baseUrl = null, maxEntries = DEFAULT_MAX_ENTRIES) {
  // USTC 首页是“表格（含更新时间）”，子目录多为 nginx autoindex（<pre> 链接列表）。
  // 优先尝试按表格抓取更新时间，失败再回退到通用 <a> 抽取。
  const entries = [];

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(String(html || "")))) {
    const rowHtml = row[1] || "";
    const anchors = extractAnchors(rowHtml, maxEntries);
    if (!anchors.length) continue;

    const first = anchors.find((a) => !isBadHref(a.href));
    if (!first) continue;

    const cleanHref = first.href.split("?")[0].split("#")[0];
    const direct = baseUrl ? extractDirectChildFromHref(cleanHref, baseUrl) : null;
    if (baseUrl && !direct) continue;

    const isDirectory = baseUrl ? direct.isDirectory : cleanHref.endsWith("/");
    const rawName = baseUrl
      ? direct.name
      : first.label || cleanHref.replace(/\/+$/g, "").split("/").filter(Boolean).pop() || "";
    const name = normalizeListingName(rawName);
    if (!name) continue;

    // USTC: <td class="filetime">2025-12-31 06:25:06</td>
    let modified = null;
    const timeMatch =
      rowHtml.match(/class\s*=\s*["']filetime["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ||
      rowHtml.match(/<td\b[^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})\s*<\/td>/i);
    if (timeMatch && timeMatch[1]) {
      modified = parseChinaMirrorDateTime(stripHtmlTags(timeMatch[1]));
    }

    // USTC 子目录页：<td title="316478 bytes">309.06 KiB</td>
    let size = null;
    if (!isDirectory) {
      const titleBytesMatch = rowHtml.match(/title\s*=\s*["']\s*([0-9]+)\s*bytes?\s*["']/i);
      if (titleBytesMatch && titleBytesMatch[1]) {
        const n = Number(titleBytesMatch[1]);
        size = Number.isFinite(n) && n >= 0 ? n : null;
      } else {
        const sizeTextMatch = rowHtml.match(
          /<td\b[^>]*>\s*([0-9]+(?:\.[0-9]+)?\s*(?:B|KB|MB|GB|KiB|MiB|GiB))\s*<\/td>/i,
        );
        if (sizeTextMatch && sizeTextMatch[1]) {
          size = parseHumanSizeToBytes(stripHtmlTags(sizeTextMatch[1]));
        }
      }
    }

    entries.push({ name, isDirectory, size: isDirectory ? null : size, modified: modified ?? null, href: cleanHref });
    if (entries.length >= maxEntries) break;
  }

  const out = entries.length ? entries : parseHtmlListingGeneric(html, baseUrl, maxEntries);

  // USTC 根页面（/）包含站内导航（status/help），避免混进“镜像目录列表”
  if (baseUrl) {
    try {
      const u = new URL(String(baseUrl));
      if ((u.pathname || "/") === "/") {
        return out.filter((e) => {
          const n = String(e?.name || "").trim().toLowerCase();
          if (!n) return false;
          return n !== "help" && n !== "status";
        });
      }
    } catch {
      // ignore
    }
  }

  return out;
}

function parseHtmlListingTunaOrAliyun(html, baseUrl = null, maxEntries = DEFAULT_MAX_ENTRIES) {
  // tuna/aliyun 都是“表格 + date/size”的风格；这里做 best-effort 提取 date/size
  const entries = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(String(html || "")))) {
    const rowHtml = row[1] || "";
    const anchors = extractAnchors(rowHtml, maxEntries);
    if (!anchors.length) continue;

    const first = anchors.find((a) => !isBadHref(a.href));
    if (!first) continue;

    const cleanHref = first.href.split("?")[0].split("#")[0];
    const direct = baseUrl ? extractDirectChildFromHref(cleanHref, baseUrl) : null;
    if (baseUrl && !direct) continue;

    const isDirectory = baseUrl ? direct.isDirectory : cleanHref.endsWith("/");
    const rawName = baseUrl
      ? direct.name
      : first.label || cleanHref.replace(/\/+$/g, "").split("/").filter(Boolean).pop() || "";
    const name = normalizeListingName(rawName);
    if (!name) continue;

    // date / size（best-effort）
    let modified = null;
    let size = null;

    const dateMatch =
      rowHtml.match(/class\s*=\s*"date"[^>]*>([\s\S]*?)<\/[^>]+>/i) ||
      rowHtml.match(/<td\b[^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*<\/td>/i);
    if (dateMatch && dateMatch[1]) {
      const txt = stripHtmlTags(dateMatch[1]);
      modified = parseChinaMirrorDateTime(txt);
    }

    const sizeMatch =
      rowHtml.match(/class\s*=\s*"size"[^>]*>([\s\S]*?)<\/[^>]+>/i) ||
      rowHtml.match(/<td\b[^>]*>\s*([0-9]+(?:\.[0-9]+)?\s*(?:B|KB|MB|GB|KiB|MiB|GiB))\s*<\/td>/i);
    if (sizeMatch && sizeMatch[1]) {
      size = parseHumanSizeToBytes(stripHtmlTags(sizeMatch[1]));
    }

    entries.push({ name, isDirectory, size, modified, href: cleanHref });
    if (entries.length >= maxEntries) break;
  }

  // 如果表格解析不到，就回退到通用 a 链接抽取
  if (!entries.length) return parseHtmlListingGeneric(html, baseUrl, maxEntries);
  return entries;
}

function parseJsonListing(text, maxEntries = DEFAULT_MAX_ENTRIES) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    return [];
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.entries)
    ? parsed.entries
    : Array.isArray(parsed?.files)
    ? parsed.files
    : null;

  if (!arr) return [];

  const entries = [];
  for (const item of arr) {
    const nameRaw = item?.name || item?.href || item?.path || null;
    if (!nameRaw) continue;
    const name = String(nameRaw).replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
    if (!name) continue;
    const type = String(item?.type || "").toLowerCase();
    const isDirectory = type === "directory" || type === "dir" || item?.is_dir === true || item?.isDirectory === true;
    const size = typeof item?.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : null;
    const modified = item?.mtime ? new Date(Number(item.mtime) * 1000) : item?.modified ? new Date(item.modified) : null;
    entries.push({ name, isDirectory, size: isDirectory ? null : size, modified: modified instanceof Date && Number.isFinite(modified.getTime()) ? modified : null });
    if (entries.length >= maxEntries) break;
  }
  return entries;
}

function parseXmlListing(text, maxEntries = DEFAULT_MAX_ENTRIES) {
  const xml = String(text || "");
  if (!xml.trim()) return [];

  let parsed;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      trimValues: true,
    });
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  /** @type {Array<any>} */
  const nodes = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const local = String(k).includes(":") ? String(k).split(":").pop() : String(k);
      if (local === "file" || local === "directory") {
        if (Array.isArray(v)) {
          nodes.push(...v);
        } else {
          nodes.push(v);
        }
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(parsed);

  const entries = [];
  for (const n of nodes) {
    const href = n?.["@_href"] || n?.["@_name"] || n?.href || n?.name || n?.["#text"] || null;
    if (!href) continue;
    const clean = String(href).split("?")[0].split("#")[0];
    const isDirectory = String(n?.["@_type"] || "").toLowerCase() === "directory" || clean.endsWith("/");
    const name = clean.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
    if (!name) continue;
    const size = typeof n?.["@_size"] === "number" ? n["@_size"] : typeof n?.size === "number" ? n.size : null;
    const mtime = n?.["@_mtime"] ?? n?.mtime ?? null;
    const modified = mtime ? new Date(Number(mtime) * 1000) : null;
    entries.push({ name, isDirectory, size: isDirectory ? null : size, modified: modified instanceof Date && Number.isFinite(modified.getTime()) ? modified : null });
    if (entries.length >= maxEntries) break;
  }
  return entries;
}

export class MirrorStorageDriver extends BaseDriver {
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "MIRROR";
    this.encryptionSecret = encryptionSecret;
    this.capabilities = [CAPABILITIES.READER, CAPABILITIES.DIRECT_LINK, CAPABILITIES.PROXY];

    this.endpointUrlRaw = config?.endpoint_url || "";
    this.presetRaw = config?.preset || "";
    this.urlProxy = config?.url_proxy || null;
    this.enableMasquerade = config?.enable_masquerade !== false;
    this.maxEntriesRaw = config?.max_entries;

    this.endpointUrl = null;
    this.preset = null;
    this.maxEntries = DEFAULT_MAX_ENTRIES;
    this._masqueradeClient = null;
  }

  async initialize() {
    const endpointUrl = normalizeEndpointUrl(this.endpointUrlRaw);
    if (!endpointUrl) {
      throw new ValidationError("MIRROR 配置缺少 endpoint_url 或 URL 格式不合法（必须以 http(s):// 开头）");
    }
    const preset = normalizePreset(this.presetRaw);
    if (!preset) {
      throw new ValidationError("MIRROR 配置缺少 preset，或 preset 不合法（仅支持 tuna/ustc/aliyun）");
    }

    this.endpointUrl = endpointUrl;
    this.preset = preset;

    // 最大条目数：默认 1000
    const rawMaxEntries = Number(this.maxEntriesRaw);
    this.maxEntries =
      Number.isFinite(rawMaxEntries) && rawMaxEntries > 0 ? Math.floor(rawMaxEntries) : DEFAULT_MAX_ENTRIES;

    // 初始化浏览器伪装客户端
    if (this.enableMasquerade) {
      this._masqueradeClient = new MasqueradeClient({
        rotateIP: true,
        rotateUA: false,
      });
    }

    this.initialized = true;
  }

  /**
   * 构建上游请求头
   * 使用浏览器伪装（MasqueradeClient），包含：
   * - 真实的浏览器 User-Agent（基于市场份额数据的静态 UA 池）
   * - 完整的浏览器请求头（Accept, Sec-Fetch 等）
   */
  _buildUpstreamHeaders(extra = {}, targetUrl = null) {
    // 使用伪装客户端生成完整的浏览器请求头
    if (this._masqueradeClient) {
      return this._masqueradeClient.buildHeaders(extra, targetUrl);
    }

    // 不使用伪装时，只设置基本的 UA
    const base = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    // 即使不使用伪装，也添加 Referer
    if (targetUrl) {
      try {
        base["Referer"] = new URL(targetUrl).origin + "/";
      } catch {
        // URL 解析失败时忽略
      }
    }

    return { ...base, ...(extra || {}) };
  }

  async stat(subPath, ctx = {}) {
    return this.getFileInfo(subPath, ctx);
  }

  async exists(subPath, ctx = {}) {
    this._ensureInitialized();
    const normalizedSubPath = subPath ?? "/";
    const asDirectory = String(normalizedSubPath).endsWith("/");
    const upstreamUrl = this._buildUpstreamUrl(normalizedSubPath, { asDirectory });
    try {
      const resp = await fetch(upstreamUrl, {
        method: "HEAD",
        headers: this._buildUpstreamHeaders({}, upstreamUrl),
      });
      if (resp.status === 404) return false;
      if (resp.ok) return true;
      if (resp.status === 403) return true;
      return false;
    } catch {
      return false;
    }
  }

  async listDirectory(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const fsPath = ctx?.path;
    const normalizedSubPath = normalizeSubPath(subPath || "/", { asDirectory: true });
    const upstreamUrl = this._buildUpstreamUrl(normalizedSubPath, { asDirectory: true });

    const acceptHeader = "text/html,application/json,application/xml;q=0.9,*/*;q=0.8";
    const resp = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        ...this._buildUpstreamHeaders({ Accept: acceptHeader }, upstreamUrl),
      },
    });

    if (!resp.ok) {
      if (resp.status === 404) throw new NotFoundError("目录不存在");
      if (resp.status === 403) {
        const { text } = await readTextWithLimit(resp, 16 * 1024);
        const snippet = String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
        throw new DriverError(
          "上游镜像站拒绝访问（HTTP 403）：通常是上游风控把当前请求识别为“非常用软件/异常请求”。建议：减少索引/爬目录频率、降低并发、或更换镜像站。",
          { status: resp.status, details: { upstreamUrl, snippet } },
        );
      }
      throw new DriverError(`上游目录请求失败: HTTP ${resp.status}`, { status: resp.status, details: { upstreamUrl } });
    }

    let contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    let { text } = await readTextWithLimit(resp, DEFAULT_MAX_LISTING_BYTES);

    // tuna 根路径（/）在无 JS 的抓取视角下，可能会返回“浏览器不兼容/请启用 JS”的提示页，
    // 可抓取的镜像列表在 /legacy_index。这里做自动降级，避免配置根地址时目录为空。
    if (
      this.preset === PRESETS.TUNA &&
      normalizedSubPath === "/" &&
      String(text || "").includes("/legacy_index") &&
      !String(text || "").includes("<tr") &&
      !String(text || "").includes("<table")
    ) {
      try {
        const legacyUrl = new URL("/legacy_index", this.endpointUrl).toString();
        const legacyResp = await fetch(legacyUrl, {
          method: "GET",
          headers: this._buildUpstreamHeaders({ Accept: acceptHeader }, legacyUrl),
        });
        if (legacyResp.ok) {
          contentType = String(legacyResp.headers.get("content-type") || "").toLowerCase();
          text = (await readTextWithLimit(legacyResp, DEFAULT_MAX_LISTING_BYTES)).text;
        }
      } catch {
        // 降级失败就继续走原始页面解析（可能为空）
      }
    }

    const basePath = this._buildMountPath(mount, normalizedSubPath);
    let entries = this._parseListingAuto(text, contentType, upstreamUrl);

    // 阿里云镜像站：根目录是“门户列表”，并且分页为 2 页。
    if (this.preset === PRESETS.ALIYUN && normalizedSubPath === "/") {
      const extra = await this._fetchAliyunPortalSecondPageEntries(upstreamUrl, { acceptHeader });
      if (Array.isArray(extra) && extra.length) {
        entries = [...entries, ...extra];
      }
    }

    entries = this._dedupeEntries(entries);

    const items = await Promise.all(
      entries.slice(0, this.maxEntries).map(async (e) => {
        const fsPath = this._joinMountPath(basePath, e.name, e.isDirectory);
        const mimetype = e.isDirectory ? "application/x-directory" : getMimeTypeFromFilename(e.name);
        const info = await buildFileInfo({
          fsPath,
          name: e.name,
          isDirectory: e.isDirectory,
          size: e.isDirectory ? null : e.size ?? null,
          modified: e.modified ?? null,
          mimetype,
          mount,
          storageType: mount?.storage_type,
          db,
        });
        return { ...info, isVirtual: false };
      }),
    );

    return {
      path: fsPath,
      type: "directory",
      isRoot: normalizedSubPath === "/" || normalizedSubPath === "",
      isVirtual: false,
      mount_id: mount?.id ?? null,
      storage_type: mount?.storage_type ?? null,
      items,
    };
  }

  async _fetchAliyunPortalSecondPageEntries(currentUpstreamUrl, { acceptHeader } = {}) {
    let u;
    try {
      u = new URL(String(currentUpstreamUrl));
    } catch {
      return [];
    }

    const host = String(u.hostname || "");
    const path = String(u.pathname || "/");
    const isAliyunPortalHost = host.endsWith("mirrors.aliyun.com") || host.endsWith("developer.aliyun.com");
    const isAliyunPortalPath = path === "/" || path === "/mirror/" || path === "/mirror";
    if (!isAliyunPortalHost || !isAliyunPortalPath) return [];

    // 第二页稳定在 developer 域名下。
    let page2Url = null;
    if (host.endsWith("mirrors.aliyun.com")) {
      page2Url = "https://developer.aliyun.com/mirror/?pageNum=2&serviceType=mirror";
    } else if (host.endsWith("developer.aliyun.com")) {
      const next = new URL(u.toString());
      next.searchParams.set("pageNum", "2");
      next.searchParams.set("serviceType", "mirror");
      page2Url = next.toString();
    }

    if (!page2Url) return [];

    try {
      const headers = acceptHeader ? { Accept: acceptHeader } : {};
      const resp = await fetch(page2Url, {
        method: "GET",
        headers: this._buildUpstreamHeaders(headers, page2Url),
      });
      if (!resp.ok) return [];
      const ct = String(resp.headers.get("content-type") || "").toLowerCase();
      const { text } = await readTextWithLimit(resp, DEFAULT_MAX_LISTING_BYTES);
      return this._parseListingAuto(text, ct, page2Url);
    } catch {
      return [];
    }
  }

  _dedupeEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return list;
    const seen = new Set();
    const out = [];
    for (const e of list) {
      if (!e || !e.name) continue;
      const key = `${e.isDirectory ? "d" : "f"}|${String(e.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  async getFileInfo(subPath, ctx = {}) {
    this._ensureInitialized();
    const { mount, db } = ctx;
    const path = ctx?.path;
    const rawSubPath = subPath ?? "/";
    const asDirectory = String(rawSubPath).endsWith("/");
    const normalizedSubPath = normalizeSubPath(rawSubPath, { asDirectory });
    const upstreamUrl = this._buildUpstreamUrl(normalizedSubPath, { asDirectory });

    const resp = await fetch(upstreamUrl, {
      method: "HEAD",
      headers: this._buildUpstreamHeaders({}, upstreamUrl),
    });
    if (resp.status === 404) throw new NotFoundError("文件不存在");
    if (!resp.ok) {
      throw new DriverError(`获取文件信息失败: HTTP ${resp.status}`, { status: resp.status });
    }

    const contentType = String(resp.headers.get("content-type") || "");
    const name = this._basename(path);
    const headerModified = parseHttpDate(resp.headers.get("last-modified"));

    // - 路径以 / 结尾：一定按目录处理
    // - 只有当“内容看起来像目录列表页”时，才按目录处理
    let isDirectory = asDirectory;
    if (!isDirectory && contentType.toLowerCase().startsWith("text/html")) {
      try {
        const acceptHeader = "text/html,application/json,application/xml;q=0.9,*/*;q=0.8";
        const sniffResp = await fetch(upstreamUrl, {
          method: "GET",
          headers: this._buildUpstreamHeaders(
            {
              Accept: acceptHeader,
              // 只取一点点内容做判断，避免把大文件拉下来
              Range: "bytes=0-32767",
            },
            upstreamUrl,
          ),
        });
        if (sniffResp.ok) {
          const { text } = await readTextWithLimit(sniffResp, 32 * 1024);
          if (looksLikeDirectoryListingHtml(text)) {
            const entries = this._parseListingAuto(text, contentType, upstreamUrl);
            isDirectory = entries.length > 0;
          }
        }
      } catch {
        // 兜底：判断失败就当文件（更安全）
      }
    }

    let size = null;
    if (!isDirectory) {
      const cl = resp.headers.get("content-length");
      const parsed = cl != null ? Number(cl) : NaN;
      size = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }

    const mimetype = isDirectory ? "application/x-directory" : contentType || getMimeTypeFromFilename(name);

    const info = await buildFileInfo({
      fsPath: path,
      name,
      isDirectory,
      size,
      modified: headerModified,
      mimetype,
      mount,
      storageType: mount?.storage_type,
      db,
    });

    return info;
  }

  async downloadFile(subPath, ctx = {}) {
    this._ensureInitialized();
    const normalized = normalizeSubPath(subPath || "/", { asDirectory: false });
    const upstreamUrl = this._buildUpstreamUrl(normalized, { asDirectory: false });

    return createHttpStreamDescriptor({
      fetchResponse: (signal) =>
        fetch(upstreamUrl, {
          method: "GET",
          signal,
          headers: this._buildUpstreamHeaders({}, upstreamUrl),
        }),
      fetchHeadResponse: (signal) =>
        fetch(upstreamUrl, {
          method: "HEAD",
          signal,
          headers: this._buildUpstreamHeaders({}, upstreamUrl),
        }),
      fetchRangeResponse: (signal, rangeHeader) =>
        fetch(upstreamUrl, {
          method: "GET",
          signal,
          headers: this._buildUpstreamHeaders({ Range: rangeHeader }, upstreamUrl),
        }),
    });
  }

  async generateDownloadUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const normalized = normalizeSubPath(subPath || "/", { asDirectory: false });
    const url = this._buildUpstreamUrl(normalized, { asDirectory: false });
    return { url, type: "native_direct" };
  }

  async generateProxyUrl(subPath, ctx = {}) {
    this._ensureInitialized();
    const { request = null, download = false, channel = "web" } = ctx || {};
    const fsPath = ctx?.path;
    const url = buildFullProxyUrl(request, fsPath, !!download);
    return { url, type: "proxy", channel };
  }

  _parseListingAuto(bodyText, contentType, baseUrl = null) {
    const ct = String(contentType || "").toLowerCase();
    let text = String(bodyText || "");
    const maxEntries = this.maxEntries || DEFAULT_MAX_ENTRIES;

    // 1) JSON
    if (ct.includes("application/json") || (looksLikeJson(text) && !ct.includes("text/html"))) {
      const jsonEntries = parseJsonListing(text, maxEntries);
      if (jsonEntries.length) return jsonEntries;
    }

    // 2) XML（nginx/lighttpd 可能有）
    if (ct.includes("xml") || (looksLikeXml(text) && !ct.includes("text/html"))) {
      const xmlEntries = parseXmlListing(text, maxEntries);
      if (xmlEntries.length) return xmlEntries;
    }

    // 3) HTML
    if (this.preset === PRESETS.ALIYUN && baseUrl) {
      try {
        const u = new URL(String(baseUrl));
        const host = String(u.hostname || "");
        const path = String(u.pathname || "/");
        const isAliyunPortalHost = host.endsWith("mirrors.aliyun.com") || host.endsWith("developer.aliyun.com");
        const isAliyunPortalPath = path === "/" || path === "/mirror/" || path === "/mirror";
        if (isAliyunPortalHost && isAliyunPortalPath) {
          text = sliceAliyunPortalMirrorSection(text);
        }
      } catch {
        // ignore
      }
    }
    if (this.preset === PRESETS.USTC) {
      return parseHtmlListingUstc(text, baseUrl, maxEntries);
    }
    if (this.preset === PRESETS.TUNA || this.preset === PRESETS.ALIYUN) {
      return parseHtmlListingTunaOrAliyun(text, baseUrl, maxEntries);
    }
    return parseHtmlListingGeneric(text, baseUrl, maxEntries);
  }

  _buildUpstreamUrl(subPathOrPath, { asDirectory = false } = {}) {
    const rel = toRelativePath(subPathOrPath, { asDirectory });
    const url = new URL(rel, this.endpointUrl);
    return url.toString();
  }

  _buildMountPath(mount, subPath = "") {
    const mountRoot = mount?.mount_path || "/";
    const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const compact = normalized.replace(/\/+/g, "/");
    return mountRoot.endsWith("/") ? `${mountRoot.replace(/\/+$/g, "")}${compact}` : `${mountRoot}${compact}`;
  }

  _joinMountPath(basePath, name, isDirectory) {
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    return `${normalizedBase}${name}${isDirectory ? "/" : ""}`;
  }

  _basename(p) {
    const parts = (p || "").split("/").filter(Boolean);
    return parts.pop() || "";
  }
}
