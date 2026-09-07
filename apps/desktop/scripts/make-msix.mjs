/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Packs the Forge-packaged app into an MSIX signed with the local dev
// certificate. `--install` then installs or upgrades it in place.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const install = process.argv.includes("--install");
const { version, author } = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const cert = join(desktopDir, "devcert.pfx");
const packaged = join(desktopDir, "out", "Diffusion Studio-win32-x64");
const stage = join(desktopDir, "out", "msix");
const output = join(desktopDir, "out", "make", "msix", `DiffusionStudio-${version}-x64.msix`);

const certInfo = execFileSync("winapp", ["cert", "info", cert], { encoding: "utf8" });
const publisher = certInfo.match(/^Subject:\s*(.+)$/m)?.[1].trim();
if (!publisher) throw new Error(`make-msix: no publisher in ${cert}; run \`winapp cert generate\` in apps/desktop first`);

rmSync(stage, { recursive: true, force: true });
cpSync(packaged, stage, { recursive: true });
cpSync(join(desktopDir, "assets", "msix"), join(stage, "assets", "msix"), { recursive: true });
writeFileSync(
  join(stage, "Package.appxmanifest"),
  readFileSync(join(desktopDir, "Package.appxmanifest"), "utf8")
    .replace("{{publisher}}", publisher)
    .replace("{{publisherDisplayName}}", author)
    .replace("{{version}}", `${version}.0`),
);

mkdirSync(dirname(output), { recursive: true });
execFileSync("winapp", ["pack", stage, "--cert", cert, "--output", output], { stdio: "inherit" });
console.log(`make-msix: wrote ${output}`);

if (install) {
  execFileSync("powershell", ["-NoProfile", "-Command", `Add-AppxPackage -ForceApplicationShutdown -Path '${output}'`], {
    stdio: "inherit",
  });
  console.log("make-msix: installed");
}
