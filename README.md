<div align="center">

# 🦜 鸚法「いんぼう」

[![CI status][ci_badge]][ci] [![License][license_badge]][license]

A Japanese practice bot for Discord, built on [discordkit][discordkit] and deployed to Cloudflare Workers.

</div>

---

**鸚法** (_inbou_, "parrot method") is a pun on 鸚鵡返し (_ōmugaeshi_, parroting something back) and 文法 (_bunpō_, grammar) — repetition being how a language sticks, and a nod to Coca Bird, the cockatiel emoji character mascot of the server it was built for.

## 🎯 What it does

A conjugation drill for a channel. The bot posts a word and a target form; the
first person to type the right answer takes the question.

```
Question 3 of 10
たべます                      ← shown in polite non-past
From    Non-past (polite)     Target  Non-past negative (plain)

  saeris:  たべない  ⭕  +4
```

Answers are accepted in kana, kanji, katakana or romaji, so a club typing on
mixed keyboard setups can all play. Ordinary conversation is ignored — a guess
has to look like an attempt at the question before it costs anybody an attempt.

| Command               | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `/quiz start`         | Begin a session. Every setting is optional; see the table below. |
| `/quiz config`        | Change the running session, from the next question on.           |
| `/quiz end`           | Stop early and post the standings.                               |
| `/quiz scores [user]` | The server leaderboard, or one player's standing.                |
| `/hint`               | A private nudge: the reading and the meaning, never the answer.  |
| `/review`             | Privately, the last question you got wrong.                      |
| `/feedback bug\|idea` | Opens a pre-filled GitHub issue.                                 |
| `/privacy tracking`   | Turn leaderboard scoring on or off for yourself.                 |
| `/privacy forget`     | Delete everything stored about you. Asks first.                  |

| Setting   | Default             | Accepts                                            |
| --------- | ------------------- | -------------------------------------------------- |
| `level`   | N5                  | N5–N1, comma-separated, or `any`                   |
| `type`    | verb, adj-i, adj-na | plus `noun`                                        |
| `class`   | all                 | ichidan, godan, suru, kuru                         |
| `forms`   | basics              | any of the 13 forms, `all`, `compounds`, or a name |
| `length`  | 10                  | 1–50, or `endless`                                 |
| `timeout` | 1m                  | 30s–10m                                            |
| `guesses` | 3                   | 1–10                                               |

Scoring tapers: a first-guess answer is worth `guesses + 1`, one less for each
miss, never below one. Above N5, `forms:compounds` asks multi-word constructions
— 〜なければならない, 〜てしまう, 〜ておく, 〜させられる, 〜たくない — which is
where the difficulty is meant to come from rather than rarer vocabulary.

The full design is in [docs/specs/conjugation-quiz.md](docs/specs/conjugation-quiz.md).

### What it stores, and how to stop it

Two things persist: your points and correct-answer counts per server, and — if
you set one — your tracking preference. Everything else lives inside a running
session and dies with it.

`/privacy tracking off` keeps you playing while nothing is written to the
leaderboard. **One row is stored** — the preference itself, so the choice
survives between sessions — and the reply says so rather than implying nothing
at all is kept. Everything else is ephemeral. It deletes nothing already
recorded.

`/privacy forget` deletes. It shows the counts first and waits for a
confirmation, because it cannot be undone. `scope:everywhere` covers every
server rather than just the current one.

The tracking preference is deleted too, which has a consequence the reply
states plainly: **the bot then treats you as new, and the next session records
you again.** Keeping a record of the person who asked not to be recorded would
be the wrong way round, but somebody who erased their data specifically to stop
being recorded should not discover it quietly starting over — so the
confirmation offers a one-press opt-out alongside it.

Erasure is defined per store rather than per command
([`src/handlers/privacy.ts`](src/handlers/privacy.ts)), so a future quiz type
declares how it erases and `/privacy forget` covers it without changing.

## 🏗️ How it works

The bot is **two Workers**, and the split is the most important thing to understand before changing anything.

