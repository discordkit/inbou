# JLPT mock tests

Practice tests in the shape of the real JLPT, played in a Discord channel. The bot asks one question at a time with numbered buttons, everyone answers privately, and everyone who is right scores. Students repeat the tests until they can hold a steady score before the real exam.

Status: **draft 1**, 2026-11-10. Decisions here are settled unless marked open; section 10 lists what is not. Nothing is built yet. N5 Section 2 (grammar and reading) comes first, and grammar comes before reading.

## Why a poll and not a race

The conjugation quiz is a race: the first correct typed answer wins. That suits recall, where typing the answer is the skill. A multiple-choice test is different. With four buttons, a race rewards the fastest press, and a blind guess is right one time in four. The JLPT measures accuracy, so the mock tests do too.

So every player votes privately, can change their vote until the question closes, and scores if their final vote is right. There is **no speed bonus**: a correct answer in the last second scores the same as one in the first. The poll mechanics come from a sibling bot built on this project, which settled them for a trivia game.

A button press is an interaction and carries a token, so each vote gets a private acknowledgement. That is the one thing the conjugation quiz cannot have (see its spec, section 3), and it is what makes a private poll possible.

## 1. The real test

N5 has three test sections. Section 2, 言語知識（文法）・読解, takes 40 minutes. Since December 2020 it has 22 items:

| 問題 | Name             | What it asks                                               | Items |
| ---- | ---------------- | ---------------------------------------------------------- | ----- |
| 1    | 文法形式の判断   | Choose the form that fits the blank （　）                 | 9     |
| 2    | 文の組み立て     | Put four chunks in order; choose the chunk that lands on ★ | 4     |
| 3    | 文章の文法       | A short essay by a student, with numbered blanks           | 4     |
| 4    | 内容理解（短文） | A text of about 80 characters, one question                | 2     |
| 5    | 内容理解（中文） | A text of about 250 characters, two questions              | 2     |
| 6    | 情報検索         | Find facts in a notice, timetable or flyer                 | 1     |

Every item has four options, numbered 1 to 4. Text uses spaces between phrases (分かち書き), and every kanji carries furigana.

**What 問題1 really tests.** In the official sample, about half the items test particles. The rest test adverbs, question words, こそあど words, a verb form inside a pattern (飲み + ながら), and set phrases (ください, 来ませんか). Grammar lists put patterns like 〜たことがある first; the paper does not. The corpus is weighted to match the paper.

**How the JLPT scores.** It uses scaled scores from Item Response Theory: the result depends on _which_ items a person got right, not on how many. N5 reports two scoring sections. Vocabulary, grammar and reading together score 0–120, with a minimum of 38. Listening scores 0–60, with a minimum of 19. The pass mark is 80 of 180.

## 2. The shape of a test

One test belongs to one channel. The bot posts a question, players press a numbered button, and the question closes when its timer ends. Then the bot reveals the answer with a short teaching note, pauses, and asks the next one.

```
鸚法 BOT
  ┌ もんだい１ · 3 / 17 · ends in 52 seconds
  │ （　）に 何(なに)を 入(い)れますか。１・２・３・４から いちばん いい ものを 一(ひと)つ えらんで ください。
  │ ## 電車(でんしゃ)（　） 学校(がっこう)へ 行(い)きます。
  │ [1 に] [2 で] [3 を] [4 が]
  │ 3 answers so far
  └ [End test]

  (mika presses 2)   → only mika sees: "You chose 2."
  (mika presses 3)   → only mika sees: "Changed to 3."

  ┌ もんだい１ · 3 / 17 · closed                                   (green)
  │ ## 電車(でんしゃ)で 学校(がっこう)へ 行(い)きます。
  │ Answer  2 で          2 of 3 correct
  │ I go to school by train.
  └ で marks the means: by train, by bus, with a pen.
```

### Rules

