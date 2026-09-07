/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Puts a `dapi` on PATH that runs the development build in dist/, the
// counterpart of the packaged app's installer. macOS and Linux symlink it into
// Homebrew's bin as before; Windows gets a .cmd shim in the per-user
// WindowsApps folder, which is on PATH by default. `--remove` undoes either.

import { existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const remove = process.argv.includes("--remove");
const windows = process.platform === "win32";

const link = windows
  ? join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "dapi.cmd")
  : "/opt/homebrew/bin/dapi";

if (remove) {
  rmSync(link, { force: true });
  console.log(`link-cli: removed ${link}`);
} else if (windows) {
  writeFileSync(link, `@"${process.execPath}" "${entry}" %*\r\n`);
  console.log(`link-cli: wrote ${link}`);
} else {
  if (existsSync(link)) rmSync(link);
  symlinkSync(entry, link);
  console.log(`link-cli: linked ${link}`);
}
