import { judge, looksLikeAnswer } from "./answer.js";
import type { QuizKind } from "./kind.js";
import type { Question } from "./question.js";
import {
  hintEmbed,
  questionEmbed,
  revealEmbed,
  reviewEmbed
} from "./render.js";

/**
 * The conjugation quiz, as a {@link QuizKind}.
 *
 * Binds the scorer and the embeds that know what a conjugation question is,
 * which is everything the session layers deliberately do not.
 */

/** The scorer compares against kana, with the kanji surface as an alternative. */
const expectedOf = (question: Question) => ({
  kana: question.answer,
  ...(question.answerKanji === undefined
    ? {}
    : { kanji: question.answerKanji }),
  stem: question.stem
});

export const conjugationQuiz: QuizKind<Question> = {
  grader: {
    isAttempt: (input, question) =>
      looksLikeAnswer(input, expectedOf(question)),
    grade: (input, question) => judge(input, expectedOf(question))
  },
  present: {
    question: questionEmbed,
    reveal: revealEmbed,
    hint: hintEmbed,
    review: reviewEmbed
  }
};
