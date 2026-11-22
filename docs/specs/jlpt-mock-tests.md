# JLPT mock tests

Practice tests in the shape of the real JLPT, played in a Discord channel. The bot asks one question at a time with numbered buttons, everyone answers privately, and everyone who is right scores. Students repeat the tests until they can hold a steady score before the real exam.

Status: **draft 3**, 2026-11-22. Decisions here are settled unless marked open; section 10 lists what is not. Phases 1 to 3 of section 9 are built, and so is the reading half of phase 5: `/bunpou` ships with 230 reviewed items, and `/dokkai` with 94 reading items (258 questions). Results history and full-section tests (`/moshi`) come next.

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
  │ で marks the means: by train, by bus, with a pen.
  └ Review on Tofugu: で
```

### Rules

- **Everyone who is right scores.** Not only the first.
- **A player holds one vote per question, and it is the latest one.** Changing a vote is always allowed and costs nothing.
- **The timer always runs to the end.** The number of players is not known, so the bot cannot tell when "everyone" has voted.
- **The vote counter shows a count, never a distribution.** "3 picked 2" would leak the answer and make players follow the crowd. The counter is debounced (edited at 1, 2, 4, 8 … votes), because Discord limits message edits per channel.
- **A press on an old question does nothing** except a private "that question has closed". Each question carries a short random token in its buttons, and the session rejects any other token.
- **The answer is never in a button's `customId`.** A client can read those. The correct position lives only in the session.
- **Timers depend on how much there is to read.** Each type has a base time, plus time per character of text the player must read. A passage or reading text counts in full for its first question and not again.
- **Together, the two tests take the real paper's 40 minutes.** `/bunpou` and `/dokkai` are the 22 questions of the real grammar-and-reading section, and students practise to finish inside its limit. Grammar runs at about a minute a question, as guides advise. Reading gets the rest, about 22 minutes, through a pace factor per 問題 (`PACE` in `draw.ts`): about 3.4 minutes for a 問題4 question, 5.4 for a 問題5 question and 4.5 for 問題6. A corpus test keeps the pair between 38 and 42 minutes, so a batch of longer texts that shifts it fails.
- **Players can join at any question.** Nothing depends on being there at the start.

### Results

At the end, the bot posts a results card with each player's score and percentage. A **My results** button gives each player a private breakdown per 問題 and the items they missed, with the answers.

### Review links

A student who misses a question should know where to read about it. Each grammar point in `grammar-points.yaml` can name a Tofugu grammar article, and a section of it, in its `tofugu` field. The reveal shows the links for the question's points under the teaching note. My results shows them again beside each missed question, and only there: a link beside a right answer would bury the ones that matter.

- **Only where a page really covers the point.** The nearest page is fine; a page that does not teach the point is not. About one point in six has no link (〜ては いけません, 〜ほうがいい, とても, and others). `exam:build` lists the points in use without one.
- **Each page once per question.** Two points can share a section, such as と for "with" and いっしょに.
- **No preview cards.** Links are written `[で](<url>)`; the `<>` stops Discord from adding a card for each one.
- **My results stays under Discord's 2,000 characters.** A student who missed most of a test could otherwise get no reply at all. When the links do not fit, they are left out from the last miss back, and the reply says the answer cards have them. The answers always stay.
- **Links are checked against the live site.** The build checks only their shape. `vp run exam:links` fetches each page once and checks that every section exists. Run it after adding or changing a link.

The card also shows a guide line: the real N5 needs 38 of 120 (32%) in its first scoring section. The JLPT scales its scores, so we show this as a guide, not as an equivalent.

### Private explanations (reading)

Reading is comprehension, not a grammar point, so a student who missed a question needs to be led back into the text. Each reading option can carry a **why**: what in the text rules it out.

- **The why goes only to the student who chose that option**, privately, just after the public reveal. A vote is a button press, and a press's token lets the bot reply privately for fifteen minutes. The session keeps each voter's latest token for the open card, and the reveal uses it. Tokens are credentials, so they are kept only on cards that explain something, and dropped when the next card opens.
- **The channel sees the answer, the vote bars, a short note and the English.** The note says what the question asked and where the text answers it, so a student who did not vote still learns something. The whys stay out of the channel, which keeps it short.
- **My results lists each missed question's why.** A private message vanishes when Discord reloads, and My results is where a student can read it again.
- **One reveal sends at most 40 private messages.** Each is a call to Discord, and the free plan allows 50 per invocation. A student past the cap still has My results. `FOLLOW_UPS_CAPPED` is reported when it happens.
- **Grammar keeps its public notes for now**, until the private follow-ups have been seen in play.

## 3. Commands

The commands follow the skill split of the Shin Kanzen Master series, which we use as the model for higher levels. N5 has no Shin Kanzen Master book, so N5 follows the official samples.

```
/bunpou start            — grammar: 問題1–3, 17 questions
/bunpou end              — end the test in this channel and show the results
/dokkai start            — reading: 問題4–6, 5 questions
/dokkai end              — end the test in this channel and show the results
/moshi start section:2   — the whole of Section 2, grammar then reading (planned)
/moshi history           — your recent results and average, private (planned)
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

