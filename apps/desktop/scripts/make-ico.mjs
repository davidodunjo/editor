/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Builds assets/icon.ico from assets/icon.png, the Windows counterpart of
// make-icns.sh. Runs under Electron (`npm run make:ico`) for its image
// resizer, so the repo needs no extra dependency. Every entry is PNG-encoded,
// which Windows has accepted since Vista and which keeps the 256px entry legal.

import { app, nativeImage } from "electron";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const HEADER = 6;
const ENTRY = 16;

const master = nativeImage.createFromPath(join(assets, "icon.png"));
if (master.isEmpty()) throw new Error("assets/icon.png is missing or unreadable");

const images = SIZES.map((size) => master.resize({ width: size, height: size, quality: "best" }).toPNG());

const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

const entries = Buffer.alloc(ENTRY * images.length);
let offset = HEADER + entries.length;
images.forEach((png, i) => {
  const size = SIZES[i];
  const entry = entries.subarray(i * ENTRY);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width, 0 means 256
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette colours: none
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
});

writeFileSync(join(assets, "icon.ico"), Buffer.concat([header, entries, ...images]));
console.log(`make-ico: wrote assets/icon.ico (${SIZES.join(", ")} px)`);
app.quit();
