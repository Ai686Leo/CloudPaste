/**
 * GitHub Releases 驱动 tester（只读）
 *
 * 目标：
 * - 验证 repo_structure 可解析
 * - 验证仓库可访问（/repos/{owner}/{repo}）
 * - 验证 Releases 列表可读取（/repos/{owner}/{repo}/releases）
 *
 * 说明：
 * - GITHUB_RELEASES 无写入能力，因此只做读测试。
 * - token 为可选：公共仓库可不填；私有仓库必须提供 token。
 */

import { ValidationError } from "../../../../http/errors.js";

const API_BASE = "https://api.github.com";
const DEFAULT_PER_PAGE = 1;
const MAX_CONCURRENCY = 3;

const parseRepoStructure = (repoStructure) => {
  const raw = String(repoStructure || "");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) {
    throw new ValidationError("GitHub Releases 配置 repo_structure 不能为空");
  }

  /** @type {Array<{ owner: string, repo: string, point: string }>} */
  const parsed = [];

  for (const line of lines) {
    let alias = null;
    let repoPart = line;

    // URL 形式不参与 alias: 分割，避免误把 "https:" 当 alias
    if (!/^https?:\/\/github\.com\//i.test(line)) {
      const idx = line.indexOf(":");
      if (idx >= 0) {
        alias = line.slice(0, idx).trim() || null;
        repoPart = line.slice(idx + 1).trim();
        if (!repoPart) {
          throw new ValidationError(
            `GitHub Releases 配置行格式无效，应为 owner/repo、别名:owner/repo 或 https://github.com/owner/repo，当前为: ${line}`,
          );
        }
      }
    }

    let normalized = repoPart;
    if (/^https?:\/\/github\.com\//i.test(repoPart)) {
      normalized = repoPart.replace(/^https?:\/\/github\.com\//i, "");
    }
    if (normalized.startsWith("/")) {
      throw new ValidationError(
        `GitHub Releases 配置行格式无效，不支持以 / 开头的 owner/repo，请使用 owner/repo 或 别名:owner/repo 或完整仓库 URL: ${line}`,
      );
    }

    const segments = normalized.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new ValidationError(`GitHub Releases 配置行缺少 owner/repo 信息: ${line}`);
    }

    const owner = segments[0];
    const repo = segments[1];
    parsed.push({ owner, repo, alias, raw: line });
  }

  // 多仓库：必须为每行指定别名，避免多个仓库都映射到 /
  if (parsed.length > 1) {
    const noAlias = parsed.filter((item) => !item.alias);
    if (noAlias.length > 0) {
      const examples = noAlias.map((item) => `${item.owner}/${item.repo}`).join(", ");
      throw new ValidationError(`GitHub Releases 多仓库配置必须为每行指定别名（alias:owner/repo），当前存在无别名项: ${examples}`);
    }
  }

  return parsed.map((item) => {
    let point = "/";
    if (item.alias) {
      point = item.alias.startsWith("/") ? item.alias : `/${item.alias}`;
      if (point.length > 1 && point.endsWith("/")) {
        point = point.replace(/\/+$/, "");
      }
    }
    return { point, owner: item.owner, repo: item.repo };
  });
};

