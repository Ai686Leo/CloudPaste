import { DriverContractError } from "../../http/errors.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message, details) {
  if (condition) return;
  throw new DriverContractError(message, { details });
}

function assertString(value, label, details) {
  assert(typeof value === "string" && value.length > 0, `${label} 必须是非空字符串`, { ...details, [label]: value });
}

function assertStringAllowEmpty(value, label, details) {
  assert(typeof value === "string", `${label} 必须是字符串`, { ...details, [label]: value });
}

function assertOptionalString(value, label, details) {
  if (value == null) return;
  assert(typeof value === "string", `${label} 必须是字符串或空`, { ...details, [label]: value });
}

function assertBoolean(value, label, details) {
  assert(typeof value === "boolean", `${label} 必须是 boolean`, { ...details, [label]: value });
}

function assertNumber(value, label, details) {
  assert(typeof value === "number" && Number.isFinite(value), `${label} 必须是有效数字`, { ...details, [label]: value });
}

function assertOptionalNumber(value, label, details) {
  if (value == null) return;
  assertNumber(value, label, details);
}

function assertOptionalBoolean(value, label, details) {
  if (value == null) return;
  assertBoolean(value, label, details);
}

function assertOptionalPlainObject(value, label, details) {
  if (value == null) return;
  assert(isPlainObject(value), `${label} 必须是对象或空`, { ...details, [label]: value });
}

function assertOptionalArray(value, label, details) {
  if (value == null) return;
  assert(Array.isArray(value), `${label} 必须是数组或空`, { ...details, [label]: value });
}

function assertOptionalStringAllowEmpty(value, label, details) {
  if (value == null) return;
  assertStringAllowEmpty(value, label, details);
}

