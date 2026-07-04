# knockknock

someone tagged your agent. your agent asked you. you tapped yes. they're in.

**knockknock** is a tiny sidecar for self-hosted AI agent gateways
([hermes](https://github.com/NousResearch/hermes-agent), openclaw) that fixes
the worst failure mode of telegram allowlists: a new person messages your bot,
gets silently dropped, and nobody ever knows they knocked.

- **detect** — watches your gateway's logs for rejected senders
- **notify** — DMs you: "maya (424242424242) knocked on ada. let them in?"
- **approve** — one tap. knockknock edits the allowlist and restarts the
  gateway. the person just starts conversing.

no forks, no patches: it reads logs the gateways already write and edits config
the gateways already read.

## quickstart

```bash
git clone https://github.com/Ani-HQ/knock-knock && cd knockknock
cp examples/config.example.json ~/.config/knockknock/config.json
# edit: your telegram id, your agents
node bin/knockknock.js status     # sanity check
node bin/knockknock.js scan       # one detection pass
node bin/knockknock.js daemon     # scan + (optional) tap-approval listener
node bin/knockknock.js install    # print systemd unit / cron line
```

### one-tap approvals (optional but nice)

make a bot with @BotFather, put its token in config under `bot.token`, DM it
once so it can reach you. knocks then arrive with approve / deny buttons.
without it, knockknock notifies through the pinged agent's own bot and gives
you a copy-paste approve command instead.

### approve from the terminal

```bash
node bin/knockknock.js approve ada 424242424242
node bin/knockknock.js deny ada 424242424242   # cooldown-mute the sender
```

## supported harnesses

| harness  | detect                        | approve                          |
|----------|-------------------------------|----------------------------------|
| hermes   | yes (reject log, out of box)  | yes (.env allowlist + restart)   |
| openclaw | yes (needs gateway log level: debug) | yes (openclaw config patch)  |

## security model

detection never changes anything. every allowlist mutation requires the
owner's explicit tap or command. callbacks from anyone but the owner are
ignored. sender ids are validated numeric before touching any config. display
names are treated as untrusted input. secrets stay in your gitignored config.

## releasing

versions are git tags. to cut a release: add a section to `CHANGELOG.md`,
bump `version` in `package.json`, then

```bash
git tag v0.x.y && git push origin v0.x.y
```

CI runs the tests and publishes a GitHub Release with the changelog section
as notes.

## license

MIT
