import * as ExifReaderNamespace from "exifreader";
import { FileType, getExtension } from "@/utils/fileTypes";

const ExifReader = ExifReaderNamespace?.default || ExifReaderNamespace;

const DEFAULT_IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "webp",
  "png",
  "gif",
  "bmp",
  "ico",
]);

export const DEFAULT_EXIF_FIELDS = [
  {
    key: "dateTimeOriginal",
    label: "拍摄时间",
    tags: ["DateTimeOriginal", "DateTimeDigitized", "DateTime"],
  },
  {
    key: "camera",
    label: "相机",
    tags: ["Make", "Model"],
    combine: (values) => values.filter(Boolean).join(" ").trim(),
  },
  {
    key: "lensModel",
    label: "镜头",
    tags: ["LensModel"],
  },
  {
    key: "focalLength",
    label: "焦距",
    tags: ["FocalLength"],
    format: (v) => formatFocalLength(v),
  },
  {
    key: "aperture",
    label: "光圈",
    tags: ["FNumber"],
    format: (v) => formatAperture(v),
  },
  {
    key: "shutter",
    label: "快门",
    tags: ["ExposureTime"],
    format: (v) => formatExposure(v),
  },
  {
    key: "iso",
    label: "ISO",
    tags: ["ISOSpeedRatings", "PhotographicSensitivity", "ISO"],
    format: (v) => formatISO(v),
  },
  {
    key: "location",
    label: "位置",
    resolve: (tags) => resolveGpsLocation(tags),
    always: true,
    placeholder: "None",
  },
];

export function isImageLikeForExif(item) {
  if (!item) return false;
  if (item?.isDirectory) return false;

  if (item?.type === FileType.IMAGE) return true;

  const mimetype = String(item?.mimetype || "").toLowerCase();
  if (mimetype.startsWith("image/")) {
    if (mimetype === "image/svg+xml") return false;
    return true;
  }

  const filename = item?.filename || item?.name || item?.path || "";
  const ext = getExtension(filename);
  if (!ext) return false;
  if (ext === "svg") return false;
  return DEFAULT_IMAGE_EXTS.has(ext);
}

export function loadExifTagsFromArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) return {};
  if (typeof ExifReader?.load !== "function") return {};
  // expanded=true：ExifReader 会将 EXIF 放入 tags.exif，并提供 tags.gps 便捷字段
  return ExifReader.load(arrayBuffer, { expanded: true }) || {};
}

export async function loadExifTagsFromArrayBufferAsync(arrayBuffer) {
  if (!arrayBuffer) return {};
  if (typeof ExifReader?.load !== "function") return {};

  try {
    // expanded=true：ExifReader 会将 EXIF 放入 tags.exif，并提供 tags.gps 便捷字段
    const maybePromise = ExifReader.load(arrayBuffer, { async: true, expanded: true });
    const tags = typeof maybePromise?.then === "function" ? await maybePromise : maybePromise;
    return tags || {};
  } catch {
    // 若环境不支持异步解析，回退同步解析
    try {
      return ExifReader.load(arrayBuffer, { expanded: true }) || {};
    } catch {
      return {};
    }
  }
}

export function buildExifRows(tags, fields = DEFAULT_EXIF_FIELDS) {
  const rows = [];
  const safeFields = Array.isArray(fields) ? fields : [];
  const rawTags = tags || {};
  const exifGroup = rawTags?.exif && typeof rawTags.exif === "object" ? rawTags.exif : null;
  // 兼容 expanded=true：把 tags.exif 扁平合并到顶层，让默认 fields.tags 仍可用
  const flatTags = exifGroup ? { ...exifGroup, ...rawTags } : rawTags;
  const tagCount = Object.keys(flatTags || {}).length;

  for (const field of safeFields) {
    if (!field?.key || !field?.label) continue;

    const hasResolver = typeof field.resolve === "function";
    const tagNames = Array.isArray(field?.tags) ? field.tags : [];
    if (!hasResolver && tagNames.length === 0) continue;

    if (hasResolver) {
      const resolved = String(field.resolve(flatTags) || "").trim();
      if (resolved) rows.push({ key: field.key, label: field.label, value: resolved });
      else if (field.always && tagCount > 0) rows.push({ key: field.key, label: field.label, value: field.placeholder || "未知" });
      continue;
    }

    const values = tagNames.map((name) => tagToText(flatTags?.[name])).filter(Boolean);
    if (values.length === 0) {
      if (field.always && tagCount > 0) rows.push({ key: field.key, label: field.label, value: field.placeholder || "未知" });
      continue;
    }

    let valueText = values[0];
    if (typeof field.combine === "function") {
      valueText = String(field.combine(values) || "").trim();
    }
    if (typeof field.format === "function") {
      valueText = String(field.format(valueText) || "").trim();
    }

    if (!valueText) continue;
    rows.push({ key: field.key, label: field.label, value: valueText });
  }

  return rows;
}

export async function loadExifRowsFromArrayBuffer(arrayBuffer, fields = DEFAULT_EXIF_FIELDS) {
  const tags = await loadExifTagsFromArrayBufferAsync(arrayBuffer);
  return buildExifRows(tags, fields);
}

function tagToText(tag) {
  if (!tag) return "";
  if (typeof tag === "string") return tag;
  if (typeof tag?.description === "string" && tag.description) return tag.description;

  const value = tag?.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace(".000Z", "Z");
  if (Array.isArray(value)) return value.filter((v) => v != null && String(v).trim() !== "").join(", ");
  return String(value);
}

