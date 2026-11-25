import { afterAll, beforeAll, expect, test } from "bun:test";
import * as path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { fake, Kny, repo, until } from "../rig.ts";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

async function phone(k: Kny, signed: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (signed) {
    await ctx.addCookies([{ name: "kunumy", value: k.cookie.slice("kunumy=".length), url: k.url }]);
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return page;
}

test.concurrent("the owner signs in with a code, opens an agent and gets its answer", async () => {
  const k = await Kny.up();
  await fake.next("j1: what's the plan?", { what: "reply", text: "The plan is ready." });
  const page = await phone(k, false);
  await page.goto(k.url + "/");
  const out = Bun.spawnSync(["bun", path.resolve(import.meta.dir, "../../Cli.ts"), "serve", "login"], { env: k.env() }).stdout.toString();
  await page.getByRole("textbox", { name: "code" }).fill(/\b(\d{6})\b/.exec(out)?.[1] ?? "");
  await page.keyboard.press("Enter");

  await page.getByRole("link", { name: /^Kunumy(?!'s settings)/ }).click();
  await page.getByRole("textbox", { name: "Message Kunumy" }).fill("j1: what's the plan?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("The plan is ready.").waitFor();
  expect(new URL(page.url()).pathname).toBe("/a/" + k.agent);
  await k.kill();
});

test.concurrent("the owner opens a work session from what runs, reads its report, and sends it on", async () => {
  const k = await Kny.up();
  await fake.next("j2: fix the typo", { what: "tool", calls: [["report", { result: "Fixed the typo in README.md." }]] });
  await fake.next("j2: and the other one", { what: "reply", text: "Fixed the other one too." });
  const s = await k.session("typo", "j2: fix the typo", repo());
  await s.status("done");
  await until("its holder ended", () => s.holder() === null);
  const page = await phone(k, true);
  await page.goto(k.url + "/a/" + k.agent);

  await page.getByRole("button", { name: "Kunumy", exact: true }).click();
  await page.getByRole("menuitem", { name: "Running" }).click();
  await page.getByRole("link", { name: /^typo/ }).click();
  await page.getByRole("heading", { name: "typo" }).waitFor();
  await page.getByText("Fixed the typo in README.md.", { exact: true }).last().waitFor();
  await page.getByRole("textbox", { name: "Message typo" }).fill("j2: and the other one");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Fixed the other one too.").waitFor();
  expect((await s.page()).runs.map((r) => r.status)).toEqual(["done", "done"]);
  await k.kill();
});