A ★ item is a sentence with `/` between its chunks, plus one or more **windows**: runs of four consecutive chunks that have exactly one valid order. Spaces written around a `/` show as a space, and none means no space, so the sentence keeps the paper's spacing.

```yaml
- id: n5-b2-0001
  type: compose
  status: draft
  sentence: "この / かばん/は / わたし/の / です。"
  en: This bag is mine.
  windows:
    - start: 1 # chunks 1–4, counted from 0: かばん は わたし の
      difficulty: 1
      points: [particle-no-pronoun]
      note: "わたしの stands for the thing that is mine."
```

At ask time, the bot chooses a window, puts the ★ on one of its four positions at random, and shuffles the four chunks into the options. The card shows `この ＿＿ ＿＿ ＿★＿ ＿＿ です。`, and the reveal shows the whole sentence with the window underlined. One item with one window gives four different questions, so a student cannot memorise "the answer is わたし". Like a slot, each window has its own difficulty, points and note.

Code checks the window's shape: it fits the sentence, its four chunks are different strings (two の would make the ★ answer ambiguous), and it does not end the sentence (the last chunk carries the 。, which would give its own place away). Whether the order is unique is the reviewer's call, and it is this type's trap. 新聞を コーヒーを 飲みながら 読みます is as good as コーヒーを 飲みながら 新聞を 読みます. Splitting particles into their own chunks, as the paper does, is what pins an order down.

**Each chunk in a window is one word.** A particle always stands alone: `{学校|がっこう}/の`, never `{学校|がっこう}の`. A verb or adjective in one form is one chunk, as the paper prints it: 読んで, 食べた, 行きたい, とらないで, 作りかた. Words written apart stay apart: いる, ください, こと, とき. The first review found six windows that joined a noun or a stem to a particle; code cannot catch this without a dictionary, so the reviewer checks it. Chunks outside the window are only shown, so they can be any size.

### Passages (問題3)

A passage has an optional intro (who wrote it, and why), a text with four or more `（n）` blanks numbered in reading order, and the whole passage in English. Each blank is a slot, as in 問題1: its own answer, wrong pool, difficulty, points and note.

**A passage has about eight blanks, and a test asks any four of them**, chosen at random. So a passage that comes up again usually asks a different set: eight blanks give 70 sets of four. A test draws one passage, so a passage appears at most once in it. Because any blank may be shown filled, each blank must stand alone:

- No filled-in answer gives another blank away.
- No two blanks in a passage test the same grammar point.
- No two blanks sit side by side.

A test asks four blanks, numbered straight on from 問題2 (14 to 17 on a full test), and answers them **on one card**. Each asked blank shows its number, ［15］, and has its own row of buttons under a ［15］ label. Blanks it does not ask are shown filled. The second live test asked the blanks one card at a time, and one short story split across four cards read badly. One card with four labelled rows uses about 32 of Discord's 40 components.

The card's timer is the sum of its questions' times, with the passage counted once. Each press gets a private reply naming its row, "［15］ You chose 2". The answer counter counts players, not presses, so one player answering four rows is one.

The passage shows as a block quote at reading size, with its readings in a small line below. The card is revealed as one: the completed passage with every answer underlined, then each blank's answer, result and note, then the English for the whole passage. Scoring, results and My results still count each blank as its own question.

