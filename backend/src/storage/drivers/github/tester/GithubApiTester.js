/**
 * GitHub API 驱动 tester
 *
 * 目标：
 * - 验证 token + repo 可访问
 * - 验证 ref（分支）可解析
 * - 验证读能力（Contents API 列目录）
 * - 验证写能力（对同一 sha 执行一次 refs PATCH 作为“无副作用写权限探测”）
 *
 * 说明：
 * - Git commit 无法像对象存储那样“写入后无痕清理”，因此避免创建 commit。
 * - 如果分支受保护或 token 权限不足，PATCH ref 可能失败，此时驱动实际写入也会失败，故应明确提示。
 */

import { ValidationError } from "../../../../http/errors.js";

const DEFAULT_API_BASE = "https://api.github.com";

const parseRefInput = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return { kind: "empty", value: null };
  if (raw.startsWith("refs/heads/")) return { kind: "branch", value: raw.slice("refs/heads/".length) };
  if (raw.startsWith("heads/")) return { kind: "branch", value: raw.slice("heads/".length) };
  if (raw.startsWith("refs/tags/")) return { kind: "tag", value: raw.slice("refs/tags/".length) };
  if (raw.startsWith("tags/")) return { kind: "tag", value: raw.slice("tags/".length) };
  if (raw.startsWith("refs/")) return { kind: "unsupported", value: raw };
  return { kind: "any", value: raw };
};

const encodeGitRefPath = (refName) =>
  String(refName || "")
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");

const normalizeFolderPrefix = (folder) => {
  if (!folder) return "";
  let f = String(folder).trim().replace(/\\+/g, "/");
  f = f.replace(/\/+/g, "/");
  f = f.replace(/^\/+/, "").replace(/\/+$/, "");
  if (f.includes("..")) {
    throw new ValidationError("default_folder 不允许包含 .. 段");
  }
  return f;
};

const buildHeaders = (token, extra = {}) => {
  const headers = {
    "User-Agent": "CloudPaste-GithubApiTester",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

async function fetchJsonWithHeaders(url, token, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: buildHeaders(token, init.headers || {}),
  });

  let bodyText = null;
  let json = null;
  try {
    bodyText = await resp.text();
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }

  return { resp, json, bodyText };
}

