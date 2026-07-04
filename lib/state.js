import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';

const STATE_PATH = join(CONFIG_DIR, 'state.json');

// state shape:
// {
//   cursors:   { "<agent>": <byte offset or journal cursor string> },
//   knocks:    { "<agent>:<senderId>": { lastNotifiedAt, name, count, status } },
// }
// status: "pending" | "approved" | "denied"

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { cursors: {}, knocks: {} };
  }
}

export function saveState(state) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = STATE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

export function knockKey(agent, senderId) {
  return `${agent}:${senderId}`;
}

/** true if this knock should trigger a fresh notification */
export function shouldNotify(state, agent, senderId, cooldownHours, now = Date.now()) {
  const k = state.knocks[knockKey(agent, senderId)];
  if (!k) return true;
  if (k.status === 'approved' || k.status === 'denied') return false;
  return now - k.lastNotifiedAt > cooldownHours * 3_600_000;
}

export function recordKnock(state, agent, senderId, name, now = Date.now()) {
  const key = knockKey(agent, senderId);
  const k = state.knocks[key] ?? { count: 0, status: 'pending' };
  k.count += 1;
  k.name = name || k.name || '';
  k.lastNotifiedAt = now;
  state.knocks[key] = k;
}

export function recordDecision(state, agent, senderId, status) {
  const key = knockKey(agent, senderId);
  const k = state.knocks[key] ?? { count: 0 };
  k.status = status;
  k.decidedAt = Date.now();
  state.knocks[key] = k;
}
