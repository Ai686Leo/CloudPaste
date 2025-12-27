/**
 * TELEGRAM 驱动连接测试器（Bot API）
 *
 *   1) bot_token 是真的（getMe 成功）
 *   2) 目标 chat_id 机器人能访问（getChat 成功）
 *
 * - 不会发消息、不做写入
 * - 只做“读 API 的确认”
 */

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

export async function telegramTestConnection(config, _encryptionSecret, _requestOrigin = null) {
  const botToken = config?.bot_token || config?.botToken;
  const targetChatId = config?.target_chat_id || config?.targetChatId;
  const apiBaseUrl = normalizeApiBaseUrl(config?.api_base_url || config?.apiBaseUrl);

  const result = {
    connectionInfo: {
      apiBaseUrl,
      targetChatId: targetChatId ? String(targetChatId) : null,
    },
    getMe: { success: false, status: null, error: null, bot: null },
    getChat: { success: false, status: null, error: null, chat: null, skipped: false },
  };

  if (!botToken || typeof botToken !== "string") {
    return { success: false, message: "bot_token 配置缺失", result };
  }

  // 你已决定：target_chat_id 只支持纯数字字符串（例如 -100...）
  if (targetChatId && !/^-?\d+$/.test(String(targetChatId).trim())) {
    return { success: false, message: "target_chat_id 必须是纯数字（例如 -100...）", result };
  }

  // 1) getMe：确认 token 是否有效
  const getMeUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getMe`;
  const meRes = await fetchJson(getMeUrl);
  result.getMe.status = meRes.resp.status;

  if (!meRes.resp.ok || !meRes.json?.ok) {
    result.getMe.success = false;
    result.getMe.error = meRes.json?.description || meRes.text || "getMe 请求失败";
    return { success: false, message: `Telegram 测试失败：bot_token 无效或无法访问（HTTP ${meRes.resp.status}）`, result };
  }

  result.getMe.success = true;
  result.getMe.bot = meRes.json?.result || null;

  // 2) getChat：确认 chat_id 是否可访问（建议必填，否则后续上传会失败）
  if (!targetChatId) {
    result.getChat.skipped = true;
    return { success: true, message: "Telegram 测试成功（已确认 bot_token；未填写 target_chat_id，跳过 getChat）", result };
  }

  const getChatUrl = `${apiBaseUrl}/bot${String(botToken).trim()}/getChat?chat_id=${encodeURIComponent(String(targetChatId).trim())}`;
  const chatRes = await fetchJson(getChatUrl);
  result.getChat.status = chatRes.resp.status;

  if (!chatRes.resp.ok || !chatRes.json?.ok) {
    result.getChat.success = false;
    result.getChat.error = chatRes.json?.description || chatRes.text || "getChat 请求失败";
    // 这里不抛异常，用“success:false”回给前端（符合你项目已有 tester 风格）
    return { success: false, message: "Telegram 测试失败：bot_token 可用，但 target_chat_id 无法访问（机器人可能不在该群/频道）", result };
  }

  result.getChat.success = true;
  result.getChat.chat = chatRes.json?.result || null;

  return { success: true, message: "Telegram 测试成功（bot_token + target_chat_id 均可用）", result };
}

export default { telegramTestConnection };