```
bot Worker  (src/worker/)          ← the foundation; edits here reconnect
  ├─ fetch      /health
  ├─ scheduled  cron wake-up, so an evicted bot comes back
  └─ Durable Object (InbouBot)
       └─ Gateway connection ──> Discord
            ├─ onReady
            ├─ onInteractionCreate
            └─ onMessageCreate
                    │
                    │  service binding (HANDLERS)
                    ▼
handlers Worker  (src/handlers/)   ← app logic; edit freely, session survives
  ├─ commands.ts   slash commands
  ├─ messages.ts   typed answers
  ├─ Durable Object (QuizSession)  one per channel
  │    └─ state + the question timer, on an alarm
  └─ D1 (SCORES)   the cross-session leaderboard
```

Discord allows exactly **one Gateway session per bot**, and a Worker invocation cannot hold a socket open past the request that created it. A Durable Object can: it is addressable, single-instance, and — the part that matters — its alarms survive eviction. So the connection lives in the DO.

### Why the second Worker exists

The Cloudflare plugin makes the Worker entry self-accepting, and that entry re-exports the Durable Object. So editing _any_ module the entry can reach tears down the isolate, kills the Gateway session, and costs a fresh `IDENTIFY` against Discord's 1000-per-day budget. During a focused session on game logic that adds up fast, and the bot blinks offline each time.

Moving app logic into a separate Worker puts it outside that import graph. The plugin reloads the handlers Worker on its own, the Durable Object is never touched, and the session survives. Measured: four consecutive edits to handler code kept the same session id, while the equivalent edit to the bot Worker reconnects — which is correct, since its wiring genuinely changed.

This is the pattern Discord bot frameworks converge on — keep the socket service stable, reload the handler service — adapted to Workers via `auxiliaryWorkers` and a service binding.

### Other decisions worth knowing

- **Connection timers run on DO alarms, not `setTimeout`.** A DO's JS timers die with its isolate, so an evicted object would stop heartbeating and lose the session with no error anywhere. `src/worker/alarmScheduler.ts` multiplexes the connection's several pending timers onto the DO's single, non-repeating alarm slot.
- **`nodejs_compat` is off, deliberately.** The Gateway client runs on the bare Workers runtime — Web-standard `WebSocket`, no Node builtins. `vp run check:bundle` fails the build if a dependency pulls one in, so that stays a decision rather than a drift.
- **Intents are requested explicitly where no handler implies them.** `onMessageCreate` registers its own, but `MESSAGE_CONTENT` gates message _fields_ rather than an event: without it `content` arrives as an empty string and a prefix match silently never fires.

## 📦 Setup

```bash
vp install
```

### Environment

Copy `.env.schema` to `.env` and fill it in. `.env` is gitignored; `.env.schema` is committed and declares the shape, which Varlock validates.

