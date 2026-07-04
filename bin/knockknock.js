#!/usr/bin/env node
import { loadConfig, CONFIG_DIR } from '../lib/config.js';
import { loadState } from '../lib/state.js';
import { scanOnce } from '../lib/scan.js';
import { listen } from '../lib/listen.js';
import { approveKnock, denyKnock } from '../lib/approve.js';

const USAGE = `knockknock — someone tagged your agent. your agent asked you. you tapped yes.

usage:
  knockknock status                     show config, state, pending knocks
  knockknock scan [--dry-run]           one detection pass (+notify unless dry)
  knockknock daemon                     scan every 60s + tap-approval listener
  knockknock approve <agent> <id> [--dry-run]
  knockknock deny <agent> <id>          mute future knock alerts for a sender
  knockknock install                    print the systemd user unit
`;

const [cmd, ...args] = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pos = args.filter((a) => !a.startsWith('--'));

try {
  switch (cmd) {
    case 'status': {
      const cfg = loadConfig();
      const state = loadState();
      const pending = Object.entries(state.knocks).filter(([, k]) => k.status === 'pending');
      console.log(`config: ${CONFIG_DIR}/config.json`);
      console.log(`agents: ${Object.keys(cfg.agents).join(', ')}`);
      console.log(`tap approvals: ${cfg.bot?.token ? 'on' : 'off (no bot.token)'}`);
      console.log(`llm fallback: ${cfg.llm?.baseUrl ? 'on' : 'off'}`);
      console.log(`pending knocks: ${pending.length}`);
      for (const [key, k] of pending) {
        console.log(`  ${key} ${k.name ? `(${k.name})` : ''} x${k.count}`);
      }
      break;
    }
    case 'scan': {
      const cfg = loadConfig();
      const results = await scanOnce(cfg, { dryRun });
      for (const r of results) {
        console.log(
          `${r.knock.senderId} (${r.knock.name || '?'}) knocked on ${r.agentName}` +
            (r.notified ? ' → owner notified' : dryRun ? ' [dry run]' : ' (cooldown/decided)'),
        );
      }
      if (results.length === 0) console.log('no new knocks');
      break;
    }
    case 'daemon': {
      const cfg = loadConfig();
      const tick = () => scanOnce(cfg).catch((e) => console.error(`scan: ${e.message}`));
      tick();
      setInterval(tick, 60_000);
      await listen(cfg); // returns immediately if no bot token; interval keeps us alive
      break;
    }
    case 'approve': {
      const [agent, id] = pos;
      if (!agent || !id) throw new Error('usage: knockknock approve <agent> <id>');
      const cfg = loadConfig();
      console.log((await approveKnock(cfg, agent, id, { dryRun })).summary);
      break;
    }
    case 'deny': {
      const [agent, id] = pos;
      if (!agent || !id) throw new Error('usage: knockknock deny <agent> <id>');
      loadConfig();
      console.log(denyKnock(agent, id).summary);
      break;
    }
    case 'install': {
      console.log(`# ~/.config/systemd/user/knockknock.service
[Unit]
Description=knockknock — allowlist knock notifications

[Service]
ExecStart=${process.execPath} ${new URL(import.meta.url).pathname} daemon
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target

# then: systemctl --user daemon-reload && systemctl --user enable --now knockknock`);
      break;
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
