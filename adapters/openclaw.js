// openclaw adapter.
// approve: fully working — `openclaw config patch` is a validated write, then
// `openclaw gateway restart` applies it (no hot-reload RPC as of 2026.6.5).
// detect: v1.1 — openclaw's structured ingress DROPS group rejects pre-log
// (reason `sender_not_allowlisted`). Surfacing them needs the gateway env var
// OPENCLAW_DEBUG_TELEGRAM_INGRESS=1; the log format behind that flag still
// needs a spike before we can ship a parser. Until then this adapter is
// approve-only.

import { execFileSync } from 'node:child_process';

const OPENCLAW = process.env.KNOCKKNOCK_OPENCLAW_BIN ?? 'openclaw';

function getPath(dotPath) {
  const out = execFileSync(OPENCLAW, ['config', 'get', dotPath], {
    timeout: 30_000,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/**
 * Add senderId to the account's allowlists via openclaw's own validated
 * config writer. scope: "group" | "dm" | "group+dm" (default "group").
 */
export function approve(agentName, agent, senderId, { dryRun = false } = {}) {
  if (!/^\d+$/.test(senderId)) throw new Error('senderId must be numeric');
  const account = agent.account ?? agentName;
  if (!/^[a-z0-9_-]+$/i.test(account)) throw new Error('bad account name');
  const scope = agent.scope ?? 'group';
  const base = `channels.telegram.accounts.${account}`;

  const patch = { channels: { telegram: { accounts: { [account]: {} } } } };
  const target = patch.channels.telegram.accounts[account];
  const touched = [];
  for (const [flag, key] of [
    ['group', 'groupAllowFrom'],
    ['dm', 'allowFrom'],
  ]) {
    if (!scope.includes(flag)) continue;
    const current = (getPath(`${base}.${key}`) ?? []).map(String);
    if (current.includes(senderId)) continue;
    target[key] = [...current, senderId];
    touched.push(key);
  }
  if (touched.length === 0) {
    return { changed: false, summary: `${senderId} already allowed on ${agentName}` };
  }
  const args = ['config', 'patch', '--stdin', ...(dryRun ? ['--dry-run'] : [])];
  execFileSync(OPENCLAW, args, {
    input: JSON.stringify(patch),
    timeout: 60_000,
    encoding: 'utf8',
  });
  if (!dryRun) {
    execFileSync(OPENCLAW, ['gateway', 'restart'], { timeout: 120_000 });
  }
  return {
    changed: true,
    summary: `${senderId} added to ${touched.join('+')} on ${agentName}${dryRun ? ' (dry run)' : ', gateway restarted'}`,
  };
}

/** detect() lands in v1.1 behind OPENCLAW_DEBUG_TELEGRAM_INGRESS. */
export function readNewLines() {
  return { lines: [], cursor: 0 };
}

export function parseKnocks() {
  return [];
}

export function botToken() {
  return null; // use the dedicated knockknock bot for openclaw notifications
}