export async function githubApiTestConnection(config, encryptionSecret, requestOrigin = null) {
  const owner = config?.owner;
  const repo = config?.repo;
  const token = config?.token;
  const apiBase = (config?.api_base || DEFAULT_API_BASE).toString().replace(/\/+$/, "");
  const defaultFolder = config?.default_folder || "";

  if (!owner || !repo || !token) {
    throw new ValidationError("GitHub API 配置缺少必填字段: owner/repo/token");
  }

  /** @type {{ read: any, write: any, info: any }} */
  const result = {
    read: { success: false, error: null, prefix: "/", objectCount: 0, firstObjects: [] },
    write: { success: false, error: null, note: "通过 PATCH refs 到同一 sha 进行无副作用写权限探测" },
    info: {
      endpoint: apiBase,
      owner,
      repo,
      ref: config?.ref || null,
      defaultFolder: defaultFolder || "",
      ghProxy: config?.gh_proxy || null,
      repoPrivate: null,
      permissions: null,
      rateLimit: null,
      repoEmpty: null,
    },
  };

  // 1) 仓库元信息（验证 token & repo 可访问）
  const repoUrl = `${apiBase}/repos/${owner}/${repo}`;
  const repoRes = await fetchJsonWithHeaders(repoUrl, token);
  if (!repoRes.resp.ok) {
    const msg = repoRes.json?.message || repoRes.bodyText || `HTTP ${repoRes.resp.status}`;
    return {
      success: false,
      message: `GitHub API 配置测试失败（仓库不可访问）: ${msg}`,
      result: {
        ...result,
        read: { ...result.read, success: false, error: msg },
      },
    };
  }

  const repoMeta = repoRes.json || {};
  result.info.repoPrivate = !!repoMeta.private;
  if (repoMeta.permissions && typeof repoMeta.permissions === "object") {
    result.info.permissions = {
      admin: !!repoMeta.permissions.admin,
      maintain: !!repoMeta.permissions.maintain,
      push: !!repoMeta.permissions.push,
      triage: !!repoMeta.permissions.triage,
      pull: !!repoMeta.permissions.pull,
    };
  }

  const rl = {
    limit: repoRes.resp.headers.get("x-ratelimit-limit"),
    remaining: repoRes.resp.headers.get("x-ratelimit-remaining"),
    reset: repoRes.resp.headers.get("x-ratelimit-reset"),
  };
  if (rl.limit || rl.remaining || rl.reset) {
    result.info.rateLimit = rl;
  }

  // 1.5) 空仓库判定（空仓库常见返回 409: Git Repository is empty）
  try {
    const commitsUrl = new URL(`${apiBase}/repos/${owner}/${repo}/commits`);
    commitsUrl.searchParams.set("per_page", "1");
    const commitsRes = await fetchJsonWithHeaders(commitsUrl.toString(), token);
    const isEmpty =
      commitsRes.resp.status === 409 ||
      (commitsRes.resp.ok && Array.isArray(commitsRes.json) && commitsRes.json.length === 0);
    result.info.repoEmpty = isEmpty;
  } catch {
    result.info.repoEmpty = null;
  }

  // 2) 解析 ref：branch/tag/commit sha 均可；仅分支可写
  const refRaw = config?.ref ? String(config.ref).trim() : String(repoMeta.default_branch || "").trim();
  const parsedRef = parseRefInput(refRaw);
  if (!parsedRef.value) {
    return { success: false, message: "GitHub API 配置测试失败：ref 不能为空", result };
  }
  if (parsedRef.kind === "unsupported") {
    return {
      success: false,
      message: "GitHub API 配置测试失败：ref 仅支持 refs/heads/*、heads/*、refs/tags/*、tags/* 或直接填写值",
      result,
    };
  }

  const resolvedRef = parsedRef.value;
  let isOnBranch = false;
  let resolvedBranch = null;

  // 尝试把 ref 识别为分支（存在分支时启用写权限探测；tag 明确保持只读）
  if (parsedRef.kind !== "tag") {
    try {
      const headRefUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeGitRefPath(resolvedRef)}`;
      const headRefRes = await fetchJsonWithHeaders(headRefUrl, token);
      if (headRefRes.resp.ok) {
        isOnBranch = true;
        resolvedBranch = resolvedRef;
      } else if (parsedRef.kind === "branch") {
        // 空仓库：refs/heads/<branch> 尚未创建，允许后续写入时初始化
        if (result.info.repoEmpty === true) {
          isOnBranch = true;
          resolvedBranch = resolvedRef;
        } else {
          const msg = headRefRes.json?.message || headRefRes.bodyText || `HTTP ${headRefRes.resp.status}`;
          return { success: false, message: `GitHub API 配置测试失败：分支不存在或不可访问: ${msg}`, result };
        }
      } else if (result.info.repoEmpty === true) {
        // 空仓库：无法通过 refs 判断，默认按“分支名”处理（tags/sha 在空仓库中不可用）
        isOnBranch = true;
        resolvedBranch = resolvedRef;
      }
    } catch (e) {
      if (parsedRef.kind === "branch") {
        if (result.info.repoEmpty === true) {
          isOnBranch = true;
          resolvedBranch = resolvedRef;
        } else {
          return { success: false, message: `GitHub API 配置测试失败：分支检查异常: ${e?.message || String(e)}`, result };
        }
      }
    }
  }

  result.info.resolvedRef = resolvedRef;
  result.info.isOnBranch = isOnBranch;
  result.info.resolvedBranch = resolvedBranch;

  // 3) 读测试：列出 default_folder 根目录内容（Contents API）
  try {
    const folder = normalizeFolderPrefix(defaultFolder);
    const repoPath = folder ? `/${folder}` : "/";
    const contentsUrl = new URL(`${apiBase}/repos/${owner}/${repo}/contents${repoPath === "/" ? "" : repoPath}`);
    contentsUrl.searchParams.set("ref", resolvedRef);

    const contentsRes = await fetchJsonWithHeaders(contentsUrl.toString(), token, {
      headers: { Accept: "application/vnd.github.object+json" },
    });

    if (contentsRes.resp.ok) {
      const payload = contentsRes.json;
      const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.entries) ? payload.entries : [];
      result.read.success = true;
      result.read.prefix = repoPath;
      result.read.objectCount = entries.length;
      result.read.firstObjects = entries.slice(0, 3).map((item) => ({
        key: item?.name || "",
        size: typeof item?.size === "number" ? item.size : 0,
        lastModified: new Date(0).toISOString(),
        type: item?.type || "",
      }));
    } else {
      // 空仓库：Contents 根目录返回 404，视为“空目录”
      if (result.info.repoEmpty === true && (contentsRes.resp.status === 404 || contentsRes.resp.status === 409)) {
        result.read.success = true;
        result.read.prefix = repoPath;
        result.read.objectCount = 0;
        result.read.firstObjects = [];
      } else {
        const msg = contentsRes.json?.message || contentsRes.bodyText || `HTTP ${contentsRes.resp.status}`;
        result.read.success = false;
        result.read.error = msg;
      }
    }
  } catch (error) {
    result.read.success = false;
    result.read.error = error?.message || String(error);
  }

  // 4) 写测试：仅分支可做“无副作用写权限探测”
  if (!isOnBranch) {
    result.write.success = true;
    result.write.skipped = true;
    result.write.note = "ref 非分支（tag/commit sha），Git 引用不可移动，跳过写权限探测";
  } else if (result.info.repoEmpty === true) {
    result.write.success = true;
    result.write.skipped = true;
    result.write.note = "仓库为空：无法对 refs 做“同 sha PATCH”探测；实际写入将触发初始化提交（创建首个 commit + refs/heads）";
  } else {
    try {
      const refUrl = `${apiBase}/repos/${owner}/${repo}/git/ref/heads/${encodeGitRefPath(resolvedBranch)}`;
      const refRes = await fetchJsonWithHeaders(refUrl, token);
      if (!refRes.resp.ok) {
        const msg = refRes.json?.message || refRes.bodyText || `HTTP ${refRes.resp.status}`;
        result.write.success = false;
        result.write.error = `读取分支 HEAD 失败: ${msg}`;
      } else {
        const headSha = refRes.json?.object?.sha || null;
        if (!headSha) {
          result.write.success = false;
          result.write.error = "读取分支 HEAD 失败：响应缺少 object.sha";
        } else {
          const patchUrl = `${apiBase}/repos/${owner}/${repo}/git/refs/heads/${encodeGitRefPath(resolvedBranch)}`;
          const patchRes = await fetchJsonWithHeaders(patchUrl, token, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sha: headSha, force: false }),
          });

          if (patchRes.resp.ok) {
            result.write.success = true;
            result.write.headSha = headSha;
          } else {
            const msg = patchRes.json?.message || patchRes.bodyText || `HTTP ${patchRes.resp.status}`;
            result.write.success = false;
            result.write.error = `写权限探测失败: ${msg}`;
          }
        }
      }
    } catch (error) {
      result.write.success = false;
      result.write.error = error?.message || String(error);
    }
  }

  const basicConnectSuccess = result.read.success === true;
  const writeSuccess = result.write.success === true;
  const overallSuccess = basicConnectSuccess && writeSuccess;

  let message = "GitHub API 配置测试";
  if (basicConnectSuccess) {
    if (result.write?.skipped) {
      message += "成功 (已跳过写权限探测)";
    } else if (writeSuccess) {
      message += "成功 (读写权限均可用)";
    } else {
      message += "部分成功 (仅读权限可用或分支写入被限制)";
    }
  } else {
    message += "失败 (读取权限不可用)";
  }

  return { success: overallSuccess, message, result };
}
