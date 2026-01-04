/**
 * TELEGRAM 驱动连接测试器（Bot API）
 *
 *   1) bot_token 是真的（getMe 成功）
 *   2) 目标 chat_id 机器人能访问（getChat 成功）
 *
 * - 不会发消息、不做写入
 * - 只做“读 API 的确认”
 */

import { decryptIfNeeded } from "../../../../utils/crypto.js";

function normalizeApiBaseUrl(url) {
  const raw = String(url || "").trim();
  const fallback = "https://api.telegram.org";
  if (!raw) return fallback;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

async function fetchJson(url) {
  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { resp, json, text };
}

export async function telegramTestConnection(config, encryptionSecret, _requestOrigin = null) {
  const botTokenEncrypted = config?.bot_token || config?.botToken;
  const botToken = await decryptIfNeeded(botTokenEncrypted, encryptionSecret);
  const targetChatId = config?.target_chat_id || config?.targetChatId;
  const apiBaseUrl = normalizeApiBaseUrl(config?.endpoint_url);

  const info = {
    endpoint_url: apiBaseUrl,
    targetChatId: targetChatId ? String(targetChatId) : null,
  };
  const state = {
    getMe: { success: false, status: null, error: null, bot: null },
    getChat: { success: false, status: null, error: null, chat: null, skipped: false },
  };

  if (!botToken || typeof botToken !== "string") {
    const checks = [
      { key: "connect", label: "连接（getMe）", success: false, error: "bot_token 配置缺失" },
      { key: "read", label: "读权限（getChat）", success: false, error: "bot_token 配置缺失" },
      { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
    ];
    return { success: false, message: "bot_token 配置缺失", result: { info, checks } };
  }

  // 你已决定：target_chat_id 只支持纯数字字符串（例如 -100...）
  if (targetChatId && !/^-?\d+$/.test(String(targetChatId).trim())) {
    const checks = [
      { key: "connect", label: "连接（getMe）", success: false, error: "target_chat_id 格式不合法" },
      { key: "read", label: "读权限（getChat）", success: false, error: "target_chat_id 必须是纯数字（例如 -100...）" },
      { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
    ];
    return { success: false, message: "target_chat_id 必须是纯数字（例如 -100...）", result: { info, checks } };
  }

  // 1) getMe：确认 token 是否有效
  const getMeUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getMe`;
  const meRes = await fetchJson(getMeUrl);
  state.getMe.status = meRes.resp.status;

  if (!meRes.resp.ok || !meRes.json?.ok) {
    state.getMe.success = false;
    state.getMe.error = meRes.json?.description || meRes.text || "getMe 请求失败";
    const checks = [
      {
        key: "connect",
        label: "连接（getMe）",
        success: false,
        error: state.getMe.error,
        items: [{ key: "status", label: "状态码", value: state.getMe.status }],
      },
      { key: "read", label: "读权限（getChat）", success: false, error: "bot_token 无效，跳过 getChat" },
      { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
    ];
    return { success: false, message: `Telegram 测试失败：bot_token 无效或无法访问（HTTP ${meRes.resp.status}）`, result: { info, checks } };
  }

  state.getMe.success = true;
  state.getMe.bot = meRes.json?.result || null;

  // 2) getChat：确认 chat_id 是否可访问（建议必填，否则后续上传会失败）
  if (!targetChatId) {
    state.getChat.skipped = true;
    const checks = [
      {
        key: "connect",
        label: "连接（getMe）",
        success: true,
        items: [
          ...(state.getMe.bot && typeof state.getMe.bot === "object"
            ? [
                { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
                { key: "botUsername", label: "用户名", value: state.getMe.bot.username ?? null },
                { key: "botName", label: "名称", value: state.getMe.bot.first_name ?? null },
              ]
            : []),
        ],
        ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
      },
      {
        key: "read",
        label: "读权限（getChat）",
        success: true,
        skipped: true,
        note: "未填写 target_chat_id，跳过 getChat",
      },
      { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
    ];
    return { success: true, message: "Telegram 测试成功（已确认 bot_token；未填写 target_chat_id，跳过 getChat）", result: { info, checks } };
  }

  const getChatUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getChat?chat_id=${encodeURIComponent(String(targetChatId).trim())}`;
  const chatRes = await fetchJson(getChatUrl);
  state.getChat.status = chatRes.resp.status;

  if (!chatRes.resp.ok || !chatRes.json?.ok) {
    state.getChat.success = false;
    state.getChat.error = chatRes.json?.description || chatRes.text || "getChat 请求失败";
    const checks = [
      {
        key: "connect",
        label: "连接（getMe）",
        success: true,
        items: [
          ...(state.getMe.bot && typeof state.getMe.bot === "object"
            ? [
                { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
                { key: "botUsername", label: "用户名", value: state.getMe.bot.username ?? null },
                { key: "botName", label: "名称", value: state.getMe.bot.first_name ?? null },
              ]
            : []),
        ],
        ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
      },
      {
        key: "read",
        label: "读权限（getChat）",
        success: false,
        error: state.getChat.error,
        items: [{ key: "status", label: "状态码", value: state.getChat.status }],
      },
      { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
    ];
    return { success: false, message: "Telegram 测试失败：bot_token 可用，但 target_chat_id 无法访问（机器人可能不在该群/频道）", result: { info, checks } };
  }

  state.getChat.success = true;
  state.getChat.chat = chatRes.json?.result || null;

  const checks = [
    {
      key: "connect",
      label: "连接（getMe）",
      success: true,
      items: [
        ...(state.getMe.bot && typeof state.getMe.bot === "object"
          ? [
              { key: "botId", label: "Bot ID", value: state.getMe.bot.id ?? null },
              { key: "botUsername", label: "用户名", value: state.getMe.bot.username ?? null },
              { key: "botName", label: "名称", value: state.getMe.bot.first_name ?? null },
            ]
          : []),
      ],
      ...(state.getMe.bot ? { details: { bot: state.getMe.bot } } : {}),
    },
    {
      key: "read",
      label: "读权限（getChat）",
      success: true,
      items: [
        ...(state.getChat.chat && typeof state.getChat.chat === "object"
          ? [
              { key: "chatId", label: "Chat ID", value: state.getChat.chat.id ?? null },
              { key: "chatType", label: "类型", value: state.getChat.chat.type ?? null },
              { key: "chatTitle", label: "标题", value: state.getChat.chat.title ?? null },
              { key: "chatUsername", label: "用户名", value: state.getChat.chat.username ?? null },
            ]
          : []),
      ],
      ...(state.getChat.chat ? { details: { chat: state.getChat.chat } } : {}),
    },
    { key: "write", label: "写权限", success: true, skipped: true, note: "TELEGRAM 测试不做真实写入" },
  ];

  return { success: true, message: "Telegram 测试成功（bot_token + target_chat_id 均可用）", result: { info, checks } };
}

export default { telegramTestConnection };
