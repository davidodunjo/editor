/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Windows counterpart of make-icns.sh; runs under Electron for its resizer.

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

const ICON_TYPE = 1;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(ICON_TYPE, 2);
header.writeUInt16LE(images.length, 4);

const entries = Buffer.alloc(ENTRY * images.length);
let offset = HEADER + entries.length;
images.forEach((png, i) => {
  const dimension = SIZES[i] === 256 ? 0 : SIZES[i];
  const entry = entries.subarray(i * ENTRY);
  entry.writeUInt8(dimension, 0);
  entry.writeUInt8(dimension, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
});

writeFileSync(join(assets, "icon.ico"), Buffer.concat([header, entries, ...images]));
console.log(`make-ico: wrote assets/icon.ico (${SIZES.join(", ")} px)`);
app.quit();
