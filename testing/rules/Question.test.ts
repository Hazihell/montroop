import { expect, test } from "bun:test";
import { Question } from "../../Question.ts";

test("a question's choices are read from Claude Code's input, a question with no text left out", () => {
  const input = { questions: [
    { question: "Which colors?", header: "Colors", multiSelect: true, options: [{ label: "red", description: "warm" }, { label: "blue" }] },
    { header: "Broken", options: [] },
  ] };
  expect(Question.of(input)).toEqual([{ question: "Which colors?", header: "Colors", multi: true, options: [{ label: "red", description: "warm" }, { label: "blue", description: "" }] }]);
});

test("answers are each a text, trimmed; any other answer makes them no answers", () => {
  expect(Question.answers({ "Which bird?": " heron \n" })).toEqual({ "Which bird?": "heron" });
  expect(Question.answers({ "Which bird?": 1 })).toBeNull();
  expect(Question.answers(["heron"])).toBeNull();
});
