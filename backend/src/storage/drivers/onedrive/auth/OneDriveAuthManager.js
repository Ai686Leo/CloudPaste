/**
 * OneDriveAuthManager
 *
 * OneDrive OAuth 2.0 认证管理器
 * - 负责 access token 的缓存与刷新
 * - 支持 refresh_token 模式（v1 首版）
 * - 支持外部 token 续期端点（可选）
 *
 * Token 管理边界：
 * - 驱动内部负责 access token 的缓存与刷新
 * - refresh_token / clientId / clientSecret 等敏感配置由存储配置表提供
 * - 驱动只消费配置，不自行持久化用户凭据
 */

import { DriverError } from "../../../../http/errors.js";

/**
 * 区域到 OAuth 端点的映射
 * - 仅供 OneDriveAuthManager 内部使用
 */
const OAUTH_ENDPOINTS = {
  global: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  cn: "https://login.chinacloudapi.cn/common/oauth2/v2.0/token",
  us: "https://login.microsoftonline.us/common/oauth2/v2.0/token",
  de: "https://login.microsoftonline.de/common/oauth2/v2.0/token",
};

export class OneDriveAuthManager {
  /**
   * @param {Object} config 认证配置
   * @param {string} config.region 区域（global/cn/us/de）
   * @param {string} config.clientId 应用客户端 ID
   * @param {string} config.clientSecret 应用客户端密钥
   * @param {string} config.refreshToken 刷新令牌
   * @param {string} [config.tokenRenewEndpoint] 自定义 token 续期端点（可选）
   * @param {string} [config.redirectUri] OAuth 回调地址（可选）
   * @param {boolean} [config.useOnlineApi] 是否使用 Online API 协议调用续期端点（可选）
   */
  constructor(config) {
    this.region = config.region || "global";
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.tokenRenewEndpoint = config.tokenRenewEndpoint || null;
    this.redirectUri = config.redirectUri || null;
    this.useOnlineApi = Boolean(config.useOnlineApi);

    // 内存缓存
    this.accessToken = null;
    this.tokenExpiresAt = null;

    // 验证必填配置：
    // - refresh_token 始终必填（无论走微软 OAuth 还是走自建续期服务，都需要 refresh_token）
    // - useOnlineApi=true：必须配置 tokenRenewEndpoint（外部续期服务）
    // - useOnlineApi=false：必须配置 clientId（走微软 OAuth 端点；clientSecret 可选，取决于你的 Azure 应用类型）
    if (!this.refreshToken) {
      throw new DriverError("OneDrive 认证配置缺少 refreshToken", { status: 400 });
    }
    if (this.useOnlineApi) {
      if (!this.tokenRenewEndpoint) {
        throw new DriverError("OneDrive 认证配置缺少 tokenRenewEndpoint（已启用 useOnlineApi）", { status: 400 });
      }
    } else {
      if (!this.clientId) {
        throw new DriverError("OneDrive 认证配置缺少 clientId（未启用 useOnlineApi 时必填）", { status: 400 });
      }
    }
  }

  /**
   * 获取有效的 access token
   * - 优先使用内存缓存
   * - 失效时自动刷新
   * @returns {Promise<string>} access token
   */
  async getAccessToken() {
    // 检查缓存是否有效（提前 5 分钟刷新）
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 分钟缓冲

    if (this.accessToken && this.tokenExpiresAt && (this.tokenExpiresAt - bufferMs) > now) {
      return this.accessToken;
    }

    // 刷新 token
    await this.refreshAccessToken();
    return this.accessToken;
  }

