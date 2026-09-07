/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAssetSpec, isAssetRef, parseSource } from "@diffusionstudio/jsx";
import {
  Ai, AssetId, Audio, GenAi, getAssetFile, getEntityTree, Hidden, Muted,
  Paint, PaintType, Source,
} from "@diffusionstudio/runtime";
import type { SourceModifierValues } from "@diffusionstudio/runtime";
import { createEncoder } from "@diffusionstudio/encoder";
import { createCapture } from "@/engine/capture";
import { assetName, GENERATED_DIR } from "@diffusionstudio/assets";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "@/components/genai/config";
import { assert, mimeTypeToExtension } from "@/utils";
import { registry } from "@/providers";
import { toast } from "somoto";

import type { AspectRatio, AssetInput, AssetRef, AssetSpecInput } from "@diffusionstudio/jsx";
import type { Asset, AssetGeneration, AssetLibrary, AssetType } from "@diffusionstudio/assets";
import type { ExportResult } from "@diffusionstudio/encoder";
import type { Entity, World } from "koota";

/** What a failure is called where the user reads about it. */
const FAILURE_TITLES: Record<AssetSpecInput["type"] | "transcript", string> = {
  image: "Image generation failed",
  video: "Video generation failed",
  voice: "Voice generation failed",
  audio: "Audio generation failed",
  transcript: "Caption generation failed",
};

/**
 * One step of a source modifier (see the runtime's `SourceModifiers`): a
 * model call that makes a new asset out of one the library already holds.
 * An element asks for these by prop and goes on naming what it was made
 * from, so each step is stored and cached on its own, and a set of modifiers
 * is these run in order (see `derive`).
 */
export type TransformKind = "remove-background" | "upscale" | "add-audio";

/** What each step is called where the user reads about it, and names its result. */
const TRANSFORMS: Record<TransformKind, { title: string; suffix: string }> = {
  "remove-background": { title: "Background removal failed", suffix: "Background removed" },
  "upscale": { title: "Upscale failed", suffix: "Upscaled" },
  "add-audio": { title: "Adding audio failed", suffix: "With audio" },
};

/** The steps a set of modifiers comes to, in the order they are applied. */
function steps(modifiers: SourceModifierValues): TransformKind[] {
  const kinds: TransformKind[] = [];
  if (modifiers.removeBackground) kinds.push("remove-background");
  if (modifiers.upscale > 1) kinds.push("upscale");
  if (modifiers.addAudio) kinds.push("add-audio");
  return kinds;
}

/**
 * A spec with defaults applied and every `AssetInput` reduced to an asset id.
 * Field order is fixed, so `JSON.stringify` of it is a stable `generationKey`.
 */
export type ResolvedSpec =
  | { type: "image"; model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; refIds: string[] }
  | { type: "video"; model: string; prompt: string; aspectRatio: AspectRatio; duration: number; audio: boolean; seed?: number; startFrameId?: string; endFrameId?: string }
  | { type: "voice"; model: string; prompt: string; voice: string; seed?: number }
  | { type: "audio"; model: string; prompt: string; duration?: number; seed?: number };

const GENERATED_NAME_LENGTH = 48;

/** Creates the project's GenAi over `library` and attaches it as the world's Ai. */
export function attachAi(world: World, library: AssetLibrary, dir?: string): EditorGenAi {
  const ai = new EditorGenAi(library, dir);
  world.set(Ai, ai);
  return ai;
}

export class EditorGenAi extends GenAi {
  private readonly library: AssetLibrary;
  /** The project's folder, so a transcription's capture compiles the sources as they are now. */
  private readonly dir?: string;

  /**
   * Declarations already resolved, keyed by ref identity — a ref consumed by
   * several elements resolves (and validates) once. A failed one is forgotten:
   * from there on the element that asked is what carries the failure, in its
   * `error` prop, and that is what keeps the generation from running again.
   */
  private readonly memo = new Map<AssetRef, Promise<Asset>>();
  /** In-flight generations and transcriptions keyed by `generationKey`. */
  private readonly inflight = new Map<string, Promise<Asset>>();

  public constructor(library: AssetLibrary, dir?: string) {
    super();
    this.library = library;
    this.dir = dir;
  }

