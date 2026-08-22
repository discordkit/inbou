import { describe, expect, it } from "vitest";
import { ComponentType } from "@discordkit/client";
import type { Question } from "../quiz/question.js";
import {
  BUTTON,
  classLabel,
  hintEmbed,
  questionButtons,
  questionEmbed,
  revealEmbed,
  scoresEmbed,
  withReading
} from "../quiz/render.js";

const uru: Question = {
  wordId: `1`,
  prompt: `うりません`,
  form: `non-past-negative`,
  answer: `うらない`,
  stem: `うら`,
  answerKanji: `売らない`,
  dictionary: `売る`,
  reading: `うる`,
  gloss: `to sell; to betray`,
  type: `verb`,
  verbClass: `godan-r`,
  example: { jpn: `本を売る。`, eng: `I sell books.` }
};

describe(`withReading: writing a word for a learner`, () => {
  it(`pairs kanji with its reading`, () => {
    // WHY: Discord cannot render ruby, which is how the reference site shows
    // furigana. A learner who cannot read 売る needs うる on screen or the
    // question is unanswerable for them.
    expect(withReading(`売る`, `うる`)).toBe(`売る（うる）`);
  });

  it(`does not repeat a word that is already kana`, () => {
    // WHY: ある（ある）reads as a mistake, not a reading.
    expect(withReading(`ある`, `ある`)).toBe(`ある`);
  });
});

describe(`questionEmbed`, () => {
  it(`shows the prompt, the target form and the class`, () => {
    // WHY: these three are the whole question. Without the target form the
    // player does not know what to convert to; without the class they cannot
    // tell 行く from 書く.
    const embed = questionEmbed(uru, 3, 10);
    expect(embed.title).toBe(`Question 3 of 10`);
    expect(embed.description).toContain(`うりません`);
    // "From" as well as "Target": 見せません and 見せない look alike, so a
    // player cannot otherwise tell whether the prompt is already in the form
    // being asked for.
    expect(embed.fields?.[0]).toEqual({
      name: `From`,
      value: `Non-past negative (polite)`,
      inline: true
    });
    expect(embed.fields?.[1]?.value).toBe(`Non-past negative (plain)`);
    expect(embed.fields?.[2]?.value).toBe(`Godan (-る)`);
  });

  it(`omits the total for an endless session`, () => {
    // WHY: "Question 3 of null" would be a visible bug, and an endless session
    // has no total to show.
    expect(questionEmbed(uru, 3, null).title).toBe(`Question 3`);
  });
});

describe(`revealEmbed: the teaching moment`, () => {
  it(`names the winner in the description, never the title`, () => {
    // WHY: Discord does not resolve mention markup in an embed title — it
    // renders the raw `<@123…>`, which is what the channel saw. Descriptions
    // and field values do resolve it, which is why the Attempts list was
    // showing names correctly all along.
    const embed = revealEmbed(uru, { winner: `mika` }, []);
    expect(embed.title).not.toContain(`<@`);
    expect(embed.description).toContain(`<@mika>`);
    expect(embed.fields?.[0]?.value).toBe(`売らない（うらない）`);
  });

  it(`says what the answer was worth`, () => {
    // WHY: points now vary with how many guesses it took, so a bare "got it"
    // leaves the score unexplained.
    // What the answer earned, and the running total separately. Reporting only
    // the total made a late answer read as though one question were worth
    // twenty points, which left the final leaderboard looking arbitrary.
    const embed = revealEmbed(
      uru,
      { winner: `mika`, points: 3, total: 11 },
      []
    );
    expect(embed.description).toContain(`+3`);
    expect(embed.description).toContain(`11 total`);
  });

  it(`says nobody got it when the question timed out`, () => {
    // WHY: a timeout still teaches. Posting a winner-shaped embed with an empty
    // name would read as a bug.
    const embed = revealEmbed(uru, { winner: null }, []);
    expect(embed.title).toBe(`Nobody got it in time`);
  });

  it(`lists every attempt with its verdict`, () => {
    // WHY: this is where wrong answers finally get explained. Players who
    // guessed see what they typed next to what was right, which is the whole
    // reason the embed waits until the question closes.
    const embed = revealEmbed(uru, { winner: `mika` }, [
      { userId: `drake`, answer: `うらなかった`, correct: false },
      { userId: `mika`, answer: `うらない`, correct: true }
    ]);
    const attempts = embed.fields?.find((f) => f.name === `Attempts`)?.value;
    expect(attempts).toContain(`❌ <@drake> うらなかった`);
    expect(attempts).toContain(`⭕ <@mika> うらない`);
  });

  it(`omits the attempts field when nobody guessed`, () => {
    // WHY: an empty "Attempts" heading is noise on a question that timed out
    // with no takers.
    const embed = revealEmbed(uru, { winner: null }, []);
    expect(embed.fields?.some((f) => f.name === `Attempts`)).toBe(false);
  });

  it(`includes the example sentence when the word has one`, () => {
    const embed = revealEmbed(uru, { winner: `mika` }, []);
    expect(embed.fields?.find((f) => f.name === `Example`)?.value).toContain(
      `本を売る。`
    );
  });

  it(`omits the example when the word has none`, () => {
    // WHY: 5,543 of 7,409 corpus words have an example, so the field has to be
    // conditional or a quarter of reveals show an empty heading.
    const { example, ...without } = uru;
    void example;
    const embed = revealEmbed(without, { winner: `mika` }, []);
    expect(embed.fields?.some((f) => f.name === `Example`)).toBe(false);
  });
});

