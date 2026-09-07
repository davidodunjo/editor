/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AspectRatio } from "@diffusionstudio/jsx";
import type { Inputs, ModelInfo, Provider } from "../index";

const QUEUE = "https://queue.fal.run";
const STORAGE_INITIATE = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
const POLL_INITIAL_MS = 1000;
const POLL_MAX_MS = 10000;
const POLL_GROWTH = 1.5;

type Session = { apiKey: string; signal?: AbortSignal };
type Body = Record<string, unknown>;
type Call = { endpoint: string; body: Body };
type FalFile = { url: string; content_type?: string; file_name?: string };
type Submitted = { status_url: string; response_url: string; cancel_url: string };
type Frames = { start?: string; end?: string };

const IMAGE_SIZE_PRESETS: Record<AspectRatio, string> = {
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

type ImageModel = ModelInfo & {
  textToImage: string;
  edit: string;
  sizing: "preset" | "aspect_ratio";
  seeded: boolean;
};

const IMAGE_MODELS: ImageModel[] = [
  {
    id: "flux-2-turbo",
    name: "FLUX.2 [DEV] Turbo",
    textToImage: "fal-ai/flux-2/turbo",
    edit: "fal-ai/flux-2/turbo/edit",
    sizing: "preset",
    seeded: true,
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    textToImage: "openai/gpt-image-2",
    edit: "openai/gpt-image-2/edit",
    sizing: "preset",
    seeded: false,
  },
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    textToImage: "fal-ai/nano-banana-2",
    edit: "fal-ai/nano-banana-2/edit",
    sizing: "aspect_ratio",
    seeded: true,
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    textToImage: "fal-ai/nano-banana-pro",
    edit: "fal-ai/nano-banana-pro/edit",
    sizing: "aspect_ratio",
    seeded: true,
  },
  {
    id: "seedream-4.5",
    name: "Seedream 4.5",
    textToImage: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    edit: "fal-ai/bytedance/seedream/v4.5/edit",
    sizing: "preset",
    seeded: true,
  },
];

type VideoModel = ModelInfo & { call: (input: Inputs["video"], frames: Frames) => Call };

const seconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const kling = (path: string, startField: string, endField: string, audio: boolean) =>
  ({ prompt, aspectRatio, duration, generateAudio }: Inputs["video"], frames: Frames): Call => {
    const body: Body = { prompt, duration: String(duration) };
    if (audio) body.generate_audio = generateAudio;
    return frames.start
      ? { endpoint: `${path}/image-to-video`, body: { ...body, [startField]: frames.start, [endField]: frames.end } }
      : { endpoint: `${path}/text-to-video`, body: { ...body, aspect_ratio: aspectRatio } };
  };

const veo = (base: string) =>
  ({ prompt, aspectRatio, duration, generateAudio, seed }: Inputs["video"], frames: Frames): Call => {
    const body: Body = { prompt, aspect_ratio: aspectRatio, duration: `${duration}s`, generate_audio: generateAudio, seed };
    if (frames.end) {
      return { endpoint: `${base}/first-last-frame-to-video`, body: { ...body, first_frame_url: frames.start, last_frame_url: frames.end } };
    }
    if (frames.start) return { endpoint: `${base}/image-to-video`, body: { ...body, image_url: frames.start } };
    return { endpoint: base, body };
  };

const VIDEO_MODELS: VideoModel[] = [
  {
    id: "kling-3-pro",
    name: "Kling 3.0",
    durations: seconds(3, 15),
    aspectRatios: ["16:9", "9:16", "1:1"],
    features: ["start-frame", "end-frame", "audio"],
    call: kling("fal-ai/kling-video/v3/pro", "start_image_url", "end_image_url", true),
  },
  {
    id: "kling-o3-pro",
    name: "Kling 3.0 Omni",
    durations: seconds(3, 15),
    aspectRatios: ["16:9", "9:16", "1:1"],
    features: ["start-frame", "end-frame", "audio"],
    call: kling("fal-ai/kling-video/o3/pro", "image_url", "end_image_url", true),
  },
  {
    id: "kling-2.5-turbo",
    name: "Kling 2.5 Turbo",
    durations: [5, 10],
    aspectRatios: ["16:9", "9:16", "1:1"],
    features: ["start-frame", "end-frame"],
    call: kling("fal-ai/kling-video/v2.5-turbo/pro", "image_url", "tail_image_url", false),
  },
  {
    id: "seedance-2.0",
    name: "Seedance 2.0",
    durations: seconds(4, 15),
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    features: ["start-frame", "end-frame", "audio"],
    call: ({ prompt, aspectRatio, duration, generateAudio }, frames) => ({
      endpoint: frames.start ? "bytedance/seedance-2.0/image-to-video" : "bytedance/seedance-2.0/text-to-video",
      body: {
        prompt,
        aspect_ratio: aspectRatio,
        duration: String(duration),
        generate_audio: generateAudio,
        image_url: frames.start,
        end_image_url: frames.end,
      },
    }),
  },
  {
    id: "veo-3.1",
    name: "Veo 3.1",
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    features: ["start-frame", "end-frame", "audio"],
    call: veo("fal-ai/veo3.1"),
  },
  {
    id: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    durations: [4, 6, 8],
    aspectRatios: ["16:9", "9:16"],
    features: ["start-frame", "end-frame", "audio"],
    call: veo("fal-ai/veo3.1/fast"),
  },
  {
    id: "wan-2.6",
    name: "Wan 2.6",
    durations: [5, 10, 15],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    features: ["start-frame"],
    call: ({ prompt, duration, seed }, frames) => {
      if (!frames.start) throw new Error("Wan 2.6 on fal animates a start frame; give it one.");
      return { endpoint: "wan/v2.6/image-to-video", body: { prompt, image_url: frames.start, duration: String(duration), seed } };
    },
  },
  {
    id: "hailuo-2.3",
    name: "Hailuo 2.3",
    durations: [6],
    aspectRatios: ["16:9"],
    features: ["start-frame"],
    call: ({ prompt }, frames) => ({
      endpoint: frames.start ? "fal-ai/minimax/hailuo-2.3/pro/image-to-video" : "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
      body: { prompt, image_url: frames.start },
    }),
  },
];

