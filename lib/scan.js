import * as hermes from '../adapters/hermes.js';
import * as openclaw from '../adapters/openclaw.js';
import { isCandidate, llmExtract } from './extract.js';
import { loadState, saveState, shouldNotify, recordKnock } from './state.js';
import { notifyKnock } from './notify.js';

const ADAPTERS = { hermes, openclaw };

/**
 * One detection pass over every configured agent.
 * dryRun: parse + report, no state writes, no notifications.
 */
export async function scanOnce(cfg, { dryRun = false, log = console.error } = {}) {
  const state = loadState();
  const results = [];

  for (const [agentName, agent] of Object.entries(cfg.agents)) {
    const adapter = ADAPTERS[agent.harness];
    const { lines, cursor } = adapter.readNewLines(agent, state.cursors[agentName]);
    if (!dryRun) state.cursors[agentName] = cursor;
    if (lines.length === 0) continue;

    const knocks = adapter.parseKnocks(lines);
    // LLM fallback: only candidate lines the regexes produced nothing for
    const matchedIds = new Set(knocks.map((k) => k.senderId));
    const unmatched = lines.filter(
      (l) => isCandidate(l) && ![...matchedIds].some((id) => l.includes(id)),
    );
    knocks.push(...(await llmExtract(cfg, unmatched.slice(0, 20))));

    for (const knock of knocks) {
      const fresh = shouldNotify(state, agentName, knock.senderId, cfg.cooldownHours);
      results.push({ agentName, knock, notified: fresh && !dryRun });
      if (!fresh || dryRun) continue;
      recordKnock(state, agentName, knock.senderId, knock.name);
      try {
        await notifyKnock(cfg, {
          agentName,
          knock,
          agentBotToken: adapter.botToken(agent),
        });
        log(`notified owner: ${knock.senderId} knocked on ${agentName}`);
      } catch (err) {
        log(`notify failed for ${agentName}/${knock.senderId}: ${err.message}`);
      }
    }
  }

  if (!dryRun) saveState(state);
  return results;
}
