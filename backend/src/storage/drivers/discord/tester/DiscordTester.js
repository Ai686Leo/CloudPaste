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

function normalizeEndpointUrl(value, fallback) {
  const raw = value != null ? String(value).trim() : "";
  const base = raw ? raw.replace(/\/+$/, "") : String(fallback || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("endpoint_url 必须以 http:// 或 https:// 开头");
    }
  } catch {
    throw new ValidationError("endpoint_url 不是合法的 URL");
  }
  return base;
}

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

function parseRetryAfterMs(resp, json) {
  const retryAfterSec = typeof json?.retry_after === "number" ? json.retry_after : null;
  const retryAfterHeader = resp?.headers?.get?.("retry-after");
  const retryAfterHeaderSec = retryAfterHeader != null && retryAfterHeader !== "" ? Number(retryAfterHeader) : null;
  const retryAfter = Number.isFinite(retryAfterSec)
    ? retryAfterSec
    : Number.isFinite(retryAfterHeaderSec)
    ? retryAfterHeaderSec
    : null;
  return retryAfter != null ? Math.ceil(retryAfter * 1000) : null;
}

export async function discordTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const botTokenEncrypted = config?.bot_token || config?.botToken;
  const tokenRaw = await decryptIfNeeded(botTokenEncrypted, encryptionSecret);
  const botToken = typeof tokenRaw === "string" ? tokenRaw.trim() : "";

  const channelIdRaw = config?.channel_id || config?.channelId;
  const channelId = channelIdRaw != null ? String(channelIdRaw).trim() : "";

  const apiBase = normalizeEndpointUrl(config?.endpoint_url, DISCORD_API_BASE);

  const result = {
    info: {
      endpoint_url: apiBase,
      channelId: channelId || null,
      hasBotToken: !!botToken,
    },
    getChannel: { success: false, status: null, error: null, channel: null, retryAfterMs: null },
    typing: { success: false, status: null, error: null, retryAfterMs: null, skipped: false },
  };

  const finalize = ({ success, message }) => {
    const channel = result.getChannel.channel;
    const checks = [
      {
        key: "read",
        label: "读权限（getChannel）",
        success: result.getChannel.success === true,
        ...(result.getChannel.error ? { error: result.getChannel.error } : {}),
        items: [
          { key: "status", label: "状态码", value: result.getChannel.status },
          ...(result.getChannel.retryAfterMs != null
            ? [{ key: "retryAfterMs", label: "限速等待(ms)", value: result.getChannel.retryAfterMs }]
            : []),
          ...(channel?.id ? [{ key: "channelId", label: "频道ID", value: channel.id }] : []),
          ...(channel?.name ? [{ key: "channelName", label: "频道名", value: channel.name }] : []),
          ...(channel?.guild_id ? [{ key: "guildId", label: "服务器ID", value: channel.guild_id }] : []),
          ...(channel?.type != null ? [{ key: "channelType", label: "频道类型", value: channel.type }] : []),
        ],
        ...(channel ? { details: { channel } } : {}),
      },
      {
        key: "write",
        label: "写权限（typing）",
        success: result.typing.success === true,
        ...(result.typing.skipped ? { skipped: true } : {}),
        ...(result.typing.error ? { error: result.typing.error } : {}),
        note: "用 typing 作为轻量写权限探测（不发真实消息）",
        items: [
          { key: "status", label: "状态码", value: result.typing.status },
          ...(result.typing.retryAfterMs != null
            ? [{ key: "retryAfterMs", label: "限速等待(ms)", value: result.typing.retryAfterMs }]
            : []),
        ],
      },
    ];
    return { success, message, result: { info: result.info, checks } };
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

  const url = `${apiBase}/channels/${encodeURIComponent(channelId)}`;
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
    result.getChannel.success = false;
    result.getChannel.error = "触发 Discord 速率限制（429），请稍后再试";
    result.getChannel.retryAfterMs = parseRetryAfterMs(res.resp, res.json);
    result.typing.skipped = true;
    result.typing.success = false;
    result.typing.error = "写入测试未执行（读取频道信息已被限速）";
    return finalize({ success: false, message: result.getChannel.error });
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
      result.typing.skipped = true;
      result.typing.success = false;
      result.typing.error = "写入测试未执行（读取频道信息失败）";
      return finalize({ success: false, message: "Discord 测试失败：bot_token 无效或权限不足" });
    }

    // 404：频道不存在或 bot 看不到
    if (res.resp.status === 404) {
      result.getChannel.success = false;
      result.getChannel.error = msg || "频道不存在或 bot 无法访问（404）";
      result.typing.skipped = true;
      result.typing.success = false;
      result.typing.error = "写入测试未执行（读取频道信息失败）";
      return finalize({ success: false, message: "Discord 测试失败：频道不存在或 bot 无权访问" });
    }

    result.getChannel.success = false;
    result.getChannel.error = msg;
    result.typing.skipped = true;
    result.typing.success = false;
    result.typing.error = "写入测试未执行（读取频道信息失败）";
    return finalize({ success: false, message: `Discord 测试失败：无法读取频道信息（HTTP ${res.resp.status}）` });
  }

  result.getChannel.success = true;
  result.getChannel.channel = {
    id: res.json?.id || null,
    name: res.json?.name || null,
    type: res.json?.type ?? null,
    guild_id: res.json?.guild_id || null,
  };

  // 读权限：只要能 getChannel，就说明 bot 至少“看得见”这个频道
  // 已由 getChannel.success 表示

  // 写权限：用 typing 作为“能不能发消息”的轻量测试（不发真实消息，避免污染频道）
  const typingUrl = `${apiBase}/channels/${encodeURIComponent(channelId)}/typing`;
  const typingRes = await fetchJson(typingUrl, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "User-Agent": "CloudPaste-DiscordTester (https://github.com/ling-drag0n/CloudPaste)",
      Accept: "application/json",
    },
  });

  result.typing.status = typingRes.resp.status;

  if (typingRes.resp.status === 429) {
    result.typing.success = false;
    result.typing.error = "触发 Discord 速率限制（429），typing 测试被限速";
    result.typing.retryAfterMs = parseRetryAfterMs(typingRes.resp, typingRes.json);
    return finalize({ success: false, message: "Discord 测试部分成功（读取正常，但写入测试触发限速 429）" });
  }

  if (!typingRes.resp.ok) {
    const msg =
      typingRes.json?.message ||
      typingRes.json?.error ||
      typingRes.text ||
      `HTTP ${typingRes.resp.status}`;
    result.typing.success = false;
    result.typing.error = msg || "typing 请求失败";
    return finalize({ success: false, message: "Discord 测试部分成功（bot 可访问频道，但可能没有发送消息权限）" });
  }

  result.typing.success = true;
  return finalize({ success: true, message: "Discord 测试成功（bot 可访问该频道，并且具备发送消息权限）" });
}

export default { discordTestConnection };
