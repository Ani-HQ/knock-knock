# knockknock — spec (v1)

2026-07-04. status: agreed with ani, building.

## problem

self-hosted agent gateways (hermes, openclaw) gate telegram access with per-agent
allowlists. when a stranger tags an agent in a group or DMs it, the message is
dropped. the owner never finds out someone knocked, and adding the person means
ssh + config surgery + gateway restart. both harnesses ship DM-only "pairing"
that is pull-based and CLI-approved. nobody handles the group case, nobody
notifies the owner, nobody makes approval a tap.

## what knockknock does

1. **detect** — watches gateway logs for rejected senders (per-harness adapter).
2. **notify** — DMs the owner on telegram: "X (id) knocked on <agent>. let them in?"
3. **approve** — owner taps a button (or runs `knockknock approve <agent> <id>`);
   knockknock edits the harness allowlist and restarts the gateway. done.

## architecture

single node 22 ESM daemon, zero runtime deps. modules:

- `bin/knockknock.js` — CLI: `daemon`, `scan`, `approve`, `deny`, `status`, `install`
- `lib/config.js` — loads config (see below), validates
- `lib/state.js` — cursor + per-sender cooldown + decisions, one JSON file
- `lib/scan.js` — pulls new log lines per agent, runs adapter parse, dedupes, notifies
- `lib/extract.js` — regex extractors per adapter; optional LLM fallback for
  unmatched candidate lines (any OpenAI-compatible endpoint, e.g. cerebras).
  the model EXTRACTS only ({sender_id, name, platform}); output is validated
  (numeric id) and never triggers action without owner approval.
- `lib/notify.js` — telegram sendMessage. two modes:
  - **full**: dedicated knockknock bot token → inline approve/deny buttons
  - **degraded**: no kk bot → notify via the pinged agent's own bot token with a
    copyable `knockknock approve ...` command (sendMessage is stateless and does
    not conflict with the gateway's getUpdates poller; only receiving would)
- `lib/listen.js` — long-poll getUpdates on the kk bot only (never agent bots),
  owner-only callback handling, tap → adapter approve → edit + restart → confirm
- `adapters/hermes.js` — detect: `Unauthorized user: <id> (<name>) on <platform>`
  from `~/.hermes-<agent>/logs/agent.log` (or journald unit). approve: add id to
  `TELEGRAM_ALLOWED_USERS` in the agent home `.env`, `systemctl --user restart <unit>`.
- `adapters/openclaw.js` — approve: `openclaw config patch` (validated write) on
  account allowFrom/groupAllowFrom + `openclaw gateway restart`. detect: parses
  `Blocked telegram (group message from|group sender|direct sender) <id>` out of
  the gateway's JSON file log (daily-rotated, {file, offset} cursor). requires
  file log level debug (`openclaw config set logging.level debug`) — openclaw
  only logs rejects through logVerbose; spiked against 2026.6.5 source. the
  file log has no account attribution, so knocks credit the configured agent
  (unambiguous with one public telegram account; caveat documented).

## config

`~/.config/knockknock/config.json` — NEVER in the repo. repo ships
`examples/config.example.json`. holds: owner telegram id, optional kk bot token,
optional LLM endpoint/key, agents map:

```json
{
  "ownerId": "<numeric telegram id>",
  "bot": { "token": "<knockknock bot token, optional>" },
  "llm": { "baseUrl": "", "apiKey": "", "model": "" },
  "cooldownHours": 6,
  "agents": {
    "<name>": {
      "harness": "hermes",
      "home": "~/.hermes-<name>",
      "unit": "hermes-<name>-gateway.service",
      "botTokenEnv": "TELEGRAM_BOT_TOKEN"
    }
  }
}
```

## security invariants

- approval requires the owner's explicit action, always. detection/extraction
  never mutates an allowlist.
- callbacks are accepted only from `ownerId`; everything else is ignored.
- extracted ids must be numeric; agent names must exist in config.
- a stranger's display name is untrusted input: it is escaped in notifications
  and never interpolated into shell commands (ids only, validated).
- per-sender cooldown so repeat knocks can't spam the owner.
- secrets live in gitignored config or the harnesses' own env files; knockknock
  stores no tokens of its own beyond the optional kk bot token.

## decisions log

- one-tap requires a dedicated bot token (agent bots' getUpdates belongs to
  their gateways; a second poller steals updates). degraded mode keeps the tool
  useful with zero extra setup.
- plain JS over TS: zero-build single-file-ish daemon, easier OSS adoption.
  (deviation from house default, deliberate.)
- hermes is adapter #1: its reject log already exists; openclaw needs a debug
  flag and its own parse spike (v1.1).
- LLM parsing is a fallback, not the primary: regex handles the known formats
  free and offline; the model absorbs format drift and future harnesses.

## roadmap

- v1: hermes detect+approve, notify (both modes), listener, daemon, cron/systemd install
- v1.1: openclaw detect (debug-flag spike), discord adapter interface
- v2: upstream group-pairing PR to hermes-agent; per-group scopes for openclaw
