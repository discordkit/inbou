import { describe, expect, it } from "vitest";
import { conjugate } from "../quiz/conjugate.js";

const row = (
  surface: string,
  pos: string[],
  form: string
): [string, string] => {
  const rows = conjugate(surface, pos);
  const match = rows?.find((r) => r.form === form);
  if (!match) throw new Error(`no ${form} row for ${surface}`);
  return [match.affirmative, match.negative];
};

describe("conjugate: verb classes", () => {
  it("conjugates an ichidan verb, with the ら抜き potential variant", () => {
    // WHY: Shirabe shows the colloquial 食べれる alongside the standard form (BACKLOG #19) —
    // learners meet the ら抜き form constantly and need to see it's the same word.
    expect(row("食べる", ["v1"], "Non-past")).toEqual(["食べる", "食べない"]);
    expect(row("食べる", ["v1"], "Potential")).toEqual([
      "食べられる",
      "食べられない"
    ]);
    expect(
      conjugate("食べる", ["v1"])?.find((r) => r.form === "Potential")
        ?.colloquial
    ).toBe("食べれる");
    expect(row("食べる", ["v1"], "Volitional")).toEqual(["食べよう", ""]);
  });

  it("uses the right te/ta gemination for each godan class", () => {
    // WHY: the te-form is where godan classes actually differ (って/いて/いで/して/んで); getting
    // one wrong teaches a learner a non-word. One probe per gemination group.
    expect(row("買う", ["v5u"], "Te-form")[0]).toBe("買って");
    expect(row("書く", ["v5k"], "Te-form")[0]).toBe("書いて");
    expect(row("泳ぐ", ["v5g"], "Te-form")[0]).toBe("泳いで");
    expect(row("話す", ["v5s"], "Te-form")[0]).toBe("話して");
    expect(row("死ぬ", ["v5n"], "Te-form")[0]).toBe("死んで");
    expect(row("読む", ["v5m"], "Te-form")[0]).toBe("読んで");
    expect(row("作る", ["v5r"], "Past")[0]).toBe("作った");
  });

  it("handles the lexical irregulars", () => {
    // WHY: these four POS codes exist precisely because the regular tables produce wrong forms —
    // 行いて, あらない, 下さります, 問って are all non-words a naive v5 rule would emit.
    expect(row("行く", ["v5k-s"], "Te-form")[0]).toBe("行って");
    expect(row("ある", ["v5r-i"], "Non-past")).toEqual(["ある", "ない"]);
    expect(row("ある", ["v5r-i"], "Past")[1]).toBe("なかった");
    expect(row("下さる", ["v5aru"], "Non-past (polite)")[0]).toBe("下さいます");
    expect(row("下さる", ["v5aru"], "Imperative")[0]).toBe("下さい");
    expect(row("問う", ["v5u-s"], "Te-form")[0]).toBe("問うて");
  });

  it("conjugates 来る in kanji and kana spellings alike", () => {
    // WHY: the stem vowel change (こ/き/く) is invisible in kanji but spelled out in kana — the
    // same verb needs different string surgery depending on how the headword is written.
    expect(row("来る", ["vk"], "Non-past")).toEqual(["来る", "来ない"]);
    expect(row("来る", ["vk"], "Imperative")[0]).toBe("来い");
    expect(row("くる", ["vk"], "Non-past")[1]).toBe("こない");
    expect(row("くる", ["vk"], "Non-past (polite)")[0]).toBe("きます");
    expect(row("くる", ["vk"], "Conditional (〜ば)")[0]).toBe("くれば");
  });

  it("conjugates する compounds and suru-nouns", () => {
    // WHY: 勉強 is tagged n+vs — a noun whose verb 勉強する learners conjugate daily. The table
    // must surface the derived verb, and the potential must be できる, not しられる.
    expect(row("勉強", ["n", "vs", "vt"], "Non-past")).toEqual([
      "勉強する",
      "勉強しない"
    ]);
    expect(row("勉強", ["n", "vs"], "Potential")[0]).toBe("勉強できる");
    expect(row("する", ["vs-i"], "Passive")[0]).toBe("される");
  });
});

describe("conjugate: adjectives", () => {
  it("conjugates い-adjectives on the stem", () => {
    expect(row("高い", ["adj-i"], "Past")).toEqual([
      "高かった",
      "高くなかった"
    ]);
    expect(row("高い", ["adj-i"], "Adverbial")).toEqual(["高く", ""]);
  });

  it("swaps いい to the よい stem (adj-ix)", () => {
    // WHY: いい only exists in the non-past — every other form is built on よ (よかった, よくない).
    // A regular adj-i rule would emit いかった, which is not Japanese.
    expect(row("いい", ["adj-ix"], "Past")[0]).toBe("よかった");
    expect(row("かっこいい", ["adj-ix"], "Non-past")[1]).toBe("かっこよくない");
  });

  it("conjugates な-adjectives through だ", () => {
    expect(row("静か", ["adj-na"], "Non-past")).toEqual([
      "静かだ",
      "静かじゃない"
    ]);
    expect(row("静か", ["adj-na"], "Te-form")[0]).toBe("静かで");
  });
});

describe("conjugate: gating", () => {
  it("returns null for non-conjugable POS", () => {
    // WHY: this null is what hides the section on nouns/particles — a conjugation table on 犬
    // would be nonsense.
    expect(conjugate("犬", ["n"])).toBeNull();
    expect(conjugate("を", ["prt"])).toBeNull();
  });

  it("returns null when the surface doesn't match the class ending", () => {
    // WHY: dictionary data oddities (a v1 tag on a non-る surface) must not produce garbage —
    // silently absent beats silently wrong.
    expect(conjugate("食べ", ["v1"])).toBeNull();
    expect(conjugate("書く", ["v5m"])).toBeNull();
  });

  it("uses the first POS code that conjugates", () => {
    expect(conjugate("勉強", ["n", "vs"])?.[0].affirmative).toBe("勉強する");
  });
});
