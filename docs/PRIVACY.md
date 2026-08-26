# Privacy Policy

**鸚法 (inbou)** — a Japanese conjugation practice bot for Discord.

Last updated: 26 August 2026

This describes what the bot stores, why, and how to remove it. It reflects what
the code actually does; the tables it names are in
[`migrations/`](../migrations) and the deletion path is in
[`src/handlers/privacy.ts`](../src/handlers/privacy.ts).

## Who runs it

inbou is an **example project** published by the
[discordkit](https://github.com/discordkit) organization — a real-world
reference for developers building bots with discordkit's libraries. It is not a
company, a product, or a service with anybody on call.

It is [open source](https://github.com/discordkit/inbou) and self-hostable;
this policy covers the instance discordkit operates, which is the one you get
by installing the bot from its invite link.

If you run your own instance, you are its operator and this policy is not
yours — fork it and say what your deployment does.

Questions or requests: [open an issue](https://github.com/discordkit/inbou/issues)
or use `/feedback`.

## What is stored

### Kept until you delete it

When a quiz session finishes, one row per player per server:

| Field       | Column        | What it is                                         |
| ----------- | ------------- | -------------------------------------------------- |
| Server ID   | `guild_id`    | The Discord server the session ran in              |
| User ID     | `user_id`     | Your Discord user ID — a number, not your username |
| Points      | `points`      | Your running total in that server                  |
| Correct     | `correct`     | How many questions you have answered correctly     |
| Sessions    | `sessions`    | How many sessions you have taken part in           |
| Last played | `last_played` | When you last finished a session                   |

If you turn tracking off, one further row records that choice — `guild_id`,
`user_id`, and `opted_out_at`, the moment you made it. It exists so the
preference survives between sessions.

The column names are the real ones, from
[`migrations/`](../migrations), so this table can be checked against the
schema rather than taken on trust.

That is the entire durable record. No usernames, no message content, no
answers, no timestamps beyond the two above.

### Kept for one session, per channel

A session holds, in storage attached to that channel: the current question, who
has answered it, what they typed, and the running scores. This is what makes
the game work — the standings, the reveal, and `/review`.

**It is replaced when the next session starts in that channel.** A finished
session's state stays there until then, so the most recent game in a channel is
readable by the bot until somebody plays another. Nothing outside that channel
reads it, and it is never copied into the durable record except as the points
and counts above.

`/privacy forget` clears the durable record, not a session in progress — that
one ends on its own, and nothing from it is written to the leaderboard for a
player who has opted out or been forgotten.

### Published deliberately, by you

`/feedback` opens a **pre-filled GitHub issue** containing your user ID, the
server and channel ID, your Discord language setting, the bot's version, and
the current quiz settings.

Nothing is sent until you press Submit on GitHub, and you can edit or delete
any of it first. **Once submitted it is a public GitHub issue under your own
account**, and the bot cannot retract it — `/privacy forget` does not and
cannot reach it. Delete or edit the issue yourself if you change your mind.

## What is never stored

- Your username, display name, or avatar
- The content of messages, including your answers, beyond a session's own lifetime
- Anything at all in a direct message — there is no leaderboard outside a server
- Any analytics, tracking, or advertising identifiers
- Anything that leaves Cloudflare, other than what you deliberately publish

## Why

The scores exist so `/quiz scores` can show a server's leaderboard across
sessions rather than only the game just played. The tracking preference exists
so opting out does not have to be repeated every session.

There is no other purpose. The data is not analysed, profiled, sold, or shared.

## Your controls

Everything is self-service, in Discord, and every reply is private to you.

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `/privacy tracking`                | Shows whether your scores are being saved              |
| `/privacy tracking off`            | Stops saving them. You can still play normally         |
| `/privacy tracking on`             | Starts saving again                                    |
| `/privacy forget`                  | Deletes your data in this server, after a confirmation |
| `/privacy forget scope:everywhere` | Deletes it in every server                             |

**Opting out** stores one row — the preference itself — and nothing else. You
keep playing, keep racing, and still appear in the standings a session posts
while it runs; those messages are not stored.

**Deleting** shows you the counts first and waits for a confirmation, because
it cannot be undone. It removes your tracking preference too, which means the
bot then treats you as new and the next session records you again. The
confirmation says so, and offers to opt you out in the same step.

Everything above is self-service on purpose. Deleting your data should not
require handing your Discord user ID to a third service to ask.

## Where it lives, and for how long

Everything is on [Cloudflare](https://www.cloudflare.com/privacypolicy/) —
Workers and D1, in their global network. No other processor is involved.

There is no scheduled deletion: scores are kept until you delete them, because
a leaderboard that quietly forgot people would be worse than one that does not.

**There is equally no guarantee that they are kept.** inbou is an example
project offered free of charge, and the service and its leaderboard history may
be changed, reset, or deleted entirely **at any time and without notice** — a
migration, a mistake, an expired account, or simply a decision to stop running
it. Nothing here is a commitment to durability.

If your data matters to you, [run your own
instance](https://github.com/discordkit/inbou). That is what the project is
for, and it is the only way to control what happens to it.

## Children

Discord requires users to be 13 or older, or older where local law says so.
inbou is not directed at children and collects nothing beyond what is described
above from anybody.

## Changes

Material changes will be noted in the
[changelog](https://github.com/discordkit/inbou/blob/main/CHANGELOG.md) and
this document's date updated. The git history of this file is the full record.

## Legal bases, for anyone who needs them

The data controller for the instance described here is the **discordkit**
organization, reachable through
[the repository's issues](https://github.com/discordkit/inbou/issues).

Under the UK GDPR and EU GDPR, the lawful basis is **legitimate interest** —
running a practice game people asked for, using the minimum needed to keep a
score. You can object at any time with `/privacy tracking off`, and exercise
erasure with `/privacy forget`.

Rights of access, rectification, erasure, and portability are satisfied by
`/privacy`, in Discord, immediately and without identifying yourself to anybody
else. `/quiz scores @you` is the access right; `/privacy forget` is the erasure
right. Since the whole record for a person is the handful of numbers listed
above, that is complete erasure — with the single exception of a GitHub issue
you chose to publish.
