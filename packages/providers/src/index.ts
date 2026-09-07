/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript } from "@diffusionstudio/assets";
import type { AspectRatio } from "@diffusionstudio/jsx";

export type Capability = "image" | "video" | "sound" | "speech" | "transcription" | "listen" | "upscale" | "background";

export const VENDOR_KEYS = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  fal: "FAL_KEY",
  replicate: "REPLICATE_API_TOKEN",
  elevenlabs: "ELEVENLABS_API_KEY",
} as const;

export type Vendor = keyof typeof VENDOR_KEYS;

export type Inputs = {
  image: { model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; images: File[] };
  video: {
    model: string;
    prompt: string;
    aspectRatio: AspectRatio;
    duration: number;
    generateAudio: boolean;
    seed?: number;
    startFrame?: File;
    endFrame?: File;
  };
  sound: { model: string; prompt: string; duration?: number; seed?: number };
  speech: { model: string; voice: string; text: string; seed?: number };
  transcription: { audio: File };
  listen: { media: File; prompt?: string };
  upscale: { media: File };
  background: { image: File };
};

export type Outputs = {
  image: File[];
  video: File[];
  sound: File[];
  speech: File[];
  transcription: Transcript;
  listen: string;
  upscale: File;
  background: File;
};

export type VideoFeature = "start-frame" | "end-frame" | "audio";

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
  durations?: number[];
  aspectRatios?: AspectRatio[];
  features?: VideoFeature[];
};

export type VoiceInfo = { id: string; label: string; description: string; previewUrl?: string };

export type RunContext = { apiKey: string | null; signal?: AbortSignal };

export interface Provider<C extends Capability = Capability> {
  readonly id: string;
  readonly name: string;
  readonly capability: C;
  readonly vendor: Vendor | null;
  models(): ModelInfo[];
  voices?(): VoiceInfo[];
  run(input: Inputs[C], context: RunContext): Promise<Outputs[C]>;
}

export type KeySource = "environment" | "stored";

export type ResolvedKey = { value: string; source: KeySource } | { value: null; source: null };

export interface KeyStore {
  get(vendor: Vendor): Promise<ResolvedKey>;
  set(vendor: Vendor, value: string | null): Promise<void>;
}

type EnvLookup = (name: string) => Promise<string | null>;
type StoredKeys = { get(name: string): Promise<string | null>; set(name: string, value: string | null): Promise<void> };

export function layeredKeys(env: EnvLookup, stored: StoredKeys): KeyStore {
  return {
    async get(vendor) {
      const name = VENDOR_KEYS[vendor];
      const fromEnv = await env(name);
      if (fromEnv) return { value: fromEnv, source: "environment" };
      const fromStore = await stored.get(name);
      if (fromStore) return { value: fromStore, source: "stored" };
      return { value: null, source: null };
    },
    set: (vendor, value) => stored.set(VENDOR_KEYS[vendor], value),
  };
}

export function memoryKeys(): StoredKeys {
  const values = new Map<string, string>();
  return {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      if (value === null) values.delete(name);
      else values.set(name, value);
    },
  };
}

export type Listed<T> = T & { provider: string; available: boolean };

export type ProviderStatus = {
  id: string;
  name: string;
  capability: Capability;
  vendor: Vendor | null;
  key: ResolvedKey | null;
};

export class NoProviderError extends Error {
  constructor(capability: Capability, model?: string) {
    super(
      model
        ? `No configured provider offers the model "${model}". Add its API key in Settings.`
        : `No provider is configured for ${capability}. Add an API key in Settings.`,
    );
    this.name = "NoProviderError";
  }
}

export class ProviderRegistry {
  constructor(
    private readonly providers: readonly Provider[],
    private readonly keys: KeyStore,
  ) {}

  async status(): Promise<ProviderStatus[]> {
    return Promise.all(
      this.providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        capability: provider.capability,
        vendor: provider.vendor,
        key: provider.vendor ? await this.keys.get(provider.vendor) : null,
      })),
    );
  }

  async models<C extends Capability>(capability: C): Promise<Listed<ModelInfo>[]> {
    return this.list(capability, (provider) => provider.models());
  }

  async voices(): Promise<Listed<VoiceInfo>[]> {
    return this.list("speech", (provider) => provider.voices?.() ?? []);
  }

  async run<C extends Capability>(capability: C, input: Inputs[C], signal?: AbortSignal): Promise<Outputs[C]> {
    const model = "model" in input ? input.model : undefined;
    const provider = await this.select(capability, model);
    const apiKey = provider.vendor ? (await this.keys.get(provider.vendor)).value : null;
    return provider.run(input, { apiKey, signal });
  }

  private async available(provider: Provider): Promise<boolean> {
    return provider.vendor === null || (await this.keys.get(provider.vendor)).value !== null;
  }

  private async list<T>(capability: Capability, pick: (provider: Provider) => T[]): Promise<Listed<T>[]> {
    const listed: Listed<T>[] = [];
    for (const provider of this.providers) {
      if (provider.capability !== capability) continue;
      const available = await this.available(provider);
      for (const item of pick(provider)) listed.push({ ...item, provider: provider.id, available });
    }
    return listed;
  }

  private async select<C extends Capability>(capability: C, model?: string): Promise<Provider<C>> {
    for (const provider of this.providers) {
      if (provider.capability !== capability) continue;
      if (model !== undefined && !provider.models().some((m) => m.id === model)) continue;
      if (await this.available(provider)) return provider as Provider<C>;
    }
    throw new NoProviderError(capability, model);
  }
}
