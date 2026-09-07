/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, safeStorage } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VENDOR_KEYS } from "@diffusionstudio/providers";

type EncryptedSecrets = Record<string, string>;

const VENDOR_ENV_NAMES = new Set<string>(Object.values(VENDOR_KEYS));

function secretsPath(): string {
  return join(app.getPath("userData"), "secrets.json");
}

async function readSecrets(): Promise<EncryptedSecrets> {
  try {
    return JSON.parse(await readFile(secretsPath(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function getSecret(name: string): Promise<string | null> {
  const ciphertext = (await readSecrets())[name];
  if (ciphertext === undefined) return null;
  return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  const secrets = await readSecrets();
  if (value === null) {
    delete secrets[name];
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system keychain is unavailable, so the key cannot be stored securely. Set it as an environment variable instead.");
    }
    secrets[name] = safeStorage.encryptString(value).toString("base64");
  }
  await writeFile(secretsPath(), JSON.stringify(secrets, null, 2));
}

export function readVendorEnvironment(names: string[]): Record<string, string | null> {
  return Object.fromEntries(
    names.map((name) => [name, VENDOR_ENV_NAMES.has(name) ? (process.env[name] ?? null) : null]),
  );
}
