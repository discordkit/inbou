<div align="center">

# 🦜 鸚法

[![CI status][ci_badge]][ci] [![License][license_badge]][license]

A Japanese practice bot for Discord, built on [discordkit][discordkit] and deployed to Cloudflare Workers.

</div>

---

**鸚法** (_inbou_) is a pun on 鸚鵡返し (_ōmugaeshi_, parroting something back) and 文法 (_bunpō_, grammar) — repetition being how a language sticks, and a nod to Coca Bird, the cockatiel emoji character mascot of the server it was built for.

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

| Variable                 | Required | Where to get it                                                                                                                                     |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`      | yes      | [Developer Portal][portal] → your app → **Bot → Reset Token**. Authenticates both the Gateway connection and the REST calls.                        |
| `DISCORD_APPLICATION_ID` | yes      | Same app → **General Information**. Public; it appears in invite URLs.                                                                              |
| `DISCORD_GUILD_ID`       | no       | The server to register commands into while developing. Guild commands appear immediately; global ones can take up to an hour. Needs Developer Mode. |

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
vp run scores:migrate            # local
wrangler d1 migrations apply inbou-scores   --config wrangler.handlers.jsonc --remote
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
| Register commands | `vp run commands:register` | Pushes the command list to Discord.                         |
| Migrate scores    | `vp run scores:migrate`    | Applies the D1 schema locally. Add `--remote` for live.     |
| Rebuild corpus    | `vp run corpus:build`      | Regenerates the word list from JMdict. Rarely needed.       |
| Deploy            | `wrangler deploy`          | Needs your own Cloudflare account.                          |

Slash commands are registered over REST and persist on Discord's side, so `commands:register` is a deliberate step rather than something the bot does at boot. Re-running it replaces the whole set, which is what makes a removed command disappear.

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

[discordkit]: https://github.com/discordkit/discordkit
[portal]: https://discord.com/developers/applications
[ci_badge]: https://github.com/discordkit/inbou/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/discordkit/inbou/actions/workflows/ci.yml
[license_badge]: https://img.shields.io/badge/license-MIT-blue.svg
[license]: https://github.com/discordkit/inbou/blob/main/LICENSE.md
[personal-website]: https://saeris.gg
