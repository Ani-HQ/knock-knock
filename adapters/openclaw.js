// openclaw adapter.
// detect: requires the gateway's file log level at debug (`openclaw config set
// logging.level debug` + gateway restart) — openclaw's ingress only logs
// rejected senders through logVerbose. Reject lines (verified against
// openclaw 2026.6.5 source):
//   "Blocked telegram group message from <id> (groupPolicy: allowlist)"
//   "Blocked telegram group sender <id> (group allowFrom override)"
//   "Blocked telegram direct sender <id> (<reason>)"
// The file log carries no account attribution, so knocks are credited to this
// configured agent — unambiguous with one public openclaw telegram account,
// document the caveat if you run several.
// approve: `openclaw config patch` (validated write) + `openclaw gateway
// restart` (no hot-reload RPC as of 2026.6.5).

import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { validateKnock } from '../lib/extract.js';

const OPENCLAW = process.env.KNOCKKNOCK_OPENCLAW_BIN ?? 'openclaw';
const LOG_FILE_RE = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;
const REJECT_RE =
  /Blocked telegram (?:group message from|group sender|direct sender) (\d+)/g;

function latestLogFile(dir) {
  try {
    const files = readdirSync(dir).filter((f) => LOG_FILE_RE.test(f)).sort();
    return files.length ? join(dir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function readFrom(path, offset) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], size: offset };
  }
  let start = offset;
  if (start > size) start = 0; // truncated/rewritten
  if (start >= size) return { lines: [], size };
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return { lines: buf.toString('utf8').split('\n').filter(Boolean), size };
  } finally {
    closeSync(fd);
  }
}

/**
 * Cursor is { file, offset } — openclaw rotates to a new dated file daily.
 * On rollover, drain the remainder of the old file, then the new one from 0.
 */
export function readNewLines(agent, cursor) {
  const dir = agent.logDir ?? '/tmp/openclaw';
  const latest = latestLogFile(dir);
  if (!latest) return { lines: [], cursor: cursor ?? null };

  if (!cursor?.file) {
    // first run: start at the end of the current file
    const { size } = readFrom(latest, Number.MAX_SAFE_INTEGER);
    return { lines: [], cursor: { file: latest, offset: size } };
  }

  const lines = [];
  let offset = cursor.offset ?? 0;
  if (cursor.file !== latest) {
    const old = readFrom(cursor.file, offset);
    lines.push(...old.lines);
    offset = 0;
  }
  const cur = readFrom(latest, offset);
  lines.push(...cur.lines);
  return { lines, cursor: { file: latest, offset: cur.size } };
}

/** Log lines are JSON with a `message` field; fall back to the raw line. */
export function parseKnocks(lines) {
  const knocks = [];
  for (const line of lines) {
    let msg = line;
    try {
      const parsed = JSON.parse(line);
      msg = String(parsed.message ?? line);
    } catch {
      // not JSON, scan the raw line
    }
    for (const m of msg.matchAll(REJECT_RE)) {
      const k = validateKnock({ senderId: m[1], name: '', platform: 'telegram' });
      if (k) knocks.push(k);
    }
  }
  return knocks;
}

const tokenCache = new Map();

/** The account's bot token from openclaw config, for degraded-mode notify. */
export function botToken(agent) {
  const account = agent.account ?? 'default';
  if (tokenCache.has(account)) return tokenCache.get(account);
  let token = null;
  try {
    const out = execFileSync(
      OPENCLAW,
      ['config', 'get', `channels.telegram.accounts.${account}.botToken`],
      { timeout: 30_000, encoding: 'utf8' },
    );
    const val = JSON.parse(out);
    if (typeof val === 'string' && val.includes(':')) token = val;
  } catch {
    // fall through: dedicated knockknock bot required for this agent
  }
  tokenCache.set(account, token);
  return token;
}

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
