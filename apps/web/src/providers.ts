/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_CHANNELS } from "@desktop/main-channels";
import { layeredKeys, memoryKeys, ProviderRegistry } from "@diffusionstudio/providers";
import { createWhisper, falImages, falVideos, gemini } from "@diffusionstudio/providers/providers";
import { mainBridge } from "@/lib/ipc";
import { modelStore } from "@/models";

import type { KeyStore, Vendor } from "@diffusionstudio/providers";

export const VENDOR_NAMES: Record<Vendor, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  fal: "fal",
  replicate: "Replicate",
  elevenlabs: "ElevenLabs",
};

function desktopKeys(): KeyStore {
  return layeredKeys(
    async (name) => (await mainBridge.call(MAIN_CHANNELS.ENV_GET, { names: [name] }))[name] ?? null,
    {
      get: (name) => mainBridge.call(MAIN_CHANNELS.SECRETS_GET, { name }),
      set: (name, value) => mainBridge.call(MAIN_CHANNELS.SECRETS_SET, { name, value }),
    },
  );
}

function browserKeys(): KeyStore {
  return layeredKeys(async () => null, memoryKeys());
}

export const keys = window.desktop ? desktopKeys() : browserKeys();

export const registry = new ProviderRegistry([createWhisper(modelStore), gemini, falImages, falVideos], keys);