- **Everyone who is right scores.** Not only the first.
- **A player holds one vote per question, and it is the latest one.** Changing a vote is always allowed and costs nothing.
- **The timer always runs to the end.** The number of players is not known, so the bot cannot tell when "everyone" has voted.
- **The vote counter shows a count, never a distribution.** "3 picked 2" would leak the answer and make players follow the crowd. The counter is debounced (edited at 1, 2, 4, 8 … votes), because Discord limits message edits per channel.
- **A press on an old question does nothing** except a private "that question has closed". Each question carries a short random token in its buttons, and the session rejects any other token.
- **The answer is never in a button's `customId`.** A client can read those. The correct position lives only in the session.
- **Timers depend on how much there is to read.** Each type has a base time, plus time per character of text the player must read. A passage counts in full for its first blank and not again. The constants are tuned in live play.
- **Players can join at any question.** Nothing depends on being there at the start.

### Results

At the end, the bot posts a results card with each player's score and percentage. A **My results** button gives each player a private breakdown per 問題 and the items they missed, with the answers.

The card also shows a guide line: the real N5 needs 38 of 120 (32%) in its first scoring section. The JLPT scales its scores, so we show this as a guide, not as an equivalent.

## 3. Commands

The commands follow the skill split of the Shin Kanzen Master series, which we use as the model for higher levels. N5 has no Shin Kanzen Master book, so N5 follows the official samples.

```
/bunpou start            — grammar: 問題1–3, 17 questions
/dokkai start            — reading: 問題4–6, 5 questions
/moshi start section:2   — the whole of Section 2, grammar then reading
/moshi history           — your recent results and average (private)
```

`/goi` (vocabulary) and `/choukai` (listening) come later. The conjugation quiz keeps `/quiz`.

A test cannot start while a `/quiz` session runs in the same channel, and the other way round. Typed answers and button votes in one channel at once would confuse everyone.

## 4. Items

The bot does not invent questions. Every item is written by hand, reviewed by a person who reads Japanese well, and stored in the repository.

### Source files

Items live in YAML under `data/jlpt/n5/`, one file per question type. `grammar-points.yaml` lists the grammar points that items refer to. `vp run exam:build` checks every item and writes the reviewed ones to `src/handlers/exam/corpus.json`. Like the word corpus, it is built on purpose, never automatically, and the output is committed.

```yaml
# 問題1. Ruby is {漢字|かな}. A blank is （n）, where n is the slot number.
- id: n5-b1-0001
  type: form
  status: draft
  sentence: "{電車|でんしゃ}（1） {学校|がっこう}へ {行|い}きます。"
  en: I go to school by train.
  slots:
    - answer: で
      wrong: [に, を, が, と]
      difficulty: 1
      points: [particle-de-means]
      note: で marks the means.
```

- **`id` is permanent.** Results and statistics refer to it, so an id is never reused, even after its item is deleted.
- **Difficulty, grammar points and the note belong to a slot**, not to the sentence, because two blanks in one sentence can test different things.
- **`difficulty` is 1, 2 or 3.** The reviewer sets it. Later, real answers recalibrate it (section 6).
- **Options hold only the part that varies.** If every option would end in です, です goes in the sentence: きのうの テストは あまり（　）です, with むずかしくなかった and its neighbours as the options. An ending stays in the options only when it is itself what varies (です, でした, ですか). Every character of an option is read four times, and the timer grows with it. `exam:build` prints a hint when all of a slot's options share an ending; the reviewer decides.
- **`status` is `draft` or `reviewed`.** Only reviewed items ship. `exam:build --drafts` includes drafts for a local preview and must never be committed.
- **A sentence can have several slots.** Each slot has its own pool of wrong answers, so one sentence gives several questions.
- **A wrong pool holds three or more options.** Each one is checked as wrong _in this sentence_. At ask time, the bot draws three of them, which makes a repeated item look different.
- **A pair item** (は／は) has one slot that covers two blanks. Its options are written as the paper writes them: `は／は`.

### ★ items (問題2)

A ★ item is a sentence split into parts, plus one or more **windows**: runs of four consecutive parts that have exactly one valid order.

