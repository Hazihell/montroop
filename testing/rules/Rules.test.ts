import { expect, test } from "bun:test";
import { ASK, Rules } from "../../Rules.ts";

const SCRATCH = "/home/sam/.kunumy/scratch/a1";

function asks(tool: string, args: Record<string, unknown>): string | null {
  return Rules.match(ASK, tool, args, SCRATCH)?.what ?? null;
}

test("the default rules ask before a shell command that deletes outside the scratch folder", () => {
  expect(asks("shell", { command: "rm -rf /home/sam/project" })).toBe("Delete files or data outside the scratch folder");
  expect(asks("shell", { command: "cd ~/notes && rm old.txt" })).toBe("Delete files or data outside the scratch folder");
  expect(asks("shell", { command: "git push --force origin main" })).toBe("Delete files or data outside the scratch folder");
  expect(asks("shell", { command: "git reset --hard HEAD~3" })).toBe("Delete files or data outside the scratch folder");
});

test("deleting inside the scratch folder, also named from ~, asks no one", () => {
  expect(asks("shell", { command: "rm -rf " + SCRATCH + "/build" })).toBeNull();
  expect(asks("shell", { command: "rm -rf ~/.kunumy/scratch/a1/build" })).toBeNull();
});

test("a path that only starts like the scratch folder, or climbs out of it, isn't in it", () => {
  expect(asks("shell", { command: "rm -rf " + SCRATCH + "-other" })).toBe("Delete files or data outside the scratch folder");
  expect(asks("shell", { command: "rm -rf " + SCRATCH + "/../../projects" })).toBe("Delete files or data outside the scratch folder");
});

test("the default rules ask before sending, paying, logging in and publishing", () => {
  expect(asks("mcp__gmail__send_email", { to: "a@b.c" })).toBe("Send a message or email as you");
  expect(asks("shell", { command: "echo hi | mailx -s hello a@b.c" })).toBe("Send a message or email as you");
  expect(asks("mcp__shop__checkout", {})).toBe("Pay or buy something");
  expect(asks("shell", { command: "gh auth login && npm login" })).toBe("Log in to a site");
  expect(asks("shell", { command: "gh pr create --fill" })).toBe("Post or publish something");
  expect(asks("mcp__browser__click", { element: "Buy now" })).toBe("Pay or buy something");
});

test("reading, drafting and everyday commands ask no one", () => {
  expect(asks("mcp__gmail__create_draft", { to: "a@b.c" })).toBeNull();
  expect(asks("mcp__slack__search_messages", { query: "deploy" })).toBeNull();
  expect(asks("mcp__browser__snapshot", {})).toBeNull();
  expect(asks("shell", { command: "git push origin feature" })).toBeNull();
  expect(asks("shell", { command: "ls -la && bun test" })).toBeNull();
});

test("a rule's tools are globs, matched whole and in any case, and ! leaves some out", () => {
  const rules = [{ what: "Touch prod", tools: "*deploy*, !*__deploy_preview", args: "" }];
  expect(Rules.match(rules, "mcp__ci__DEPLOY", {}, null)?.what).toBe("Touch prod");
  expect(Rules.match(rules, "mcp__ci__deploy_preview", {}, null)).toBeNull();
  expect(Rules.match(rules, "redeployer", {}, null)?.what).toBe("Touch prod");
});

test("a rule's arguments match each string or number argument, nested too, on its own line", () => {
  const rules = [{ what: "Big order", tools: "order", args: "^9{3,}$" }];
  expect(Rules.match(rules, "order", { items: [{ qty: 9999 }] }, null)?.what).toBe("Big order");
  expect(Rules.match(rules, "order", { note: "x 9999" }, null)).toBeNull();
});

test("the rules a config gives are read, or say what's wrong with them", () => {
  expect(Rules.read(undefined)).toEqual(ASK);
  expect(Rules.read([{ what: " Deploy ", tools: "deploy", args: " " }])).toEqual([{ what: "Deploy", tools: "deploy", args: "" }]);
  expect(Rules.read({})).toBe("Give a list of up to 50 rules");
  expect(Rules.read([{ what: "x", tools: " , ! " }])).toBe("Rule 1 needs what it is, the tools it's for, and the arguments, if any, on one line each");
  expect(Rules.read([{ what: "x", tools: "y", args: "(" }])).toStartWith("Rule 1's arguments are no regular expression: ");
});
