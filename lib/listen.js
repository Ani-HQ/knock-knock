// Tap-approval listener. Long-polls getUpdates on the DEDICATED knockknock bot
// only — never on an agent's bot (their gateways own those pollers; a second
// consumer steals updates). Owner-only: every callback from anyone else is
// ignored outright.

import { answerCallback, sendMessage } from './notify.js';
import { approveKnock, denyKnock } from './approve.js';

const CB_RE = /^([ad]):([a-z0-9_-]+):(\d+)$/i;

export async function listen(cfg, { log = console.error, signal } = {}) {
  if (!cfg.bot?.token) {
    log('no bot.token in config — tap approvals off, CLI approvals still work');
    return;
  }
  const token = cfg.bot.token;
  let offset = 0;
  log('listening for tap approvals');

  while (!signal?.aborted) {
    let updates = [];
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["callback_query"]`,
        { signal: AbortSignal.timeout(60_000) },
      );
      const data = await res.json();
      if (data.ok) updates = data.result;
    } catch {
      await new Promise((r) => setTimeout(r, 5_000)); // network blip, retry
      continue;
    }

    for (const u of updates) {
      offset = u.update_id + 1;
      const cb = u.callback_query;
      if (!cb) continue;
      if (String(cb.from?.id) !== String(cfg.ownerId)) continue; // owner-only
      const m = CB_RE.exec(cb.data ?? '');
      if (!m) continue;
      const [, action, agentName, senderId] = m;
      if (!cfg.agents[agentName]) continue;

      try {
        const result =
          action.toLowerCase() === 'a'
            ? await approveKnock(cfg, agentName, senderId)
            : denyKnock(agentName, senderId);
        await answerCallback(token, cb.id, 'done');
        await sendMessage(token, cfg.ownerId, result.summary);
        log(result.summary);
      } catch (err) {
        await answerCallback(token, cb.id, 'failed, check logs');
        await sendMessage(token, cfg.ownerId, `failed: ${err.message}`).catch(() => {});
        log(`approval failed: ${err.message}`);
      }
    }
  }
}