```yaml
- id: n5-b2-0001
  type: compose
  parts: [この, かばん, は, わたし, の, です。]
  windows: [1] # parts 1–4: かばん は わたし の
```

At ask time, the bot chooses a window, puts the ★ on one of its four positions at random, and shuffles the four chunks into the options. One item with one window gives four different questions, so a student cannot memorise "the answer is わたし".

The four chunks in a window must be different strings. If two chunks were both の, the answer would be ambiguous.

### Passages (問題3)

A passage has four or more blanks. The bot asks four of them, in order, and fills the others in with their answers. Each blank has its own answer, wrong pool, difficulty and points.

### What code checks, and what a person checks

Code checks every item, drafts included, in `vp test`:

- The schema is valid. The answer is not in its own wrong pool. The pool has at least three distinct options.
- Every kanji is inside ruby markup, so its reading is always shown. Every kanji is an N5 or N4 kanji. The paper is not limited to N5 kanji: its sample writes 私, 家, 朝, 帰, 作, 好 and 教 in kanji, all of them N4, because it spells N5 words the usual way and gives every kanji furigana. Words with harder kanji are written in kana.
- Each ★ window fits in its sentence, and its four chunks are distinct.
- Every grammar point exists in `grammar-points.yaml`. Every id is unique.
- Every reviewed item, in every variant, passes through the real renderer and stays inside Discord's limits.
- The committed corpus matches the source files and holds no drafts.

Code cannot check that a wrong option is really wrong. That is the main trap: a distractor that is also grammatical. The official sample asks 家（　）出ます and leaves out から, because から would also be right. So a person reviews every item for these points:

- Each wrong option is wrong in its sentence.
- Each ★ window has one valid order.
- The Japanese is natural.
- The item is at N5 level.
- The difficulty rating fits.

## 5. Drawing a test

Think of each question type as a deck of cards.

- **A test draws a fixed number of cards from each deck**, following a blueprint: for `/bunpou`, 9 from 問題1, 4 from 問題2 and one passage (4 questions) from 問題3.
- **A card appears at most once in a test.**
- **After the test, every card goes back into its deck.** Nothing is remembered between tests. Repeated exposure is the point; the random choices above keep repeats from being identical.
- **Each deck is drawn by difficulty.** The blueprint fixes the difficulty mix, for example 3 easy, 4 medium and 2 hard for 問題1. Every test is then about equally hard, and a student's scores can be compared from test to test. If a level runs short, the draw borrows from the nearest level and does not fail.
- **The draw prefers different grammar points within a deck**, because the real paper does not test one point twice.
- **The whole test is drawn when it starts** and stored in the session. Questions are numbered 1–17 straight through 問題1, 2 and 3, as on the paper.

## 6. Scoring

- A correct answer scores the weight of its difficulty: **2, 3 or 4 points** for difficulty 1, 2 or 3. A wrong answer, or no answer, scores 0.
- Results show the weighted score, the percentage, and the number correct in each 問題.
- **Calibration, later.** The bot counts how often each item is shown and answered correctly, with no user ids. `vp run exam:stats` lists items whose real success rate disagrees with their rating. The reviewer then updates the ratings in the YAML. Ratings never change by themselves.

## 7. What Discord constrains

- **No furigana.** Discord cannot place text above text. A sentence is shown as the paper prints it, without readings, and its readings follow in one small line below: 日曜日 にちようび · 学校 がっこう. The first live test tried inline readings, 日曜日(にちようび)に, and they made sentences hard to read. Buttons, notes and private results keep inline readings in half-width brackets, because they have no room for a second line. Items store ruby markup, so this is a renderer choice and never touches the corpus.
- **A heading is already bold.** The answer in a revealed sentence is underlined, not bold; a bold answer vanished into the heading in the first live test.
- **Underscores mean italics.** The ★ line uses full-width underscores: ＿＿ ＿＿ ★ ＿＿.
- **Components V2 is all or nothing.** A V2 message cannot have `content` or embeds, so the whole card is built from components. The accent colour shows the state: blue while open, green when revealed.
- **Limits per message:** 40 components (nested ones count), 4,000 characters of text, 5 buttons per row, 80 characters per button label, 100 per `customId`. A 問題1 card uses about 12 components. An N5 passage is about 250 characters.
- **No tables in markdown.** This matters for 問題6 (information retrieval), whose material is often a timetable or a flyer. It needs a design spike before reading ships.