  /**
   * 刷新 access token
   * - 使用 refresh_token 或自定义端点
   */
  async refreshAccessToken() {
    try {
      let tokenResponse;

      // 分支策略：
      // - 当显式启用 useOnlineApi 且配置了 tokenRenewEndpoint 时，走外部 Online API 续期端点
      // - 其他情况一律走微软官方 OAuth 端点（即便仍然配置了 tokenRenewEndpoint，也不使用）
      if (this.useOnlineApi && this.tokenRenewEndpoint) {
        // 使用外部 token 续期端点（Online API 协议）
        tokenResponse = await this._fetchFromCustomEndpoint();
      } else {
        // 使用微软 OAuth 端点
        tokenResponse = await this._fetchFromMicrosoftEndpoint();
      }

      // 更新缓存
      this.accessToken = tokenResponse.access_token;
      const expiresIn = tokenResponse.expires_in || 3600; // 默认 1 小时
      this.tokenExpiresAt = Date.now() + expiresIn * 1000;

      // 如果返回了新的 refresh_token，更新内存中的值
      // 注意：持久化到数据库的责任在上层服务，驱动不直接写数据库
      if (tokenResponse.refresh_token) {
        this.refreshToken = tokenResponse.refresh_token;
      }
    } catch (error) {
      // 清除缓存
      this.accessToken = null;
      this.tokenExpiresAt = null;

      throw new DriverError(`OneDrive token 刷新失败: ${error.message}`, {
        status: 500,
        cause: error,
        details: { region: this.region },
      });
    }
  }

  /**
   * 从微软 OAuth 端点获取 token
   * @private
   */
  async _fetchFromMicrosoftEndpoint() {
    const tokenUrl = OAUTH_ENDPOINTS[this.region] || OAUTH_ENDPOINTS.global;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret || "",
      refresh_token: this.refreshToken,
    });

    if (this.redirectUri) {
      body.set("redirect_uri", this.redirectUri);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error_description || errorData.error || response.statusText;
      throw new Error(`Microsoft OAuth 错误: ${errorMessage}`);
    }

    return await response.json();
  }

  /**
   * 从自定义端点获取 token
   * @private
   */
  async _fetchFromCustomEndpoint() {
    if (!this.tokenRenewEndpoint) {
      throw new Error("未配置自定义 token 续期端点");
    }

    // Online API 模式：使用 GET + refresh_ui 协议
    if (this.useOnlineApi) {
      if (!this.refreshToken) {
        throw new Error("缺少 refresh_token，无法调用 Online API 续期服务");
      }

      let renewUrl;
      try {
        renewUrl = new URL(this.tokenRenewEndpoint);
      } catch {
        throw new Error("token_renew_endpoint 不是合法的 URL");
      }

      renewUrl.searchParams.set("refresh_ui", this.refreshToken);
      renewUrl.searchParams.set("server_use", "true");
      renewUrl.searchParams.set("driver_txt", "onedrive_pr");

      const response = await fetch(renewUrl.toString(), {
        method: "GET",
        headers: {
          // 保留简单 UA，方便后端识别来源（不会暴露敏感信息）
          "User-Agent": "CloudPaste-OneDriveDriver",
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          data.text || data.error || data.message || response.statusText || "Online API 请求失败";
        throw new Error(`Online API 刷新失败: ${errorMessage}`);
      }

      const accessToken = data.access_token || data.AccessToken;
      const refreshToken = data.refresh_token || data.RefreshToken;
      const expiresIn = data.expires_in || data.ExpiryTime || data.expiryTime;

      if (!accessToken) {
        const errorMessage = data.text || data.error || "Online API 返回的数据缺少 access_token";
        throw new Error(`Online API 数据无效: ${errorMessage}`);
      }

      const normalized = {
        access_token: accessToken,
      };
      if (typeof expiresIn === "number") {
        normalized.expires_in = expiresIn;
      }
      if (refreshToken) {
        normalized.refresh_token = refreshToken;
      }

      return normalized;
    }

    // 通用 JSON 模式：兼容自建 token 续期服务
    const payload = {};
    if (this.clientId) {
      payload.client_id = this.clientId;
    }
    if (this.refreshToken) {
      payload.refresh_token = this.refreshToken;
    }

    const response = await fetch(this.tokenRenewEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || data.message || response.statusText || "自定义 token 端点请求失败";
      throw new Error(`自定义 token 端点错误: ${errorMessage}`);
    }

    if (!data.access_token) {
      throw new Error("自定义 token 端点返回的数据缺少 access_token");
    }

    return data;
  }

  /**
   * 获取当前 token 状态（用于调试）
   */
  getTokenStatus() {
    return {
      hasAccessToken: !!this.accessToken,
      expiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      isExpired: this.tokenExpiresAt ? Date.now() > this.tokenExpiresAt : true,
      region: this.region,
      useCustomEndpoint: !!this.tokenRenewEndpoint,
    };
  }
}
