import { afterAll, beforeAll, expect, test } from "bun:test";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { fake, tag, Troop, repo, until } from "../rig.ts";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

async function phone(k: Troop, signed: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (signed) {
    await ctx.addCookies([{ name: "montroop", value: k.cookie.slice("montroop=".length), url: k.url }]);
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return page;
}

test.concurrent("the owner signs in with a code, opens an agent and gets its answer", async () => {
  const k = await Troop.up();
  await fake.next("j1: what's the plan?", { what: "reply", text: "The plan is ready." });
  const page = await phone(k, false);
  await page.goto(k.url + "/");
  const out = Bun.spawnSync(["bun", path.resolve(import.meta.dir, "../../Cli.ts"), "serve", "login"], { env: k.env() }).stdout.toString();
  await page.getByRole("textbox", { name: "code" }).fill(/\b(\d{6})\b/.exec(out)?.[1] ?? "");
  await page.keyboard.press("Enter");

  await page.getByRole("link", { name: /^Montroop(?!'s settings)/ }).click();
  await page.getByRole("textbox", { name: "Message Montroop" }).fill("j1: what's the plan?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("The plan is ready.").first().waitFor();
  expect(new URL(page.url()).pathname).toBe("/a/" + k.agent);
  await k.kill();
});

test.concurrent("the owner opens a work session from what runs, reads its report, and sends it on", async () => {
  const k = await Troop.up();
  await fake.next("j2: fix the typo", { what: "tool", calls: [["report", { result: "Fixed the typo in README.md." }]] });
  await fake.next("j2: and the other one", { what: "reply", text: "Fixed the other one too." });
  const s = await k.session("typo", "j2: fix the typo", repo());
  await s.status("done");
  await until("its holder ended", () => s.holder() === null);
  const page = await phone(k, true);
  await page.goto(k.url + "/a/" + k.agent);

  await page.getByRole("button", { name: "Montroop", exact: true }).click();
  await page.getByRole("menuitem", { name: "Running" }).click();
  await page.getByRole("link", { name: /^typo/ }).click();
  await page.getByRole("heading", { name: "typo" }).waitFor();
  await page.getByText("Fixed the typo in README.md.", { exact: true }).last().waitFor();
  await page.getByRole("textbox", { name: "Message typo" }).fill("j2: and the other one");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Fixed the other one too.").waitFor();
  await until("its second run done", async () => (await s.page()).runs.map((r) => r.status).join() === "done,done");
  await k.kill();
});

test.concurrent("the owner sees in what runs a subagent's task and model, and that it waits on a usage limit till its reset, and opens it", async () => {
  const k = await Troop.up();
  await fake.next("j3: tally the herons", { what: "error", kind: "usage-limit", reset: Date.now() + 3600e3 });
  const [s] = await k.subagents({ task: "j3: tally the herons", name: "tally", model: "haiku-5.5", memory: false });
  await until("it waits on the limit", async () => (await s.page()).waits === "limit");
  const page = await phone(k, true);
  await page.goto(k.url + "/a/" + k.agent + "/running");

  const row = page.getByRole("link", { name: /^tally/ });
  await row.getByText("j3: tally the herons").waitFor();
  await row.getByText(/^haiku-5\.5/).waitFor();
  await row.getByText(/^Usage limit · resets .*\d\d:\d\d$/).waitFor();
  await row.click();
  await page.getByRole("heading", { name: "tally" }).waitFor();
  await page.getByText(/^Hit a usage limit: it goes on by itself at .*\d\d:\d\d\.$/).waitFor();
  expect(await page.getByText(/^Its turn failed/).count()).toBe(0);
  await k.api("POST", "/api/sessions/" + s.id + "/stop", {});
  await k.kill();
});

test.concurrent("the owner's settings page open on a mon shows what the mon changes of its own settings, keeping what the owner is typing", async () => {
  const k = await Troop.up();
  const t = tag();
  const page = await phone(k, true);
  await page.goto(k.url + "/a/" + k.agent + "/edit");
  await page.getByText("Prompt history").waitFor();
  await page.getByRole("textbox", { name: "Description" }).fill("Typed by the owner.");
  await fake.next(t + ": rename", { what: "tool", calls: [["settings", { action: "set", name: "Nova", about: "Watches the herons.", prompt: "You are Nova. Answer in haiku." }]] });
  await k.tell(t + ": rename");

  await until("the name shown", async () => await page.getByRole("textbox", { name: "Name" }).inputValue() === "Nova");
  expect(await page.getByRole("textbox", { name: "System prompt" }).inputValue()).toBe("You are Nova. Answer in haiku.");
  expect(await page.getByRole("textbox", { name: "Description" }).inputValue()).toBe("Typed by the owner.");
  await k.kill();
});
