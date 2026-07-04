// hermes-agent adapter.
// detect: hermes gateways log rejected senders out of the box:
//   "WARNING gateway.run: Unauthorized user: 424242424242 (ada) on telegram"
// approve: add the id to TELEGRAM_ALLOWED_USERS in the agent home's .env and
// restart the gateway unit. hermes allowlists are per-agent (no group scope).

import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { validateKnock } from '../lib/extract.js';

const REJECT_RE = /Unauthorized user:\s*(\d+)\s*\(([^)]*)\)\s*on\s*(\w+)/g;

export function logPath(agent) {
  return join(agent.home, 'logs', 'agent.log');
}

/**
 * Read new bytes since cursor (byte offset). Handles rotation (size < cursor).
 * Returns { lines, cursor }.
 */
export function readNewLines(agent, cursor) {
  const path = logPath(agent);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], cursor: cursor ?? 0 };
  }
  let start = typeof cursor === 'number' ? cursor : size; // first run: start at end
  if (start > size) start = 0; // rotated
  if (start === size) return { lines: [], cursor: size };
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return { lines: buf.toString('utf8').split('\n').filter(Boolean), cursor: size };
  } finally {
    closeSync(fd);
  }
}

/** Parse knock events out of log lines. */
export function parseKnocks(lines) {
  const knocks = [];
  for (const line of lines) {
    for (const m of line.matchAll(REJECT_RE)) {
      const k = validateKnock({ senderId: m[1], name: m[2], platform: m[3] });
      if (k) knocks.push(k);
    }
  }
  return knocks;
}

/** The agent's own bot token, for degraded-mode notifications. */
export function botToken(agent) {
  const env = readEnv(join(agent.home, '.env'));
  return env[agent.botTokenEnv ?? 'TELEGRAM_BOT_TOKEN'] ?? null;
}

function readEnv(path) {
  const out = {};
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Add senderId to TELEGRAM_ALLOWED_USERS in the agent's .env, restart unit.
 * Returns a human summary. dryRun skips writes/restarts.
 */
export function approve(agentName, agent, senderId, { dryRun = false } = {}) {
  if (!/^\d+$/.test(senderId)) throw new Error('senderId must be numeric');
  const envPath = join(agent.home, '.env');
  const raw = readFileSync(envPath, 'utf8');
  const key = 'TELEGRAM_ALLOWED_USERS';
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)(["']?)([^"'\\n]*)\\2\\s*$`, 'm');
  const m = raw.match(re);
  let next;
  if (m) {
    const ids = m[3].split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.includes(senderId)) {
      return { changed: false, summary: `${senderId} already allowed on ${agentName}` };
    }
    ids.push(senderId);
    next = raw.replace(re, `$1$2${ids.join(',')}$2`);
  } else {
    next = raw.trimEnd() + `\n${key}=${senderId}\n`;
  }
  if (!dryRun) {
    writeFileSync(envPath + '.bak.knockknock', raw);
    writeFileSync(envPath, next);
    execFileSync('systemctl', ['--user', 'restart', agent.unit], { timeout: 60_000 });
  }
  return {
    changed: true,
    summary: `${senderId} added to ${key} on ${agentName}${dryRun ? ' (dry run)' : ', gateway restarted'}`,
  };
}