function formatAperture(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";
  if (txt.startsWith("f/") || txt.startsWith("F/")) return `ƒ/${txt.slice(2)}`;
  if (txt.startsWith("ƒ/")) return txt;
  return `ƒ/${txt}`;
}

function formatExposure(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";
  if (txt.includes("/")) return `${txt}s`;
  if (txt.endsWith("s")) return txt;

  const n = Number(txt);
  if (Number.isFinite(n)) {
    if (n >= 1) return `${n}s`;
    const denom = Math.round(1 / n);
    if (denom > 0) return `1/${denom}s`;
  }
  return txt;
}

function formatFocalLength(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";
  if (txt.toLowerCase().includes("mm")) return txt;
  return `${txt}mm`;
}

function formatISO(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";
  if (txt.toUpperCase().startsWith("ISO")) return txt;
  return `ISO ${txt}`;
}

/**
 * 从 EXIF tags 中解析 GPS 坐标（返回数值对象）
 * @param {Object} tags - EXIF tags 对象
 * @returns {{ lat: number, lng: number } | null} - 坐标对象或 null
 */
export function resolveGpsCoordinates(tags) {
  if (!tags || Object.keys(tags).length === 0) return null;

  // 1) 优先：expanded=true 的 gps 便利字段（通常为十进制度）
  const expandedLat = normalizeGpsCoordinateValue(tags?.gps?.Latitude ?? tags?.gps?.latitude);
  const expandedLng = normalizeGpsCoordinateValue(tags?.gps?.Longitude ?? tags?.gps?.longitude);
  if (expandedLat != null && expandedLng != null) return { lat: expandedLat, lng: expandedLng };

  // 2) 回退：标准 EXIF GPS tag（度分秒 + Ref）
  const lat = parseGpsCoordinate(tags?.GPSLatitude, tags?.GPSLatitudeRef, { min: -90, max: 90 });
  const lng = parseGpsCoordinate(tags?.GPSLongitude, tags?.GPSLongitudeRef, { min: -180, max: 180 });
  if (lat != null && lng != null) return { lat, lng };

  // 3) 少数：XMP 命名空间
  const xmpLat = parseGpsCoordinate(tags?.["Xmp.exif.GPSLatitude"], tags?.["Xmp.exif.GPSLatitudeRef"], { min: -90, max: 90 });
  const xmpLng = parseGpsCoordinate(tags?.["Xmp.exif.GPSLongitude"], tags?.["Xmp.exif.GPSLongitudeRef"], { min: -180, max: 180 });
  if (xmpLat != null && xmpLng != null) return { lat: xmpLat, lng: xmpLng };

  return null;
}

function resolveGpsLocation(tags) {
  const coords = resolveGpsCoordinates(tags);
  if (!coords) return "";
  return formatLatLng(coords.lat, coords.lng);
}

function formatLatLng(lat, lng) {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  const absLat = Math.abs(lat);
  const absLng = Math.abs(lng);
  return `${absLat.toFixed(5)}°${latDir}\u2003${absLng.toFixed(5)}°${lngDir}`;
}

function parseGpsCoordinate(valueTag, refTag, { min, max }) {
  const value = normalizeGpsCoordinateValue(valueTag);
  if (value == null) return null;

  let signed = value;
  const ref = normalizeGpsRef(refTag);
  if (ref === "S" || ref === "W") signed = -Math.abs(value);
  else if (ref === "N" || ref === "E") signed = Math.abs(value);

  if (!Number.isFinite(signed)) return null;
  if (typeof min === "number" && signed < min) return null;
  if (typeof max === "number" && signed > max) return null;
  return signed;
}

function normalizeGpsRef(tag) {
  if (!tag) return "";
  const raw = tag?.value ?? tag?.description ?? tag;
  const txt = String(raw || "").trim().toUpperCase();
  if (!txt) return "";
  if (txt.startsWith("N")) return "N";
  if (txt.startsWith("S")) return "S";
  if (txt.startsWith("E")) return "E";
  if (txt.startsWith("W")) return "W";
  if (txt.includes("NORTH")) return "N";
  if (txt.includes("SOUTH")) return "S";
  if (txt.includes("EAST")) return "E";
  if (txt.includes("WEST")) return "W";
  return "";
}

function normalizeGpsCoordinateValue(tag) {
  if (!tag) return null;

  const raw = tag?.value ?? tag?.description ?? tag;
  if (typeof raw === "number") return raw;

  if (typeof raw === "string") {
    // 支持：`26.5934` / `26,35,36.4` 等
    const cleaned = raw.replace(/[^\d.,/\-\s]/g, " ").trim();
    if (!cleaned) return null;
    const n = Number(cleaned.split(/\s+/)[0]);
    return Number.isFinite(n) ? n : null;
  }

  if (Array.isArray(raw)) {
    // 常见格式：DMS [deg, min, sec]
    const parts = raw.map((v) => normalizeRational(v)).filter((v) => typeof v === "number");
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    const deg = parts[0] || 0;
    const min = parts[1] || 0;
    const sec = parts[2] || 0;
    return deg + min / 60 + sec / 3600;
  }

  const rational = normalizeRational(raw);
  return typeof rational === "number" ? rational : null;
}

function normalizeRational(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(v) && v.length >= 2) {
    const num = Number(v[0]);
    const den = Number(v[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
    return null;
  }
  if (typeof v === "object") {
    const num = v?.numerator ?? v?.num ?? v?.n ?? v?.[0];
    const den = v?.denominator ?? v?.den ?? v?.d ?? v?.[1];
    if (typeof num === "number" && typeof den === "number" && den !== 0) return num / den;
  }
  return null;
}
