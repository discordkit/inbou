---
inbou: major
---

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
