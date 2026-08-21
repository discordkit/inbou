# Conjugation quiz

A per-channel Japanese conjugation quiz. The bot posts a word and a target form; players answer by typing an ordinary channel message, and the first correct one scores.

Status: **draft 1**, 2026-08-20. Decisions here are settled unless marked open. Section 8 lists what is not.

## Why a Gateway bot and not interactions

The defining mechanic is that everyone races to type. Interactions alone can only offer multiple-choice buttons or a private per-user modal, and both lose the shared-channel feel. So answers arrive as `MESSAGE_CREATE` and the bot needs the Gateway. [Kotoba](https://github.com/mistval/kotoba) is the reference implementation of that mechanic.

This choice is what forces the feedback design in [section 3](#3-what-discord-will-not-let-us-do).

## 1. The shape of a round

One session belongs to one channel. The bot posts a question, anyone who wants to play types an answer, and the first correct answer takes the point.

```
鸚法 BOT
  ┌ Question 3 · 売りません
  │ Target   Non-past negative (plain)
  │ Class    Godan (-r)
  └ [Hint] [Settings] [End]

drake   売らなかった   ❌
mika    うらない       ⭕

鸚法 BOT
  ┌ mika got it — 売らない
  │ Dictionary  売る（うる）
  │ Meaning     to sell; to betray
  │ Rule        Godan negative: う-row → あ-row, then ない.
  └ Attempts    drake 売らなかった (past, not non-past)
```

### Rules

- **One guess per player per question.** A second message from the same player is ignored — not penalised, just not scored. Adjustable after playtesting.
- **No skip. A timeout instead.** Default **2 minutes**, configurable. On expiry the bot reveals the answer and moves on.
- **Wrong guesses get a ❌ reaction**, correct ones ⭕. The teaching embed lands only when the question closes, so nothing is leaked mid-race.
- **Scoring is per guild**, accumulated across sessions.

### Session length

Fixed (5 / 10 / 15 / 20 / 30) or **endless**, which ends after **3–5 consecutive timeouts** — the signal that the room has gone quiet. Consecutive matters: a timeout followed by an answered question resets the counter.

## 2. Commands and configuration

Two surfaces, deliberately. Flags for people who know what they want, buttons for everyone else. Keep them thin and separable — we may drop one after testing.

```
/quiz start   [level] [type] [class] [forms]
              [length] [timeout] [difficulty]
/quiz config  <same flags>     — applies to the running session
/quiz end                       — stop, post final scores
/quiz scores  [user]            — guild leaderboard
/hint                           — ephemeral, private
/review                         — ephemeral recap of your last answer
```

### Defaults

| Flag         | Default             | Accepts                            |
| ------------ | ------------------- | ---------------------------------- |
| `level`      | N5                  | N5–N1, comma-separated             |
| `type`       | verb, adj-i, adj-na | + noun (off by default, see below) |
| `class`      | all                 | ichidan, godan, suru, kuru         |
| `forms`      | basics              | any of the 13, or `all`            |
| `length`     | 10                  | 5–30, or `endless`                 |
| `timeout`    | 2m                  | 30s–10m                            |
| `difficulty` | single              | `single` \| `compound`             |

**Why nouns default off.** In the reference corpus N5 is 312 nouns to 119 verbs, and nouns only conjugate the copula — だ / です / だった. Leaving them on makes an N5 session repetitive and easy. They stay available, just not by default.

### Mid-session changes

`/quiz config` takes the same flags and applies them **from the next question**, never retroactively. The reply is ephemeral, so tuning does not spam the channel. Changing `level` or `type` mid-session keeps the score: it is the same session, differently filtered.

## 3. What Discord will not let us do

**Ephemeral messages require an interaction token.** A typed answer arrives as `MESSAGE_CREATE` — an event with no token — so a plain message can never receive a private reply.

Verified three ways:

- Discord's docs: ephemeral messaging is "exclusively tied to the interaction system and requires the `interaction_token`".
- A Discord engineer declined the feature request as an abuse vector: bots could show members content that is not stored on Discord's servers, "leaving very little to no proof for Trust & Safety to look up".
- discordkit's own types — `createInteractionResponse` documents "only EPHEMERAL may be set"; `createMessage` has no path to it.

Open since 2021 across discord-api-docs [#2486](https://github.com/discord/discord-api-docs/issues/2486), [#3291](https://github.com/discord/discord-api-docs/discussions/3291) and [#7693](https://github.com/discord/discord-api-docs/discussions/7693), still declined.

So the teaching moment cannot be private at the moment a wrong answer is typed. Instead:

| Moment        | Channel                           | Privacy                                    |
| ------------- | --------------------------------- | ------------------------------------------ |
| Wrong guess   | ❌ reaction on their message      | Public, but silent — no explanation leaked |
| Correct guess | ⭕ reaction, round closes         | Public                                     |
| Round ends    | Embed: answer, rule, all attempts | Public — the question is settled           |
| `/hint`       | Ephemeral reply                   | **Genuinely private**                      |
| `/review`     | Ephemeral reply                   | **Genuinely private**                      |

The reaction carries information (right or wrong) without carrying the answer, so the race survives: knowing drake was wrong tells you nothing about what is right.

Because `/hint` is ephemeral and in-channel, nobody switches to DMs, and a hint gives nothing away to the rest of the room.

## 4. Answering: what counts as correct

1. **Normalise** — NFKC, strip all whitespace, trim trailing `。、.,!?！？`
2. **Romaji → kana** — ours only, see below
3. **Fold katakana** — katakana to hiragana by codepoint −96
4. **Compare** — against the folded kana answer, _or_ the kanji surface unfolded

All four of these score for 売らない:

```
うらない      kana
売らない      kanji
ウラナイ      katakana  (folded)
uranai        romaji    (converted — our addition)
```

**Romaji is a real decision, not a detail.** The reference app never scores romaji: its input field converts before submission. A Discord message arrives raw, so without step 2 a member typing `uranai` is simply wrong. For a club with mixed keyboard setups that excludes people. It also brings ambiguity we must handle — `n` vs `nn`, `si` / `shi`, trailing consonants mid-word.

## 5. Questions: how one is made

### Single-word (all levels, default)

Two shapes only, following the reference model:

| Target              | Prompt                              | Task             |
| ------------------- | ----------------------------------- | ---------------- |
| One of the 4 basics | **Polite** form of that same target | Convert register |
| The other 9 forms   | **Dictionary** form                 | Conjugate        |

The four basics are non-past affirmative and negative, past affirmative and negative.

### Compound (higher levels)

Difficulty at N3 and above should come from multi-word constructions carrying a specific meaning, not just rarer vocabulary. These compose from the same primitive, because each intermediate result is itself a valid verb:

```
食べる
  → causative        食べさせる
  → passive          食べさせられる
  → te-form          食べさせられて
```

| Construction       | Means                       | Built from                         |
| ------------------ | --------------------------- | ---------------------------------- |
| 〜なければならない | must do                     | negative stem + fixed tail         |
| 〜てしまう         | do completely / regrettably | te-form + しまう (v5u)             |
| 〜ておく           | do in advance               | te-form + おく (v5k)               |
| 〜させられる       | be made to do               | causative → passive                |
| 〜たくない         | don't want to               | masu-stem + たい → い-adj negative |

**We already own the teaching text.** `vscode-jisho/src/shared/grammar.ts` is 641 lines of originally-written notes whose `AUXILIARY_NOTES` covers exactly these building blocks — しまう・おく・いる・くれる・もらう・あげる・そうだ・ようだ・らしい plus the passive and causative primitives. Each carries a gist, a detail paragraph and an N5-vocabulary example.

## 6. Where things live

Quiz logic goes in `src/handlers/` so that editing it never restarts the Gateway session. See the README for why that split exists.

| Store          | Holds         | Notes                                                                                                             |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Durable Object | Session state | One per channel, in the **handlers** Worker. Current question, per-player guesses, scores, config, timeout alarm. |
| D1             | Guild scores  | Cross-session leaderboard. A 30-question session writes ~30 rows against 100k/day.                                |
| open           | Word corpus   | Read-only, never written at runtime. Bundle, D1, or static assets.                                                |

**The timeout runs on a Durable Object alarm**, not `setTimeout` — the same reasoning as the connection timers in `src/worker/alarmScheduler.ts`. A DO's JS timers die with its isolate, so an evicted session would silently stop timing out.

### The handlers Worker owns the session object — verified

Spiked and confirmed, so this is settled rather than assumed. Under `vp run dev` both Workers hold their own SQLite-backed namespaces at once:

```
inbou           BOT     → InbouBot      use_sqlite: true
inbou-handlers  SESSION → QuizSession   use_sqlite: true
```

Exercised end to end through the bot Worker's `HANDLERS` service binding into the handlers DO — storage persisted across calls, and the alarm handler fired there. Most importantly the reason for the split held: **four consecutive edits to handler code left the Gateway session id unchanged**, while the object's storage kept its state across those reloads.

The local explorer API is what to reach for on the next binding question:

```
GET /cdn-cgi/local/explorer/api/workers/durable_objects/namespaces
GET /cdn-cgi/local/explorer/api/local/workers
```

**The Vitest pool needs two things**, because it runs every test in one Worker and resolves each Durable Object class against that Worker's entry, while our two classes live in different entries:

- `main: "./src/testEntry.ts"` — a non-shipping module re-exporting both classes. It also needs a default export, since a Durable Object cannot be one.
- `miniflare.durableObjects.SESSION = { className, useSQLite: true }` — the pool reads `wrangler.jsonc` and never `wrangler.handlers.jsonc`, so the binding and its SQLite backend must both be restated.

This is a test-harness concern only. Production keeps the split.

### It fits the free tier, and the quiz is not what costs

Durable Objects bill on **wall-clock duration at a flat 128 MB (0.125 GB)**, whatever memory is really used. The free plan allows **13,000 GB-s/day** and 100,000 requests/day.

The Gateway connection dominates, and it predates the quiz entirely:

```
86,400s/day × 0.125 GB = 10,800 GB-s/day   83% of the allowance
                                            2,200 GB-s/day left
```

An object avoids duration charges only if it is _eligible for hibernation_, which requires all of: no `setTimeout`/`setInterval`, no in-flight `fetch()`, no WebSocket API, no request still processing, and **no active outbound connection**. `@discordkit/gateway` calls `new WebSocket(url)`, so `InbouBot` is permanently ineligible — the docs are explicit that an accepted WebSocket "will incur duration charges for the entire time the WebSocket is connected".

The WebSocket Hibernation API does not rescue this: it applies to _inbound_ connections where clients connect to your object. Ours is an outbound client connection to Discord.

**`QuizSession` is nearly free**, because it breaks none of those conditions — no WebSocket, no timers (alarms instead), no outbound connection. It hibernates about ten seconds after each question and is billed for active JavaScript rather than session wall-clock:

```
30-question game ≈ 10.5s active ≈ 1.3 GB-s ≈ 0.06% of the remaining headroom
```

Requests are not a concern either: alarm-driven heartbeats run at roughly 2,100/day against a 100,000 allowance.

**The risk is availability, not cost.** Exceeding a free-tier limit makes further operations fail, so an overrun takes the bot offline rather than producing a bill. The 2,200 GB-s cushion is thin enough that a reconnect loop, or anything else on the account using Durable Objects, could eat it. Worth watching in the dashboard after deploying. If it ever binds, the fix is the paid plan rather than an architecture change.

## 7. Build order

Sequenced so each step is verifiable on its own and nothing blocks on an open question.

1. **Conjugator** — port `conjugate.ts` and `kana.ts`, add polite/casual flat keying, test the irregulars. Pure functions, no Discord, no session cost.
2. **Scorer** — normalise → romaji → fold → compare. Table-driven tests over the four accepted spellings.
3. ~~**Corpus pipeline**~~ — done; see section 9.
4. **Session DO** — state machine and alarm timeout. The binding is spiked and working; `src/handlers/session.ts` is the placeholder to replace.
5. **Discord surface** — commands, embeds, reactions, buttons, ephemeral hint.
6. **Leaderboard** — D1 schema and `/quiz scores`.
7. **Compound forms** — grammar layer over the primitive, wired to the existing notes.

## 8. Still open

None of these block step 1.

- ~~**Can the handlers Worker own a Durable Object namespace?**~~ **Answered: yes.** Verified end to end; see section 6.
- ~~**Where does the corpus live — bundle, D1, or static assets?**~~ **Answered: bundled.** Measured at 578 KiB gzipped against a 3 MB limit — 19% — so the simplest option is also affordable. See section 9.
- **How are ties handled** when two correct answers land in the same second? Gateway ordering gives a sequence, so first-received wins — but that is a decision to state, not to leave to chance.
- **What exactly ends an endless session** — 3, 4, or 5 consecutive timeouts? At a 2-minute timeout, 3 means six quiet minutes. Probably right, worth playtesting.
- **Does `/hint` cost anything?** Currently free. If scores matter competitively a hint might forfeit the point, or not, if the bot is primarily a teaching tool.

## 9. The corpus

Built by `vp run corpus:build` into `src/handlers/quiz/corpus.json`, which is **committed**. Nothing regenerates it on a normal build or in CI, so neither touches the network.

|                        |                                                            |
| ---------------------- | ---------------------------------------------------------- |
| Words                  | 7,409                                                      |
| Source                 | JMdict `jmdict-examples-eng`, resolved at build time       |
| With example sentences | 5,543                                                      |
| Size                   | 1,820 KB raw · **578 KiB gzipped** (19% of the 3 MB limit) |

By level: N5 210 · N4 294 · N3 670 · N2 873 · N1 1,318 · unlevelled 4,044.
By type: verb 5,748 · な-adj 1,347 · い-adj 314.

**Tatoeba comes free.** The `jmdict-examples-eng` asset embeds Tanaka-corpus sentences per sense, already paired with English translations — so there is no separate sentence download and no index join.

**Word class is resolved once, at build time.** A JMdict entry carries POS codes across its senses, and `src/handlers/quiz/wordClass.ts` picks the one the conjugator should use. Verbs are checked before adjectives and both before nouns, so a する-noun like 勉強 is drilled as 勉強する rather than as a copula.

### Register filtering

- **Dropped entirely**: `vulg`, `X`, `arch`, `obs`, and `chn`. That last one is not obvious — JMdict files うんこ and ウンチ under _children's language_ rather than vulgar, so omitting it lets lavatory words through a filter meant to catch exactly those.
- **Held to N2**: `on-mim`, `col`, `sl`, `net-sl`, `derog` — but only for words with no JLPT listing. A listed level always wins, because ゆっくり is tagged `on-mim` and is genuinely N5.

### Why N5 is only ~210 words

Not a pipeline bug — measured. JMdict's `common` filter drops exactly **one** N5 word. Of Waller's 667 N5 entries, **444 are not conjugable at all**: particles, adverbs, pure nouns, numbers. Only 223 are verbs or adjectives.

For comparison, TinyWisdom's N5 conjugable set is **188**. We are ahead, not behind.

No better open dataset exists. `yomitan-jlpt-vocab`, `yomichan-jlpt-vocab` and `open-anki-jlpt-decks` all derive from the same Waller lists, and JLPT publishes no official vocabulary list at all. Shin Kanzen Master is a copyrighted textbook series whose fan-made decks key by surface text rather than JMdict id, so joining them would be both lossy and legally murky.

The realistic way to grow N5 is **pure nouns with the copula** (犬 → 犬だ / 犬でした), which is most of those 444 entries. Not built yet; nouns default off regardless.

### What guards it

`src/handlers/__tests__/corpus.spec.ts` runs on every CI pass and checks all 7,409 entries against the real conjugator: every word conjugates, every word produces each form its type promises, required fields are present, levels are in range, and the crude words stay out. A committed data file cannot drift from the code that reads it without a test failing.

## Background

Researched from [TinyWisdom's conjugation drill](https://japanese.thetinywisdom.com/conjugations), whose single JS bundle embeds both its game logic and its 6,883-word corpus. Two mechanics were taken from it directly: the prompt rule in section 5 and the scorer in section 4. Its corpus was **not** taken — it is a curated JMdict slice with hand-capped levels and an unofficial community JLPT list, so we build our own from the same public sources.

Word data and conjugation rules come from `@saeris/vscode-jisho`, which already solves the hard part. `conjugate.ts` has zero imports and runs on the bare Workers runtime unchanged, handling 行く gemination, 問う, ある → ない, 下さる, いい → よい and 来る in both scripts. Its shape differs from what the quiz needs — it pairs polarity per row where the quiz wants 13 flat forms split polite and casual — so the port needs a thin adapter.

JLPT levels are not a JMdict field. They come from Waller / tanos via [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab), keyed by JMdict sequence id and merged at build time.
