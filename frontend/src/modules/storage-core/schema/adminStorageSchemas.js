const STORAGE_UNITS = [
  { value: 1, label: "B" },
  { value: 1024, label: "KB" },
  { value: 1024 * 1024, label: "MB" },
  { value: 1024 * 1024 * 1024, label: "GB" },
  { value: 1024 * 1024 * 1024 * 1024, label: "TB" },
];

function getDefaultStorageByProvider(provider) {
  switch (provider) {
    case "Cloudflare R2":
    case "Backblaze B2":
      return 10 * 1024 * 1024 * 1024;
    case "Aliyun OSS":
    default:
      return 5 * 1024 * 1024 * 1024;
  }
}

function setStorageSizeFromBytes(bytes, state) {
  if (!bytes || bytes <= 0) {
    state.storageSize = "";
    state.storageUnit = 1024 * 1024 * 1024;
    return;
  }
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < STORAGE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  state.storageSize = value.toFixed(2);
  state.storageUnit = STORAGE_UNITS[unitIndex].value;
}

function calculateStorageBytes(state) {
  if (!state.storageSize || isNaN(state.storageSize) || state.storageSize <= 0) {
    return null;
  }
  return Math.floor(parseFloat(state.storageSize) * state.storageUnit);
}

function normalizeDefaultFolder(value) {
  if (!value) return "";
  return value.toString().replace(/^\/+/, "");
}

function normalizeEndpointForWebDav(url) {
  if (!url) return "";
  let value = String(url).trim();
  if (!value.endsWith("/")) {
    value = `${value}/`;
  }
  return value;
}

function isValidUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export {
  STORAGE_UNITS,
  getDefaultStorageByProvider,
  setStorageSizeFromBytes,
  calculateStorageBytes,
  normalizeDefaultFolder,
  normalizeEndpointForWebDav,
  isValidUrl,
};
