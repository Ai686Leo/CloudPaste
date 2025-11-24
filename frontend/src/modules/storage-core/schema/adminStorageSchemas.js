const STORAGE_TYPES = {
  S3: "S3",
  WEBDAV: "WEBDAV",
};

function createS3DefaultFormState() {
  return {
    name: "",
    storage_type: STORAGE_TYPES.S3,
    provider_type: "Cloudflare R2",
    endpoint_url: "",
    bucket_name: "",
    region: "",
    access_key_id: "",
    secret_access_key: "",
    path_style: false,
    default_folder: "",
    is_public: false,
    total_storage_bytes: null,
    custom_host: "",
    signature_expires_in: 3600,
  };
}

function createWebDavDefaultFormState() {
  return {
    name: "",
    storage_type: STORAGE_TYPES.WEBDAV,
    provider_type: "",
    endpoint_url: "",
    bucket_name: "",
    region: "",
    access_key_id: "",
    secret_access_key: "",
    path_style: false,
    default_folder: "",
    is_public: false,
    total_storage_bytes: null,
    custom_host: "",
    signature_expires_in: null,
    username: "",
    password: "",
    tls_insecure_skip_verify: false,
  };
}

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

const S3_PROVIDER_TYPES = [
  { value: "Cloudflare R2", label: "Cloudflare R2" },
  { value: "Backblaze B2", label: "Backblaze B2" },
  { value: "AWS S3", label: "AWS S3" },
  { value: "Aliyun OSS", label: "阿里云OSS" },
  { value: "Other", label: "其他S3兼容服务" },
];

const STORAGE_TYPE_OPTIONS = [
  { value: STORAGE_TYPES.S3, label: "S3/对象存储" },
  { value: STORAGE_TYPES.WEBDAV, label: "WebDAV" },
];

function hydrateS3FormFromConfig(target, config) {
  target.storage_type = config.storage_type || STORAGE_TYPES.S3;
  target.name = config.name || "";
  target.provider_type = config.provider_type || target.provider_type || "Cloudflare R2";
  target.endpoint_url = config.endpoint_url || "";
  target.bucket_name = config.bucket_name || "";
  target.region = config.region || "";
  target.default_folder = config.default_folder || "";
  target.path_style = config.path_style === 1 || config.path_style === true;
  target.custom_host = config.custom_host || "";
  target.signature_expires_in = config.signature_expires_in || 3600;
  target.is_public = config.is_public === 1 || config.is_public === true;
  if (config.total_storage_bytes) {
    target.total_storage_bytes = config.total_storage_bytes;
  } else {
    target.total_storage_bytes = getDefaultStorageByProvider(target.provider_type || "Cloudflare R2");
  }
}

function hydrateWebDavFormFromConfig(target, config) {
  target.storage_type = config.storage_type || STORAGE_TYPES.WEBDAV;
  target.name = config.name || "";
  target.endpoint_url = config.endpoint_url || "";
  target.username = config.username || "";
  target.password = "";
  target.default_folder = config.default_folder || "";
  target.tls_insecure_skip_verify =
    config.tls_insecure_skip_verify === 1 || config.tls_insecure_skip_verify === true;
  target.custom_host = config.custom_host || "";
  target.is_public = config.is_public === 1 || config.is_public === true;
  if (config.total_storage_bytes) {
    target.total_storage_bytes = config.total_storage_bytes;
  } else {
    target.total_storage_bytes = getDefaultStorageByProvider("Cloudflare R2");
  }
}

function buildS3Payload(formState) {
  const totalBytes = calculateStorageBytes(formState);
  return {
    name: formState.name,
    storage_type: STORAGE_TYPES.S3,
    is_public: formState.is_public,
    total_storage_bytes: totalBytes,
    provider_type: formState.provider_type,
    endpoint_url: formState.endpoint_url,
    bucket_name: formState.bucket_name,
    region: formState.region,
    access_key_id: formState.access_key_id,
    secret_access_key: formState.secret_access_key,
    path_style: formState.path_style,
    default_folder: normalizeDefaultFolder(formState.default_folder),
    custom_host: formState.custom_host || "",
    signature_expires_in: formState.signature_expires_in,
  };
}

function buildWebDavPayload(formState) {
  const totalBytes = calculateStorageBytes(formState);
  return {
    name: formState.name,
    storage_type: STORAGE_TYPES.WEBDAV,
    is_public: formState.is_public,
    total_storage_bytes: totalBytes,
    endpoint_url: normalizeEndpointForWebDav(formState.endpoint_url),
    username: formState.username,
    password: formState.password,
    default_folder: normalizeDefaultFolder(formState.default_folder),
    tls_insecure_skip_verify: formState.tls_insecure_skip_verify,
    custom_host: formState.custom_host || "",
  };
}

