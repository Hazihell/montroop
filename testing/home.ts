// The test file's own data folder, set before the modules under test load
// (each test file loads them anew): import it first.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "home-")), ".kunumy");
fs.mkdirSync(DIR, { recursive: true });
process.env.KNY_DIR = DIR;
