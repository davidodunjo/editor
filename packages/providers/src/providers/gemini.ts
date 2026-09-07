/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ModelInfo, Provider } from "../index";

const API = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_PROMPT =
  "Describe this media over time with timestamps: what is said, what is heard, and what is shown.";
const INLINE_REQUEST_LIMIT_BYTES = 20 * 1024 * 1024;
const BASE64_GROWTH = 4 / 3;
const FILE_POLL_INTERVAL_MS = 2000;

const MODELS: ModelInfo[] = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "Most capable Flash model." },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", description: "Previous-generation Flash model." },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", description: "Balances speed and multimodal capability." },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", description: "Fastest and most cost-effective." },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Advanced reasoning for complex problems." },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Best price-performance for high-volume tasks." },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Deep reasoning for complex tasks." },
];

type Session = { apiKey: string; signal?: AbortSignal };

type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

type GeminiFile = {
  name: string;
  uri: string;
  mimeType: string;
  state: "STATE_UNSPECIFIED" | "PROCESSING" | "ACTIVE" | "FAILED";
  error?: { message?: string };
};

export const gemini: Provider<"listen"> = {
  id: "gemini",
  name: "Gemini",
  capability: "listen",
  vendor: "gemini",
  models: () => MODELS,

  async run({ media, prompt }, { apiKey, signal }) {
    if (!apiKey) throw new Error("Gemini has no API key.");
    if (!media.type) throw new Error(`"${media.name}" has no MIME type, so Gemini cannot read it.`);

    const session = { apiKey, signal };
    if (fitsInline(media)) return describe(session, await inlinePart(media), prompt);

    const file = await upload(session, media);
    try {
      return await describe(session, { fileData: { mimeType: file.mimeType, fileUri: file.uri } }, prompt);
    } finally {
      void request(session, `/v1beta/${file.name}`, { method: "DELETE" }).catch(() => {});
    }
  },
};

const fitsInline = (media: File) => media.size * BASE64_GROWTH < INLINE_REQUEST_LIMIT_BYTES;

async function inlinePart(media: File): Promise<Part> {
  return { inlineData: { mimeType: media.type, data: await base64(media) } };
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function describe(session: Session, media: Part, prompt: string | undefined): Promise<string> {
  const result = await request<GenerateContentResponse>(session, `/v1beta/models/${DEFAULT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [media, { text: prompt || DEFAULT_PROMPT }] }] }),
  });

  const blocked = result.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini declined the request: ${blocked}`);

  const candidate = result.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini returned no text${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}.`);
  return text;
}

async function upload(session: Session, media: File): Promise<GeminiFile> {
  const started = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    signal: session.signal,
    headers: {
      "x-goog-api-key": session.apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(media.size),
      "X-Goog-Upload-Header-Content-Type": media.type,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: media.name } }),
  });
  await ensureOk(started);

  const uploadUrl = started.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini did not return an upload URL.");

  const finished = await fetch(uploadUrl, {
    method: "POST",
    signal: session.signal,
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: media,
  });
  await ensureOk(finished);

  let { file } = (await finished.json()) as { file: GeminiFile };
  while (file.state === "PROCESSING") {
    await sleep(FILE_POLL_INTERVAL_MS, session.signal);
    file = await request<GeminiFile>(session, `/v1beta/${file.name}`, { method: "GET" });
  }
  if (file.state !== "ACTIVE") {
    throw new Error(`Gemini could not process "${media.name}": ${file.error?.message ?? file.state}`);
  }
  return file;
}

async function request<T>(session: Session, path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: session.signal,
    headers: { "x-goog-api-key": session.apiKey, ...init.headers },
  });
  await ensureOk(response);
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = response.statusText;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? detail;
  } catch {}
  throw new Error(`Gemini request failed (${response.status}): ${detail}`);
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
