// Telegram notifications. sendMessage over the Bot API is stateless and never
// conflicts with a gateway's getUpdates long-poll — only a second RECEIVER
// would. So notifying "from" an agent's own bot is safe.

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export async function sendMessage(token, chatId, text, extra = {}) {
  const res = await fetch(API(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`sendMessage failed: ${data.description ?? res.status}`);
  return data.result;
}

export async function answerCallback(token, callbackId, text) {
  await fetch(API(token, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {});
}

/** Escape a stranger's display name — untrusted input. */
function safeName(name) {
  const cleaned = String(name ?? '').replace(/[\n\r<>`]/g, ' ').trim();
  return cleaned || 'someone';
}

/**
 * Notify the owner about a knock.
 * Full mode (kk bot token): inline approve/deny buttons.
 * Degraded mode (agent's own bot): copyable CLI command.
 */
export async function notifyKnock(cfg, { agentName, knock, agentBotToken }) {
  const who = `${safeName(knock.name)} (${knock.senderId})`;
  if (cfg.bot?.token) {
    return sendMessage(
      cfg.bot.token,
      cfg.ownerId,
      `knock knock. ${who} pinged ${agentName} on ${knock.platform}. let them in?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'let them in', callback_data: `a:${agentName}:${knock.senderId}` },
            { text: 'ignore', callback_data: `d:${agentName}:${knock.senderId}` },
          ]],
        },
      },
    );
  }
  if (agentBotToken) {
    return sendMessage(
      agentBotToken,
      cfg.ownerId,
      `knock knock. ${who} pinged ${agentName} on ${knock.platform} but isn't on the allowlist.\n\n` +
        `approve from the host:\nknockknock approve ${agentName} ${knock.senderId}`,
    );
  }
  throw new Error(`no notification path for ${agentName}: set bot.token in config`);
}
