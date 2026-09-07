/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { env, pipeline } from "@huggingface/transformers";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type WhisperDevice = "webgpu" | "wasm";
export type WhisperDtype = "fp32" | "fp16" | "q4" | "q8";
export type WhisperDtypes = { encoder_model: WhisperDtype; decoder_model_merged: WhisperDtype };
export type WordChunk = { text: string; timestamp: [number, number | null] };

export interface WhisperRequest {
  repo: string;
  device: WhisperDevice;
  dtype: WhisperDtypes;
  modelPath: string | null;
  audio: Float32Array;
}

export type WhisperResponse = { chunks: WordChunk[] } | { error: string };

const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

const scope = self as unknown as {
  name: string;
  onmessage: ((event: MessageEvent<WhisperRequest>) => void) | null;
  postMessage(message: WhisperResponse): void;
};

const pipelines = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

env.backends.onnx.wasm!.wasmPaths = { wasm: ortWasmUrl };

// ORT's thread pool re-runs this module in workers named em-pthread; those are its to drive.
if (scope.name !== "em-pthread") {
  scope.onmessage = async ({ data }) => {
    try {
      const asr = await load(data);
      const output = await asr(data.audio, {
        return_timestamps: "word",
        chunk_length_s: CHUNK_LENGTH_S,
        stride_length_s: STRIDE_LENGTH_S,
      });
      scope.postMessage({ chunks: (output.chunks ?? []) as WordChunk[] });
    } catch (error) {
      scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function load({ repo, device, dtype, modelPath }: WhisperRequest): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${repo}:${device}`;
  let loading = pipelines.get(key);
  if (!loading) {
    env.allowLocalModels = modelPath !== null;
    env.allowRemoteModels = modelPath === null;
    env.useBrowserCache = modelPath === null;
    if (modelPath !== null) env.localModelPath = modelPath;
    loading = pipeline("automatic-speech-recognition", repo, { device, dtype });
    pipelines.set(key, loading);
  }
  return loading;
}