function validateS3Form(formState, isEdit) {
  const hasName = !!(formState.name && formState.name.trim());
  if (!hasName || !formState.storage_type) {
    return { valid: false, message: "请填写所有必填字段" };
  }
  const s3FieldsValid =
    !!formState.provider_type && !!formState.endpoint_url && !!formState.bucket_name;
  const urlValid =
    isValidUrl(formState.endpoint_url) && isValidUrl(formState.custom_host || "");
  if (!s3FieldsValid || !urlValid) {
    return { valid: false, message: "请检查存储类型、端点 URL、Bucket 名称等必填字段" };
  }
  if (!isEdit) {
    if (!formState.access_key_id || !formState.secret_access_key) {
      return { valid: false, message: "请填写访问密钥和密钥凭证" };
    }
  }
  return { valid: true, message: "" };
}

function buildS3CardSummary(config) {
  const rows = [];
  rows.push({
    key: "bucket_name",
    label: "存储桶",
    value: config.bucket_name || "",
    show: !!config.bucket_name,
  });
  rows.push({
    key: "region",
    label: "区域",
    value: config.region || "自动",
    show: true,
  });
  rows.push({
    key: "default_folder",
    label: "默认文件夹",
    value: config.default_folder || "根目录",
    show: !!config.default_folder,
  });
  if (config.path_style !== undefined) {
    rows.push({
      key: "path_style",
      label: "路径样式",
      value: config.path_style ? "路径样式" : "虚拟主机样式",
      show: true,
    });
  }
  return rows;
}

function buildWebDavCardSummary(config) {
  const rows = [];
  rows.push({
    key: "endpoint_url",
    label: "端点地址",
    value: config.endpoint_url || "",
    show: !!config.endpoint_url,
  });
  rows.push({
    key: "username",
    label: "用户名",
    value: config.username || "",
    show: !!config.username,
  });
  rows.push({
    key: "default_folder",
    label: "默认目录",
    value: config.default_folder || "/",
    show: !!config.default_folder,
  });
  if (config.tls_insecure_skip_verify) {
    rows.push({
      key: "tls_insecure_skip_verify",
      label: "TLS验证",
      value: "跳过证书校验",
      show: true,
    });
  }
  return rows;
}

function validateWebDavForm(formState, isEdit) {
  const hasName = !!(formState.name && formState.name.trim());
  if (!hasName || !formState.storage_type) {
    return { valid: false, message: "请填写所有必填字段" };
  }
  if (!formState.endpoint_url || !isValidUrl(formState.endpoint_url)) {
    return { valid: false, message: "请填写合法的 WebDAV 端点 URL" };
  }
  if (!isValidUrl(formState.custom_host || "")) {
    return { valid: false, message: "自定义 HOST 格式不正确" };
  }
  const passwordOk = isEdit ? true : !!formState.password;
  if (!formState.username || !passwordOk) {
    return { valid: false, message: "请填写用户名和密码" };
  }
  return { valid: true, message: "" };
}

const AdminStorageStrategies = {
  [STORAGE_TYPES.S3]: {
    type: STORAGE_TYPES.S3,
    storageTypesOptions: STORAGE_TYPE_OPTIONS,
    providerTypes: S3_PROVIDER_TYPES,
    storageUnits: STORAGE_UNITS,
    createDefaultFormState: () => createS3DefaultFormState(),
    hydrateFormFromConfig: hydrateS3FormFromConfig,
    setStorageSizeFromBytes,
    calculateStorageBytes,
    getDefaultStorageByProvider,
    buildPayload: buildS3Payload,
    validate: validateS3Form,
    buildCardSummary: buildS3CardSummary,
  },
  [STORAGE_TYPES.WEBDAV]: {
    type: STORAGE_TYPES.WEBDAV,
    storageTypesOptions: STORAGE_TYPE_OPTIONS,
    providerTypes: [],
    storageUnits: STORAGE_UNITS,
    createDefaultFormState: () => createWebDavDefaultFormState(),
    hydrateFormFromConfig: hydrateWebDavFormFromConfig,
    setStorageSizeFromBytes,
    calculateStorageBytes,
    getDefaultStorageByProvider,
    buildPayload: buildWebDavPayload,
    validate: validateWebDavForm,
    buildCardSummary: buildWebDavCardSummary,
  },
};

function getAdminStorageStrategy(type) {
  const key = type || STORAGE_TYPES.S3;
  if (AdminStorageStrategies[key]) {
    return AdminStorageStrategies[key];
  }
  return AdminStorageStrategies[STORAGE_TYPES.S3];
}

export {
  STORAGE_TYPES,
  STORAGE_UNITS,
  STORAGE_TYPE_OPTIONS,
  S3_PROVIDER_TYPES,
  getAdminStorageStrategy,
};