## 8. Where things live

The tests reuse the two-Worker setup. The bot Worker already forwards every interaction, so it does not change.

```
/bunpou start ─► commands.ts ─► exam/flow.ts ── draws the whole test once (exam/draw.ts)
                                    │
                                    ▼
                        ExamSession (one per channel) ── poll machine (exam/machine.ts)
                        holds the drawn test and votes   alarm ─► SELF ─► EXAM_TIMEOUT
                                    │
button exam:v:<token>:<n> ─► commands.ts ─► flow ─► private "You chose 2."
```

- **`ExamSession` is a new Durable Object class.** It is not a mode of `QuizSession`. The race and the poll have opposite rules (the first answer wins, against everyone scores), and one machine that did both would hide that difference in conditions. `QuizKind` in `quiz/kind.ts` stays the interface for typed-answer quizzes.
- **The corpus never enters the Durable Object.** The flow draws the test in the handlers Worker and hands the session the resolved questions, a few kilobytes. The conjugation quiz follows the same rule.
- **Bot text is in English** (acknowledgements, results), as in the rest of inbou. Test content and instructions are in Japanese, as on the paper.

## 9. Build order

Each phase ends with something we can show.

1. **`/bunpou` end to end, with 問題1 only.** Item schema and build, draw, machine, session, Components V2 cards, vote routing, about 20 reviewed seed items.
2. **問題2 and 問題3.** The ★ and passage draws and cards. `/bunpou` runs the full 9 + 4 + 4.
3. **Content.** Complete the grammar point list, then draft batches of about 20 items per category for review. `exam:build` reports how many items each deck holds at each difficulty. A deck is playable when each difficulty level holds at least twice what one test draws. Targets: 150 or more for 問題1 (weighted to particles), 60 ★ sentences, 15 passages.
4. **Results, history and calibration.** A player's results are stored only if they have not opted out of tracking, and `/privacy forget` erases them. Item statistics hold no user ids. `/moshi history`, `exam:stats`, and an update to `docs/PRIVACY.md`.
5. **`/dokkai` and `/moshi section:2`.** The reading item types, after the 問題6 design spike.

Later: `/goi`, whose 漢字読み and 表記 items can be generated from the JMdict corpus we already build; then N4; then `/choukai`, which needs audio.

## 10. Still open

- **Word spacing for N5.** If sentences still read poorly with the readings line, add learner word spacing (particles separated) as an authoring step that rewrites the YAML, never at runtime. vscode-jisho's `spacing.ts` skips kana-only text, which is most of N5, so it would need a kana-aware pass or hand review.
- **Timer constants.** Base time per type and time per character. Tune them in live play.
- **The difficulty mix per deck.** 3 / 4 / 2 for 問題1 is a first guess.
- **How to show 問題6 material** without tables: V2 sections, a code block, or an image.

## 11. Sources and licensing

- **Format:** the official N5 sample paper and test guide from [jlpt.jp](https://www.jlpt.jp/e/guideline/testsections.html), and the [item counts after the 2020 change](https://jlpt.jp/e/topics/202009091599642827.html). We copy the format and the standard instruction lines, never the items.
- **Grammar points:** the list starts from Jonathan Waller's N5 grammar list ([tanos.co.uk](https://tanos.co.uk/jlpt/skills/grammar/), reported to be CC BY; to confirm) and is checked against Wikibooks, JLPT Sensei, Bunpro, Genki and Minna no Nihongo. A list of grammar point names is a set of facts. We write our own explanations.
- **Items:** written for this project. Textbooks, workbooks and Tofugu are copyrighted, and we never copy their sentences.
- **Kanji list:** the old JLPT levels 4 and 3 in [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (EDRDG, CC BY-SA 4.0).