export const falImages: Provider<"image"> = {
  id: "fal-images",
  name: "fal",
  capability: "image",
  vendor: "fal",
  models: () => IMAGE_MODELS,

  async run({ model, prompt, aspectRatio, seed, images }, context) {
    const session = open(context);
    const chosen = IMAGE_MODELS.find((candidate) => candidate.id === model);
    if (!chosen) throw new Error(`fal does not offer the image model "${model}".`);

    const body: Body = { prompt };
    if (chosen.sizing === "preset") body.image_size = IMAGE_SIZE_PRESETS[aspectRatio];
    else body.aspect_ratio = aspectRatio;
    if (chosen.seeded) body.seed = seed;
    if (images.length > 0) body.image_urls = await Promise.all(images.map((image) => upload(session, image)));

    const endpoint = images.length > 0 ? chosen.edit : chosen.textToImage;
    const result = await generate<{ images: FalFile[] }>(session, endpoint, body);
    return Promise.all(result.images.map((image) => download(session, image)));
  },
};

export const falVideos: Provider<"video"> = {
  id: "fal-videos",
  name: "fal",
  capability: "video",
  vendor: "fal",
  models: () => VIDEO_MODELS,

  async run(input, context) {
    const session = open(context);
    const chosen = VIDEO_MODELS.find((candidate) => candidate.id === input.model);
    if (!chosen) throw new Error(`fal does not offer the video model "${input.model}".`);
    if (input.endFrame && !input.startFrame) throw new Error("An end frame needs a start frame to go with it.");

    const [start, end] = await Promise.all([
      input.startFrame && upload(session, input.startFrame),
      input.endFrame && upload(session, input.endFrame),
    ]);
    const { endpoint, body } = chosen.call(input, { start, end });
    const result = await generate<{ video: FalFile }>(session, endpoint, body);
    return [await download(session, result.video)];
  },
};

function open({ apiKey, signal }: { apiKey: string | null; signal?: AbortSignal }): Session {
  if (!apiKey) throw new Error("fal has no API key.");
  return { apiKey, signal };
}

async function generate<T>(session: Session, endpoint: string, body: Body): Promise<T> {
  const submitted = await request<Submitted>(session, `${QUEUE}/${endpoint}`, { method: "POST", body: JSON.stringify(body) });
  const cancel = () => void fetch(submitted.cancel_url, { method: "PUT", headers: authorization(session) }).catch(() => {});
  session.signal?.addEventListener("abort", cancel, { once: true });
  try {
    let delay = POLL_INITIAL_MS;
    while (true) {
      await sleep(delay, session.signal);
      const { status } = await request<{ status: string }>(session, submitted.status_url, { method: "GET" });
      if (status === "COMPLETED") break;
      delay = Math.min(delay * POLL_GROWTH, POLL_MAX_MS);
    }
  } finally {
    session.signal?.removeEventListener("abort", cancel);
  }
  return request<T>(session, submitted.response_url, { method: "GET" });
}

async function upload(session: Session, file: File): Promise<string> {
  const type = file.type || "application/octet-stream";
  const { upload_url, file_url } = await request<{ upload_url: string; file_url: string }>(session, STORAGE_INITIATE, {
    method: "POST",
    body: JSON.stringify({ content_type: type, file_name: file.name }),
  });
  const stored = await fetch(upload_url, { method: "PUT", signal: session.signal, headers: { "Content-Type": type }, body: file });
  await ensureOk(stored);
  return file_url;
}

async function download(session: Session, file: FalFile): Promise<File> {
  const response = await fetch(file.url, { signal: session.signal });
  await ensureOk(response);
  const blob = await response.blob();
  const name = file.file_name ?? decodeURIComponent(new URL(file.url).pathname.split("/").pop() ?? "result");
  return new File([blob], name, { type: file.content_type ?? blob.type });
}

const authorization = (session: Session) => ({ Authorization: `Key ${session.apiKey}` });

async function request<T>(session: Session, url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: session.signal,
    headers: { ...authorization(session), "Content-Type": "application/json", Accept: "application/json" },
  });
  await ensureOk(response);
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = response.statusText;
  try {
    const body = (await response.json()) as { detail?: unknown; message?: string };
    detail = describe(body.detail) ?? body.message ?? detail;
  } catch {}
  throw new Error(`fal request failed (${response.status}): ${detail}`);
}

function describe(detail: unknown): string | undefined {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return undefined;
  return detail
    .map((item: { loc?: unknown[]; msg?: string }) => (item.loc ? `${item.loc.join(".")}: ${item.msg}` : item.msg ?? String(item)))
    .join("; ");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
