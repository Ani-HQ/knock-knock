import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR =
  process.env.KNOCKKNOCK_CONFIG_DIR ?? join(homedir(), '.config', 'knockknock');

export function expandHome(p) {
  return p?.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function loadConfig() {
  const path = join(CONFIG_DIR, 'config.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `no config at ${path} — copy examples/config.example.json there and edit it`,
    );
  }
  const cfg = JSON.parse(raw);
  if (!/^\d+$/.test(String(cfg.ownerId ?? ''))) {
    throw new Error('config.ownerId must be a numeric telegram user id');
  }
  if (!cfg.agents || Object.keys(cfg.agents).length === 0) {
    throw new Error('config.agents must define at least one agent');
  }
  for (const [name, agent] of Object.entries(cfg.agents)) {
    if (!/^[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`agent name ${JSON.stringify(name)} must be alphanumeric`);
    }
    if (!['hermes', 'openclaw'].includes(agent.harness)) {
      throw new Error(`agent ${name}: unknown harness ${agent.harness}`);
    }
    if (agent.home) agent.home = expandHome(agent.home);
  }
  cfg.cooldownHours ??= 6;
  return cfg;
}