  /** Identical concurrent declarations collapse to one request. */
  public resolve(ref: AssetRef): Promise<Asset> {
    assert(isAssetRef(ref), "Not a generate.* declaration");

    let promise = this.memo.get(ref);
    if (!promise) {
      promise = this.generateFromRef(ref);
      promise.catch(() => this.memo.delete(ref));
      this.memo.set(ref, promise);
    }
    return promise;
  }

  /**
   * Transcribes the scene's audible mix for a `<captions>` element (see the
   * runtime's asset system). Cached by scene id + seed: the same pair is the
   * same transcript asset across sessions (the transcript lands in the
   * library under `generated/` with that key in the manifest), and a new
   * seed transcribes the scene again.
   */
  public async transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
    const key = transcriptKey(scene, seed);

    const cached = this.library.list().find((asset) => asset.generation?.key === key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return await running;

    const promise = this.runTranscription(world, scene, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      throw reportFailure(error, FAILURE_TITLES.transcript);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Encodes the scene's audio, transcribes it, and stores the transcript. */
  private async runTranscription(world: World, scene: Entity, key: string): Promise<Asset> {
    assert(sceneHasAudio(world, scene), "No audio found. Add an audio or video clip to the scene to generate captions.");

    // The scene's own capture world: the project rendered again, reduced to
    // this scene, with nothing drawn — see `createCapture`.
    const capture = await createCapture(world, scene, { mode: "offline-audio", dir: this.dir });
    let result: ExportResult;
    try {
      const encoder = await createEncoder(capture.world, {
        format: "ogg",
        video: { enabled: false },
        audio: { enabled: true, codec: "opus", sampleRate: 24000 },
      });
      result = await encoder.render();
    } finally {
      capture.dispose();
    }
    assert(result.type === "success" && result.data !== undefined, "Failed to encode the scene audio");

    const audio = new File([result.data], "scene-audio.ogg", { type: "audio/ogg" });
    console.log(`[gen-ai] transcribing scene audio for ${key} (${audio.size} bytes)`);
    const transcript = await registry.run("transcription", { audio });
    assert(
      transcript.length > 0 && transcript.some((segment) => segment.words.length > 0),
      "No speech detected. The audio does not appear to contain recognizable speech.",
    );

    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    const asset = await this.library.store(blob, {
      name: `${this.nextCaptionsName()}.json`,
      folder: GENERATED_DIR,
      generation: { key },
    });

    // A re-take of unchanged speech comes back byte-identical, and the library
    // dedups by content: `store` then hands back the earlier take still keyed
    // by its old seed. Re-key it, or the authored seed misses the cache and
    // transcribes again on every load.
    if (asset.generation?.key !== key) {
      this.library.update(asset, { generation: { key } });
    }

    return asset;
  }

  private nextCaptionsName(): string {
    let max = 0;
    for (const asset of this.library.list()) {
      const match = assetName(asset).match(/^Captions (\d+)\.json$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `Captions ${max + 1}`;
  }

  private resolveInput(input: AssetInput): Promise<Asset> {
    return isAssetRef(input) ? this.resolve(input) : this.library.resolve(input);
  }

  private async generateFromRef(ref: AssetRef): Promise<Asset> {
    const spec = getAssetSpec(ref);

    try {
      const resolved = await this.resolveSpec(spec);
      const generationKey = JSON.stringify(resolved);

      const cached = this.library.list().find((asset) => asset.generation?.key === generationKey);
      if (cached) return cached;

      const running = this.inflight.get(generationKey);
      if (running) return await running;

      const promise = this.runGeneration(resolved, generationKey);
      this.inflight.set(generationKey, promise);
      try {
        return await promise;
      } finally {
        this.inflight.delete(generationKey);
      }
    } catch (error) {
      throw reportFailure(error, FAILURE_TITLES[spec.type]);
    }
  }

  private async resolveSpec(spec: AssetSpecInput): Promise<ResolvedSpec> {
    switch (spec.type) {
      case "image": {
        const refs = await Promise.all((spec.refs ?? []).map((ref) => this.resolveInput(ref)));
        return {
          type: "image",
          model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          seed: spec.seed,
          refIds: refs.map((asset) => asset.id),
        };
      }
      case "video": {
        const [startFrame, endFrame] = await Promise.all([
          spec.startFrame !== undefined ? this.resolveInput(spec.startFrame) : undefined,
          spec.endFrame !== undefined ? this.resolveInput(spec.endFrame) : undefined,
        ]);
        const resolved = {
          type: "video",
          model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          duration: spec.duration ?? 5,
          audio: spec.audio ?? false,
          seed: spec.seed,
          startFrameId: startFrame?.id,
          endFrameId: endFrame?.id,
        } satisfies ResolvedSpec;
        checkVideoConstraints(resolved);
        return resolved;
      }
      case "voice": {
        return {
          type: "voice",
          model: PROMPT_INPUT_VOICE_MODEL,
          prompt: spec.prompt,
          voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
          seed: spec.seed,
        };
      }
      case "audio": {
        return {
          type: "audio",
          model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        };
      }
    }
  }

  /** Runs a generation and stores its first result under `generated/`. */
  private async runGeneration(spec: ResolvedSpec, generationKey: string): Promise<Asset> {
    console.log(`[gen-ai] generating ${spec.type} with ${spec.model}:`, spec);
    const results = await this.requestGeneration(spec);
    assert(results.length > 0, "No results returned from the model");

    return this.store(results[0], generatedName(spec), { key: generationKey });
  }

  private async requestGeneration(spec: ResolvedSpec): Promise<File[]> {
    switch (spec.type) {
      case "image":
        return registry.run("image", {
          model: spec.model,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio,
          seed: spec.seed,
          images: await Promise.all(spec.refIds.map((id) => this.fileOf(id))),
        });
      case "video": {
        const [startFrame, endFrame] = await Promise.all([
          spec.startFrameId ? this.fileOf(spec.startFrameId) : undefined,
          spec.endFrameId ? this.fileOf(spec.endFrameId) : undefined,
        ]);
        return registry.run("video", {
          model: spec.model,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio,
          duration: spec.duration,
          generateAudio: spec.audio,
          seed: spec.seed,
          startFrame,
          endFrame,
        });
      }
      case "voice":
        return registry.run("speech", {
          model: spec.model,
          voice: spec.voice,
          text: spec.prompt,
          seed: spec.seed,
        });
      case "audio":
        return registry.run("sound", {
          model: spec.model,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        });
    }
  }

  /**
   * `asset` through every modifier the element asked for, one step at a time
   * and in a fixed order. Each step is cached in its own right, so turning
   * one on leaves what the others already made alone — adding `upscale` to a
   * cut-out picture pays for the enlarging, not for the matte again.
   */
  public async derive(asset: Asset, modifiers: SourceModifierValues): Promise<Asset> {
    let derived = asset;
    for (const kind of steps(modifiers)) {
      derived = await this.transform(kind, derived);
    }
    return derived;
  }

  /**
   * Runs one step over `asset` and returns what it produced, stored under
   * `generated/` like any other model output. Keyed by step and input, so the
   * same call on the same asset is the same result in this session and the
   * next: upscaling a picture twice costs what upscaling it once did.
   */
  public async transform(kind: TransformKind, asset: Asset): Promise<Asset> {
    // No upscale factor in the key: the capability takes none, so every
    // factor is the same call and would otherwise be billed once per number
    // asked for. It belongs here the moment a provider can be told one.
    const key = `transform:v1:${kind}:${asset.id}`;

    const cached = this.library.list().find((entry) => entry.generation?.key === key);
    if (cached) return cached;

    const running = this.inflight.get(key);
    if (running) return await running;

    const promise = this.runTransform(kind, asset, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      throw reportFailure(error, TRANSFORMS[kind].title);
    } finally {
      this.inflight.delete(key);
    }
  }

  private async runTransform(kind: TransformKind, asset: Asset, key: string): Promise<Asset> {
    console.log(`[gen-ai] running ${kind} on ${asset.path}`);
    const result = await this.requestTransform(kind, asset, await this.fileOf(asset.id));

    const base = assetName(asset).replace(/\.[^.]+$/, "");
    return this.store(result, `${base} (${TRANSFORMS[kind].suffix})`, { key });
  }

  private requestTransform(kind: TransformKind, asset: Asset, input: File): Promise<File> {
    switch (kind) {
      case "remove-background":
        assert(asset.type === "IMAGE", "Only a picture has a background to remove");
        return registry.run("background", { image: input });
      case "upscale":
        return registry.run("upscale", { media: input });
      case "add-audio":
        assert(isMoving(asset.type), "Only footage can be scored");
        throw new Error("No provider can add audio to footage yet.");
    }
  }

  /**
   * Files what a model returned in the library. The name is ours, the
   * extension the result's — what came back decides what the file is called,
   * not what was asked for.
   */
  private store(file: File, name: string, generation: AssetGeneration): Promise<Asset> {
    return this.library.store(file, {
      name: name + resultExtension(file),
      folder: GENERATED_DIR,
      generation,
    });
  }

  private fileOf(assetId: string): Promise<File> {
    const asset = this.library.get(assetId);
    assert(asset, `Referenced asset ${assetId} not found`);
    return getAssetFile(asset);
  }
}

export function generationSpecOf(asset: Asset): ResolvedSpec | undefined {
  const key = asset.generation?.key;
  if (!key?.startsWith("{")) return undefined;
  try {
    return JSON.parse(key) as ResolvedSpec;
  } catch {
    return undefined;
  }
}

/** Whether an asset type is footage, for the calls that only take footage. */
const isMoving = (type: AssetType): boolean => type === "VIDEO" || type === "SEQUENCE";

function generatedName(spec: ResolvedSpec): string {
  const name = spec.prompt.replace(/[<>:"/\\|?*\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim();
  return name.slice(0, GENERATED_NAME_LENGTH).trim() || spec.type;
}

/**
 * What to call a generated result: the extension its type implies, falling
 * back to the one its own name carries. Neither is guaranteed — some models
 * hand back a plain slug, some say only `application/octet-stream` — so this
 * can come back empty, and the library reads the bytes instead. The name is
 * what the file is identified by once on disk, so getting it right saves
 * that guess.
 */
function resultExtension(file: File): string {
  const fromType = file.type ? mimeTypeToExtension(file.type) : ".bin";
  if (fromType !== ".bin") return fromType;

  const dot = file.name.lastIndexOf(".");
  const fromName = dot > 0 ? file.name.slice(dot + 1) : "";
  return fromName && fromName.length <= 5 ? `.${fromName}` : "";
}

/**
 * Says what a generation failed with, and hands the error on. The message is
 * what the element ends up carrying too (the runtime's `SourceError`, which
 * the editor writes into its `error` prop), so the sentence in the file, the
 * one on the canvas and the one in the toast are the same. The toast is keyed
 * by it: variants that failed the same way are one thing gone wrong rather
 * than four, and a render that ran into the same wall does not stack up.
 */
function reportFailure(error: unknown, title: string): Error {
  const failure = error instanceof Error ? error : new Error(String(error));

  console.error(`[gen-ai] ${title}:`, failure);
  toast.error(title, {
    id: `gen-ai:${title}:${failure.message}`,
    description: failure.message,
  });

  return failure;
}

/**
 * The transcript cache key: scene id + seed. The scene's durable name is the
 * id in its source stamp (`<file>:<id>`, stamped once by the compiler — the
 * same identity the project config keys by); a scene without one falls back
 * to its entity id, which only holds within the session.
 */
function transcriptKey(scene: Entity, seed: number): string {
  const source = scene.get(Source)?.value;
  const locator = source ? parseSource(source)?.locator : undefined;
  const sceneId = typeof locator === "string" ? locator : source ?? String(scene.id());
  return `transcript:v1:${sceneId}:${seed}`;
}

/**
 * Whether anything in the scene contributes to its audible mix: an unmuted,
 * unhidden audio clip, video, or video paint with its asset bound.
 */
function sceneHasAudio(world: World, scene: Entity): boolean {
  for (const entity of getEntityTree(world, scene)) {
    if (entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
    if (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO) return true;
  }
  return false;
}

/**
 *  Per-model constraints (`dapi models video`); unknown models are left to the provider.
 */
function checkVideoConstraints(spec: Extract<ResolvedSpec, { type: "video" }>): void {
  const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === spec.model);
  if (!model) return;

  assert(model.aspectRatios.includes(spec.aspectRatio), `${spec.model} does not support aspect ratio ${spec.aspectRatio}`);
  assert(model.durations.includes(`${spec.duration}s`), `${spec.model} does not support a duration of ${spec.duration}s`);
  assert(!spec.audio || model.features.includes("audio"), `${spec.model} does not support audio generation`);
  assert(spec.endFrameId === undefined || model.features.includes("end-frame"), `${spec.model} does not support an end frame`);
}
