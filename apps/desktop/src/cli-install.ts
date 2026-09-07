/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliInstallResult } from "./main-channels";

const WINDOWS = process.platform === "win32";

export const CLI_LINK_PATH = WINDOWS
  ? join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "dapi.cmd")
  : "/usr/local/bin/dapi";

// The dev workflow links the workspace build into Homebrew's bin instead
// (`symlink:create` in apps/cli), so both locations count as installed.
const DEV_LINK_PATH = "/opt/homebrew/bin/dapi";

export function isCliInstalled(): boolean {
  return existsSync(CLI_LINK_PATH) || existsSync(DEV_LINK_PATH);
}

// Linking into /usr/local/bin needs elevation; osascript shows the standard
// macOS admin prompt so the app itself never asks for credentials.
function linkCli(): Promise<void> {
  const wrapper = join(process.resourcesPath, "cli", "bin", "dapi");
  const shell = `mkdir -p /usr/local/bin && ln -sf '${wrapper}' '${CLI_LINK_PATH}'`;
  const script = `do shell script "${shell.replaceAll('"', '\\"')}" with administrator privileges`;
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve()));
  });
}

// The MSIX execution alias resolves to whichever version is installed, and
// the CLI bundle sits beside that exe, so the shim never goes stale.
const WINDOWS_SHIM = [
  "@echo off",
  "set ELECTRON_RUN_AS_NODE=1",
  `diffusionstudio.exe --eval "process.argv.splice(1, 0, 'dapi'); require(require('path').join(require('path').dirname(process.execPath), 'resources', 'cli', 'dapi.js'))" -- %*`,
  "",
].join("\r\n");

export async function installCli(): Promise<CliInstallResult> {
  if (!app.isPackaged) {
    return {
      status: "error",
      error: "Installing the CLI is only available in the packaged app. Use `npm run symlink:create` in development.",
    };
  }
  try {
    if (WINDOWS) {
      writeFileSync(CLI_LINK_PATH, WINDOWS_SHIM);
    } else {
      await linkCli();
    }
    return { status: "installed" };
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (message.includes("-128")) return { status: "cancelled" }; // user cancelled the admin prompt
    return { status: "error", error: message };
  }
}
