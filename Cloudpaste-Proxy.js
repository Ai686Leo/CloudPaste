// 通用边缘反向代理示例（Cloudflare Workers / Deno Deploy / Vercel Edge 等）
// 依赖标准 Fetch API 与 Web Crypto，不绑定具体平台。
//
// 配置方式有两种（二选一）：
// 1）直接修改下方常量（最适合在 Cloudflare Worker / Deno 在线编辑器里复制即用）
// 2）在运行时通过 env.{ORIGIN,TOKEN,SIGN_SECRET,WORKER_BASE} 覆盖这些常量
//
// 字段说明：
// - ORIGIN：
//   CloudPaste 后端地址，例如 https://cloudpaste.example.com 项目的后端地址

// - TOKEN：
//   反代调用 CloudPaste /api/proxy/link 时使用的认证凭证，会被放在 Authorization 头里。
//   CloudPaste 的 AuthService 会解析 Authorization 头：
//     - 形如 "Bearer <adminToken>" 时按管理员令牌验证（validateAdminToken）
//     - 形如 "ApiKey <apiKeyValue>" 时按 API 密钥验证
//   推荐做法：
//     1）在 CloudPaste 后台创建一个专用的 API 密钥，并启用它
//     2）将 TOKEN 设置为完整的认证头串，例如：TOKEN = "ApiKey KS6PPQAKz8dRPhATdJ4wx3tA8rxsGKXx"
//   也可以使用管理员 Token：TOKEN = "Bearer <adminToken>"，但生产环境更推荐使用专用 API Key。

// - SIGN_SECRET：
//   FS 场景下 /proxy/fs 路由使用的 HMAC 签名密钥。
//   后端 .env 中 ENCRYPTION_SECRET 相同的值

// - WORKER_BASE：
//   本反代对外地址，例如 https://proxy.example.com，自己反代的域名地址，仅用于检测上游重定向是否回环到自身。
//   配错最多会导致“回环检测”不生效，不会影响正常代理功能。

// ==== 全局配置（可直接修改为你自己的值 / 在运行时通过 env 覆盖） ====
let ORIGIN = "https://cloudpaste.example.com";
let TOKEN = "ApiKey xxx";
let SIGN_SECRET = "default-encryption-key";
let WORKER_BASE = "https://proxy.example.com";

// 从 env 覆盖全局配置（如 Cloudflare Worker 的 env、Deno.serve 传入的对象等）
function initFromEnv(env) {
  if (!env) return;
  if (env.ORIGIN) ORIGIN = String(env.ORIGIN);
  if (env.TOKEN) TOKEN = String(env.TOKEN);
  if (env.SIGN_SECRET) SIGN_SECRET = String(env.SIGN_SECRET);
  if (env.WORKER_BASE) WORKER_BASE = String(env.WORKER_BASE);
}

const textEncoder = new TextEncoder();

/** 将 HMAC-SHA256 结果编码为标准 Base64 字符串（与 Node.js crypto.digest("base64") 对齐） */
async function hmacSha256Base64(secret, data) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  // 标准 Base64，与 CloudPaste ProxySignatureService 的 digest("base64") 完全一致
  return btoa(bin);
}

/**
 * 校验 FS 场景下的签名：
 * sign 形如 "<base64UrlHash>:<expire>"，其中 expire 为秒级时间戳，0 表示永不过期。
 */
async function verifyFsSign(path, sign, secret) {
  // 未提供 sign 时，反代层不做校验，完全交由 CloudPaste 按挂载/全局策略决定是否需要签名。
  // - 当挂载/全局未启用签名时，LinkService 生成的 url_proxy 入口本身就不会带 sign。
  // - 当挂载启用签名时，CloudPaste 仍会在 /api/p 链路上强制验证签名，保证安全性。
  if (!sign) return "";
  const parts = String(sign).split(":");
  if (!parts.length) return "expire missing";
  const expireStr = parts[parts.length - 1];
  if (!expireStr) return "expire missing";

  const expire = parseInt(expireStr, 10);
  if (Number.isNaN(expire)) return "expire invalid";
  if (expire > 0 && Math.floor(Date.now() / 1000) > expire) {
    return "expire expired";
  }

  const base = await hmacSha256Base64(secret, `${path}:${expireStr}`);
  const expected = `${base}:${expireStr}`;
  if (expected !== sign) return "sign mismatch";
  return "";
}

