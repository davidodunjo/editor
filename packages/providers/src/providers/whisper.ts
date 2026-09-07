/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/// <reference types="@webgpu/types" />

import type { Transcript, TranscriptWord } from "@diffusionstudio/assets";
import type { ModelInfo, Provider } from "../index";
import type { WhisperDevice, WhisperDtype, WhisperDtypes, WhisperRequest, WhisperResponse, WordChunk } from "./whisper-worker";

export type ModelFiles = { repo: string; files: string[] };

export interface ModelStore {
  ensure(model: ModelFiles, signal?: AbortSignal): Promise<string | null>;
}

const SAMPLE_RATE = 16000;
const DEFAULT_MODEL = "whisper-base";
const MAX_WORDS_PER_SEGMENT = 40;
const SENTENCE_END = /[.!?]["')\]]?$/;

type WhisperModel = ModelInfo & { repo: string; webgpuOnly: boolean };

const MODELS: WhisperModel[] = [
  {
    id: "whisper-base",
    name: "Whisper Base",
    description: "Runs locally and fast; downloads about 200 MB on first use.",
    repo: "onnx-community/whisper-base_timestamped",
    webgpuOnly: false,
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    description: "Runs locally, more accurate; downloads about 590 MB on first use.",
    repo: "onnx-community/whisper-small_timestamped",
    webgpuOnly: false,
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    description: "Runs locally, most accurate; needs WebGPU and downloads about 1.6 GB on first use.",
    repo: "onnx-community/whisper-large-v3-turbo_timestamped",
    webgpuOnly: true,
  },
];

const DTYPE_SUFFIXES: Record<WhisperDtype, string> = { fp32: "", fp16: "_fp16", q4: "_q4", q8: "_quantized" };

const CONFIG_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json"];

export function createWhisper(store: ModelStore): Provider<"transcription"> {
  return {
    id: "whisper",
    name: "Whisper",
    capability: "transcription",
    vendor: null,
    models: () => MODELS.map(({ id, name, description }) => ({ id, name, description })),

    async run({ audio, model: modelId = DEFAULT_MODEL }, { signal }) {
      const model = MODELS.find((candidate) => candidate.id === modelId);
      if (!model) throw new Error(`Unknown Whisper model "${modelId}"`);
      const device = await pickDevice();
      if (model.webgpuOnly && device !== "webgpu") throw new Error(`${model.name} needs WebGPU, which this device does not offer.`);

      const dtype = dtypesFor(model, device);
      const [samples, modelPath] = await Promise.all([
        decodeMono(audio),
        store.ensure({ repo: model.repo, files: filesFor(dtype) }, signal),
      ]);

      const key = `${model.repo}:${device}`;
      const worker = takeWorker(key);
      try {
        const chunks = await transcribe(worker, { repo: model.repo, device, dtype, modelPath, audio: samples }, signal);
        releaseWorker(key, worker);
        return toTranscript(chunks, samples.length / SAMPLE_RATE);
      } catch (error) {
        worker.terminate();
        throw error;
      }
    },
  };
}

let device: Promise<WhisperDevice> | undefined;

function pickDevice(): Promise<WhisperDevice> {
  device ??= Promise.resolve(navigator.gpu?.requestAdapter()).then((adapter) => (adapter ? "webgpu" : "wasm"));
  return device;
}

function dtypesFor(model: WhisperModel, device: WhisperDevice): WhisperDtypes {
  if (device === "wasm") return { encoder_model: "q8", decoder_model_merged: "q8" };
  return { encoder_model: model.webgpuOnly ? "fp16" : "fp32", decoder_model_merged: "q4" };
}

function filesFor(dtype: WhisperDtypes): string[] {
  return [
    ...CONFIG_FILES,
    `onnx/encoder_model${DTYPE_SUFFIXES[dtype.encoder_model]}.onnx`,
    `onnx/decoder_model_merged${DTYPE_SUFFIXES[dtype.decoder_model_merged]}.onnx`,
  ];
}

async function decodeMono(audio: File): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(await audio.arrayBuffer());
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += samples[i]! / buffer.numberOfChannels;
  }
  return mono;
}

const idleWorkers = new Map<string, Worker>();

function takeWorker(key: string): Worker {
  const idle = idleWorkers.get(key);
  if (idle) {
    idleWorkers.delete(key);
    return idle;
  }
  return new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
}

function releaseWorker(key: string, worker: Worker): void {
  if (idleWorkers.has(key)) worker.terminate();
  else idleWorkers.set(key, worker);
}

function transcribe(worker: Worker, request: WhisperRequest, signal?: AbortSignal): Promise<WordChunk[]> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => reject(signal!.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const settle = (finish: () => void) => {
      signal?.removeEventListener("abort", abort);
      finish();
    };
    worker.onmessage = ({ data }: MessageEvent<WhisperResponse>) =>
      settle(() => ("error" in data ? reject(new Error(data.error)) : resolve(data.chunks)));
    worker.onerror = (event) => settle(() => reject(new Error(event.message || "The Whisper worker failed")));
    worker.postMessage(request);
  });
}

function toTranscript(chunks: WordChunk[], duration: number): Transcript {
  const words: TranscriptWord[] = [];
  chunks.forEach((chunk, index) => {
    const text = chunk.text.trim();
    if (!text) return;
    const start = chunk.timestamp[0];
    const end = chunk.timestamp[1] ?? chunks[index + 1]?.timestamp[0] ?? duration;
    words.push({ text, start, end: Math.max(start, end) });
  });

  const segments: Transcript = [];
  let current: TranscriptWord[] = [];
  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.text) || current.length >= MAX_WORDS_PER_SEGMENT) {
      segments.push(segment(current));
      current = [];
    }
  }
  if (current.length) segments.push(segment(current));
  return segments;
}

const segment = (words: TranscriptWord[]) => ({ text: words.map((word) => word.text).join(" "), words });
