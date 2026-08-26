# Changelog



## 1.1.0
<sub>2026-08-26</sub>

- [#9](https://github.com/discordkit/inbou/pull/9)  *(minor)* Thanks [@Saeris](https://github.com/Saeris)! - Add /privacy: tracking opt-out and right to be forgotten
- [#7](https://github.com/discordkit/inbou/pull/7)  *(patch)* Thanks [@Saeris](https://github.com/Saeris)! - Name the command registration scope instead of inferring it
- [#10](https://github.com/discordkit/inbou/pull/10)  *(patch)* Thanks [@Saeris](https://github.com/Saeris)! - Roll back a failed deploy, and fix the remote migrate task

## 1.0.1
<sub>2026-08-22</sub>

- [#4](https://github.com/discordkit/inbou/pull/4)  *(patch)* Thanks [@Saeris](https://github.com/Saeris)! - Record deployments in a production GitHub Environment

## 1.0.0
<sub>2026-08-22</sub>

- [#2](https://github.com/discordkit/inbou/pull/2)  *(major)* Thanks [@Saeris](https://github.com/Saeris)!
  First release: a Japanese conjugation quiz for Discord.

  The bot posts a word and a target form; the first person to type the right
  answer takes the question. Answers are accepted in kana, kanji, katakana or
  romaji, so a club typing on mixed keyboard setups can all play, and ordinary
  channel conversation is ignored rather than scored.

  **Commands.** `/quiz start`, `/quiz config`, `/quiz end`, `/quiz scores`,
  `/hint`, `/review`, `/feedback`.

  **The quiz.** 13 conjugation forms across verbs, い-adjectives, な-adjectives
  and nouns, drawn from a corpus built from JMdict with JLPT levels. Above N5,
  five multi-word constructions — 〜なければならない, 〜てしまう, 〜ておく,
  〜させられる, 〜たくない — so difficulty comes from grammar rather than rarer
  vocabulary. Scoring tapers with each wrong guess.

  **Sessions** are per channel, held in a Durable Object as an XState machine,
  with the question timer on a DO alarm so an evicted session still times out.
  Scores persist per guild in D1.

  **Architecture.** Two Workers: the bot Worker holds the Gateway connection in a
  Durable Object, and the handlers Worker holds the app logic. Editing quiz code
  reloads only the handlers, so the Gateway session survives — measured across
  four consecutive edits. Everything the quiz decides is pure and runs in plain
  Node; only the Durable Objects and D1 need workerd.
- [#2](https://github.com/discordkit/inbou/pull/2)  *(minor)* Thanks [@Saeris](https://github.com/Saeris)!
  Release automation and Cloudflare deployment.

  Merging a PR with a bump file opens a version PR; merging that tags a release
  and deploys. Deployment builds with Vite (not wrangler's own bundler, which
  would apply neither the `?raw` SQL import nor the `__BUILD__` define), applies
  D1 migrations, deploys the handlers Worker before the bot Worker as the service
  binding requires, and registers slash commands last so Discord never offers a
  command the running code cannot answer.