function validateRenameItemResult(args, result, ctx) {
  assert(isPlainObject(result), "renameItem 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "renameItem.success", { ...ctx, result });
  assertString(result.source, "renameItem.source", { ...ctx, result });
  assertString(result.target, "renameItem.target", { ...ctx, result });
  assertOptionalString(result.message, "renameItem.message", { ...ctx, result });

  const options = args[2];
  const oldPath = options?.oldPath;
  const newPath = options?.newPath;
  assertString(oldPath, "renameItem.options.oldPath", { ...ctx, options });
  assertString(newPath, "renameItem.options.newPath", { ...ctx, options });
  assert(result.source === oldPath, "renameItem.source 必须等于 ctx.oldPath（FS 视图路径）", { ...ctx, oldPath, newPath, result });
  assert(result.target === newPath, "renameItem.target 必须等于 ctx.newPath（FS 视图路径）", { ...ctx, oldPath, newPath, result });
}

function validateCopyItemResult(args, result, ctx) {
  assert(isPlainObject(result), "copyItem 返回值必须是对象", { ...ctx, result });
  assertString(result.status, "copyItem.status", { ...ctx, result });
  assertString(result.source, "copyItem.source", { ...ctx, result });
  assertString(result.target, "copyItem.target", { ...ctx, result });
  assertOptionalString(result.message, "copyItem.message", { ...ctx, result });

  const allowed = new Set(["success", "skipped", "failed"]);
  assert(allowed.has(result.status), "copyItem.status 必须是 success/skipped/failed 之一", { ...ctx, result });

  // 禁止旧字段/歧义字段继续存在（不做兼容）
  assert(!("error" in result), "copyItem 禁止返回 error 字段（必须使用 message）", { ...ctx, result });
  assert(!("success" in result), "copyItem 禁止返回 success 字段（以 status 作为唯一语义）", { ...ctx, result });

  if (result.status === "skipped") {
    assert("skipped" in result, "copyItem.status=skipped 时必须返回 skipped 字段", { ...ctx, result });
    assertBoolean(result.skipped, "copyItem.skipped", { ...ctx, result });
    assert(result.skipped === true, "copyItem.status=skipped 时 skipped 必须为 true", { ...ctx, result });
    assertString(result.reason, "copyItem.reason", { ...ctx, result });
  }

  const options = args[2];
  const sourcePath = options?.sourcePath;
  const targetPath = options?.targetPath;
  assertString(sourcePath, "copyItem.options.sourcePath", { ...ctx, options });
  assertString(targetPath, "copyItem.options.targetPath", { ...ctx, options });
  assert(result.source === sourcePath, "copyItem.source 必须等于 ctx.sourcePath（FS 视图路径）", { ...ctx, sourcePath, targetPath, result });
  assert(result.target === targetPath, "copyItem.target 必须等于 ctx.targetPath（FS 视图路径）", { ...ctx, sourcePath, targetPath, result });
}

function validateBatchRemoveItemsResult(_args, result, ctx) {
  assert(isPlainObject(result), "batchRemoveItems 返回值必须是对象", { ...ctx, result });
  assertNumber(result.success, "batchRemoveItems.success", { ...ctx, result });
  assert(result.success >= 0, "batchRemoveItems.success 必须 >= 0", { ...ctx, result });
  assert(Array.isArray(result.failed), "batchRemoveItems.failed 必须是数组", { ...ctx, result });

  for (const item of result.failed) {
    assert(isPlainObject(item), "batchRemoveItems.failed[] 必须是对象", { ...ctx, failedItem: item });
    assertString(item.path, "batchRemoveItems.failed[].path", { ...ctx, failedItem: item });
    assertString(item.error, "batchRemoveItems.failed[].error", { ...ctx, failedItem: item });
  }
}

function validateUploadFileResult(_args, result, ctx) {
  assert(isPlainObject(result), "uploadFile 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "uploadFile.success", { ...ctx, result });
  assertString(result.storagePath, "uploadFile.storagePath", { ...ctx, result });
  assertOptionalString(result.message, "uploadFile.message", { ...ctx, result });
}

function validateUpdateFileResult(args, result, ctx) {
  assert(isPlainObject(result), "updateFile 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "updateFile.success", { ...ctx, result });
  assertString(result.path, "updateFile.path", { ...ctx, result });
  assertOptionalString(result.message, "updateFile.message", { ...ctx, result });

  const options = args[2];
  const fsPath = options?.path;
  assertString(fsPath, "updateFile.options.path", { ...ctx, options });
  assert(result.path === fsPath, "updateFile.path 必须等于 ctx.path（FS 视图路径）", { ...ctx, fsPath, result });
}

function validateCreateDirectoryResult(args, result, ctx) {
  assert(isPlainObject(result), "createDirectory 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "createDirectory.success", { ...ctx, result });
  assertString(result.path, "createDirectory.path", { ...ctx, result });
  if (result.alreadyExists != null) {
    assertBoolean(result.alreadyExists, "createDirectory.alreadyExists", { ...ctx, result });
  }

  const options = args[1];
  const fsPath = options?.path;
  assertString(fsPath, "createDirectory.options.path", { ...ctx, options });
  assert(result.path === fsPath, "createDirectory.path 必须等于 ctx.path（FS 视图路径）", { ...ctx, fsPath, result });
}

function validateListDirectoryResult(args, result, ctx) {
  assert(isPlainObject(result), "listDirectory 返回值必须是对象", { ...ctx, result });
  assertString(result.path, "listDirectory.path", { ...ctx, result });
  assert(result.type === "directory", "listDirectory.type 必须是 directory", { ...ctx, result });
  assert(Array.isArray(result.items), "listDirectory.items 必须是数组", { ...ctx, result });

  for (const item of result.items) {
    assert(isPlainObject(item), "listDirectory.items[] 必须是对象", { ...ctx, item });
    assertString(item.path, "FileInfo.path", { ...ctx, item });
    assertString(item.name, "FileInfo.name", { ...ctx, item });
    assert(typeof item.isDirectory === "boolean", "FileInfo.isDirectory 必须是 boolean", { ...ctx, item });
  }

  const options = args[1];
  const fsPath = options?.path;
  assertString(fsPath, "listDirectory.options.path", { ...ctx, options });
  assert(result.path === fsPath, "listDirectory.path 必须等于 ctx.path（FS 视图路径）", { ...ctx, fsPath, result });
}

function validateGetFileInfoResult(args, result, ctx) {
  assert(isPlainObject(result), "getFileInfo 返回值必须是对象", { ...ctx, result });
  assertString(result.path, "getFileInfo.path", { ...ctx, result });
  assertStringAllowEmpty(result.name, "getFileInfo.name", { ...ctx, result });
  assert(typeof result.isDirectory === "boolean", "getFileInfo.isDirectory 必须是 boolean", { ...ctx, result });
  assert("size" in result, "getFileInfo.size 必须存在（允许为 null）", { ...ctx, result });
  assert("modified" in result, "getFileInfo.modified 必须存在（允许为 null）", { ...ctx, result });

  const options = args[1];
  const fsPath = options?.path;
  assertString(fsPath, "getFileInfo.options.path", { ...ctx, options });
  assert(result.path === fsPath, "getFileInfo.path 必须等于 ctx.path（FS 视图路径）", { ...ctx, fsPath, result });
}

function validateDownloadFileResult(_args, result, ctx) {
  assert(isPlainObject(result), "downloadFile 返回值必须是对象", { ...ctx, result });
  assert(typeof result.getStream === "function", "downloadFile 返回值必须包含 getStream() 方法", { ...ctx, resultKeys: Object.keys(result || {}) });
}

function validateGenerateDownloadUrlResult(_args, result, ctx) {
  assert(isPlainObject(result), "generateDownloadUrl 返回值必须是对象", { ...ctx, result });
  assertString(result.url, "generateDownloadUrl.url", { ...ctx, result });
  assertString(result.type, "generateDownloadUrl.type", { ...ctx, result });

  const allowed = new Set(["custom_host", "native_direct"]);
  assert(allowed.has(result.type), "generateDownloadUrl.type 必须是 custom_host 或 native_direct", { ...ctx, result });

  assertOptionalNumber(result.expiresIn, "generateDownloadUrl.expiresIn", { ...ctx, result });
  assertOptionalString(result.expiresAt, "generateDownloadUrl.expiresAt", { ...ctx, result });
}

function validateGenerateProxyUrlResult(_args, result, ctx) {
  assert(isPlainObject(result), "generateProxyUrl 返回值必须是对象", { ...ctx, result });
  assertString(result.url, "generateProxyUrl.url", { ...ctx, result });
  assertString(result.type, "generateProxyUrl.type", { ...ctx, result });
  assert(result.type === "proxy", "generateProxyUrl.type 必须为 proxy", { ...ctx, result });
  assertOptionalString(result.channel, "generateProxyUrl.channel", { ...ctx, result });
  assertOptionalNumber(result.expiresIn, "generateProxyUrl.expiresIn", { ...ctx, result });
}

function validateGenerateUploadUrlResult(_args, result, ctx) {
  assert(isPlainObject(result), "generateUploadUrl 返回值必须是对象", { ...ctx, result });

  // success 字段允许存在与否，但若存在必须是 boolean（避免出现 success: "true" 之类的脏数据）
  if ("success" in result) {
    assertBoolean(result.success, "generateUploadUrl.success", { ...ctx, result });
  }

  // uploadUrl：允许空字符串（用于 skipUpload=true 的“秒传/去重”场景），但必须是 string
  assert("uploadUrl" in result, "generateUploadUrl.uploadUrl 必须存在（允许为空字符串）", { ...ctx, result });
  assertStringAllowEmpty(result.uploadUrl, "generateUploadUrl.uploadUrl", { ...ctx, result });

  // storagePath：必须可用于后续 commit / 建档 / 下载
  assertString(result.storagePath, "generateUploadUrl.storagePath", { ...ctx, result });

  assertOptionalString(result.publicUrl, "generateUploadUrl.publicUrl", { ...ctx, result });
  assertOptionalString(result.contentType, "generateUploadUrl.contentType", { ...ctx, result });
  assertOptionalNumber(result.expiresIn, "generateUploadUrl.expiresIn", { ...ctx, result });
  assertOptionalString(result.sha256, "generateUploadUrl.sha256", { ...ctx, result });
  assertOptionalString(result.repoRelPath, "generateUploadUrl.repoRelPath", { ...ctx, result });
  assertOptionalBoolean(result.skipUpload, "generateUploadUrl.skipUpload", { ...ctx, result });

  // headers：可选，但若存在必须是 { [k:string]: string }
  if ("headers" in result && result.headers != null) {
    assert(isPlainObject(result.headers), "generateUploadUrl.headers 必须是对象", { ...ctx, result });
    for (const [k, v] of Object.entries(result.headers)) {
      assertStringAllowEmpty(k, "generateUploadUrl.headers.key", { ...ctx, key: k });
      assertStringAllowEmpty(v, "generateUploadUrl.headers.value", { ...ctx, key: k, value: v });
    }
  }

  // 如果不是 skipUpload，uploadUrl 必须非空
  if (result.skipUpload !== true) {
    assert(String(result.uploadUrl || "").trim().length > 0, "generateUploadUrl.skipUpload!=true 时 uploadUrl 不能为空", { ...ctx, result });
  }
}

function validateInitializeFrontendMultipartUploadResult(_args, result, ctx) {
  assert(isPlainObject(result), "initializeFrontendMultipartUpload 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "initializeFrontendMultipartUpload.success", { ...ctx, result });
  assertString(result.uploadId, "initializeFrontendMultipartUpload.uploadId", { ...ctx, result });
  assertString(result.strategy, "initializeFrontendMultipartUpload.strategy", { ...ctx, result });

  const allowed = new Set(["per_part_url", "single_session"]);
  assert(allowed.has(result.strategy), "initializeFrontendMultipartUpload.strategy 必须是 per_part_url 或 single_session", { ...ctx, result });

  assertString(result.fileName, "initializeFrontendMultipartUpload.fileName", { ...ctx, result });
  assertNumber(result.fileSize, "initializeFrontendMultipartUpload.fileSize", { ...ctx, result });
  assertNumber(result.partSize, "initializeFrontendMultipartUpload.partSize", { ...ctx, result });
  assertNumber(result.totalParts, "initializeFrontendMultipartUpload.totalParts", { ...ctx, result });
  assertString(result.key, "initializeFrontendMultipartUpload.key", { ...ctx, result });

  assertOptionalPlainObject(result.policy, "initializeFrontendMultipartUpload.policy", { ...ctx, result });
  assertOptionalBoolean(result.skipUpload, "initializeFrontendMultipartUpload.skipUpload", { ...ctx, result });

  if (result.strategy === "per_part_url") {
    assert(Array.isArray(result.presignedUrls), "initializeFrontendMultipartUpload.presignedUrls 必须是数组", { ...ctx, result });
    // skipUpload=true 时允许只返回占位 URL，否则必须至少返回一个 URL
    if (result.skipUpload !== true) {
      assert(result.presignedUrls.length > 0, "per_part_url 模式下 presignedUrls 不能为空", { ...ctx, result });
    }
    for (const item of result.presignedUrls) {
      assert(isPlainObject(item), "presignedUrls[] 必须是对象", { ...ctx, item });
      assertNumber(item.partNumber, "presignedUrls[].partNumber", { ...ctx, item });
      assert(item.partNumber > 0, "presignedUrls[].partNumber 必须 > 0", { ...ctx, item });
      assertStringAllowEmpty(item.url, "presignedUrls[].url", { ...ctx, item });
    }
  }

  if (result.strategy === "single_session") {
    assert(isPlainObject(result.session), "single_session 模式下 session 必须是对象", { ...ctx, result });
    assertString(result.session.uploadUrl, "single_session.session.uploadUrl", { ...ctx, result });
    assertOptionalArray(result.session.nextExpectedRanges, "single_session.session.nextExpectedRanges", { ...ctx, result });
    assertOptionalString(result.session.expirationDateTime, "single_session.session.expirationDateTime", { ...ctx, result });
    assertOptionalString(result.session.providerUploadUrl, "single_session.session.providerUploadUrl", { ...ctx, result });
  }
}

function validateSignMultipartPartsResult(_args, result, ctx) {
  assert(isPlainObject(result), "signMultipartParts 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "signMultipartParts.success", { ...ctx, result });
  assertString(result.uploadId, "signMultipartParts.uploadId", { ...ctx, result });
  assertString(result.strategy, "signMultipartParts.strategy", { ...ctx, result });

  const allowed = new Set(["per_part_url", "single_session"]);
  assert(allowed.has(result.strategy), "signMultipartParts.strategy 必须是 per_part_url 或 single_session", { ...ctx, result });

  assertOptionalPlainObject(result.policy, "signMultipartParts.policy", { ...ctx, result });
  assertOptionalBoolean(result.resetUploadedParts, "signMultipartParts.resetUploadedParts", { ...ctx, result });
  assertOptionalString(result.message, "signMultipartParts.message", { ...ctx, result });

  if (result.strategy === "per_part_url") {
    assert(Array.isArray(result.presignedUrls), "signMultipartParts.presignedUrls 必须是数组", { ...ctx, result });
    for (const item of result.presignedUrls) {
      assert(isPlainObject(item), "presignedUrls[] 必须是对象", { ...ctx, item });
      assertNumber(item.partNumber, "presignedUrls[].partNumber", { ...ctx, item });
      assert(item.partNumber > 0, "presignedUrls[].partNumber 必须 > 0", { ...ctx, item });
      assertStringAllowEmpty(item.url, "presignedUrls[].url", { ...ctx, item });
      assertOptionalStringAllowEmpty(item.etag, "presignedUrls[].etag", { ...ctx, item });
    }
  }

  if (result.strategy === "single_session") {
    assert(isPlainObject(result.session), "single_session 模式下 session 必须是对象", { ...ctx, result });
    assertString(result.session.uploadUrl, "single_session.session.uploadUrl", { ...ctx, result });
    assertOptionalArray(result.session.nextExpectedRanges, "single_session.session.nextExpectedRanges", { ...ctx, result });
  }
}

function validateListMultipartUploadsResult(_args, result, ctx) {
  assert(isPlainObject(result), "listMultipartUploads 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "listMultipartUploads.success", { ...ctx, result });
  assert(Array.isArray(result.uploads), "listMultipartUploads.uploads 必须是数组", { ...ctx, result });
}

function validateListMultipartPartsResult(_args, result, ctx) {
  assert(isPlainObject(result), "listMultipartParts 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "listMultipartParts.success", { ...ctx, result });
  assert("uploadId" in result, "listMultipartParts.uploadId 必须存在（允许为 null）", { ...ctx, result });
  assert(Array.isArray(result.parts), "listMultipartParts.parts 必须是数组", { ...ctx, result });
  assertOptionalArray(result.errors, "listMultipartParts.errors", { ...ctx, result });
  assertOptionalPlainObject(result.policy, "listMultipartParts.policy", { ...ctx, result });
  assertOptionalBoolean(result.uploadNotFound, "listMultipartParts.uploadNotFound", { ...ctx, result });
}

function validateCompleteFrontendMultipartUploadResult(_args, result, ctx) {
  assert(isPlainObject(result), "completeFrontendMultipartUpload 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "completeFrontendMultipartUpload.success", { ...ctx, result });
  assertOptionalString(result.storagePath, "completeFrontendMultipartUpload.storagePath", { ...ctx, result });
  assertOptionalString(result.publicUrl, "completeFrontendMultipartUpload.publicUrl", { ...ctx, result });
  assertOptionalString(result.message, "completeFrontendMultipartUpload.message", { ...ctx, result });
}

function validateAbortFrontendMultipartUploadResult(_args, result, ctx) {
  assert(isPlainObject(result), "abortFrontendMultipartUpload 返回值必须是对象", { ...ctx, result });
  assertBoolean(result.success, "abortFrontendMultipartUpload.success", { ...ctx, result });
  assertOptionalString(result.message, "abortFrontendMultipartUpload.message", { ...ctx, result });
}

function validateProxyFrontendMultipartChunkResult(_args, result, ctx) {
  assert(isPlainObject(result), "proxyFrontendMultipartChunk 返回值必须是对象", { ...ctx, result });
  assertNumber(result.status, "proxyFrontendMultipartChunk.status", { ...ctx, result });
  assertBoolean(result.done, "proxyFrontendMultipartChunk.done", { ...ctx, result });
  assertOptionalBoolean(result.skipped, "proxyFrontendMultipartChunk.skipped", { ...ctx, result });
}

function validateContextByMethod(methodName, args, ctx) {
  const details = { ...ctx, method: methodName };
  const hasMount = (options) => !!options && isPlainObject(options) && options.mount != null;

  switch (methodName) {
    case "listDirectory":
    case "getFileInfo":
    case "downloadFile":
    case "createDirectory": {
      const options = args[1];
      if (!hasMount(options)) return;
      assertString(options.path, `${methodName}.options.path`, { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.subPath, `${methodName}.options.subPath`, { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], `${methodName}.subPath`, { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, `${methodName} 第一个参数 subPath 必须等于 ctx.subPath`, { ...details, options });
      return;
    }
    case "uploadFile": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertString(options.path, "uploadFile.options.path", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.subPath, "uploadFile.options.subPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "uploadFile.subPath", { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, "uploadFile 第一个参数 subPath 必须等于 ctx.subPath", { ...details, options });
      return;
    }
    case "updateFile": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertString(options.path, "updateFile.options.path", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.subPath, "updateFile.options.subPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "updateFile.subPath", { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, "updateFile 第一个参数 subPath 必须等于 ctx.subPath", { ...details, options });
      return;
    }
    case "renameItem": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertString(options.oldPath, "renameItem.options.oldPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertString(options.newPath, "renameItem.options.newPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.oldSubPath, "renameItem.options.oldSubPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.newSubPath, "renameItem.options.newSubPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "renameItem.oldSubPath", { ...details, oldSubPath: args[0] });
      assertStringAllowEmpty(args[1], "renameItem.newSubPath", { ...details, newSubPath: args[1] });
      assert(args[0] === options.oldSubPath, "renameItem 第一个参数 oldSubPath 必须等于 ctx.oldSubPath", { ...details, options });
      assert(args[1] === options.newSubPath, "renameItem 第二个参数 newSubPath 必须等于 ctx.newSubPath", { ...details, options });
      return;
    }
    case "copyItem": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertString(options.sourcePath, "copyItem.options.sourcePath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertString(options.targetPath, "copyItem.options.targetPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.sourceSubPath, "copyItem.options.sourceSubPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.targetSubPath, "copyItem.options.targetSubPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "copyItem.sourceSubPath", { ...details, sourceSubPath: args[0] });
      assertStringAllowEmpty(args[1], "copyItem.targetSubPath", { ...details, targetSubPath: args[1] });
      assert(args[0] === options.sourceSubPath, "copyItem 第一个参数 sourceSubPath 必须等于 ctx.sourceSubPath", { ...details, options });
      assert(args[1] === options.targetSubPath, "copyItem 第二个参数 targetSubPath 必须等于 ctx.targetSubPath", { ...details, options });
      return;
    }
    case "generateDownloadUrl":
    case "generateProxyUrl":
    case "generateUploadUrl": {
      const options = args[1];
      if (!hasMount(options)) return;
      assertString(options.path, `${methodName}.options.path`, { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(options.subPath, `${methodName}.options.subPath`, { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], `${methodName}.subPath`, { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, `${methodName} 第一个参数 subPath 必须等于 ctx.subPath`, { ...details, options });
      return;
    }
    case "initializeFrontendMultipartUpload":
    case "completeFrontendMultipartUpload":
    case "abortFrontendMultipartUpload":
    case "listMultipartUploads": {
      const options = args[1];
      if (!hasMount(options)) return;
      assertStringAllowEmpty(options.subPath, `${methodName}.options.subPath`, { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], `${methodName}.subPath`, { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, `${methodName} 第一个参数 subPath 必须等于 ctx.subPath`, { ...details, options });
      return;
    }
    case "listMultipartParts": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertStringAllowEmpty(options.subPath, "listMultipartParts.options.subPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "listMultipartParts.subPath", { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, "listMultipartParts 第一个参数 subPath 必须等于 ctx.subPath", { ...details, options });
      assertString(args[1], "listMultipartParts.uploadId", { ...details, uploadId: args[1] });
      return;
    }
    case "signMultipartParts": {
      const options = args[3];
      if (!hasMount(options)) return;
      assertStringAllowEmpty(options.subPath, "signMultipartParts.options.subPath", { ...details, optionsKeys: Object.keys(options || {}) });
      assertStringAllowEmpty(args[0], "signMultipartParts.subPath", { ...details, subPath: args[0] });
      assert(args[0] === options.subPath, "signMultipartParts 第一个参数 subPath 必须等于 ctx.subPath", { ...details, options });
      assertString(args[1], "signMultipartParts.uploadId", { ...details, uploadId: args[1] });
      assert(Array.isArray(args[2]), "signMultipartParts.partNumbers 必须是数组", { ...details, partNumbers: args[2] });
      return;
    }
    case "proxyFrontendMultipartChunk": {
      const options = args[2];
      if (!hasMount(options)) return;
      assertString(options.contentRange, "proxyFrontendMultipartChunk.options.contentRange", { ...details, optionsKeys: Object.keys(options || {}) });
      assertOptionalNumber(options.contentLength, "proxyFrontendMultipartChunk.options.contentLength", { ...details, optionsKeys: Object.keys(options || {}) });
      return;
    }
    default:
      return;
  }
}

function validateByMethod(methodName, args, result, ctx) {
  switch (methodName) {
    case "renameItem":
      return validateRenameItemResult(args, result, ctx);
    case "copyItem":
      return validateCopyItemResult(args, result, ctx);
    case "batchRemoveItems":
      return validateBatchRemoveItemsResult(args, result, ctx);
    case "uploadFile":
      return validateUploadFileResult(args, result, ctx);
    case "updateFile":
      return validateUpdateFileResult(args, result, ctx);
    case "createDirectory":
      return validateCreateDirectoryResult(args, result, ctx);
    case "listDirectory":
      return validateListDirectoryResult(args, result, ctx);
    case "getFileInfo":
      return validateGetFileInfoResult(args, result, ctx);
    case "downloadFile":
      return validateDownloadFileResult(args, result, ctx);
    case "generateDownloadUrl":
      return validateGenerateDownloadUrlResult(args, result, ctx);
    case "generateProxyUrl":
      return validateGenerateProxyUrlResult(args, result, ctx);
    case "generateUploadUrl":
      return validateGenerateUploadUrlResult(args, result, ctx);
    case "initializeFrontendMultipartUpload":
      return validateInitializeFrontendMultipartUploadResult(args, result, ctx);
    case "completeFrontendMultipartUpload":
      return validateCompleteFrontendMultipartUploadResult(args, result, ctx);
    case "abortFrontendMultipartUpload":
      return validateAbortFrontendMultipartUploadResult(args, result, ctx);
    case "listMultipartUploads":
      return validateListMultipartUploadsResult(args, result, ctx);
    case "listMultipartParts":
      return validateListMultipartPartsResult(args, result, ctx);
    case "signMultipartParts":
      return validateSignMultipartPartsResult(args, result, ctx);
    case "proxyFrontendMultipartChunk":
      return validateProxyFrontendMultipartChunkResult(args, result, ctx);
    default:
      return;
  }
}

const ENFORCED_METHODS = new Set([
  "listDirectory",
  "getFileInfo",
  "downloadFile",
  "generateDownloadUrl",
  "generateProxyUrl",
  "generateUploadUrl",
  "uploadFile",
  "updateFile",
  "createDirectory",
  "renameItem",
  "copyItem",
  "batchRemoveItems",
  "initializeFrontendMultipartUpload",
  "completeFrontendMultipartUpload",
  "abortFrontendMultipartUpload",
  "listMultipartUploads",
  "listMultipartParts",
  "signMultipartParts",
  "proxyFrontendMultipartChunk",
]);

/**
 * DriverContractEnforcer
 *
 * @param {object} driver
 * @param {{ storageType?: string }} options
 * @returns {object} Proxy(driver)
 */
export function enforceDriverContract(driver, { storageType } = {}) {
  const driverType = typeof driver?.getType === "function" ? driver.getType() : driver?.type;
  assertString(driverType, "driver.getType()", { storageType, driverType });

  return new Proxy(driver, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string") return value;
      if (!ENFORCED_METHODS.has(prop)) return value;
      if (typeof value !== "function") return value;

      return async (...args) => {
        validateContextByMethod(prop, args, { storageType: storageType || null, driverType: driverType || null, method: prop });
        const result = await value.apply(target, args);
        validateByMethod(prop, args, result, { storageType: storageType || null, driverType: driverType || null, method: prop });
        return result;
      };
    },
  });
}