describe(`scoresEmbed`, () => {
  it(`medals the top three and mentions each player`, () => {
    const embed = scoresEmbed(
      [
        { userId: `mika`, points: 5 },
        { userId: `drake`, points: 3 },
        { userId: `sam`, points: 1 }
      ],
      10
    );
    expect(embed.description).toContain(`🥇 <@mika> — 5`);
    expect(embed.description).toContain(`🥈 <@drake> — 3`);
    expect(embed.description).toContain(`🥉 <@sam> — 1`);
    expect(embed.footer?.text).toBe(`10 questions asked`);
  });

  it(`says so when nobody scored`, () => {
    // WHY: an empty description renders as a blank embed, which looks broken
    // rather than like a quiet session.
    expect(scoresEmbed([], 5).description).toBe(`No answers this session.`);
  });

  it(`writes one question in the singular`, () => {
    expect(scoresEmbed([], 1).footer?.text).toBe(`1 question asked`);
  });
});

describe(`hintEmbed`, () => {
  it(`gives the reading and meaning but never the answer`, () => {
    // WHY: a hint is private, so it cannot be allowed to hand over the
    // conjugation — that would let one player win every race by typing /hint.
    const embed = hintEmbed(uru);
    const rendered = JSON.stringify(embed);
    expect(rendered).toContain(`うる`);
    expect(rendered).toContain(`to sell`);
    expect(rendered).not.toContain(`うらない`);
    expect(rendered).not.toContain(`売らない`);
  });
});

describe(`classLabel`, () => {
  it(`names 行く's class distinctly`, () => {
    // WHY: 行く geminates where other く-verbs do not, so a player told
    // "Godan (-く)" would apply the wrong rule and be marked wrong for it.
    expect(classLabel({ ...uru, verbClass: `godan-iku` })).toBe(
      `Godan (行く exception)`
    );
    expect(classLabel({ ...uru, verbClass: `godan-k` })).toBe(`Godan (-く)`);
  });

  it(`names adjective types, which have no verb class`, () => {
    expect(classLabel({ ...uru, type: `adj-i`, verbClass: undefined })).toBe(
      `い-adjective`
    );
    expect(classLabel({ ...uru, type: `adj-na`, verbClass: undefined })).toBe(
      `な-adjective`
    );
  });
});

describe(`questionButtons`, () => {
  it(`offers a hint and an end control`, () => {
    // WHY: a button is where someone stuck actually looks, and it costs no
    // typing in a channel where typing is how you answer.
    //
    // `components` is a union — an action row holds buttons, OR a text input,
    // OR a select — so this narrows rather than assuming an array.
    const [row] = questionButtons();
    const buttons = Array.isArray(row?.components) ? row.components : [];
    expect(buttons.map((b) => b.customId)).toEqual([BUTTON.hint, BUTTON.end]);
  });

  it(`uses the component types the client validates against`, () => {
    // WHY: the ids are the routing key — Discord echoes them back, and a
    // mismatch produces a button that silently does nothing while the player
    // sees "this interaction failed". Building from the client's enums rather
    // than raw numbers is what keeps the shape and the router in step.
    const [row] = questionButtons();
    expect(row?.type).toBe(ComponentType.ActionRow);
    const buttons = Array.isArray(row?.components) ? row.components : [];
    expect(buttons.every((b) => b.type === ComponentType.Button)).toBe(true);
  });
});
