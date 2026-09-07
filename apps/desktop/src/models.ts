/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, net, protocol } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { once } from "node:events";
import { dirname, join, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";

import type { BrowserWindow } from "electron";
import type { ModelFiles, ModelStatus } from "./main-channels";

export const MODELS_SCHEME = "models";
const HUB = "https://huggingface.co";
const PROGRESS_INTERVAL_MS = 200;

const downloads = new Map<string, Promise<void>>();

export function registerModelsScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MODELS_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

export function serveModels(): void {
  protocol.handle(MODELS_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    try {
      return await net.fetch(pathToFileURL(localPath(decodeURIComponent(pathname).slice(1))).href);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export async function modelsStatus({ repo, files }: ModelFiles): Promise<ModelStatus> {
  let present = true;
  let bytes = 0;
  for (const file of files) {
    const size = await fileSize(localPath(join(repo, file)));
    if (size === null) present = false;
    else bytes += size;
  }
  return { present, bytes };
}

export function downloadModels(window: BrowserWindow | null, { repo, files }: ModelFiles): Promise<void> {
  const key = `${repo}:${[...files].sort().join(",")}`;
  let pending = downloads.get(key);
  if (!pending) {
    pending = download(window, repo, files).finally(() => downloads.delete(key));
    downloads.set(key, pending);
  }
  return pending;
}

async function download(window: BrowserWindow | null, repo: string, files: string[]): Promise<void> {
  const sizes = await hubSizes(repo);
  const expected = files.map((file) => {
    const size = sizes.get(file);
    if (size === undefined) throw new Error(`${repo} has no file "${file}" on Hugging Face.`);
    return size;
  });
  const total = expected.reduce((sum, size) => sum + size, 0);
  const loaded = new Array<number>(files.length).fill(0);
  let reportedAt = 0;
  const report = (force: boolean) => {
    if (!force && Date.now() - reportedAt < PROGRESS_INTERVAL_MS) return;
    reportedAt = Date.now();
    mainBridge.emit(window, MAIN_CHANNELS.MODELS_PROGRESS, { repo, loaded: loaded.reduce((sum, bytes) => sum + bytes, 0), total });
  };

  await Promise.all(
    files.map((file, index) =>
      downloadFile(repo, file, expected[index]!, (bytes) => {
        loaded[index] = bytes;
        report(false);
      }),
    ),
  );
  report(true);
}

async function downloadFile(repo: string, file: string, size: number, onProgress: (bytes: number) => void): Promise<void> {
  const path = localPath(join(repo, file));
  if ((await fileSize(path)) === size) {
    onProgress(size);
    return;
  }

  const part = `${path}.part`;
  await mkdir(dirname(path), { recursive: true });
  let offset = (await fileSize(part)) ?? 0;
  if (offset > size) offset = 0;
  onProgress(offset);

  if (offset < size) {
    const response = await net.fetch(`${HUB}/${repo}/resolve/main/${file}`, {
      headers: offset ? { Range: `bytes=${offset}-` } : {},
    });
    if (response.status === 200) offset = 0;
    else if (response.status !== 206) throw new Error(`Downloading ${repo}/${file} failed (${response.status} ${response.statusText}).`);
    if (!response.body) throw new Error(`Downloading ${repo}/${file} returned no data.`);

    const out = createWriteStream(part, { flags: offset ? "a" : "w" });
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await once(out, "drain");
      offset += value.byteLength;
      onProgress(offset);
    }
    out.end();
    await finished(out);
  }

  const written = await fileSize(part);
  if (written !== size) throw new Error(`${repo}/${file} came down as ${written} bytes, expected ${size}.`);
  await rename(part, path);
}

async function hubSizes(repo: string): Promise<Map<string, number>> {
  const response = await net.fetch(`${HUB}/api/models/${repo}/tree/main?recursive=true`);
  if (!response.ok) throw new Error(`Could not list ${repo} on Hugging Face (${response.status} ${response.statusText}).`);
  const entries = (await response.json()) as { type: string; path: string; size: number }[];
  return new Map(entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry.size]));
}

function localPath(relative: string): string {
  const root = join(app.getPath("userData"), "models");
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new Error(`"${relative}" is not inside the models directory.`);
  return path;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