| Variable                 | Required | Where to get it                                                                                                                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN`      | yes      | [Developer Portal][portal] → your app → **Bot → Reset Token**. Authenticates both the Gateway connection and the REST calls.                                                               |
| `DISCORD_APPLICATION_ID` | yes      | Same app → **General Information**. Public; it appears in invite URLs.                                                                                                                     |
| `DISCORD_GUILD_ID`       | no       | A development shortcut: registers commands to this one server, where they appear instantly and shadow the global set. Leave it unset for the registration users get. Needs Developer Mode. |

The bot needs two **privileged** intents enabled under **Bot → Privileged Gateway Intents**: **Message Content** and **Server Members**. Without them Discord closes the connection with a fatal `4014`.

### The leaderboard database

Session scores live in the Durable Object and vanish with the session. The
standing leaderboard is D1, which needs creating once:

```bash
wrangler d1 create inbou-scores
```

Put the returned id into `wrangler.handlers.jsonc` under the `SCORES` binding —
**not** `wrangler.jsonc`, which is where `wrangler d1 create` writes it by
default. The leaderboard belongs to the handlers Worker, and a binding on the
wrong Worker fails silently: the bot plays perfectly and simply records nothing.

Then apply the schema:

```bash
vp run scores:migrate          # local
vp run scores:migrate:remote   # the deployed database
```

Local development needs neither step — Miniflare creates its own database from
the binding — and the binding is optional at runtime. Without it the quiz plays
identically and keeps no leaderboard, rather than refusing to start.

## 🔧 Running it

| What              | Command                    | Notes                                                       |
| ----------------- | -------------------------- | ----------------------------------------------------------- |
| Local dev         | `vp run dev`               | Runs both Workers and the DO in real workerd via Miniflare. |
| Tests             | `vp test`                  | Drives a real Durable Object inside workerd.                |
| Bundle check      | `vp run check:bundle`      | Fails if the bundle pulls in a Node builtin.                |
| Register commands | `vp run commands:register` | Dev: pushes to `DISCORD_GUILD_ID`, instantly.               |
| Publish commands  | `vp run commands:publish`  | Global: every guild that has the bot. What users get.       |
| Migrate scores    | `vp run scores:migrate`    | Applies the D1 schema locally. Add `--remote` for live.     |
| Rebuild corpus    | `vp run corpus:build`      | Regenerates the word list from JMdict. Rarely needed.       |
| Deploy            | `vp run deploy`            | Build, migrate, deploy both Workers, register commands.     |

Slash commands are registered over REST and persist on Discord's side, so this is a deliberate step rather than something the bot does at boot. Re-running it replaces the whole set, which is what makes a removed command disappear.

### Two scopes, and why the distinction bites

**Global is the real one.** Commands belong to the _application_, not to a
server, so one global registration covers every guild that installs the bot —
including guilds that install it later. There is no per-server step, ever. A
client holding a stale command has it read-repaired on first use rather than
waiting out a propagation delay.

**Guild is a development shortcut.** A private copy scoped to one server that
updates instantly. It also **shadows** the global command of the same name
there, indefinitely, until cleared — so the server you test in becomes the one
place the published command list is not what runs. `vp run
commands:clear-guild` hands it back.

`vp run deploy` always publishes globally, whatever the environment holds.
That is not a detail: the scope used to depend on `DISCORD_GUILD_ID` being
absent, so a release from a machine with a dev `.env` published to one server
and exited 0, leaving every real user without commands. Named rather than
inferred now, with a test that fails if the deploy stops passing `--global`.

### Waking the bot in dev

`vp run dev` brings the bot online on its own and prints the state it reached:

```
➤  bot: connecting
Connected as 鸚法「いんぼう」
```

That comes from a small plugin in `vite.config.ts`, and it exists because the connection cannot start itself. The Gateway socket lives in a Durable Object, which only runs when something addresses it. In production the cron trigger does that every five minutes; **Miniflare never fires crons on a schedule locally**, so nothing would.

**Using the bot does not wake it,** which is the part that surprises people. Events flow one way — the bot Worker forwards to the handlers Worker, never back — so a slash command reaches the handlers over HTTP and never touches the object holding the socket. With the socket asleep no events arrive at all, so there is nothing to forward. The wake has to come from outside that loop.

If you need to do it by hand — a bot evicted mid-session, or a dev server started some other way:

```bash
curl http://localhost:5173/health
```

That reports the connection state and starts it, because reading the state requires the object. `/cdn-cgi/handler/scheduled` runs the same code path through the cron handler. Both are idempotent: a live connection short-circuits, so neither costs a Gateway session.

## 🚀 Releasing

Releases are driven by [bumpy][bumpy]. Every PR carries a **bump file** — a
small markdown note in `.bumpy/` saying what changed and how far the version
moves. CI fails a PR without one, so the changelog can never fall behind the
code.

```bash
vp exec bumpy add     # interactive: pick a bump level, write a summary
```

Merging that PR opens a **Version PR** with the version bump and the changelog
entry. Merging _the Version PR_ tags a release and deploys. Nothing reaches
production without a version and a changelog line.

### What deploying actually does

`vp run deploy` runs [`scripts/deploy.mjs`](scripts/deploy.mjs), in this order:

1. **`vp build`** — Vite's build, not wrangler's. Wrangler bundles on its own
   and would apply neither the `?raw` SQL import nor the `__BUILD__` define, so
   `/feedback` would report `dev` as the build for every production report.
2. **D1 migrations**, before the Worker that reads the table. Idempotent.
3. **The handlers Worker, then the bot Worker.** This order is load-bearing:
   the bot declares a service binding to `inbou-handlers`, and Cloudflare fails
   a deploy that binds a Worker which does not exist yet.
4. **Slash commands last**, so Discord never offers a command the running code
   cannot answer.

If any step after the first deploy fails, both Workers are rolled back to the
versions they were serving beforehand, pinned by id. The schema, the code and
the command list only work as a set — code expecting a column D1 does not have
is broken, and so are commands the running code cannot answer.

**Migrations are not rolled back, and must be additive.** Cloudflare restores a
Worker version but leaves connected resources alone, so after a rollback the
previous code runs against the _new_ schema. That is only safe if the new
schema is a superset: add tables and columns, never drop or rename.
`migrations.spec.ts` fails a migration that breaks the rule, which is what
keeps the recovery path from becoming a second outage.

Migrations run first for the same reason — a failure there has deployed
nothing, so there is nothing to undo.

### Two kinds of secret, which is not obvious

They look alike and are not interchangeable. Confusing them is how the first
production deploy went out green and then threw `1101` on every request.

**GitHub secrets** are read by the CI runner, at build time.

| Secret                   | Used for                                  |
| ------------------------ | ----------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Deploying both Workers and applying D1    |
| `CLOUDFLARE_ACCOUNT_ID`  | Same                                      |
| `DISCORD_BOT_TOKEN`      | Registering slash commands after deploy   |
| `DISCORD_APPLICATION_ID` | Same                                      |
| `BUMPY_GH_TOKEN`         | So the version PR triggers CI (see below) |

The Cloudflare token needs **Workers Scripts: Edit**, **D1: Edit**, **Workers
KV Storage: Edit**, **Account Settings: Read**, and **User Details: Read**. If
the repo is org-owned, a fine-grained PAT also needs that repo in its
**Repository access** list — permissions alone are not enough.

**Cloudflare Worker secrets** are read by the running Workers. `wrangler
deploy` ships code, not environment, so these are set once and persist across
deploys:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN --name inbou-handlers
npx wrangler secret put DISCORD_BOT_TOKEN --name inbou
npx wrangler secret put DISCORD_APPLICATION_ID --name inbou
```