/** 将 CloudPaste /api/proxy/link 响应的 header 映射到请求头 */
function applyUpstreamHeaders(request, headerMap) {
  if (!headerMap || typeof headerMap !== "object") {
    return request;
  }
  const next = new Request(request);
  for (const [k, values] of Object.entries(headerMap)) {
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      next.headers.set(k, String(v));
    }
  }
  return next;
}

/** 判断重定向是否指向当前反代自身（用于避免无限循环） */
function isSelfRedirect(location, currentHost) {
  if (!location) return false;
  try {
    const loc = new URL(location, "http://dummy");
    const target = loc.host;

    // 1. 显式配置的 WORKER_BASE
    if (WORKER_BASE) {
      const base = new URL(WORKER_BASE);
      if (target === base.host) return true;
    }

    // 2. 回落到当前请求 Host
    if (currentHost && target === currentHost) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/** 处理 /proxy/fs 与 /proxy/share 的统一入口（平台无关核心逻辑） */
export async function handleProxyRequest(request, env) {
  // 优先使用传入 env 覆盖全局配置，方便在不同平台注入机密
  initFromEnv(env);

  if (!ORIGIN || !TOKEN || !SIGN_SECRET) {
    return new Response(JSON.stringify({ code: 500, message: "proxy env not configured" }), {
      status: 500,
      headers: { "content-type": "application/json;charset=UTF-8" },
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const requestOrigin = request.headers.get("Origin") || "*";

  // 统一处理 CORS 预检请求，避免将 OPTIONS 透传到上游
  if (request.method === "OPTIONS" && path.startsWith("/proxy/")) {
    const allowHeaders =
      request.headers.get("Access-Control-Request-Headers") ||
      "Range, Content-Type";

    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": allowHeaders,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 仅处理 /proxy 路径，其余直接 404
  if (!path.startsWith("/proxy/")) {
    return new Response("Not Found", { status: 404 });
  }

  // FS 视图：/proxy/fs<fsPath>?sign=...
  if (path.startsWith("/proxy/fs")) {
    const fsPath = decodeURIComponent(path.slice("/proxy/fs".length) || "/");
    const sign = url.searchParams.get("sign") ?? "";

    // 签名校验
    const verifyMsg = await verifyFsSign(fsPath, sign, SIGN_SECRET);
    if (verifyMsg) {
      return new Response(JSON.stringify({ code: 401, message: verifyMsg }), {
        status: 401,
        headers: { "content-type": "application/json;charset=UTF-8" },
      });
    }

    // 调用 CloudPaste /api/proxy/link 获取上游 URL
    const controlUrl = new URL(ORIGIN);
    controlUrl.pathname = "/api/proxy/link";

    const linkResp = await fetch(controlUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        Authorization: TOKEN,
      },
      body: JSON.stringify({ type: "fs", path: fsPath }),
    });

    const linkJson = await linkResp.json().catch(() => null);
    const code = linkJson?.code ?? linkResp.status;
    const data = linkJson?.data ?? null;
    if (code !== 200 || !data?.url) {
      return new Response(JSON.stringify({ code, message: "proxy link resolve failed" }), {
        status: 502,
        headers: { "content-type": "application/json;charset=UTF-8" },
      });
    }

    // 转发到上游
    let upstreamReq = applyUpstreamHeaders(request, data.header);
    upstreamReq = new Request(data.url, upstreamReq);

    let upstreamRes = await fetch(upstreamReq);
    const currentHost = url.host;

    // 跟随重定向，避免自递归
    for (let i = 0; i < 5 && upstreamRes.status >= 300 && upstreamRes.status < 400; i++) {
      const location = upstreamRes.headers.get("Location");
      if (!location) break;

      if (isSelfRedirect(location, currentHost)) {
        // 自身重定向：递归交给 handleProxyRequest 处理
        const nextReq = new Request(new URL(location, request.url).toString(), request);
        return handleProxyRequest(nextReq, env);
      }

      upstreamReq = new Request(location, upstreamReq);
      upstreamRes = await fetch(upstreamReq);
    }

    const resp = new Response(upstreamRes.body, upstreamRes);
    resp.headers.delete("set-cookie");
    resp.headers.set("Access-Control-Allow-Origin", requestOrigin);
    resp.headers.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Content-Type",
    );
    resp.headers.append("Vary", "Origin");
    return resp;
  }

  // 分享视图：/proxy/share/:slug
  if (path.startsWith("/proxy/share/")) {
    const slug = decodeURIComponent(path.slice("/proxy/share/".length));
    if (!slug) {
      return new Response(JSON.stringify({ code: 400, message: "missing share slug" }), {
        status: 400,
        headers: { "content-type": "application/json;charset=UTF-8" },
      });
    }

    const controlUrl = new URL(ORIGIN);
    controlUrl.pathname = "/api/proxy/link";

    const linkResp = await fetch(controlUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=UTF-8",
        Authorization: TOKEN,
      },
      body: JSON.stringify({ type: "share", slug }),
    });

    const linkJson = await linkResp.json().catch(() => null);
    const code = linkJson?.code ?? linkResp.status;
    const data = linkJson?.data ?? null;
    if (code !== 200 || !data?.url) {
      return new Response(JSON.stringify({ code, message: "proxy link resolve failed" }), {
        status: 502,
        headers: { "content-type": "application/json;charset=UTF-8" },
      });
    }

    let upstreamReq = applyUpstreamHeaders(request, data.header);
    upstreamReq = new Request(data.url, upstreamReq);

    let upstreamRes = await fetch(upstreamReq);
    const currentHost = url.host;

    for (let i = 0; i < 5 && upstreamRes.status >= 300 && upstreamRes.status < 400; i++) {
      const location = upstreamRes.headers.get("Location");
      if (!location) break;

      if (isSelfRedirect(location, currentHost)) {
        const nextReq = new Request(new URL(location, request.url).toString(), request);
        return handleProxyRequest(nextReq, env);
      }

      upstreamReq = new Request(location, upstreamReq);
      upstreamRes = await fetch(upstreamReq);
    }

    const resp = new Response(upstreamRes.body, upstreamRes);
    resp.headers.delete("set-cookie");
    resp.headers.set("Access-Control-Allow-Origin", requestOrigin);
    resp.headers.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Content-Type",
    );
    resp.headers.append("Vary", "Origin");
    return resp;
  }

  return new Response("Not Found", { status: 404 });
}

