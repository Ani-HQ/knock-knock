# changelog

all notable changes to knockknock. format loosely follows
[keep a changelog](https://keepachangelog.com); versions follow
[semver](https://semver.org) (0.x: minor = features, patch = fixes).

## [unreleased]

## [0.2.0] - 2026-07-04

openclaw goes full-loop: both harness adapters now detect and approve.

### added
- openclaw adapter detection: parses blocked-sender lines (group message,
  group sender override, direct sender) from the gateway's JSON file log.
  requires `openclaw config set logging.level debug` + gateway restart —
  openclaw only logs rejects at debug level. handles daily log rotation
  with a {file, offset} cursor.
- degraded-mode notifications for openclaw agents: the account bot token
  is read from openclaw config, so notify works without a dedicated bot.

### known limitations
- the openclaw file log carries no account attribution: with several
  public telegram accounts on one gateway, knocks credit the configured
  agent. unambiguous with a single public-facing account.

## [0.1.0] - 2026-07-04

first release. someone tagged your agent. your agent asked you. you tapped
yes. they're in.

### added
- hermes adapter: detect rejected senders from gateway logs (cursor-based,
  rotation-safe), approve via `TELEGRAM_ALLOWED_USERS` .env edit (with backup)
  + gateway unit restart
- openclaw adapter: approve via validated `openclaw config patch` + gateway
  restart (detection landed in 0.2.0)
- scan daemon (60s) with per-sender cooldown so repeat knocks can't spam
- telegram notifications: dedicated-bot mode with inline approve/deny buttons,
  or degraded mode via the pinged agent's own bot with a copy-paste command
- owner-only tap-approval listener (long-poll, dedicated bot only)
- optional LLM extraction fallback for unknown log formats (any
  OpenAI-compatible endpoint); regex primary, strict numeric-id validation
- CLI: `status`, `scan`, `daemon`, `approve`, `deny`, `install`
