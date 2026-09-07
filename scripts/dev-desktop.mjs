/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One command to develop the desktop app from source. It:
//   1. builds the CLI, so a linked `dapi` (see symlink:create) runs the
//      latest code and the app's headless server matches it;
//   2. starts the web dev server (Vite on :5173), first reclaiming the port
//      from a Vite left behind by an earlier run that did not come down;
//   3. waits for that server, then launches Electron, which loads it.
// Ctrl-C tears the whole tree down.

import { spawn, execFileSync } from "node:child_process";
import { get } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WINDOWS = process.platform === "win32";
const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");
const FORGE = join(ROOT, "node_modules", "@electron-forge", "cli", "dist", "electron-forge.js");
const DEV_PORT = 5173;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const children = [];
let shuttingDown = false;

// JS entry points, not .bin shims: those are .cmd files on Windows.
function run(name, script, args, cwd) {
  const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit", detached: !WINDOWS });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    // A child dying on its own (e.g. Vite crashed) should bring the rest down.
    console.error(`\n[dev:desktop] ${name} exited (${code}); shutting down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      if (WINDOWS) {
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      // Already gone.
    }
  }
  process.exit(code);
}

function buildWorkspace(pkg) {
  const pm = process.env.npm_execpath;
  if (pm?.endsWith(".js")) {
    execFileSync(process.execPath, [pm, "run", "build", `--workspace=${pkg}`], { stdio: "inherit" });
  } else if (pm) {
    execFileSync(pm, ["run", "--filter", pkg, "build"], { stdio: "inherit" });
  } else {
    execFileSync("npm", ["run", "build", `--workspace=${pkg}`], { stdio: "inherit", shell: WINDOWS });
  }
}

// Resolves once the dev server answers. Probes over HTTP against the same URL
// Electron loads, so we follow its host resolution (Vite binds localhost as
// IPv6 ::1) rather than guessing an address family.
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = get(url, (res) => {
        res.destroy();
        resolve(); // Any response means the server is up.
      });
      req.once("error", () => {
        req.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Vite did not come up at ${url} in time`));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

function powershell(command) {
  return execFileSync("powershell", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "ignore"] }).toString();
}

/** PIDs listening on a TCP port; [] when none or unknown. */
function listeners(port) {
  try {
    const out = WINDOWS
      ? powershell(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`)
      : execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return [...new Set(out.split("\n").map((line) => Number(line.trim())).filter(Boolean))];
  } catch {
    return []; // lsof exits 1 when nothing listens.
  }
}

/** The command line of a process, or "" when it is gone. */
function commandOf(pid) {
  try {
    const out = WINDOWS
      ? powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`)
      : execFileSync("ps", ["-o", "command=", "-p", String(pid)], { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return out.trim();
  } catch {
    return "";
  }
}

function kill(pid, force) {
  try {
    if (WINDOWS) {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

/**
 * Frees the dev port. A Vite left over from an earlier run of this repo
 * (Ctrl-C'd terminal, crashed Electron, a detached child) is killed and the
 * port awaited; anything else on the port is not ours to touch, so we say
 * what it is and stop.
 */
async function reclaimPort(port) {
  const pids = listeners(port);
  if (!pids.length) return;
  const here = ROOT.replace(/[\\/]$/, "");
  for (const pid of pids) {
    const command = commandOf(pid);
    if (!command.includes("vite") || !command.includes(here)) {
      console.error(`[dev:desktop] port ${port} is in use by another process (pid ${pid}): ${command || "unknown"}`);
      process.exit(1);
    }
    console.log(`[dev:desktop] port ${port} held by a stale vite (pid ${pid}); stopping it…`);
    kill(pid, false);
  }
  const deadline = Date.now() + 5000;
  while (listeners(port).length) {
    if (Date.now() > deadline) {
      for (const pid of listeners(port)) kill(pid, true);
      await new Promise((r) => setTimeout(r, 200));
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// 1. Build the CLI (blocking) so `dapi` and the app agree on the latest code.
console.log("[dev:desktop] building CLI…");
buildWorkspace("@diffusionstudio/cli");

// 2. Start the web dev server, on a port that is free.
await reclaimPort(DEV_PORT);
console.log("[dev:desktop] starting web dev server…");
run("web", VITE, [], join(ROOT, "apps", "web"));

// 3. Once it is up, build the desktop app (blocking, mirrors its `dev`
// script) and launch Electron, which loads :5173.
try {
  await waitForServer(DEV_URL);
} catch (err) {
  console.error(`[dev:desktop] ${err.message}`);
  shutdown(1);
}
console.log("[dev:desktop] building desktop app…");
buildWorkspace("@diffusionstudio/desktop");
console.log("[dev:desktop] starting desktop app…");
run("desktop", FORGE, ["start"], join(ROOT, "apps", "desktop"));
