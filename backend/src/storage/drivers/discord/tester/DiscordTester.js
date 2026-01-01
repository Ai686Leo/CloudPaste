/**
 * DISCORD 驱动连接测试器（Bot API）
 *
 * 最小测试目标：
 * 1) bot_token 是否有效（401/403 能识别）
 * 2) bot 是否能访问指定频道（GET /channels/{channel_id}）
 *
 * 官方文档参考：
 * - https://discord.com/developers/docs/resources/channel#get-channel
 * - https://discord.com/developers/docs/reference#rate-limits
 */

import { ValidationError } from "../../../../http/errors.js";
import { decryptIfNeeded } from "../../../../utils/crypto.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function fetchJson(url, init = {}) {
  const resp = await fetch(url, init);
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

export async function discordTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const botTokenEncrypted = config?.bot_token || config?.botToken;
  const tokenRaw = await decryptIfNeeded(botTokenEncrypted, encryptionSecret);
  const botToken = typeof tokenRaw === "string" ? tokenRaw.trim() : "";

  const channelIdRaw = config?.channel_id || config?.channelId;
  const channelId = channelIdRaw != null ? String(channelIdRaw).trim() : "";

  const result = {
    info: {
      apiBase: DISCORD_API_BASE,
      channelId: channelId || null,
      hasBotToken: !!botToken,
    },
    getChannel: { success: false, status: null, error: null, channel: null, retryAfterMs: null },
  };

  if (!botToken) {
    throw new ValidationError("DISCORD 配置缺少必填字段: bot_token");
  }
  if (!channelId) {
    throw new ValidationError("DISCORD 配置缺少必填字段: channel_id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new ValidationError("channel_id 必须是纯数字字符串（Snowflake）");
  }

  const url = `${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}`;
  const res = await fetchJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "CloudPaste-DiscordTester (https://github.com/ling-drag0n/CloudPaste)",
      Accept: "application/json",
    },
  });

  result.getChannel.status = res.resp.status;

  // 429：限速（本测试器不做自动重试，只把 retryAfter 提示出来）
  if (res.resp.status === 429) {
    const retryAfterSec = typeof res.json?.retry_after === "number" ? res.json.retry_after : null;
    const retryAfterHeader = res.resp.headers.get("retry-after");
    const retryAfterHeaderSec = retryAfterHeader != null && retryAfterHeader !== "" ? Number(retryAfterHeader) : null;
    const retryAfter = Number.isFinite(retryAfterSec)
      ? retryAfterSec
      : Number.isFinite(retryAfterHeaderSec)
      ? retryAfterHeaderSec
      : null;

    result.getChannel.success = false;
    result.getChannel.error = "触发 Discord 速率限制（429），请稍后再试";
    result.getChannel.retryAfterMs = retryAfter != null ? Math.ceil(retryAfter * 1000) : null;
    return { success: false, message: result.getChannel.error, result };
  }

  if (!res.resp.ok) {
    const msg =
      res.json?.message ||
      res.json?.error ||
      res.text ||
      `HTTP ${res.resp.status}`;

    // 401/403：token 无效或权限不足（常见）
    if (res.resp.status === 401 || res.resp.status === 403) {
      result.getChannel.success = false;
      result.getChannel.error = msg || "bot_token 无效或权限不足（401/403）";
      return { success: false, message: "Discord 测试失败：bot_token 无效或权限不足", result };
    }

    // 404：频道不存在或 bot 看不到
    if (res.resp.status === 404) {
      result.getChannel.success = false;
      result.getChannel.error = msg || "频道不存在或 bot 无法访问（404）";
      return { success: false, message: "Discord 测试失败：频道不存在或 bot 无权访问", result };
    }

    result.getChannel.success = false;
    result.getChannel.error = msg;
    return { success: false, message: `Discord 测试失败：无法读取频道信息（HTTP ${res.resp.status}）`, result };
  }

  result.getChannel.success = true;
  result.getChannel.channel = {
    id: res.json?.id || null,
    name: res.json?.name || null,
    type: res.json?.type ?? null,
    guild_id: res.json?.guild_id || null,
  };

  return { success: true, message: "Discord 测试成功（bot 可访问该频道）", result };
}

export default { discordTestConnection };