### Reading items (問題4–6)

Reading items live in `data/jlpt/n5/dokkai/`: `short.yaml` (問題4), `mid.yaml` (問題5) and `info.yaml` (問題6). Each is a text or a picture with **several questions**, and a test asks one of them (two for 問題5, in text order). So a text that comes up again usually asks something new.

```yaml
- id: n5-d4-0007
  type: short
  status: reviewed
  intro: "（{会社|かいしゃ}で）\nキムさんの つくえの {上|うえ}に この メモが あります。"
  text: "…あしたの かいぎは 3{時|じ}からでは なくて、4{時|じ}からです。…"
  en: "…"
  questions:
    - question: "あしたの かいぎは {何時|なんじ}からですか。"
      options:
        - option: "3{時|じ}"
          why: "Three was the old time. 3{時|じ}からでは なくて means “not from three”."
        - "4{時|じ}"
        - …
      answer: 2
      difficulty: 2
      note: "This asks when the meeting starts now. The time changed: …"
```

- **Options are drawn or ordered.** `answer` plus three or more `wrong` are drawn and shuffled, as in 問題1. Four `options` with an `answer` index keep their order, for times, prices and days, which the paper prints in order. Ordered answers should land on each position about equally; the build hints when they cluster.
- **Options sit in the card**, numbered 1–4 under the question as the paper prints them, and the buttons show only the number. Reading options are sentences, too long for a button and too important to trim.
- **A medium or hard question explains every wrong option** (`- option: … why: …`), and the build fails without them. An easy question's note is usually enough. The note says what the question asks and where the text answers it.
- **`points` are optional.** A question names a grammar point only where one decides it, such as から〜まで or もう／まだ, and the reveal links its review page.
- **`__phrase__`** underlines a phrase in the text, for the paper's "what does this refer to" questions.
- **A 問題6 item's `material` is structured data**, not text: one of about 25 kinds of document (a bus-stop timetable, a receipt, a ticket machine, a medicine bag, a delivery slip, a group chat, notices and signs). Templates in `src/handlers/exam/material/` draw each kind to look like the real thing, so students learn where each kind of document keeps its information. The picture holds only the information, never the options. The build checks each kind's structure: a receipt's sums, a timetable's columns, a calendar's legend.

### What code checks, and what a person checks

Code checks every item, drafts included, in `vp test`:

