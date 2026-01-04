/**
 * HuggingFace Datasets（Hub）驱动 tester
 *
 * 1) 能不能访问到数据集（read）
 * 2) 如果配置了 token：token 是否有效、refs 能不能查（辅助判断是否可写）
 *
 */

import { ValidationError } from "../../../../http/errors.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";
import { normalizeBaseUrl, normalizeFolderPath, normalizeRepoId, splitRepoId } from "../hfUtils.js";
import { buildAuthHeaders, buildRefsApiUrl, buildTreeApiUrlWithQuery, getRevisionKind } from "../hfHubApi.js";

async function fetchJson(url, token, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: buildAuthHeaders(token, init?.headers || {}),
  });
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

export async function huggingFaceDatasetsTestConnection(config, encryptionSecret, _requestOrigin = null) {
  // endpoint_url 是可选的：
  // - 用户没填：默认走 https://huggingface.co
  // - 这里会在测试结果里展示“实际使用的端点地址”，方便排查代理/镜像问题
  const endpointConfiguredRaw = config?.endpoint_url ? String(config.endpoint_url).trim() : "";
  const endpointBase = normalizeBaseUrl(endpointConfiguredRaw);
  const repo = normalizeRepoId(config?.repo);
  const repoParts = splitRepoId(repo);
  const revision = String(config?.revision || "main").trim() || "main";
  const tokenEncrypted = config?.hf_token;
  const tokenRaw = await decryptIfNeeded(tokenEncrypted, encryptionSecret);
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() || null : null;
  const defaultFolder = normalizeFolderPath(config?.default_folder);
  const expand = config?.hf_use_paths_info === true;
  const limitRaw = config?.hf_tree_limit;
  const limit = limitRaw != null && limitRaw !== "" && Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : null;

  if (!repo) {
    throw new ValidationError("HuggingFace Datasets 配置缺少 repo（例如 Open-Orca/OpenOrca）");
  }
  if (!repoParts?.namespace || !repoParts?.repo) {
    throw new ValidationError("repo 格式无效，应为 owner/name（例如 Open-Orca/OpenOrca）");
  }

  const result = {
    info: {
      endpoint_url: endpointBase,
      repo,
      revision,
      defaultFolder: defaultFolder || "",
      hasToken: !!token,
    },
    read: { success: false, error: null, note: "读取测试：获取数据集信息 + tree 列目录" },
    write: {
      success: false,
      error: null,
      note: "写入测试：这里只做“可写可能性判断”",
      likelyWritable: false,
      revisionKind: null,
      skipped: false,
    },
  };

  const finalize = ({ success, message }) => {
    const checks = [
      {
        key: "read",
        label: "读权限",
        success: result.read.success === true,
        ...(result.read.note ? { note: result.read.note } : {}),
        ...(result.read.error ? { error: result.read.error } : {}),
        items: [
          ...(typeof result.read.objectCount === "number" ? [{ key: "objectCount", label: "对象数量", value: result.read.objectCount }] : []),
          ...(Array.isArray(result.read.sample) && result.read.sample.length ? [{ key: "sample", label: "目录样本", value: result.read.sample }] : []),
        ],
      },
      {
        key: "write",
        label: "写权限",
        success: result.write.success === true,
        ...(result.write.skipped ? { skipped: true } : {}),
        ...(result.write.note ? { note: result.write.note } : {}),
        ...(result.write.error ? { error: result.write.error } : {}),
        items: [
          ...(typeof result.write.likelyWritable === "boolean" ? [{ key: "likelyWritable", label: "可能可写", value: result.write.likelyWritable === true }] : []),
          ...(result.write.revisionKind ? [{ key: "revisionKind", label: "版本类型", value: result.write.revisionKind }] : []),
        ],
      },
    ];

    return { success, message, result: { info: result.info, checks } };
  };

  // 1) 数据集信息：验证 repo 可访问 + 判断是否 private/gated
  const repoEncoded = repo
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const infoUrl = `${endpointBase}/api/datasets/${repoEncoded}`;
  const infoRes = await fetchJson(infoUrl, token, { method: "GET", headers: { Accept: "application/json" } });

  if (infoRes.resp.status === 404) {
    result.read.success = false;
    result.read.error = "数据集不存在，或你没有权限访问（404）";
    return finalize({ success: false, message: "HuggingFace 测试失败：数据集不存在或无权限访问" });
  }

  // 没 token 的情况下，如果是 private/gated，常见会 401/403
  if ((infoRes.resp.status === 401 || infoRes.resp.status === 403) && !token) {
    result.read.success = false;
    result.read.error = "数据集需要 token 才能访问（private/gated）";
    return finalize({ success: false, message: "HuggingFace 测试失败：该数据集需要配置 HF_TOKEN 才能读取" });
  }

  if (!infoRes.resp.ok) {
    const msg = infoRes.json?.error || infoRes.json?.message || infoRes.text || `HTTP ${infoRes.resp.status}`;
    result.read.success = false;
    result.read.error = msg;
    return finalize({ success: false, message: `HuggingFace 测试失败：无法读取数据集信息（HTTP ${infoRes.resp.status}）` });
  }

  const isPrivate = infoRes.json?.private === true;
  const isGated =
    infoRes.json?.gated === true ||
    infoRes.json?.gated_dataset === true ||
    infoRes.json?.gatedRepo === true ||
    infoRes.json?.gated_repo === true;
  result.info.isPrivate = isPrivate;
  result.info.isGated = isGated;

  // 2) tree 列目录：验证“读链路”能跑通（默认不强行指定 limit，避免误报）
  const repoPath = defaultFolder || "";
  const treeUrl = buildTreeApiUrlWithQuery(
    { endpointBase, repoId: repo, revision, repoPath },
    { expand, recursive: false, limit, cursor: null },
  );
  const treeRes = await fetchJson(treeUrl, token, { method: "GET", headers: { Accept: "application/json" } });

  if (treeRes.resp.status === 401 || treeRes.resp.status === 403) {
    result.read.success = false;
    result.read.error = token ? "token 可能无权限，或 gated 未通过" : "需要 token（private/gated）";
    return finalize({ success: false, message: "HuggingFace 测试失败：tree 列目录被拒绝（401/403）" });
  }
  if (!treeRes.resp.ok) {
    result.read.success = false;
    result.read.error = treeRes.json?.error || treeRes.text || `HTTP ${treeRes.resp.status}`;
    return finalize({ success: false, message: `HuggingFace 测试失败：tree 列目录失败（HTTP ${treeRes.resp.status}）` });
  }

  const entries = Array.isArray(treeRes.json) ? treeRes.json : [];
  result.read.success = true;
  result.read.objectCount = entries.length;
  result.read.sample = entries.slice(0, 3).map((it) => ({
    type: it?.type || null,
    path: it?.path || null,
    size: typeof it?.size === "number" ? it.size : null,
  }));

  // 3) “可写可能性判断”（不做真实写入）
  if (!token) {
    result.write.skipped = true;
    result.write.likelyWritable = false;
    result.write.revisionKind = null;
    return finalize({ success: true, message: "HuggingFace 测试成功（读可用；未配置 token，写入会被禁用）" });
  }

  // refs：用于判断 revision 是 branch/tag/commit（commit sha 明确不可写）
  try {
    const kind = await getRevisionKind(
      {
        _endpointBase: endpointBase,
        _repo: repo,
        _repoParts: repoParts,
        _revision: revision,
        _token: token,
        _refsCache: { expiresAt: 0, branches: new Set(), tags: new Set(), fetchedAt: null },
        _refsInflight: null,
        _fetchJson: async (url, init = {}) => {
          const res = await fetchJson(url, token, init);
          if (!res.resp.ok) {
            throw new Error(res.json?.error || res.text || `HTTP ${res.resp.status}`);
          }
          return res.json;
        },
      },
      revision,
    );

    result.write.revisionKind = kind;
    result.write.likelyWritable = kind === "branch";
    result.write.success = kind === "branch";
    if (kind !== "branch") {
      result.write.error = "当前 revision 不是分支（tag/commit 只能读不能写）";
    }
  } catch (e) {
    // refs 失败不算致命：你真正写入时，HF 上游会给明确错误
    result.write.success = false;
    result.write.likelyWritable = false;
    result.write.error = `无法判断 revision 类型（refs 请求失败）：${e?.message || String(e)}`;
  }

  return finalize({
    success: true,
    message: result.write.likelyWritable
      ? "HuggingFace 测试成功（读可用；revision 看起来是分支，可尝试写入）"
      : "HuggingFace 测试成功（读可用；写入权限未确认或不可写）",
  });
}

export default { huggingFaceDatasetsTestConnection };