Or in the dashboard: **Workers & Pages → the Worker → Settings → Variables and
Secrets → Add**, type **Secret**, then **Deploy**.

`BUMPY_GH_TOKEN` is a fine-grained PAT, and it is not optional here. GitHub
does not trigger workflows from PRs created with the default token, and `main`
requires the `Check & Test` check to merge — so a version PR opened without it
would sit forever with checks that never run.

The release job runs in a `production` GitHub Environment restricted to `main`,
which records a deployment on every release. The GitHub secrets above are still
repo-level; scoping them to that environment would mean only the release job
could read them.

### One token, one bot

Discord allows **one Gateway session per bot token**. Local development and
production therefore cannot share one: both would connect, and the channel
would get every message twice — two intro embeds, two copies of each question.

So development needs its own Discord application, with its own token in your
local `.env`. Production's token lives only in Cloudflare's Worker secrets.

`DISCORD_GUILD_ID` exists for this split: set it in dev and commands register
to one guild and appear instantly; leave it unset in production and they
register globally.

The same constraint governs staging. A preview deployment needs a third
application, and it is only worth running while you are actually testing — the
Gateway socket costs about 10,800 GB-s/day of the free tier's 13,000 Durable
Object allowance, so two always-on bots do not fit.

### Nothing to configure in the Discord portal

The bot dials Discord over the Gateway; Discord never calls in. **Leave
"Interactions Endpoint URL" empty** — filling it in makes Discord HTTP-post
interactions instead of sending them over the socket, and every command breaks.

The portal only needs the two privileged intents — **Message Content** and
**Server Members** — under Bot → Privileged Gateway Intents. Without them
Discord closes the connection with a fatal `4014`.

### Dependency versions

Two conventions, on purpose. The **toolchain is pinned exactly** — the
Cloudflare plugins, wrangler, vite-plus, vitest, xstate, nostics — because a
minor bump there can change the bundle or how the tests resolve modules, and
that should be a commit rather than a surprise. Ordinary libraries take a caret.

## 🧪 Two checks, and why both

- **`vp test`** proves the code _runs_ on workerd.
- **`vp run check:bundle`** proves it _deploys_.

The test pool runs inside workerd but with permissive module resolution — Vitest itself needs Node interop — so `node:fs` resolves happily there. Only the real bundle tells the truth. Run both.

## 🥂 License

[MIT][license] © [Drake Costa][personal-website]

[bumpy]: https://github.com/dmno-dev/bumpy
[discordkit]: https://github.com/discordkit/discordkit
[portal]: https://discord.com/developers/applications
[ci_badge]: https://github.com/discordkit/inbou/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/discordkit/inbou/actions/workflows/ci.yml
[license_badge]: https://img.shields.io/badge/license-MIT-blue.svg
[license]: https://github.com/discordkit/inbou/blob/main/LICENSE.md
[personal-website]: https://saeris.gg