- The schema is valid. The answer is not in its own wrong pool. The pool has at least three distinct options.
- Every kanji is inside ruby markup, so its reading is always shown. Every kanji is an N5 or N4 kanji. The paper is not limited to N5 kanji: its sample writes 私, 家, 朝, 帰, 作, 好 and 教 in kanji, all of them N4, because it spells N5 words the usual way and gives every kanji furigana. Words with harder kanji are written in kana.
- Each ★ window fits in its sentence, and its four chunks are distinct.
- Every grammar point exists in `grammar-points.yaml`. Every id is unique.
- Every reviewed item, in every variant, passes through the real renderer and stays inside Discord's limits.
- The committed corpus matches the source files and holds no drafts.
- Reading: every medium and hard wrong option has a why, and no ordered answer has one. Every word of a picture is in its alt text. Every picture fits its canvas, measured with the real fonts. Every reading card closes inside its voters' fifteen-minute reply tokens, and every private follow-up fits in one message.

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
- **Reading shares one mix across its decks.** Every `/dokkai` test asks 2 easy, 2 medium and 1 hard question (`READING_MIX`), shuffled across its five questions each time. Tests stay equally hard, and every approved question can come up: a fixed level per deck would never ask 問題6's easy or hard questions, because 問題6 asks only one. 問題5 asks the two questions of its text nearest the levels it was dealt, in text order.
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
- **No tables in markdown.** So 問題6's material, often a timetable or a flyer, is a **picture**, drawn at build time and shown in a media gallery. The picture has no furigana: its readings follow in a small line below it, like any other text, and its text is the gallery's alt text. A tall picture may need opening at full size, so 問題6's timer allows a minute for that.

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
- **問題6 pictures are drawn at build time and hosted by a third Worker, `inbou-assets`**, which serves only static files. `exam:build` names each picture by a hash of what it draws (its template's HTML, its width, and the pinned renderer and font versions) and records the names in `corpus.json`. `exam:draw` renders them with [takumi](https://github.com/kane50613/takumi) into `dist/assets`, after checking that each fits. The handlers link a picture as `ASSET_BASE` plus its name, so a changed picture gets a new URL and Discord's cache never shows an old one. Publishing a picture never redeploys the bot, whose every deploy restarts its Gateway connection. The deploy ships the pictures before the handlers that link them.

## 9. Build order

Each phase ends with something we can show.

Phases 1 to 3 are done, and so is `/dokkai` from phase 5.

1. **`/bunpou` end to end, with 問題1 only.** Item schema and build, draw, machine, session, Components V2 cards, vote routing, about 20 reviewed seed items.
2. **問題2 and 問題3.** The ★ and passage draws and cards. `/bunpou` runs the full 9 + 4 + 4.
3. **Content.** Complete the grammar point list, then draft batches of about 20 items per category for review. `exam:build` reports how many items each deck holds at each difficulty. A deck is playable when each difficulty level holds at least twice what one test draws. Targets: 150 or more for 問題1 (weighted to particles), 60 ★ sentences, 15 passages.
4. **Results, history and calibration.** A player's results are stored only if they have not opted out of tracking, and `/privacy forget` erases them. Item statistics hold no user ids. `/moshi history`, `exam:stats`, and an update to `docs/PRIVACY.md`.
5. **`/dokkai` and `/moshi section:2`.** `/dokkai` is built: the reading item types, 問題6 pictures drawn in code and hosted on `inbou-assets`, and private explanations. `/moshi section:2`, grammar then reading in one sitting, is next.

Later: `/goi`, whose 漢字読み and 表記 items can be generated from the JMdict corpus we already build; then N4; then `/choukai`, which needs audio.

## 10. Still open

- **Word spacing for N5.** If sentences still read poorly with the readings line, add learner word spacing (particles separated) as an authoring step that rewrites the YAML, never at runtime. vscode-jisho's `spacing.ts` skips kana-only text, which is most of N5, so it would need a kana-aware pass or hand review.
- **Timer constants.** The pair is set to the real paper's 40 minutes; how that time is spread across 問題 is a first guess, to tune in play.
- **The difficulty mix.** 3 / 4 / 2 for 問題1 and 2 / 2 / 1 for reading are first guesses. Students' real results (phase 4) should decide them: a test that feels beyond students is a reason to shift the mix, not to rewrite items.
- **More than 40 wrong voters on one reading card.** Past the cap, follow-ups would need a second invocation; for now those students read their whys in My results.
- **Writing the 問題6 templates as JSX.** takumi takes React elements, which would give typed styles in place of CSS strings. Worth doing when the templates next change much; proved by comparing every drawn picture before and after.

## 11. Sources and licensing

- **Format:** the official N5 sample paper and test guide from [jlpt.jp](https://www.jlpt.jp/e/guideline/testsections.html), and the [item counts after the 2020 change](https://jlpt.jp/e/topics/202009091599642827.html). We copy the format and the standard instruction lines, never the items.
- **Grammar points:** the list starts from Jonathan Waller's N5 grammar list ([tanos.co.uk](https://tanos.co.uk/jlpt/skills/grammar/), reported to be CC BY; to confirm) and is checked against Wikibooks, JLPT Sensei, Bunpro, Genki and Minna no Nihongo. A list of grammar point names is a set of facts. We write our own explanations.
- **Items:** written for this project. Textbooks, workbooks and Tofugu are copyrighted, and we never copy their sentences.
- **Kanji list:** the old JLPT levels 4 and 3 in [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (EDRDG, CC BY-SA 4.0).
- **Reading:** practice sites were played for format only (にほんごクイズ, Coto Academy, The Japanese Page, Open Exam Prep, JLPT Books); no item is copied from them. The 問題6 pictures use five fonts under the SIL Open Font License (Noto Sans JP, Noto Serif JP, Zen Maru Gothic, Klee One, DotGothic16, via fontsource), drawn by takumi (MIT or Apache 2.0) at build time only.
