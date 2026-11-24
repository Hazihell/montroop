import * as fs from "node:fs";
import * as net from "node:net";
import * as config from "./Config.ts";
import { err_code } from "./Err.ts";

const LOCK       = config.DIR + "/lock";
const LOCK_PID   = LOCK + ".pid";
const LOCK_BEAT  = 5000;
const LOCK_DEAD  = 30000;
const WIN        = process.platform === "win32";

export async function lock(): Promise<void> {
  fs.mkdirSync(config.DIR, { recursive: true });
  while (WIN) {
    try {
      fs.writeFileSync(LOCK_PID, String(process.pid), { flag: "wx" });
      setInterval(() => {
        try {
          fs.utimesSync(LOCK_PID, new Date(), new Date());
        } catch {}
      }, LOCK_BEAT).unref();
      process.on("exit", () => fs.rmSync(LOCK_PID, { force: true }));
      return;
    } catch (err) {
      if (err_code(err) !== "EEXIST") {
        throw err;
      }
    }
    if (!locked()) {
      fs.rmSync(LOCK_PID, { force: true });
      continue;
    }
    await Bun.sleep(1000);
  }
  while (true) {
    try {
      Bun.listen({ unix: LOCK, socket: { data() {} } });
      return;
    } catch (err) {
      if (err_code(err) !== "EADDRINUSE") {
        throw err;
      }
    }
    const live = await new Promise<boolean>((done) => {
      const sock = net.connect(LOCK);
      sock.on("connect", () => sock.on("close", () => done(true)));
      sock.on("error", () => done(false));
    });
    if (!live) {
      fs.rmSync(LOCK, { force: true });
    }
  }
}

function locked(): boolean {
  try {
    const text = fs.readFileSync(LOCK_PID, "utf8");
    if (Date.now() - fs.statSync(LOCK_PID).mtimeMs > LOCK_DEAD || text === String(process.pid)) {
      return false;
    }
    if (text !== "") {
      process.kill(Number(text), 0);
    }
    return true;
  } catch (err) {
    return err_code(err) === "EPERM";
  }
}