// ==== 平台自适配入口 ====
// 说明：
// - Cloudflare Workers：直接使用默认导出（workerd 风格）
// - Deno Deploy       ：如果检测到 Deno.serve，则自动注册 HTTP 服务
// - 其他 Fetch 兼容运行时：导入 handleProxyRequest 自行调用

// Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    return handleProxyRequest(request, env);
  },
};

// Deno Deploy：若存在 Deno.serve，则自动启动服务
if (typeof globalThis.Deno !== "undefined" && typeof globalThis.Deno.serve === "function") {
  globalThis.Deno.serve((req) =>
    handleProxyRequest(req, {
      ORIGIN: globalThis.Deno.env?.get?.("ORIGIN") ?? ORIGIN,
      TOKEN: globalThis.Deno.env?.get?.("TOKEN") ?? TOKEN,
      SIGN_SECRET: globalThis.Deno.env?.get?.("SIGN_SECRET") ?? SIGN_SECRET,
      WORKER_BASE: globalThis.Deno.env?.get?.("WORKER_BASE") ?? WORKER_BASE,
    })
  );
}

// 对于 Vercel Edge / 其他 Edge Runtime：
//   import { handleProxyRequest } from "./cloudpaste-proxy.js";
//   export const config = { runtime: "edge" };
//   export default (req) => handleProxyRequest(req, {
//     ORIGIN: process.env.ORIGIN,
//     TOKEN: process.env.TOKEN,
//     SIGN_SECRET: process.env.SIGN_SECRET,
//     WORKER_BASE: process.env.WORKER_BASE,
//   });
// - 这样可以继续复用本文件的所有逻辑。