const buildHeaders = (token) => {
  const headers = {
    "User-Agent": "CloudPaste-GithubReleasesTester",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

async function fetchJson(url, token) {
  const resp = await fetch(url, { method: "GET", headers: buildHeaders(token) });
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

async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

export async function githubReleasesTestConnection(config, encryptionSecret, requestOrigin = null) {
  const repoStructure = config?.repo_structure;
  if (!repoStructure || typeof repoStructure !== "string" || repoStructure.trim().length === 0) {
    throw new ValidationError("GitHub Releases 配置缺少必填字段: repo_structure");
  }

  const token = config?.token || null;
  const perPageRaw = config?.per_page;
  const perPage = Number.isFinite(Number(perPageRaw)) && Number(perPageRaw) > 0 ? Math.floor(Number(perPageRaw)) : DEFAULT_PER_PAGE;

  /** @type {{ read: any, write: any, info: any }} */
  const result = {
    read: {
      success: false,
      error: null,
      repos: [],
    },
    write: {
      success: true,
      skipped: true,
      note: "GITHUB_RELEASES 为只读驱动，跳过写权限测试",
    },
    info: {
      endpoint: API_BASE,
      requestOrigin: requestOrigin || null,
      repoCount: 0,
      perPage,
      ghProxy: config?.gh_proxy || null,
      showReadme: config?.show_readme ?? null,
      showAllVersion: config?.show_all_version ?? null,
      showSourceCode: config?.show_source_code ?? null,
      rateLimit: null,
    },
  };

  // 解析 repo_structure 得到 owner/repo 列表
  const repos = parseRepoStructure(repoStructure);
  result.info.repoCount = repos.length;

  const tasks = repos.map((repo) => async () => {
    const owner = repo?.owner || "";
    const name = repo?.repo || "";
    const point = repo?.point || "/";
    const repoKey = `${owner}/${name}`;

    const entry = {
      point,
      owner,
      repo: name,
      repoKey,
      repoAccess: { success: false, status: null, error: null, private: null },
      releases: { success: false, status: null, error: null, count: 0, latestTag: null },
    };

    // 1) 仓库可访问性（含 private 信息）
    const repoUrl = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const repoRes = await fetchJson(repoUrl, token);
    const rl = {
      limit: repoRes.resp.headers.get("x-ratelimit-limit"),
      remaining: repoRes.resp.headers.get("x-ratelimit-remaining"),
      reset: repoRes.resp.headers.get("x-ratelimit-reset"),
    };
    if (!result.info.rateLimit && (rl.limit || rl.remaining || rl.reset)) {
      result.info.rateLimit = rl;
    }

    if (!repoRes.resp.ok) {
      const msg = repoRes.json?.message || repoRes.bodyText || `HTTP ${repoRes.resp.status}`;
      entry.repoAccess = { success: false, status: repoRes.resp.status, error: msg, private: null };
      entry.releases = { success: false, status: null, error: "仓库不可访问，跳过 releases 拉取", count: 0, latestTag: null };
      return entry;
    }

    entry.repoAccess = {
      success: true,
      status: repoRes.resp.status,
      error: null,
      private: typeof repoRes.json?.private === "boolean" ? repoRes.json.private : null,
    };

    // 2) Releases 可读取性（允许无 release：200 + []）
    const releasesUrl = new URL(`${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases`);
    releasesUrl.searchParams.set("per_page", String(Math.min(Math.max(perPage, 1), 100)));
    const releasesRes = await fetchJson(releasesUrl.toString(), token);
    if (!releasesRes.resp.ok) {
      const msg = releasesRes.json?.message || releasesRes.bodyText || `HTTP ${releasesRes.resp.status}`;
      entry.releases = { success: false, status: releasesRes.resp.status, error: msg, count: 0, latestTag: null };
      return entry;
    }

    const list = Array.isArray(releasesRes.json) ? releasesRes.json : [];
    entry.releases = {
      success: true,
      status: releasesRes.resp.status,
      error: null,
      count: list.length,
      latestTag: list[0]?.tag_name || null,
    };

    return entry;
  });

  const repoResults = await runWithConcurrency(tasks, MAX_CONCURRENCY);
  result.read.repos = repoResults;

  const allOk = repoResults.length > 0 && repoResults.every((r) => r?.repoAccess?.success && r?.releases?.success);
  const anyOk = repoResults.some((r) => r?.repoAccess?.success && r?.releases?.success);

  result.read.success = allOk;
  if (!anyOk) {
    result.read.error = "所有仓库的 releases 读取均失败，请检查 repo_structure 与 token 权限";
  }

  const okCount = repoResults.filter((r) => r?.repoAccess?.success && r?.releases?.success).length;
  const failCount = repoResults.length - okCount;
  const message = allOk
    ? `GitHub Releases 配置测试成功（${okCount}/${repoResults.length} 仓库可读取 releases）`
    : `GitHub Releases 配置测试${anyOk ? "部分成功" : "失败"}（成功 ${okCount}，失败 ${failCount}）`;

  return { success: anyOk, message, result };
}
