# Terms of Service

**鸚法 (inbou)** — a Japanese conjugation practice bot for Discord.

Last updated: 26 August 2026

## The short version

inbou is a free example project that asks Japanese conjugation questions in a
Discord channel. Use it, don't abuse it, and understand that it comes with no
guarantees — including that it will still be here tomorrow, with your scores
intact. If that is fine with you, there is nothing else to agree to.

## What it is

A bot that posts a word and a target form and scores the first correct answer.
It keeps a per-server leaderboard, which you can opt out of or delete — see the
[Privacy Policy](PRIVACY.md).

It is [open source](https://github.com/discordkit/inbou) under the MIT licence,
published by the [discordkit](https://github.com/discordkit) organization as a
**real-world reference** for developers building bots with discordkit's
libraries. The running instance is a demonstration of that code, offered free
of charge.

You are free to run your own instance; these terms cover the one discordkit
operates.

## Using it

Add it to a server you have permission to add bots to. Anyone who can see a
channel can start a quiz in it and answer questions.

Please don't:

- Use it to harass anyone, or in a server whose purpose is harassment
- Try to break, overload, or gain unintended access to it
- Automate answers, or otherwise game the leaderboard — it is a study aid, and
  a fake score helps nobody
- Use it where doing so would break Discord's
  [Terms of Service](https://discord.com/terms) or
  [Community Guidelines](https://discord.com/guidelines), which apply to you
  independently of these terms

The bot may be removed from a server, or a user blocked from it, if it is being
used this way. There is no appeal process, because there is no company — but
you are welcome to
[get in touch](https://github.com/discordkit/inbou/issues).

## What you can expect

**No guarantees of any kind.** It runs on Cloudflare's free tier. It may be
slow, may be down, may lose a session mid-game, and may be discontinued without
notice. Nothing here is a commitment to availability, correctness, or support.

**The Japanese may be wrong.** The corpus is generated from
[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) and the conjugations are
produced by code. Both have been tested carefully, and both can still be wrong.
**Do not rely on inbou as an authority for study, coursework, or an exam.** It
is practice, not a textbook. If you find a mistake, `/feedback bug` is genuinely
useful.

**Scores are not precious, and neither is the service.** Both the bot and its
leaderboard history may be changed, reset, or deleted **at any time and without
notice** — a bug, a migration, an expired account, or a decision to stop
running it. Nothing here promises the data will exist tomorrow.

That is a property of a free example project, not an oversight. **If you want
guarantees about your data, run your own instance** — the code is MIT licensed
and self-hosting is what it is published for.

Formally: the software is provided "as is", without warranty of any kind,
express or implied. To the fullest extent the law allows, discordkit and its
contributors are not liable for any damages arising from its use. This does not
exclude liability that cannot lawfully be excluded.

## Content

Answers you type are messages in your own Discord server, governed by Discord's
terms and your server's rules — not by the bot. It reads them only to score
them.

`/feedback` publishes what you submit as a public GitHub issue under your own
account. That is your content, and yours to edit or delete.

## Cost

Free. There is nothing to buy, no premium tier, and no advertising. If it ever
becomes expensive to run it will be limited or shut down rather than
monetised — the current design fits Cloudflare's free tier deliberately.

## Changes

These terms may change. Material changes will be noted in the
[changelog](https://github.com/discordkit/inbou/blob/main/CHANGELOG.md) and the
date above updated; the git history of this file is the full record. Continuing
to use the bot after a change means accepting it. If you disagree, remove the
bot and run `/privacy forget`.

## Contact

[Open an issue](https://github.com/discordkit/inbou/issues), or use
`/feedback` in Discord.
