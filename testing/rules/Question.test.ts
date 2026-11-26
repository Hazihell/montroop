import { expect, test } from "bun:test";
import { Question } from "../../Question.ts";

test("a question's choices are read from Claude Code's input, a question with no text left out", () => {
  const input = { questions: [
    { question: "Which colors?", header: "Colors", multiSelect: true, options: [{ label: "red", description: "warm" }, { label: "blue" }] },
    { header: "Broken", options: [] },
  ] };
  expect(Question.of(input)).toEqual([{ question: "Which colors?", header: "Colors", multi: true, options: [{ label: "red", description: "warm" }, { label: "blue", description: "" }] }]);
});

test("answers are each a text, trimmed and cut to 2000 characters, the question's text kept whole; any other answer makes them no answers", () => {
  expect(Question.answers({ "Which bird?": " heron \n" })).toEqual({ "Which bird?": "heron" });
  const long = "Which " + "very ".repeat(500) + "long one?";
  expect(Question.answers({ [long]: "x".repeat(2500) })).toEqual({ [long]: "x".repeat(2000) });
  expect(Question.answers({ "Which bird?": 1 })).toBeNull();
  expect(Question.answers(["heron"])).toBeNull();
});

test("a question's answer is its picks, then what the owner typed, joined by commas", () => {
  expect(Question.answer(["red", "green"], " teal ")).toBe("red, green, teal");
  expect(Question.answer(["heron"], "  ")).toBe("heron");
  expect(Question.answer([], "a kite")).toBe("a kite");
});

test("a tap on a choice answers only a lone question that takes one", () => {
  const q = (multi: boolean) => ({ question: "Which?", header: "", options: [], multi });
  expect(Question.tap([q(false)])).toBe(true);
  expect(Question.tap([q(true)])).toBe(false);
  expect(Question.tap([q(false), q(false)])).toBe(false);
});
