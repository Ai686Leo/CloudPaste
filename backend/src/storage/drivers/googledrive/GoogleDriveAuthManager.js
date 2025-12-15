/**
 * GoogleDriveAuthManager
 *
 * Google Drive 认证管理器，负责根据存储配置获取与刷新 access_token：
 * - 在线 API 模式（use_online_api = true）：调外部 api_address 换取 access_token/refresh_token
 * - Service Account 模式（refresh_token 为远程 URL）：解析远程 service account JSON，使用 JWT 换取 access_token
 * - 标准 refresh_token 模式：使用 client_id/client_secret/refresh_token 调用 OAuth2 token 接口
 *
 * 设计目标：
 * - 单一职责：只关心 token 生命周期与敏感字段，不依赖具体 Driver 或 FS
 * - 统一接口：提供 getAccessToken / withAccessToken，隐藏不同模式的差异
 * - 安全性：避免在日志与错误信息中泄露 access_token/refresh_token 或完整 service account JSON
 */

import crypto from "crypto";
import { DriverError } from "../../../http/errors.js";

const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * 简单 HTTP 请求工具
 * - 为保持 KISS，当前直接使用全局 fetch（Cloudflare/Node 均可），如需更复杂能力可后续抽象
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<{ status: number, json: any, raw: Response }>}
 */
async function httpRequestJson(url, options = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, json: data, raw: res };
}

/**
 * 生成 Service Account JWT（RS256）
 * 仅在 Node.js 环境下可用
 * @param {{ client_email: string, private_key: string, token_uri: string, scope?: string }} sa
 * @param {string[]} scopes
 */
