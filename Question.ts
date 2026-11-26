// Question
// ========
// A question a run puts to the owner with its provider's own tool (Claude
// Code's AskUserQuestion): parked as a call a rule names is (Hold), shown
// as a card of its choices, and answered with the owner's picks, which go
// back to the model as the call's result. Free of the server's modules, so
// the app reads them too.

import { get, list, rec, str } from "./Json.ts";

// the tool that asks
export const QUESTION = "AskUserQuestion";

type Choice = { label: string; description: string };

// multi: more than one choice may be picked
export type Question = { question: string; header: string; options: Choice[]; multi: boolean };

// the owner's answer to each question, by its text (several picks joined
// by ", ", as Claude Code takes them)
export type Answers = Record<string, string>;

const TEXT = 2000;

export namespace Question {

  // the questions a call's input asks, in Claude Code's form
  export function of(input: unknown): Question[] {
    return list(get(input, "questions")).flatMap((q) => {
      const question = str(get(q, "question"));
      const options = list(get(q, "options")).flatMap((o) => {
        const label = str(get(o, "label"));
        return label === undefined ? [] : [{ label, description: str(get(o, "description")) ?? "" }];
      });
      return question === undefined ? [] : [{ question, header: str(get(q, "header")) ?? "", options, multi: get(q, "multiSelect") === true }];
    });
  }

  export function line(qs: Question[]): string {
    return qs.map((q) => q.question).join(" · ");
  }

  // answers as a request gives them, each cut to what a message carries
  // (a question's text stays whole: it names the question); null: they
  // aren't answers
  export function answers(x: unknown): Answers | null {
    if (!rec(x) || Object.values(x).some((a) => typeof a !== "string")) {
      return null;
    }
    return Object.fromEntries(Object.entries(x as Record<string, string>).map(([q, a]) => [q, a.trim().slice(0, TEXT)]));
  }

  // one question's answer: its picks, then what the owner typed
  export function answer(picked: string[], typed: string): string {
    return [...picked, ...(typed.trim() === "" ? [] : [typed.trim()])].join(", ");
  }

  // whether a tap on a choice answers them all: a lone question that
  // takes one
  export function tap(qs: Question[]): boolean {
    return qs.length === 1 && !qs[0].multi;
  }

  // answers as one line for the agent
  export function said(a: Answers): string {
    return Object.entries(a).map(([q, text]) => q + " " + text).join("; ");
  }

}
