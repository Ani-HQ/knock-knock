import * as hermes from '../adapters/hermes.js';
import * as openclaw from '../adapters/openclaw.js';
import { loadState, saveState, recordDecision } from './state.js';

const ADAPTERS = { hermes, openclaw };

export async function approveKnock(cfg, agentName, senderId, { dryRun = false } = {}) {
  const agent = cfg.agents[agentName];
  if (!agent) throw new Error(`unknown agent: ${agentName}`);
  if (!/^\d+$/.test(senderId)) throw new Error('senderId must be numeric');
  const result = ADAPTERS[agent.harness].approve(agentName, agent, senderId, { dryRun });
  if (!dryRun) {
    const state = loadState();
    recordDecision(state, agentName, senderId, 'approved');
    saveState(state);
  }
  return result;
}

export function denyKnock(agentName, senderId) {
  if (!/^\d+$/.test(senderId)) throw new Error('senderId must be numeric');
  const state = loadState();
  recordDecision(state, agentName, senderId, 'denied');
  saveState(state);
  return { changed: true, summary: `${senderId} muted for ${agentName} (no more knock alerts)` };
}