function createServiceAccountJwt(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export class GoogleDriveAuthManager {
  /**
   * @param {{
   *   useOnlineApi: boolean,
   *   apiAddress?: string,
   *   clientId?: string,
   *   clientSecret?: string,
   *   refreshToken?: string,
   *   rootId?: string,
   *   disableDiskUsage?: boolean,
   *   scopes?: string[],
   *   logger?: Console,
   *   persistRefreshToken?: (newToken: string) => Promise<void> | void
   * }} options
   */
  constructor(options) {
    this.useOnlineApi = Boolean(options.useOnlineApi);
    this.apiAddress = options.apiAddress || null;
    this.clientId = options.clientId || null;
    this.clientSecret = options.clientSecret || null;
    this.refreshToken = options.refreshToken || "";
    this.rootId = options.rootId || "root";
    this.disableDiskUsage = Boolean(options.disableDiskUsage);
    this.scopes = Array.isArray(options.scopes) && options.scopes.length > 0
      ? options.scopes
      : ["https://www.googleapis.com/auth/drive"];
    this.logger = options.logger || console;
    this.persistRefreshToken = typeof options.persistRefreshToken === "function" ? options.persistRefreshToken : null;

    /** @type {string | null} */
    this.currentAccessToken = null;
    /** @type {number | null} 过期时间戳（秒） */
    this.accessTokenExpiresAt = null;

    /** @type {Array<{ client_email: string, private_key: string, token_uri: string }>} */
    this.serviceAccounts = [];
    this.serviceAccountIndex = 0;
    this.initialized = false;
  }

  /**
   * 初始化认证管理器（懒加载 Service Account JSON 等）
   */
  async initialize() {
    if (this.initialized) return;

    if (this.useOnlineApi) {
      if (!this.apiAddress || !this.refreshToken) {
        throw new DriverError("GoogleDriveAuthManager 配置错误：在线 API 模式需要 api_address 与 refresh_token", {
          code: "DRIVER_ERROR.GDRIVE_AUTH_CONFIG",
        });
      }
      this.initialized = true;
      return;
    }

    // Service Account 远程 URL 模式
    if (isHttpUrl(this.refreshToken)) {
      // 远程 JSON URL：此处仅记录 URL，实际获取放在请求时
      this.initialized = true;
      return;
    }

    // 标准 refresh_token 模式：需要 clientId/clientSecret/refreshToken
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new DriverError("GoogleDriveAuthManager 配置错误：标准 refresh_token 模式需要 client_id/client_secret/refresh_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_CONFIG",
      });
    }

    this.initialized = true;
  }

  /**
   * 获取当前可用 access_token（必要时刷新）
   */
  async getAccessToken() {
    await this.initialize();

    const now = Math.floor(Date.now() / 1000);
    if (this.currentAccessToken && this.accessTokenExpiresAt && this.accessTokenExpiresAt - now > 60) {
      return this.currentAccessToken;
    }

    // 根据模式刷新 token
    if (this.useOnlineApi) {
      await this._refreshViaOnlineApi();
    } else if (isHttpUrl(this.refreshToken)) {
      await this._refreshViaServiceAccount();
    } else {
      await this._refreshViaRefreshToken();
    }

    if (!this.currentAccessToken) {
      throw new DriverError("GoogleDriveAuthManager 未能获取有效的 access_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_NO_TOKEN",
      });
    }
    return this.currentAccessToken;
  }

  /**
   * 对外统一包装：在回调中注入 Authorization header，捕获 401 并自动刷新一次
   * @param {(token: string) => Promise<any>} fn
   */
  async withAccessToken(fn) {
    const token = await this.getAccessToken();
    try {
      return await fn(token);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status === 401) {
        // 尝试刷新一次后重试
        this.currentAccessToken = null;
        this.accessTokenExpiresAt = null;
        await this.getAccessToken();
        const retryToken = this.currentAccessToken;
        return await fn(retryToken);
      }
      throw error;
    }
  }

  async _refreshViaOnlineApi() {
    const url = new URL(this.apiAddress);
    url.searchParams.set("refresh_ui", this.refreshToken || "");
    url.searchParams.set("server_use", "true");
    url.searchParams.set("driver_txt", "googleui_go");

    const { status, json } = await httpRequestJson(url.toString(), {
      method: "GET",
    });

    if (status !== 200 || !json) {
      throw new DriverError("GoogleDriveAuthManager 在线 API 模式刷新 token 失败", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_ONLINE_API",
      });
    }

    const accessToken = json.access_token;
    const newRefreshToken = json.refresh_token || null;
    const expiresIn = json.expires_in || 3600;

    if (!accessToken) {
      throw new DriverError("在线 API 返回缺少 access_token", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_ONLINE_API_RESPONSE",
      });
    }

    this.currentAccessToken = accessToken;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    if (newRefreshToken && this.persistRefreshToken) {
      try {
        await this.persistRefreshToken(newRefreshToken);
      } catch (err) {
        this.logger.warn?.("[GoogleDriveAuthManager] 持久化 refresh_token 失败，将继续使用旧值");
      }
    }
  }

  async _refreshViaServiceAccount() {
    // 远程 URL 情况：按需拉取 JSON（仅在 Node 或 Worker 中进行 HTTP 调用）
    if (isHttpUrl(this.refreshToken) && this.serviceAccounts.length === 0) {
      const { status, json } = await httpRequestJson(this.refreshToken, { method: "GET" });
      if (status !== 200 || !json) {
        throw new DriverError("无法从远程 Service Account URL 获取 JSON", {
          status,
          code: "DRIVER_ERROR.GDRIVE_AUTH_SA_REMOTE",
        });
      }
      const parsed = Array.isArray(json) ? json : [json];
      this.serviceAccounts = parsed
        .map((sa) => ({
          client_email: sa.client_email,
          private_key: sa.private_key,
          token_uri: sa.token_uri || OAUTH_TOKEN_ENDPOINT,
        }))
        .filter((sa) => sa.client_email && sa.private_key);
      if (this.serviceAccounts.length === 0) {
        throw new DriverError("远程 Service Account JSON 不包含有效凭证", {
          code: "DRIVER_ERROR.GDRIVE_AUTH_SA_REMOTE_EMPTY",
        });
      }
    }

    if (this.serviceAccounts.length === 0) {
      throw new DriverError("Service Account 模式下未加载任何凭证", {
        code: "DRIVER_ERROR.GDRIVE_AUTH_SA_EMPTY",
      });
    }

    // 简单轮询下一条 Service Account 记录
    const sa = this.serviceAccounts[this.serviceAccountIndex % this.serviceAccounts.length];
    this.serviceAccountIndex = (this.serviceAccountIndex + 1) % this.serviceAccounts.length;

    const assertion = createServiceAccountJwt(sa, this.scopes);
    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", assertion);

    const { status, json } = await httpRequestJson(sa.token_uri || OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (status !== 200 || !json || !json.access_token) {
      throw new DriverError("Service Account 模式刷新 access_token 失败", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_SA_TOKEN",
      });
    }

    this.currentAccessToken = json.access_token;
    const expiresIn = json.expires_in || 3600;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  }

  async _refreshViaRefreshToken() {
    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("refresh_token", this.refreshToken);

    const { status, json } = await httpRequestJson(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (status !== 200 || !json || !json.access_token) {
      // 记录详细错误信息，便于排查配置问题（invalid_grant/invalid_client 等）
      try {
        this.logger.error?.("[GoogleDriveAuthManager] refresh_token 流程失败", {
          status,
          error: json?.error,
          error_description: json?.error_description,
        });
      } catch {}

      throw new DriverError("标准 refresh_token 模式刷新 access_token 失败", {
        status,
        code: "DRIVER_ERROR.GDRIVE_AUTH_TOKEN",
        details: {
          status,
          error: json?.error,
          error_description: json?.error_description,
        },
      });
    }

    this.currentAccessToken = json.access_token;
    const expiresIn = json.expires_in || 3600;
    this.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    if (json.refresh_token && this.persistRefreshToken) {
      try {
        await this.persistRefreshToken(json.refresh_token);
      } catch (err) {
        this.logger.warn?.("[GoogleDriveAuthManager] 持久化 refresh_token 失败，将继续使用旧值");
      }
    }
  }
}
